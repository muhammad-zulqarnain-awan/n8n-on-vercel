'use strict';
/**
 * Vercel Function entrypoint: reverse proxy in front of a local n8n process.
 * vercel.json rewrites every path to this function so the original URL is preserved.
 */
const http = require('node:http');
const sup = require('../lib/supervisor');

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']);

function fail(res, code, msg) {
  if (res.headersSent) return res.end();
  res.statusCode = code;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('retry-after', '5');
  res.end(msg);
}

module.exports = async (req, res) => {
  // Optional diagnostics, only when STATUS_TOKEN is configured.
  if (req.url.startsWith('/__status') && process.env.STATUS_TOKEN) {
    if (req.headers['x-status-token'] !== process.env.STATUS_TOKEN) return fail(res, 404, 'Not found');
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(sup.status()));
  }

  sup.begin();
  let done = false;
  const finish = () => { if (!done) { done = true; sup.end(); } };
  res.on('close', finish);

  try {
    await sup.ensureRunning();
  } catch (e) {
    console.error('[proxy] n8n not available:', e.message);
    finish();
    return fail(res, 503, `n8n is starting or unavailable: ${e.message}`);
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;

  const upstream = http.request(
    { host: '127.0.0.1', port: sup.N8N_PORT, method: req.method, path: req.url, headers },
    (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(ur.statusCode || 502, out);
      if ((ur.headers['content-type'] || '').includes('text/event-stream')) res.flushHeaders();
      ur.pipe(res);
    },
  );
  upstream.on('error', (e) => { console.error('[proxy] upstream error:', e.message); fail(res, 502, 'Bad gateway'); });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
};
