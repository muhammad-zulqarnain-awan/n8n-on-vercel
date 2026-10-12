'use strict';
// Local stand-in for the Vercel runtime: every request goes to api/index.js.
const http = require('node:http');
const handler = require('../api/index.js');
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => handler(req, res)).listen(port, () => console.log(`dev server on :${port}`));
const sup = require('../lib/supervisor');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { sup.stop(); setTimeout(() => process.exit(0), 500); });
