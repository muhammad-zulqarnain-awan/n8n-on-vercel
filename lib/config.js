'use strict';
/**
 * Builds the environment for the n8n child process.
 * Everything n8n needs is derived from a small set of Vercel project env vars:
 *   N8N_ENCRYPTION_KEY  (required)  - generate once, never change
 *   DATABASE_URL_UNPOOLED | DATABASE_URL | POSTGRES_URL_NON_POOLING | POSTGRES_URL  (one required; Neon integration injects these)
 *   N8N_PUBLIC_URL      (recommended) - e.g. https://n8n.example.com (your custom domain)
 */

const N8N_PORT = Number(process.env.N8N_INTERNAL_PORT || 5678);

function pickDatabaseUrl(env) {
  const keys = [
    'N8N_DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING',
    'DATABASE_URL',
    'POSTGRES_URL',
  ];
  for (const k of keys) if (env[k]) return { key: k, value: env[k] };
  return null;
}

function parseDatabaseUrl(raw) {
  const u = new URL(raw);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('Database URL must be postgres://');
  const host = u.hostname;
  const sslmode = u.searchParams.get('sslmode');
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return {
    host,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    ssl: !isLocal && sslmode !== 'disable',
  };
}

function resolvePublicUrl(env) {
  let raw =
    env.N8N_PUBLIC_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (env.VERCEL_URL && `https://${env.VERCEL_URL}`);
  if (!raw) throw new Error('Set N8N_PUBLIC_URL (e.g. https://n8n.example.com)');
  if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`;
  const u = new URL(raw);
  return { origin: u.origin, host: u.host, protocol: u.protocol.replace(':', '') };
}

const STRIP = [/^VERCEL_/, /^AWS_/, /^POSTGRES_/, /^DATABASE_URL/, /^PG[A-Z_]*$/, /^NEON_/, /^NEXT_/, /^STATUS_TOKEN$/];

function buildN8nEnv(base = process.env) {
  if (!base.N8N_ENCRYPTION_KEY) throw new Error('N8N_ENCRYPTION_KEY is required');
  const dbPick = pickDatabaseUrl(base);
  if (!dbPick) throw new Error('No database URL found (DATABASE_URL_UNPOOLED / DATABASE_URL / POSTGRES_URL...)');
  const db = parseDatabaseUrl(dbPick.value);
  const pub = resolvePublicUrl(base);

  const inherited = {};
  for (const [k, v] of Object.entries(base)) {
    if (STRIP.some((re) => re.test(k))) continue;
    inherited[k] = v;
  }

  const env = {
    ...inherited,

    N8N_PORT: String(N8N_PORT),
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_HOST: pub.host.replace(/:\d+$/, ''),
    N8N_PROTOCOL: pub.protocol,
    N8N_WEBHOOK_URL: `${pub.origin}/`,
    N8N_EDITOR_BASE_URL: pub.origin,
    N8N_PROXY_HOPS: '1',
    N8N_SECURE_COOKIE: pub.protocol === 'https' ? 'true' : 'false',
    N8N_PUSH_BACKEND: 'sse',
    N8N_USER_FOLDER: '/tmp/n8n',
    HOME: '/tmp',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_HIRING_BANNER_ENABLED: 'false',
    N8N_AI_ENABLED: 'false',
    N8N_COMMUNITY_PACKAGES_ENABLED: 'false',
    N8N_UNVERIFIED_PACKAGES_ENABLED: 'false',
    N8N_PAYLOAD_SIZE_MAX: '4',
    N8N_FORMDATA_FILE_SIZE_MAX: '4',
    N8N_DEFAULT_BINARY_DATA_MODE: base.N8N_DEFAULT_BINARY_DATA_MODE || 'database',
    N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES: '268435456',
    N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES: '1000',
    N8N_RUNNERS_TASK_TIMEOUT: base.N8N_RUNNERS_TASK_TIMEOUT || '120',
    EXECUTIONS_MODE: 'regular',
    DB_TYPE: 'postgresdb',
    DB_POSTGRESDB_HOST: db.host,
    DB_POSTGRESDB_PORT: String(db.port),
    DB_POSTGRESDB_USER: db.user,
    DB_POSTGRESDB_PASSWORD: db.password,
    DB_POSTGRESDB_DATABASE: db.database,
    DB_POSTGRESDB_SCHEMA: base.DB_POSTGRESDB_SCHEMA || 'public',
    DB_POSTGRESDB_SSL_ENABLED: db.ssl ? 'true' : 'false',
    DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED: 'true',
    DB_POSTGRESDB_POOL_SIZE: base.DB_POSTGRESDB_POOL_SIZE || '2',
    DB_POSTGRESDB_CONNECTION_TIMEOUT: base.DB_POSTGRESDB_CONNECTION_TIMEOUT || '30000',
    DB_PING_INTERVAL_SECONDS: base.DB_PING_INTERVAL_SECONDS || '30',
    EXECUTIONS_DATA_PRUNE: 'true',
    EXECUTIONS_DATA_MAX_AGE: base.EXECUTIONS_DATA_MAX_AGE || '72',
    EXECUTIONS_DATA_PRUNE_MAX_COUNT: base.EXECUTIONS_DATA_PRUNE_MAX_COUNT || '1000',
    NODE_OPTIONS: base.N8N_NODE_OPTIONS || '--max-old-space-size=1100',
  };
  return { env, meta: { dbKey: dbPick.key, dbHost: db.host, publicUrl: pub.origin } };
}

module.exports = { buildN8nEnv, parseDatabaseUrl, N8N_PORT };
