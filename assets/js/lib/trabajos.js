// Seguimiento de los trabajos de IA: sondeo del estado, reanudación automática y reintentos.
import { sb, ok, llamarIA } from './supabase.js';
import { store } from './store.js';
import { toast } from './ui.js';

const ACTIVOS = ['pendiente', 'procesando'];
let timer = null;
let ultimos = [];
const subs = new Set();

export const trabajosActivos = () => ultimos.filter((t) => ACTIVOS.includes(t.estado));
export function onTrabajos(fn) { subs.add(fn); fn(ultimos); return () => subs.delete(fn); }

export async function refrescarTrabajos() {
  if (!store.oposicion) return [];
  const antes = new Map(ultimos.map((t) => [t.id, t.estado]));
  ultimos = ok(await sb.from('trabajos')
    .select('id,tipo,estado,paso,total_pasos,mensaje,error,tema_id,documento_id,resultado,bloqueado_hasta,updated_at,created_at,finished_at')
    .eq('oposicion_id', store.oposicion.id)
    .order('created_at', { ascending: false }).limit(30));

  for (const t of ultimos) {
    const previo = antes.get(t.id);
    if (previo && ACTIVOS.includes(previo) && t.estado === 'completado') toast(`IA: ${t.mensaje}`, 'ok');
    if (previo && ACTIVOS.includes(previo) && t.estado === 'error') toast(`IA: error al procesar. Puedes reintentarlo.`, 'err');
    // Reanuda trabajos parados (la función se cortó o el encadenado falló)
    if (ACTIVOS.includes(t.estado)) {
      const libre = !t.bloqueado_hasta || new Date(t.bloqueado_hasta) < new Date();
      const quieto = Date.now() - new Date(t.updated_at).getTime() > 15000;
      if (libre && quieto) llamarIA({ accion: 'continuar', trabajo_id: t.id }).catch(() => {});
    }
  }
  subs.forEach((fn) => fn(ultimos));
  programar();
  return ultimos;
}

function programar() {
  clearTimeout(timer);
  const hayActivos = trabajosActivos().length > 0;
  timer = setTimeout(() => refrescarTrabajos().catch(() => programar()), hayActivos ? 4000 : 60000);
}

export async function iniciarTrabajo(cuerpo) {
  const r = await llamarIA({ accion: 'iniciar', ...cuerpo });
  await refrescarTrabajos();
  return r.trabajo;
}

export async function reintentarTrabajo(id) {
  await llamarIA({ accion: 'reintentar', trabajo_id: id });
  await refrescarTrabajos();
}

export async function cancelarTrabajo(id) {
  await llamarIA({ accion: 'cancelar', trabajo_id: id });
  await refrescarTrabajos();
}

export function pararSondeo() { clearTimeout(timer); }

export const TIPOS_TRABAJO = { procesar_tema: 'Procesar tema', importar_preguntas: 'Importar preguntas' };
