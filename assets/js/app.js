// Arranque, autenticación, layout y enrutado.
import { sb, configurado } from './lib/supabase.js';
import { store, cargarSesion, cambiarOposicion, onCambio } from './lib/store.js';
import { esc, icon, toastError, cargando } from './lib/ui.js';
import { refrescarTrabajos, onTrabajos, trabajosActivos, pararSondeo } from './lib/trabajos.js';
import { renderAuth, renderNuevaPassword } from './views/auth.js';
import { renderOnboarding } from './views/onboarding.js';

const RUTAS = [
  { re: /^\/?$/, vista: 'dashboard', titulo: 'Dashboard' },
  { re: /^\/oposicion$/, vista: 'oposicion', titulo: 'Mi oposición' },
  { re: /^\/temario$/, vista: 'temario', titulo: 'Mi temario' },
  { re: /^\/temario\/([\w-]+)$/, vista: 'tema', titulo: 'Mi temario', nav: 'temario' },
  { re: /^\/banco$/, vista: 'banco', titulo: 'Banco de preguntas' },
  { re: /^\/banco\/importar$/, vista: 'importar', titulo: 'Importar preguntas', nav: 'banco' },
  { re: /^\/banco\/revision$/, vista: 'revision', titulo: 'Revisar preguntas', nav: 'banco' },
  { re: /^\/estudiar$/, vista: 'estudiar', titulo: 'Estudiar' },
  { re: /^\/estudiar\/([\w-]+)$/, vista: 'estudiar-tema', titulo: 'Estudiar', nav: 'estudiar' },
  { re: /^\/simulacros$/, vista: 'simulacros', titulo: 'Simulacros' },
  { re: /^\/simulacros\/([\w-]+)$/, vista: 'simulacro-detalle', titulo: 'Simulacros', nav: 'simulacros' },
  { re: /^\/repaso$/, vista: 'repaso', titulo: 'Repaso inteligente' },
  { re: /^\/progreso$/, vista: 'progreso', titulo: 'Mi progreso' },
  { re: /^\/configuracion$/, vista: 'configuracion', titulo: 'Configuración' },
];

const NAV = [
  ['dashboard', '#/', 'dashboard', 'Dashboard'],
  ['oposicion', '#/oposicion', 'target', 'Mi oposición'],
  ['temario', '#/temario', 'book', 'Mi temario'],
  ['banco', '#/banco', 'bank', 'Banco de preguntas'],
  ['estudiar', '#/estudiar', 'study', 'Estudiar'],
  ['simulacros', '#/simulacros', 'exam', 'Simulacros'],
  ['repaso', '#/repaso', 'brain', 'Repaso inteligente'],
  ['progreso', '#/progreso', 'chart', 'Mi progreso'],
  null,
  ['configuracion', '#/configuracion', 'settings', 'Configuración'],
];

const root = document.getElementById('root');
let limpiezaVista = null;
let renderId = 0;

// ---------------------------------------------------------------------
async function arrancar() {
  if (!configurado) {
    root.innerHTML = `<div class="auth-main" style="min-height:100vh"><div class="card card-pad" style="max-width:520px">
      <h2>Falta configurar Supabase</h2>
      <p class="muted" style="margin-top:8px">Edita <code>assets/js/config.js</code> con la URL y la anon key de tu proyecto de Supabase. Tienes los pasos en el README.</p></div></div>`;
    return;
  }

  sb.auth.onAuthStateChange((evento, session) => {
    if (evento === 'PASSWORD_RECOVERY') { renderNuevaPassword(root); return; }
    if (evento === 'SIGNED_OUT') { pararSondeo(); store.user = null; renderAuth(root); }
    if (evento === 'SIGNED_IN' && !store.user && session?.user) setTimeout(() => entrar(session.user), 0);
  });

  const { data: { session } } = await sb.auth.getSession();
  if (location.hash.includes('type=recovery')) return;
  if (!session) return renderAuth(root);
  await entrar(session.user);
}

async function entrar(user) {
  try {
    root.innerHTML = cargando('Preparando tu espacio…');
    await cargarSesion(user);
    if (!store.oposicion) return renderOnboarding(root, () => montarLayout());
    montarLayout();
  } catch (e) {
    toastError(e);
    root.innerHTML = `<div class="loading">No se pudo cargar tu cuenta. <button class="btn btn-sm" onclick="location.reload()">Reintentar</button></div>`;
  }
}

// ---------------------------------------------------------------------
function montarLayout() {
  root.innerHTML = `
    <div class="app" id="app">
      <aside class="sidebar">
        <div class="brand"><div class="brand-logo">O</div>Opositor IA</div>
        <div class="opos-switch"><select data-opos aria-label="Oposición activa"></select></div>
        <nav class="nav" data-nav></nav>
        <div class="side-foot">
          <div class="user" data-user></div>
          <button class="btn btn-ghost btn-sm" data-logout style="color:var(--side-text);padding:0;margin-top:6px;height:auto">${icon('logout')} Cerrar sesión</button>
        </div>
      </aside>
      <div class="scrim" data-scrim></div>
      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-icon menu-btn" data-menu aria-label="Menú">${icon('menu')}</button>
          <span class="title" data-titulo></span>
          <span class="spacer"></span>
          <span data-ia></span>
        </header>
        <main class="content" id="vista"></main>
      </div>
    </div>`;
  const app = document.getElementById('app');
  root.querySelector('[data-menu]').onclick = () => app.classList.toggle('nav-open');
  root.querySelector('[data-scrim]').onclick = () => app.classList.remove('nav-open');
  root.querySelector('[data-logout]').onclick = () => sb.auth.signOut();
  // Pulsar la sección en la que ya estás vuelve a cargarla (p. ej. para salir de unos resultados)
  root.querySelector('[data-nav]').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.getAttribute('href') === (location.hash || '#/')) { e.preventDefault(); navegar(); }
  });
  root.querySelector('[data-opos]').onchange = async (e) => {
    if (e.target.value === '__nueva') { location.hash = '#/oposicion?nueva=1'; pintarSidebar(); return; }
    await cambiarOposicion(e.target.value);
    refrescarTrabajos().catch(() => {});
    navegar();
  };
  onCambio(pintarSidebar);
  onTrabajos(pintarIA);
  pintarSidebar();
  window.addEventListener('hashchange', navegar);
  navegar();
  refrescarTrabajos().catch(() => {});
}

function pintarSidebar() {
  const sel = root.querySelector('[data-opos]');
  if (!sel) return;
  sel.innerHTML = store.oposiciones.map((o) => `<option value="${o.id}" ${o.id === store.oposicion?.id ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')
    + '<option value="__nueva">+ Nueva oposición…</option>';
  root.querySelector('[data-user]').textContent = store.perfil?.nombre || store.user?.email || '';
  pintarNav();
}

function pintarNav(activa) {
  const nav = root.querySelector('[data-nav]');
  if (!nav) return;
  activa = activa || nav.dataset.activa;
  nav.dataset.activa = activa || '';
  nav.innerHTML = NAV.map((n) => n ? `<a href="${n[1]}" class="${n[0] === activa ? 'active' : ''}">${icon(n[2])}<span>${n[3]}</span></a>` : '<div class="nav-sep"></div>').join('');
}

function pintarIA(lista) {
  const el = root.querySelector('[data-ia]');
  if (!el) return;
  const activos = trabajosActivos();
  const errores = lista.filter((t) => t.estado === 'error' && Date.now() - new Date(t.updated_at) < 86400000 * 3);
  el.innerHTML = activos.length
    ? `<a class="pill-ia" href="#/temario"><span class="spinner" style="width:13px;height:13px"></span>IA trabajando · ${activos.map((t) => `${t.paso}/${t.total_pasos}`).join(', ')}</a>`
    : errores.length ? `<a class="pill-ia" style="background:var(--bad-soft);color:var(--bad)" href="#/temario">${icon('alert')} ${errores.length} proceso(s) con error</a>` : '';
}

// ---------------------------------------------------------------------
async function navegar() {
  const [ruta, qs] = (location.hash.slice(1) || '/').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const def = RUTAS.find((r) => r.re.test(ruta)) || RUTAS[0];
  const params = ruta.match(def.re)?.slice(1) || [];
  const cont = document.getElementById('vista');
  if (!cont) return;
  document.getElementById('app')?.classList.remove('nav-open');
  root.querySelector('[data-titulo]').textContent = def.titulo;
  document.title = `${def.titulo} · Opositor IA`;
  pintarNav(def.nav || def.vista);

  try { limpiezaVista?.(); } catch { /* ignorar */ }
  limpiezaVista = null;
  const id = ++renderId;
  cont.innerHTML = cargando();
  window.scrollTo({ top: 0 });
  try {
    const mod = await import(`./views/${def.vista}.js`);
    if (id !== renderId) return;
    limpiezaVista = (await mod.render(cont, params, query, () => id !== renderId)) || null;
  } catch (e) {
    if (id !== renderId) return;
    console.error(e);
    cont.innerHTML = `<div class="card card-pad"><h3>Algo ha fallado</h3><p class="muted" style="margin-top:6px">${esc(e.message || e)}</p><button class="btn btn-sm" onclick="location.reload()">Recargar</button></div>`;
  }
}

arrancar();
