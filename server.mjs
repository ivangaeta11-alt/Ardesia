import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/ink-lab.html') { res.writeHead(404); res.end('Non trovato'); return; }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !Object.hasOwn(types, extname(file)) || pathname.startsWith('/tests/')) {
      res.writeHead(404); res.end('Non trovato'); return;
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }); res.end(content);
  } catch { res.writeHead(404); res.end('Non trovato'); }
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => {
  const actualPort = server.address().port;
  console.log(`Ardesia: http://localhost:${actualPort}`);
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const opener = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', `http://localhost:${actualPort}`], { detached: true, windowsHide: true, stdio: 'ignore' });
    opener.on('error', () => console.log('Apri manualmente l’indirizzo sopra nel browser.')); opener.unref();
  }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Porta ${port} occupata. Apri http://localhost:${port} oppure imposta PORT.` : error.message); process.exitCode = 1; });

