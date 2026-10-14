'use strict';
/**
 * Keeps one n8n child process alive inside the function instance, waits for it to
 * be ready, and shuts it down after a period of inactivity so that
 *   - Neon (free) can autosuspend its compute (5 min idle), and
 *   - Vercel Hobby memory/CPU allowances are not wasted.
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { buildN8nEnv, N8N_PORT } = require('./config');

const BOOT_TIMEOUT_MS = Number(process.env.N8N_BOOT_TIMEOUT_SECONDS || 270) * 1000;
const IDLE_MS = Number(process.env.N8N_IDLE_SHUTDOWN_SECONDS || 240) * 1000;
const N8N_BIN = path.join(__dirname, '..', 'node_modules', 'n8n', 'bin', 'n8n');

let state = null;
let inflight = 0;
let lastActivity = Date.now();
let idleTimer = null;

const log = (...a) => console.log('[n8n-supervisor]', ...a);

function probe(urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: N8N_PORT, path: urlPath, timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

function start() {
  const { env, meta } = buildN8nEnv();
  log('starting n8n', meta);
  const child = spawn(process.execPath, [N8N_BIN, 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { child, startedAt: Date.now(), readyAt: null, exited: false, ready: null };

  child.stdout.on('data', (d) => process.stdout.write(`[n8n] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[n8n] ${d}`));
  child.on('exit', (code, sig) => {
    s.exited = true;
    log(`n8n exited code=${code} signal=${sig}`);
    if (state === s) state = null;
  });

  s.ready = new Promise((resolve, reject) => {
    const tick = async () => {
      if (s.exited) return reject(new Error('n8n exited during startup'));
      if (Date.now() - s.startedAt > BOOT_TIMEOUT_MS) {
        child.kill('SIGKILL');
        return reject(new Error('n8n boot timeout'));
      }
      if ((await probe('/healthz/readiness')) === 200) {
        s.readyAt = Date.now();
        log(`n8n ready in ${s.readyAt - s.startedAt} ms`);
        return resolve();
      }
      setTimeout(tick, 500);
    };
    tick();
  });
  s.ready.catch(() => { if (state === s) state = null; });
  return s;
}

async function ensureRunning() {
  if (state && !state.exited && inflight === 0 && state.readyAt && Date.now() - lastActivity > IDLE_MS) {
    log('stale after freeze/idle, restarting');
    await stop();
  }
  if (!state || state.exited) state = start();
  armIdleTimer();
  return state.ready;
}

function stop() {
  if (!state) return Promise.resolve();
  const s = state;
  state = null;
  return new Promise((resolve) => {
    if (s.exited) return resolve();
    s.child.once('exit', () => resolve());
    try { s.child.kill('SIGTERM'); } catch { }
    setTimeout(() => {
      try { s.child.kill('SIGKILL'); } catch { }
      resolve();
    }, 4000).unref();
  });
}

function armIdleTimer() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (!state || !state.readyAt) return;
    if (inflight === 0 && Date.now() - lastActivity > IDLE_MS) {
      log(`idle for ${Math.round((Date.now() - lastActivity) / 1000)}s, stopping n8n so the database can sleep`);
      stop();
    }
  }, 10_000);
  idleTimer.unref();
}

function begin() { inflight++; lastActivity = Date.now(); }
function end() { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); }

function status() {
  return {
    running: !!state && !state.exited,
    ready: !!(state && state.readyAt),
    bootMs: state && state.readyAt ? state.readyAt - state.startedAt : null,
    uptimeS: state ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
    inflight,
    idleLimitS: IDLE_MS / 1000,
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  };
}

function isRunning() {
  return !!(state && !state.exited && state.readyAt);
}

process.on('exit', () => { try { state && state.child.kill('SIGKILL'); } catch { } });

module.exports = { ensureRunning, begin, end, status, stop, isRunning, N8N_PORT };
