import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(), port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  try {
    let requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (requestPath.endsWith('/')) requestPath += 'index.html';
    const file = path.resolve(root, '.' + requestPath);
    if (!file.startsWith(root + path.sep) || /[\\/](node_modules|\.git|\.private-audit)([\\/]|$)/.test(file)) { res.writeHead(403); res.end(); return; }
    const content = await readFile(file); res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
