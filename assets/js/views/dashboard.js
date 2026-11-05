import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, temaPorId, etiquetaTema } from '../lib/store.js';
import { esc, icon, fmtPct, fmtNum, fmtDuracion, barra, barraDominio, vacio, DOMINIOS, ORDEN_DOMINIOS, plural } from '../lib/ui.js';
import { resumen, statsTemas } from '../lib/api.js';
import { grafico, colores, ejePct, mediaMovil } from '../lib/charts.js';
import { trabajosActivos, onTrabajos } from '../lib/trabajos.js';
import { simulacrosGuardados } from '../lib/runner.js';

export async function render(cont, _p, _q, cancelado) {
  const [res, temas, evo, repaso] = await Promise.all([
    resumen(),
    statsTemas(),
    sb.rpc('evolucion_diaria', { p_oposicion: store.oposicion.id, p_dias: 30 }).then(ok),
    sb.rpc('seleccionar_repaso', { p_oposicion: store.oposicion.id, p_n: 6 }).then(ok),
  ]);
  if (cancelado()) return;

  const pct = res.intentos ? (100 * res.aciertos) / res.intentos : null;
  const dom = res.dominio || {};
  const totalAct = res.preguntas_activas || 0;
  const op = store.oposicion;
  const dias = op.fecha_examen ? Math.ceil((new Date(op.fecha_examen) - new Date()) / 86400000) : null;
  const nombre = (store.perfil?.nombre || '').split(' ')[0];

  const conPreguntas = temas.filter((t) => t.preguntas_activas > 0);
  const flojos = conPreguntas.filter((t) => t.intentos > 0).sort((a, b) => (a.dominio_estimado ?? 0) - (b.dominio_estimado ?? 0)).slice(0, 4);
  const pendientes = temas.filter((t) => t.preguntas_activas === 0 || t.intentos === 0).slice(0, 5);
  const sims = simulacrosGuardados().filter((s) => s.sesion?.oposicion_id === op.id);
  const preguntasRepaso = repaso.length ? ok(await sb.from('preguntas').select('id,enunciado,tema_id').in('id', repaso.map((r) => r.pregunta_id))) : [];
  const motivo = Object.fromEntries(repaso.map((r) => [r.pregunta_id, r.motivo]));

  cont.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Hola${nombre ? `, ${esc(nombre)}` : ''}</h1>
        <p>${esc(op.nombre)}${dias !== null ? ` · ${dias > 0 ? `<b>${dias} días</b> para el examen` : dias === 0 ? '<b>el examen es hoy</b>' : 'fecha de examen pasada'}` : ''}</p>
      </div>
      <div class="page-actions">
        <a class="btn" href="#/simulacros">${icon('exam')} Simulacro</a>
        <a class="btn btn-primary" href="#/repaso">${icon('brain')} Repasar ahora</a>
      </div>
    </div>

    <div data-avisos class="stack" style="gap:10px;margin-bottom:16px"></div>

    <div class="grid grid-4">
      <div class="card stat"><div class="label">${icon('target')} Acierto global</div><div class="value">${fmtPct(pct)}</div><div class="sub">${fmtNum(res.intentos)} respuestas</div></div>
      <div class="card stat"><div class="label">${icon('brain')} Para repasar hoy</div><div class="value">${fmtNum(res.pendientes_hoy)}</div><div class="sub">vencidas o nunca vistas</div></div>
      <div class="card stat"><div class="label">${icon('check')} Dominadas</div><div class="value">${fmtNum(dom.dominada || 0)}<span class="faint" style="font-size:15px;font-weight:500"> / ${fmtNum(totalAct)}</span></div><div class="sub">${totalAct ? fmtPct((100 * (dom.dominada || 0)) / totalAct) : '—'} del banco</div></div>
      <div class="card stat"><div class="label">${icon('fire')} Racha</div><div class="value">${plural(res.racha_dias || 0, 'día')}</div><div class="sub">${fmtDuracion(res.tiempo_seg)} de estudio en total</div></div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="card span-2">
        <div class="card-head"><h3>Evolución del acierto · 30 días</h3><a class="small" href="#/progreso">Ver progreso →</a></div>
        <div class="card-body">${evo.length ? '<div class="chart-box sm"><canvas data-evo></canvas></div>' : vacio('chart', 'Aún no hay actividad', 'Haz una práctica o un simulacro para ver tu evolución.')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Estado del banco</h3><a class="small" href="#/banco">Banco →</a></div>
        <div class="card-body">
          ${barraDominio(dom)}
          <div class="stack" style="gap:8px;margin-top:14px">${ORDEN_DOMINIOS.map((k) => `
            <div class="row-between small"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${DOMINIOS[k].color};margin-right:7px"></i>${DOMINIOS[k].label}</span><b>${fmtNum(dom[k] || 0)}</b></div>`).join('')}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h3>Preguntas que deberías repasar</h3><a class="small" href="#/repaso">Empezar →</a></div>
        ${preguntasRepaso.length ? repaso.map((r) => {
          const p = preguntasRepaso.find((x) => x.id === r.pregunta_id);
          return p ? `<div class="list-item"><span class="badge badge-accent">${esc(etiquetaTema(p.tema_id))}</span><div class="grow ellipsis">${esc(p.enunciado)}</div><span class="badge badge-info">${esc(motivo[p.id])}</span></div>` : '';
        }).join('') : vacio('bank', 'Tu banco está vacío', 'Sube el temario para que la IA genere preguntas, o impórtalas.', '<a class="btn btn-primary btn-sm" href="#/temario">Ir a Mi temario</a>')}
      </div>
      <div class="card">
        <div class="card-head"><h3>Temas que necesitan atención</h3><a class="small" href="#/progreso">Detalle →</a></div>
        ${flojos.length ? flojos.map((t) => `
          <div class="list-item click" data-tema="${t.tema_id}">
            <div class="grow"><div class="ellipsis" style="font-weight:550">${esc(nombreTema(t))}</div>
              <div class="row small muted" style="margin-top:4px">${fmtPct(t.pct_acierto)} acierto · dominio ${t.dominio_estimado ?? 0}/100</div></div>
            <div style="width:110px">${barra(t.dominio_estimado)}</div>
          </div>`).join('') : `<div class="card-body muted small">Cuando practiques verás aquí los temas con peor rendimiento.</div>`}
        ${pendientes.length ? `<div class="card-body" style="border-top:1px solid var(--border)"><div class="small muted" style="margin-bottom:8px;font-weight:600">Temas pendientes</div>
          ${pendientes.map((t) => `<div class="row-between small" style="padding:4px 0"><a href="#/temario/${t.tema_id}" class="ellipsis" style="max-width:70%">${esc(nombreTema(t))}</a>
            <span class="faint">${t.preguntas_activas === 0 ? (t.preguntas_borrador ? `${t.preguntas_borrador} por revisar` : 'sin preguntas') : 'sin practicar'}</span></div>`).join('')}</div>` : ''}
      </div>
    </div>`;

  // Avisos: simulacros a medias, IA, borradores
  const avisos = cont.querySelector('[data-avisos]');
  const pintarAvisos = () => {
    const act = trabajosActivos();
    avisos.innerHTML = [
      ...sims.map((s) => `<div class="alert alert-info">${icon('exam')}<div style="flex:1">Tienes un simulacro a medias (${Object.values(s.respuestas || {}).filter(Boolean).length}/${s.preguntaIds.length} respondidas).</div><a class="btn btn-sm" href="#/simulacros">Continuar</a></div>`),
      ...act.map((t) => `<div class="alert alert-info"><span class="spinner" style="width:15px;height:15px"></span><div style="flex:1">La IA está procesando ${t.tema_id ? esc(nombreTema(temaPorId(t.tema_id))) : 'un documento'} · ${esc(t.mensaje || '')} (${t.paso}/${t.total_pasos})</div></div>`),
      res.borradores ? `<div class="alert alert-warn">${icon('edit')}<div style="flex:1">Tienes <b>${fmtNum(res.borradores)}</b> preguntas generadas o importadas pendientes de revisar antes de añadirlas a tu banco.</div><a class="btn btn-sm" href="#/banco/revision">Revisar</a></div>` : '',
      !store.temas.length ? `<div class="alert alert-info">${icon('book')}<div style="flex:1">Empieza creando los temas de tu oposición y subiendo los documentos.</div><a class="btn btn-sm" href="#/temario">Mi temario</a></div>` : '',
    ].join('');
  };
  pintarAvisos();
  const off = onTrabajos(pintarAvisos);
  cont.querySelectorAll('[data-tema]').forEach((el) => el.onclick = () => { location.hash = `#/estudiar/${el.dataset.tema}`; });

  if (evo.length) {
    const c = colores();
    const etiquetas = evo.map((d) => new Date(d.dia).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }));
    grafico(cont.querySelector('[data-evo]'), {
      type: 'line',
      data: {
        labels: etiquetas, datasets: [
          { label: '% acierto', data: evo.map((d) => d.pct), borderColor: c.accent, backgroundColor: c.accent, pointRadius: 3, tension: .3 },
          { label: 'Media 7 días', data: mediaMovil(evo.map((d) => +d.pct)), borderColor: c.faint, borderDash: [4, 4], pointRadius: 0, tension: .3 },
        ],
      },
      options: { scales: { y: ejePct }, plugins: { legend: { display: false } } },
    });
  }
  return off;
}
