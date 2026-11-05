import { sb, ok } from '../lib/supabase.js';
import { icon, vacio, fmtFechaHora } from '../lib/ui.js';
import { cargarPreguntas } from '../lib/api.js';
import { resultados } from '../lib/runner.js';

export async function render(cont, [id]) {
  const s = ok(await sb.from('v_sesiones_resumen').select('*').eq('id', id).maybeSingle());
  if (!s) { cont.innerHTML = vacio('exam', 'Simulacro no encontrado', '', '<a class="btn" href="#/simulacros">Volver</a>'); return; }
  const ses = ok(await sb.from('sesiones').select('pregunta_ids').eq('id', id).single());
  const [preguntas, intentos] = await Promise.all([
    cargarPreguntas(ses.pregunta_ids),
    sb.from('intentos').select('pregunta_id,tema_id,opcion_id,en_blanco,correcta,tiempo_ms').eq('sesion_id', id).then(ok),
  ]);
  const porId = Object.fromEntries(intentos.map((i) => [i.pregunta_id, i]));
  const respuestas = preguntas.map((p) => porId[p.id] || { pregunta_id: p.id, tema_id: p.tema_id, en_blanco: true, correcta: false, opcion_id: null });
  const wrap = document.createElement('div');
  cont.innerHTML = `<div style="max-width:900px;margin:0 auto 12px"><a class="small" href="#/simulacros">${icon('left')} Simulacros</a></div>`;
  cont.appendChild(wrap);
  resultados({
    cont: wrap, preguntas, config: s.config || {}, tipo: 'simulacro',
    titulo: `Simulacro del ${fmtFechaHora(s.iniciada_at)}`, onSalir: () => { location.hash = '#/simulacros'; },
  }, respuestas, s.duracion_seg || 0);
}
