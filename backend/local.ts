import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { handleRequest } from './src/runtime.js';
if (existsSync('.env')) loadEnvFile('.env');
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    headers.set('x-real-ip', req.socket.remoteAddress ?? '127.0.0.1');
    let body = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 24000) { res.writeHead(413, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ message: 'Solicitud demasiado grande.' })); return; } body += chunk; }
    const request = new Request(new URL(req.url ?? '/', process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'), { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method ?? 'GET') ? {} : { body }) });
    const response = await handleRequest(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
    const cookies = response.headers.getSetCookie(); if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500, { 'cache-control': 'no-store' }).end(); }
});
server.listen(Number(process.env.PORT ?? 3001), '127.0.0.1', () => { const a = server.address(); if (a && typeof a !== 'string') console.log(`Ritmo API: http://127.0.0.1:${a.port}`); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
