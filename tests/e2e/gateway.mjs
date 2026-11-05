// Pasarela local que imita la API de Supabase para pruebas E2E.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
export const ANON = jwt.sign({ role: 'anon', iss: 'supabase' }, SECRET);
export const SERVICE = jwt.sign({ role: 'service_role', iss: 'supabase' }, SECRET);
fs.writeFileSync('/home/claude/e2e/keys.json', JSON.stringify({ ANON, SERVICE }));
const db = new pg.Pool({ connectionString: 'postgres://postgres:pw@127.0.0.1:5432/opotest' });
const users = new Map(); // email -> {id,password}
const refresh = new Map();
const FILES = '/home/claude/e2e/srv/files';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const send = (res, code, body, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...cors, ...h }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const leer = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
function sesion(u) {
  const access_token = jwt.sign({ sub: u.id, role: 'authenticated', email: u.email, aud: 'authenticated' }, SECRET, { expiresIn: 3600 });
  const rt = crypto.randomUUID(); refresh.set(rt, u);
  const user = { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: u.meta || {}, app_metadata: {}, created_at: new Date().toISOString() };
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: rt, user };
}
function usuarioDe(req) {
  try { const t = (req.headers.authorization || '').replace('Bearer ', ''); const c = jwt.verify(t, SECRET); return c; } catch { return null; }
}
function proxy(req, res, port, prefix, body) {
  const p = http.request({ host: '127.0.0.1', port, path: req.url.replace(prefix, '') || '/', method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res);
  });
  p.on('error', (e) => send(res, 502, { error: String(e) }));
  p.end(body);
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, '');
  const url = new URL(req.url, 'http://x');
  const body = await leer(req);
  try {
    if (url.pathname.startsWith('/rest/v1')) return proxy(req, res, 3000, '/rest/v1', body);
    if (url.pathname.startsWith('/functions/v1')) return proxy(req, res, 8000, '/functions/v1', body);
    if (url.pathname === '/auth/v1/signup') {
      const b = JSON.parse(body); if (users.has(b.email)) return send(res, 422, { msg: 'User already registered', error_code: 'user_already_exists' });
      const u = { id: crypto.randomUUID(), email: b.email, password: b.password, meta: b.data || {} }; users.set(b.email, u);
      await db.query('insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)', [u.id, u.email, u.meta]);
      return send(res, 200, sesion(u));
    }
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(body);
      if (url.searchParams.get('grant_type') === 'password') {
        const u = users.get(b.email); if (!u || u.password !== b.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 400, error_code: 'invalid_credentials' });
        return send(res, 200, sesion(u));
      }
      const u = refresh.get(b.refresh_token); if (!u) return send(res, 400, { error: 'invalid_grant' }); return send(res, 200, sesion(u));
    }
    if (url.pathname === '/auth/v1/user') {
      const c = usuarioDe(req); if (!c?.sub) return send(res, 401, { msg: 'invalid JWT' });
      const u = [...users.values()].find((x) => x.id === c.sub);
      if (req.method === 'PUT') { const b = JSON.parse(body); if (b.password) u.password = b.password; }
      return send(res, 200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', user_metadata: u.meta, app_metadata: {} });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204, '');
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});
    // Storage
    let m;
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?documentos\/(.+)$/))) {
      const c = usuarioDe(req); const rel = decodeURIComponent(m[1]);
      if (c?.role !== 'service_role' && rel.split('/')[0] !== c?.sub) return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      const f = path.join(FILES, rel);
      if (req.method === 'POST' || req.method === 'PUT') { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); return send(res, 200, { Key: `documentos/${rel}`, Id: crypto.randomUUID() }); }
      if (req.method === 'GET') return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), { 'content-type': 'application/octet-stream' }) : send(res, 404, { error: 'not found' });
    }
    if ((m = url.pathname.match(/^\/storage\/v1\/object\/sign\/documentos\/(.+)$/))) return send(res, 200, { signedURL: `/object/sign/documentos/${m[1]}?token=x` });
    if (url.pathname === '/storage/v1/object/documentos' && req.method === 'DELETE') {
      const b = JSON.parse(body); (b.prefixes || []).forEach((p) => fs.rmSync(path.join(FILES, p), { force: true })); return send(res, 200, []);
    }
    return send(res, 404, { error: 'no route ' + url.pathname });
  } catch (e) { console.error(e); return send(res, 500, { error: String(e) }); }
}).listen(54321, () => console.log('gateway 54321'));
