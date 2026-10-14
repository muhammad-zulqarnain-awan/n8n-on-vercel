'use strict';
/**
 * Native Scheduler Execution Engine for n8n on Vercel.
 *
 * Inspects Neon PostgreSQL for active workflows with native Schedule/Cron/Interval
 * triggers, evaluates whether they are due to run, and executes due workflows
 * directly using n8n's execution runner (`n8n execute --id <workflowId>`).
 *
 * This allows users to use standard n8n Schedule Trigger nodes without having
 * to convert them to webhooks or rely on third-party schedulers.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const { buildN8nEnv, pickDatabaseUrl, parseDatabaseUrl } = require('./config');

const N8N_BIN = path.join(__dirname, '..', 'node_modules', 'n8n', 'bin', 'n8n');
const SCHEDULE_NODE_TYPES = new Set([
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.cron',
  'n8n-nodes-base.interval',
]);

const log = (...a) => console.log('[n8n-engine]', ...a);

/**
 * Creates a database client using the resolved database credentials.
 */
function createDbClient() {
  const dbPick = pickDatabaseUrl(process.env);
  if (!dbPick) throw new Error('No database URL found');
  const db = parseDatabaseUrl(dbPick.value);
  return new Client({
    host: db.host,
    port: Number(db.port),
    user: db.user,
    password: db.password,
    database: db.database,
    ssl: db.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  });
}

/**
 * Parses nodes payload from database row.
 */
function parseNodes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Determines minimum interval in milliseconds for a trigger node.
 */
function getTriggerIntervalMs(node) {
  const type = node.type;
  const p = node.parameters || {};

  if (type === 'n8n-nodes-base.interval') {
    const val = Number(p.intervalValue || 1);
    const unit = String(p.unit || 'hours').toLowerCase();
    const multipliers = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
    return val * (multipliers[unit] || 3_600_000);
  }

  if (type === 'n8n-nodes-base.scheduleTrigger') {
    const rule = p.rule || {};
    const interval = Array.isArray(rule.interval) ? rule.interval[0] : rule.interval;
    if (interval) {
      if (interval.field === 'minutes') return (Number(interval.minutesInterval) || 1) * 60_000;
      if (interval.field === 'hours') return (Number(interval.hoursInterval) || 1) * 3_600_000;
      if (interval.field === 'days') return (Number(interval.daysInterval) || 1) * 86_400_000;
      if (interval.field === 'weeks') return (Number(interval.weeksInterval) || 1) * 7 * 86_400_000;
      if (interval.field === 'months') return (Number(interval.monthsInterval) || 1) * 30 * 86_400_000;
    }
    // Default fallback for scheduleTrigger
    return 3_600_000;
  }

  if (type === 'n8n-nodes-base.cron') {
    return 3_600_000; // default 1 hour
  }

  return 3_600_000;
}

/**
 * Evaluates whether a workflow is due based on its schedule node and last execution time.
 */
function isWorkflowDue(node, lastRunTime) {
  if (!lastRunTime) return true; // Never run before, should run
  const lastTime = new Date(lastRunTime).getTime();
  if (isNaN(lastTime)) return true;

  const intervalMs = getTriggerIntervalMs(node);
  const elapsed = Date.now() - lastTime;
  return elapsed >= intervalMs;
}

/**
 * Executes a single workflow via n8n's CLI execution runner.
 */
function executeWorkflow(workflowId, n8nEnv, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    log(`executing workflow ${workflowId}...`);

    const childEnv = {
      ...n8nEnv,
      NODE_OPTIONS: '--max-old-space-size=320',
    };

    const child = spawn(process.execPath, [N8N_BIN, 'execute', '--id', String(workflowId)], {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    let timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { }
      resolve({
        id: workflowId,
        status: 'timeout',
        durationMs: Date.now() - start,
        error: `Timed out after ${timeoutMs / 1000}s`,
      });
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const success = code === 0;
      log(`workflow ${workflowId} finished code=${code} signal=${signal} in ${durationMs}ms`);
      resolve({
        id: workflowId,
        status: success ? 'success' : 'error',
        code,
        signal,
        durationMs,
        output: (stdout + '\n' + stderr).trim().slice(-1000), // last 1000 chars of output
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        id: workflowId,
        status: 'error',
        durationMs: Date.now() - start,
        error: err.message,
      });
    });
  });
}

/**
 * Main dispatcher: finds all active scheduled workflows, evaluates if due, and executes them.
 */
async function runDueWorkflows() {
  const client = createDbClient();
  await client.connect();

  try {
    // 1. Check if workflow_entity table exists
    const schema = process.env.DB_POSTGRESDB_SCHEMA || 'public';
    const checkTable = await client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'workflow_entity'
      ) as exists`,
      [schema]
    );

    if (!checkTable.rows[0]?.exists) {
      log('workflow_entity table not found; database not yet initialized by n8n');
      return {
        ok: true,
        message: 'Database not initialized yet. Open the n8n editor first to create tables.',
        evaluated: 0,
        due: 0,
        executed: [],
      };
    }

    // 2. Fetch all active workflows
    const wfRes = await client.query(
      `SELECT id, name, nodes FROM "workflow_entity" WHERE active = true`
    );

    const workflows = wfRes.rows;
    log(`found ${workflows.length} active workflows in database`);

    // 3. Check if execution_entity table exists for last-run lookups
    const checkExec = await client.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = 'execution_entity'
      ) as exists`,
      [schema]
    );
    const hasExecutionTable = checkExec.rows[0]?.exists;

    const dueList = [];

    for (const wf of workflows) {
      const nodes = parseNodes(wf.nodes);
      const schedNode = nodes.find((n) => SCHEDULE_NODE_TYPES.has(n.type));

      if (!schedNode) continue; // Not a scheduled workflow

      let lastRun = null;
      if (hasExecutionTable) {
        try {
          const execRes = await client.query(
            `SELECT "startedAt" FROM "execution_entity" WHERE "workflowId" = $1 ORDER BY "startedAt" DESC LIMIT 1`,
            [wf.id]
          );
          if (execRes.rows[0]?.startedAt) {
            lastRun = execRes.rows[0].startedAt;
          }
        } catch (e) {
          log(`could not fetch last execution for ${wf.id}:`, e.message);
        }
      }

      if (isWorkflowDue(schedNode, lastRun)) {
        log(`workflow "${wf.name}" (${wf.id}) is DUE to run (last run: ${lastRun || 'never'})`);
        dueList.push({ id: wf.id, name: wf.name });
      } else {
        log(`workflow "${wf.name}" (${wf.id}) is NOT due yet (last run: ${lastRun})`);
      }
    }

    if (dueList.length === 0) {
      return {
        ok: true,
        evaluated: workflows.length,
        due: 0,
        executed: [],
        timestamp: new Date().toISOString(),
      };
    }

    // 4. Build execution environment
    const { env } = buildN8nEnv();

    // 5. Execute due workflows sequentially with safety timeout guard
    const startTime = Date.now();
    const SAFETY_TIMEOUT_MS = 240_000; // 4 minutes safety limit (Vercel hard limit is 300s)
    const executed = [];
    let deferredCount = 0;

    for (let i = 0; i < dueList.length; i++) {
      if (Date.now() - startTime > SAFETY_TIMEOUT_MS) {
        deferredCount = dueList.length - i;
        log(`approaching timeout limit (${Math.round((Date.now() - startTime) / 1000)}s elapsed); deferring ${deferredCount} workflow(s) to next pulse`);
        break;
      }
      const item = dueList[i];
      const result = await executeWorkflow(item.id, env);
      executed.push({ ...result, name: item.name });
    }

    return {
      ok: true,
      evaluated: workflows.length,
      due: dueList.length,
      executed,
      deferred: deferredCount,
      timestamp: new Date().toISOString(),
    };
  } finally {
    try {
      await client.end();
    } catch { }
  }
}

module.exports = { runDueWorkflows };
