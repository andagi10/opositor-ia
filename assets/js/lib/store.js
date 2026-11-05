// Estado global mínimo de la sesión.
import { sb, ok } from './supabase.js';

export const store = {
  user: null,
  perfil: null,
  oposiciones: [],
  oposicion: null,        // oposición activa
  temas: [],              // temas (no archivados) de la oposición activa
  listeners: new Set(),
};

export function onCambio(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }
function emitir() { store.listeners.forEach((fn) => { try { fn(store); } catch (e) { console.error(e); } }); }

export const prefs = () => ({
  penalizacion: 0.333,
  repasoN: 20,
  practicaN: 20,
  ...(store.perfil?.preferencias || {}),
});

export async function cargarSesion(user) {
  store.user = user;
  store.perfil = ok(await sb.from('perfiles').select('*').eq('id', user.id).maybeSingle());
  if (!store.perfil) {
    // Por si el trigger no existía al registrarse
    store.perfil = ok(await sb.from('perfiles').upsert({ id: user.id, nombre: user.email.split('@')[0] }).select().single());
  }
  await cargarOposiciones();
}

export async function cargarOposiciones() {
  store.oposiciones = ok(await sb.from('oposiciones').select('*').eq('archivada', false).order('created_at'));
  const activa = store.oposiciones.find((o) => o.id === store.perfil?.oposicion_activa_id) || store.oposiciones[0] || null;
  store.oposicion = activa;
  await cargarTemas();
}

export async function cargarTemas() {
  store.temas = store.oposicion
    ? ok(await sb.from('temas').select('*').eq('oposicion_id', store.oposicion.id).eq('archivado', false).order('orden').order('numero'))
    : [];
  emitir();
}

export async function cambiarOposicion(id) {
  store.oposicion = store.oposiciones.find((o) => o.id === id) || store.oposicion;
  await sb.from('perfiles').update({ oposicion_activa_id: id }).eq('id', store.user.id);
  store.perfil.oposicion_activa_id = id;
  await cargarTemas();
}

export async function guardarPreferencias(cambios) {
  const preferencias = { ...(store.perfil.preferencias || {}), ...cambios };
  store.perfil = ok(await sb.from('perfiles').update({ preferencias }).eq('id', store.user.id).select().single());
}

export const nombreTema = (t) => t ? `${t.numero ? `Tema ${t.numero}. ` : ''}${t.titulo}` : 'Sin tema';
export const temaPorId = (id) => store.temas.find((t) => t.id === id);
export const etiquetaTema = (id) => {
  const t = temaPorId(id);
  return t ? (t.numero ? `T${t.numero}` : t.titulo.slice(0, 14)) : 'Sin tema';
};
