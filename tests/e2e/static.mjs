import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = '/home/claude/opositor-ia';
const keys = JSON.parse(fs.readFileSync('/home/claude/e2e/keys.json'));
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/assets/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`export const SUPABASE_URL='http://localhost:54321'; export const SUPABASE_ANON_KEY='${keys.ANON}'; export const ZONA_HORARIA='Europe/Madrid';`);
  }
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
}).listen(8080, () => console.log('static 8080'));
