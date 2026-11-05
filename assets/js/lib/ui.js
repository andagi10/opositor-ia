// Utilidades de interfaz: escape, iconos, toasts, modales y formato.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Iconos (trazo, 24x24) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  bank: '<path d="M9 11h6M9 15h4"/><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h6"/>',
  study: '<path d="M2 7l10-4 10 4-10 4z"/><path d="M6 9v5c0 1.5 3 3 6 3s6-1.5 6-3V9"/>',
  exam: '<path d="M9 4h6l1 2h3v15H5V6h3z"/><path d="M9 12l2 2 4-4"/>',
  brain: '<path d="M12 5a3 3 0 0 0-5.8-1A3 3 0 0 0 4 9a3 3 0 0 0 .5 5.5A3 3 0 0 0 8 19a3 3 0 0 0 4 1V5z"/><path d="M12 5a3 3 0 0 1 5.8-1A3 3 0 0 1 20 9a3 3 0 0 1-.5 5.5A3 3 0 0 1 16 19a3 3 0 0 1-4 1"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  star: '<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  sparkles: '<path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  fire: '<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-9-1 2-2 3-4 3 0-2-1-4-3-5 0 4-4 6-4 11 0 4 3 7 8 7z"/>',
  eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  archive: '<path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>',
  layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;

// ---------- Toasts ----------
export function toast(msg, tipo = '') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${tipo}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, tipo === 'err' ? 5500 : 3200);
  setTimeout(() => t.remove(), tipo === 'err' ? 6000 : 3600);
}
export const toastError = (e) => { console.error(e); toast(mensajeError(e), 'err'); };
export function mensajeError(e) {
  const m = e?.message || e?.error_description || e?.error || String(e);
  if (/JWT|session/i.test(m)) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Revisa tu conexión.';
  return m;
}

// ---------- Modales ----------
export function modal({ title, body, footer = '', size = '', onMount, dismissable = true }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${title}</h2><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Cerrar">${icon('x')}</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back && dismissable) close(); });
  back.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  const api = { el: back, close, $: (s) => back.querySelector(s), $$: (s) => [...back.querySelectorAll(s)] };
  onMount?.(api);
  setTimeout(() => back.querySelector('input:not([type=checkbox]):not([type=radio]),textarea,select')?.focus(), 30);
  return api;
}

export function confirmar(mensaje, { titulo = 'Confirmar', ok = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title: esc(titulo),
      body: `<p style="margin:0">${mensaje}</p>`,
      footer: `<button class="btn" data-no>Cancelar</button><button class="btn ${peligro ? 'btn-danger' : 'btn-primary'}" data-si>${esc(ok)}</button>`,
      onMount: (api) => {
        api.$('[data-no]').onclick = () => { api.close(); resolve(false); };
        api.$('[data-si]').onclick = () => { api.close(); resolve(true); };
        api.$('[data-close]').addEventListener('click', () => resolve(false));
      },
    });
    return m;
  });
}

export function pedirTexto(titulo, { valor = '', etiqueta = '', placeholder = '', multilinea = false, ok = 'Guardar' } = {}) {
  return new Promise((resolve) => {
    modal({
      title: esc(titulo),
      body: `<label class="field">${esc(etiqueta)}${multilinea
        ? `<textarea class="input" rows="6" placeholder="${esc(placeholder)}">${esc(valor)}</textarea>`
        : `<input class="input" value="${esc(valor)}" placeholder="${esc(placeholder)}">`}</label>`,
      footer: `<button class="btn" data-no>Cancelar</button><button class="btn btn-primary" data-si>${esc(ok)}</button>`,
      onMount: (api) => {
        const inp = api.$('input,textarea');
        const ok = () => { api.close(); resolve(inp.value.trim()); };
        api.$('[data-no]').onclick = () => { api.close(); resolve(null); };
        api.$('[data-si]').onclick = ok;
        if (!multilinea) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      },
    });
  });
}

// ---------- Formato ----------
export const fmtNum = (n) => new Intl.NumberFormat('es-ES').format(n ?? 0);
export const fmtPct = (n, dec = 0) => (n === null || n === undefined || isNaN(n)) ? '—' : `${Number(n).toFixed(dec).replace('.', ',')}%`;
export function fmtFecha(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', opts);
}
export function fmtFechaHora(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtRelativo(d) {
  if (!d) return 'nunca';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `en ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400) return `en ${Math.round(f / 3600)} h`;
    return `en ${Math.round(f / 86400)} días`;
  }
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) return `hace ${Math.round(s / 86400)} días`;
  if (s < 86400 * 365) return `hace ${Math.round(s / 86400 / 30)} meses`;
  return `hace ${Math.round(s / 86400 / 365)} años`;
}
export function fmtDuracion(seg) {
  seg = Math.max(0, Math.round(seg || 0));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min${s && m < 10 ? ` ${s} s` : ''}`;
  return `${s} s`;
}
export function fmtReloj(seg) {
  seg = Math.max(0, Math.round(seg));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
export const fmtBytes = (b) => !b ? '—' : b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
export const plural = (n, s, p) => `${fmtNum(n)} ${n === 1 ? s : (p || s + 's')}`;

// ---------- Dominios y dificultad ----------
export const DOMINIOS = {
  dominada:   { label: 'Dominada',        color: '#15803d', badge: 'badge-ok' },
  buen_nivel: { label: 'Buen nivel',      color: '#4c9a5f', badge: 'badge-info' },
  repasar:    { label: 'Necesita repaso', color: '#d08a1c', badge: 'badge-warn' },
  dificil:    { label: 'Difícil',         color: '#c0362c', badge: 'badge-bad' },
  nunca:      { label: 'Nunca respondida', color: '#9aa3b2', badge: '' },
};
export const ORDEN_DOMINIOS = ['dominada', 'buen_nivel', 'repasar', 'dificil', 'nunca'];
export const DIFICULTADES = { 1: 'Fácil', 2: 'Intermedio', 3: 'Difícil' };
export const badgeDificultad = (d) => `<span class="badge ${d === 1 ? 'badge-ok' : d === 3 ? 'badge-bad' : 'badge-warn'}">${DIFICULTADES[d] || '—'}</span>`;
export const badgeDominio = (d) => d ? `<span class="badge ${DOMINIOS[d]?.badge || ''}">${DOMINIOS[d]?.label || d}</span>` : '';
export const ORIGENES = { ia: 'IA', importada: 'Importada', manual: 'Manual', legado: 'Banco anterior' };

export function barra(pct, extra = '') {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  const cls = pct === null || pct === undefined ? '' : v >= 75 ? 'ok' : v >= 50 ? 'warn' : 'bad';
  return `<div class="bar ${cls} ${extra}"><span style="width:${v}%"></span></div>`;
}

export function barraDominio(t) {
  const total = ORDEN_DOMINIOS.reduce((s, k) => s + (Number(t[k]) || 0), 0);
  if (!total) return `<div class="dombar"></div>`;
  return `<div class="dombar" title="${ORDEN_DOMINIOS.map((k) => `${DOMINIOS[k].label}: ${t[k] || 0}`).join(' · ')}">${
    ORDEN_DOMINIOS.map((k) => t[k] ? `<span style="width:${(100 * t[k]) / total}%;background:${DOMINIOS[k].color}"></span>` : '').join('')}</div>`;
}

export function vacio(ic, titulo, texto = '', accion = '') {
  return `<div class="empty"><div class="icon">${icon(ic)}</div><h3>${esc(titulo)}</h3>${texto ? `<p>${texto}</p>` : ''}${accion}</div>`;
}

export const cargando = (txt = 'Cargando…') => `<div class="loading"><span class="spinner"></span>${esc(txt)}</div>`;

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function barajar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function descargar(nombre, contenido, tipo = 'text/plain') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

export function aCSV(filas, columnas) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columnas.map((c) => q(c.titulo)).join(';'), ...filas.map((f) => columnas.map((c) => q(c.valor(f))).join(';'))].join('\r\n');
}

export const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
