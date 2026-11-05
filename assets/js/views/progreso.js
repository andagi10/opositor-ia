import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, etiquetaTema } from '../lib/store.js';
import {
  esc, icon, fmtNum, fmtPct, fmtDuracion, fmtRelativo, barra, barraDominio, vacio, DOMINIOS, ORDEN_DOMINIOS,
  descargar, aCSV, toast, toastError, plural,
} from '../lib/ui.js';
import { resumen, statsTemas, todas } from '../lib/api.js';
import { grafico, colores, ejePct, mediaMovil } from '../lib/charts.js';
import { detallePregunta } from '../lib/pregunta-ui.js';

const LISTAS = {
  suelo_fallar: { label: 'Suelo fallar', f: (q) => q.gte('veces', 2).lt('pct_acierto', 50).order('pct_acierto').order('fallos', { ascending: false }) },
  varias_veces: { label: 'Falladas varias veces', f: (q) => q.gte('fallos', 2).order('fallos', { ascending: false }) },
  siempre: { label: 'Siempre acierto', f: (q) => q.gte('veces', 2).eq('fallos', 0).eq('blancos', 0).order('veces', { ascending: false }) },
  olvidadas: { label: 'Más tiempo sin responder', f: (q) => q.gt('veces', 0).order('ultima_at', { ascending: true }) },
  error: { label: 'Mayor % de error', f: (q) => q.gt('veces', 0).order('pct_acierto', { ascending: true }).order('veces', { ascending: false }) },
  nunca: { label: 'Nunca respondidas', f: (q) => q.eq('veces', 0).order('created_at') },
};

export async function render(cont) {
  const [res, temas] = await Promise.all([resumen(), statsTemas()]);
  let rango = 90;
  let temaEvo = '';
  let lista = 'suelo_fallar';
  const pct = res.intentos ? (100 * res.aciertos) / res.intentos : null;
  const dom = res.dominio || {};

  if (!res.intentos) {
    cont.innerHTML = `<div class="page-head"><div><h1>Mi progreso</h1></div></div><div class="card">${vacio('chart', 'Aún no hay datos', 'Responde preguntas en Estudiar, Simulacros o Repaso y aquí verás tu evolución, tus temas fuertes y débiles y el historial de cada pregunta.', '<a class="btn btn-primary" href="#/repaso">Empezar a practicar</a>')}</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="page-head"><div><h1>Mi progreso</h1><p>Todo se calcula a partir de tu historial real de respuestas.</p></div>
      <div class="page-actions"><button class="btn" data-export>${icon('download')} Exportar</button></div></div>
    <div class="grid grid-4">
      <div class="card stat"><div class="label">Preguntas respondidas</div><div class="value">${fmtNum(res.intentos)}</div><div class="sub">${fmtNum(res.blancos)} en blanco</div></div>
      <div class="card stat"><div class="label">Acertadas</div><div class="value" style="color:var(--ok)">${fmtNum(res.aciertos)}</div><div class="sub">${fmtPct(pct, 1)} de acierto global</div></div>
      <div class="card stat"><div class="label">Falladas</div><div class="value" style="color:var(--bad)">${fmtNum(res.fallos)}</div></div>
      <div class="card stat"><div class="label">Tiempo de estudio</div><div class="value">${fmtDuracion(res.tiempo_seg)}</div><div class="sub">${plural(res.dias_estudio || 0, 'día')} con actividad · ${fmtNum(res.simulacros)} simulacros</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Evolución del porcentaje de aciertos</h3>
        <div class="row"><select class="input" style="width:auto;min-height:32px" data-tema-evo><option value="">Todos los temas</option>${temas.map((t) => `<option value="${t.tema_id}">${esc(nombreTema(t))}</option>`).join('')}</select>
        <div class="seg">${[[30, '30 d'], [90, '90 d'], [365, '1 año']].map(([d, l]) => `<button data-rango="${d}" class="${d === rango ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
      <div class="card-body"><div class="chart-box"><canvas data-evo></canvas></div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Aciertos frente a errores por semana</h3></div><div class="card-body"><div class="chart-box"><canvas data-semanas></canvas></div></div></div>
      <div class="card"><div class="card-head"><h3>Evolución de preguntas dominadas</h3></div><div class="card-body"><div class="chart-box"><canvas data-dominadas></canvas></div></div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Rendimiento por tema</h3><div class="legend-dom">${ORDEN_DOMINIOS.map((k) => `<span><i style="background:${DOMINIOS[k].color}"></i>${DOMINIOS[k].label}</span>`).join('')}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Tema</th><th class="right">Respondidas</th><th class="right">Errores</th><th style="width:150px">% acierto</th><th style="width:170px">Dominio estimado</th><th style="width:180px">Distribución</th></tr></thead><tbody>
        ${[...temas].sort((a, b) => (b.dominio_estimado ?? -1) - (a.dominio_estimado ?? -1)).map((t) => `<tr class="click" data-tema="${t.tema_id}">
          <td><div style="font-weight:550" class="ellipsis">${esc(nombreTema(t))}</div><div class="small faint">${fmtNum(t.preguntas_respondidas)} de ${fmtNum(t.preguntas_activas)} preguntas vistas · ${fmtRelativo(t.ultima_at)}</div></td>
          <td class="right">${fmtNum(t.intentos)}</td><td class="right">${fmtNum(t.fallos)}</td>
          <td><div class="row" style="gap:8px;flex-wrap:nowrap">${barra(t.pct_acierto)}<span class="small nowrap">${fmtPct(t.pct_acierto)}</span></div></td>
          <td><div class="row" style="gap:8px;flex-wrap:nowrap">${barra(t.dominio_estimado)}<b class="small">${t.dominio_estimado ?? 0}</b></div></td>
          <td>${barraDominio({ dominada: t.dominadas, buen_nivel: t.buen_nivel, repasar: t.repasar, dificil: t.dificiles, nunca: t.nunca })}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card-body" style="border-top:1px solid var(--border)"><div class="chart-box" style="height:${Math.max(160, temas.length * 30)}px"><canvas data-temas></canvas></div></div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="card"><div class="card-head"><h3>Clasificación por dominio</h3></div><div class="card-body">
        <div class="chart-box sm"><canvas data-dona></canvas></div>
        <div class="stack" style="gap:6px;margin-top:12px">${ORDEN_DOMINIOS.map((k) => `<a class="row-between small" href="#/banco?dominio=${k}" style="color:inherit"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${DOMINIOS[k].color};margin-right:7px"></i>${DOMINIOS[k].label}</span><b>${fmtNum(dom[k] || 0)}</b></a>`).join('')}</div>
        <p class="small faint" style="margin:12px 0 0">Dominada: 3+ aciertos seguidos y ≥80% de acierto. Difícil: 3+ fallos y &lt;50%. Buen nivel: última acertada y ≥60%.</p>
      </div></div>
      <div class="card span-2"><div class="card-head" style="flex-wrap:wrap"><h3>Preguntas</h3>
        <select class="input" style="width:auto;min-height:32px" data-lista>${Object.entries(LISTAS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
        <div data-preguntas></div></div>
    </div>`;

  // ---------- Gráficos ----------
  const c = colores();
  async function pintarEvo() {
    const evo = ok(await sb.rpc('evolucion_diaria', { p_oposicion: store.oposicion.id, p_dias: rango, p_tema: temaEvo || null }));
    grafico(cont.querySelector('[data-evo]'), {
      data: {
        labels: evo.map((d) => new Date(d.dia).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })),
        datasets: [
          { type: 'line', label: '% acierto del día', data: evo.map((d) => +d.pct), borderColor: c.accent, backgroundColor: c.accent, pointRadius: 2.5, tension: .25, yAxisID: 'y' },
          { type: 'line', label: 'Media móvil 7 días', data: mediaMovil(evo.map((d) => +d.pct)), borderColor: c.ok, borderWidth: 2.5, pointRadius: 0, tension: .35, yAxisID: 'y' },
          { type: 'bar', label: 'Preguntas respondidas', data: evo.map((d) => d.intentos), backgroundColor: c.grid, yAxisID: 'y2', order: 3 },
        ],
      },
      options: { scales: { y: ejePct, y2: { position: 'right', grid: { display: false }, beginAtZero: true } } },
    });
    // Semanas (siempre del rango, todos los temas o el tema elegido)
    const semanas = {};
    evo.forEach((d) => {
      const f = new Date(d.dia); const lunes = new Date(f); lunes.setDate(f.getDate() - ((f.getDay() + 6) % 7));
      const k = lunes.toISOString().slice(0, 10);
      semanas[k] = semanas[k] || { a: 0, e: 0, b: 0 };
      semanas[k].a += +d.aciertos; semanas[k].e += +d.errores; semanas[k].b += +d.blancos;
    });
    const ks = Object.keys(semanas).sort();
    grafico(cont.querySelector('[data-semanas]'), {
      type: 'bar',
      data: {
        labels: ks.map((k) => `Sem. ${new Date(k).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`),
        datasets: [
          { label: 'Aciertos', data: ks.map((k) => semanas[k].a), backgroundColor: c.ok, borderRadius: 3 },
          { label: 'Errores', data: ks.map((k) => semanas[k].e), backgroundColor: c.bad, borderRadius: 3 },
          { label: 'En blanco', data: ks.map((k) => semanas[k].b), backgroundColor: c.faint, borderRadius: 3 },
        ],
      },
      options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } },
    });
  }

  async function pintarDominadas() {
    const intentos = await todas(() => sb.from('intentos').select('pregunta_id,correcta,en_blanco,respondida_at')
      .eq('oposicion_id', store.oposicion.id).not('pregunta_id', 'is', null).order('respondida_at').order('id'));
    const st = new Map();
    let dominadas = 0;
    const porDia = new Map();
    const esDom = (s) => s.racha >= 3 && s.aciertos >= 0.8 * s.veces;
    for (const i of intentos) {
      const s = st.get(i.pregunta_id) || { veces: 0, aciertos: 0, racha: 0 };
      const antes = esDom(s);
      s.veces++; if (i.correcta) { s.aciertos++; s.racha++; } else s.racha = 0;
      st.set(i.pregunta_id, s);
      const despues = esDom(s);
      if (antes !== despues) dominadas += despues ? 1 : -1;
      porDia.set(new Date(i.respondida_at).toLocaleDateString('sv-SE'), dominadas);
    }
    const dias = [...porDia.keys()];
    grafico(cont.querySelector('[data-dominadas]'), {
      type: 'line',
      data: {
        labels: dias.map((d) => new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'Preguntas dominadas', data: dias.map((d) => porDia.get(d)), borderColor: c.ok, backgroundColor: c.ok + '22', fill: true, tension: .3, pointRadius: dias.length > 60 ? 0 : 2 }],
      },
      options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { display: false } } },
    });
  }

  function pintarTemas() {
    const ts = temas.filter((t) => t.intentos > 0);
    grafico(cont.querySelector('[data-temas]'), {
      type: 'bar',
      data: {
        labels: ts.map((t) => etiquetaTema(t.tema_id) + (t.numero ? '' : '')),
        datasets: [
          { label: '% acierto', data: ts.map((t) => +t.pct_acierto), backgroundColor: ts.map((t) => (t.pct_acierto >= 75 ? c.ok : t.pct_acierto >= 50 ? c.warn : c.bad)), borderRadius: 4 },
          { label: 'Dominio estimado', data: ts.map((t) => t.dominio_estimado), backgroundColor: c.accent + '55', borderRadius: 4 },
        ],
      },
      options: { indexAxis: 'y', scales: { x: ejePct }, plugins: { tooltip: { callbacks: { title: (it) => nombreTema(ts[it[0].dataIndex]) } } } },
    });
    grafico(cont.querySelector('[data-dona]'), {
      type: 'doughnut',
      data: { labels: ORDEN_DOMINIOS.map((k) => DOMINIOS[k].label), datasets: [{ data: ORDEN_DOMINIOS.map((k) => dom[k] || 0), backgroundColor: ORDEN_DOMINIOS.map((k) => DOMINIOS[k].color), borderWidth: 0 }] },
      options: { cutout: '68%', plugins: { legend: { display: false } }, interaction: { mode: 'nearest' } },
    });
  }

  async function pintarLista() {
    const el = cont.querySelector('[data-preguntas]');
    if (!el) return;
    el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    const filas = ok(await LISTAS[lista].f(sb.from('v_banco').select('id,enunciado,tema_id,veces,aciertos,fallos,pct_acierto,ultima_at,dominio,created_at').eq('oposicion_id', store.oposicion.id).eq('estado', 'activa')).limit(25));
    const hist = filas.length ? ok(await sb.from('intentos').select('pregunta_id,correcta,en_blanco,respondida_at').in('pregunta_id', filas.map((f) => f.id)).order('respondida_at', { ascending: false }).limit(1000)) : [];
    el.innerHTML = filas.length ? filas.map((p) => {
      const h = hist.filter((x) => x.pregunta_id === p.id).slice(0, 8).reverse();
      return `<div class="list-item click" data-p="${p.id}">
        <span class="badge badge-accent">${esc(etiquetaTema(p.tema_id))}</span>
        <div class="grow"><div class="ellipsis">${esc(p.enunciado)}</div>
          <div class="small faint">${p.veces ? `${p.aciertos}/${p.veces} aciertos · última ${fmtRelativo(p.ultima_at)}` : 'Sin responder'}</div></div>
        <span class="hist-sq">${h.map((x) => `<i class="${x.correcta ? 'ok' : x.en_blanco ? 'blank' : 'bad'}"></i>`).join('')}</span>
        <b class="small nowrap" style="width:48px;text-align:right">${fmtPct(p.pct_acierto)}</b></div>`;
    }).join('') : '<div class="card-body muted small">No hay preguntas en esta categoría.</div>';
    el.querySelectorAll('[data-p]').forEach((r) => r.onclick = () => detallePregunta(r.dataset.p, pintarLista));
  }

  cont.querySelectorAll('[data-rango]').forEach((b) => b.onclick = () => { rango = +b.dataset.rango; cont.querySelectorAll('[data-rango]').forEach((x) => x.classList.toggle('on', x === b)); pintarEvo(); });
  cont.querySelector('[data-tema-evo]').onchange = (e) => { temaEvo = e.target.value; pintarEvo(); };
  cont.querySelector('[data-lista]').onchange = (e) => { lista = e.target.value; pintarLista(); };
  cont.querySelectorAll('[data-tema]').forEach((r) => r.onclick = () => { temaEvo = r.dataset.tema; cont.querySelector('[data-tema-evo]').value = temaEvo; pintarEvo(); cont.querySelector('[data-evo]').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  cont.querySelector('[data-export]').onclick = () => exportar(temas);

  pintarTemas();
  await Promise.all([pintarEvo(), pintarDominadas(), pintarLista()]);
}

async function exportar(temas) {
  try {
    toast('Preparando la exportación…');
    const fecha = new Date().toISOString().slice(0, 10);
    const [intentos, preguntas, sesiones] = await Promise.all([
      todas(() => sb.from('intentos').select('respondida_at,pregunta_id,tema_id,correcta,en_blanco,tiempo_ms,sesion_id,importado').eq('oposicion_id', store.oposicion.id).order('respondida_at')),
      todas(() => sb.from('v_banco').select('id,enunciado,tema_id,dificultad,veces,aciertos,fallos,blancos,pct_acierto,ultima_at,dominio').eq('oposicion_id', store.oposicion.id).neq('estado', 'borrador')),
      todas(() => sb.from('v_sesiones_resumen').select('iniciada_at,tipo,num_preguntas,aciertos,errores,blancos,nota,duracion_seg').eq('oposicion_id', store.oposicion.id).eq('estado', 'finalizada').neq('tipo', 'estudio').order('iniciada_at')),
    ]);
    const enun = Object.fromEntries(preguntas.map((p) => [p.id, p.enunciado]));
    const tn = (id) => nombreTema(temas.find((t) => t.tema_id === id) || store.temas.find((t) => t.id === id));
    descargar(`progreso-por-pregunta-${fecha}.csv`, aCSV(preguntas, [
      { titulo: 'Tema', valor: (r) => tn(r.tema_id) }, { titulo: 'Pregunta', valor: (r) => r.enunciado },
      { titulo: 'Veces', valor: (r) => r.veces }, { titulo: 'Aciertos', valor: (r) => r.aciertos }, { titulo: 'Fallos', valor: (r) => r.fallos },
      { titulo: 'En blanco', valor: (r) => r.blancos }, { titulo: '% acierto', valor: (r) => r.pct_acierto ?? '' },
      { titulo: 'Última vez', valor: (r) => r.ultima_at || '' }, { titulo: 'Dominio', valor: (r) => DOMINIOS[r.dominio]?.label },
    ]), 'text/csv');
    descargar(`progreso-por-tema-${fecha}.csv`, aCSV(temas, [
      { titulo: 'Tema', valor: (t) => nombreTema(t) }, { titulo: 'Preguntas activas', valor: (t) => t.preguntas_activas },
      { titulo: 'Respondidas', valor: (t) => t.intentos }, { titulo: 'Aciertos', valor: (t) => t.aciertos }, { titulo: 'Errores', valor: (t) => t.fallos },
      { titulo: '% acierto', valor: (t) => t.pct_acierto ?? '' }, { titulo: 'Dominio estimado', valor: (t) => t.dominio_estimado ?? '' },
    ]), 'text/csv');
    descargar(`historial-respuestas-${fecha}.csv`, aCSV(intentos, [
      { titulo: 'Fecha', valor: (r) => r.importado ? 'importado' : r.respondida_at }, { titulo: 'Tema', valor: (r) => tn(r.tema_id) },
      { titulo: 'Pregunta', valor: (r) => enun[r.pregunta_id] || '' }, { titulo: 'Resultado', valor: (r) => r.correcta ? 'Acierto' : r.en_blanco ? 'En blanco' : 'Fallo' },
      { titulo: 'Tiempo (s)', valor: (r) => r.tiempo_ms ? Math.round(r.tiempo_ms / 1000) : '' },
    ]), 'text/csv');
    descargar(`sesiones-y-simulacros-${fecha}.csv`, aCSV(sesiones, [
      { titulo: 'Fecha', valor: (r) => r.iniciada_at }, { titulo: 'Tipo', valor: (r) => r.tipo }, { titulo: 'Preguntas', valor: (r) => r.num_preguntas },
      { titulo: 'Aciertos', valor: (r) => r.aciertos }, { titulo: 'Errores', valor: (r) => r.errores }, { titulo: 'En blanco', valor: (r) => r.blancos },
      { titulo: 'Nota (sobre 10)', valor: (r) => r.nota }, { titulo: 'Duración (min)', valor: (r) => r.duracion_seg ? Math.round(r.duracion_seg / 60) : '' },
    ]), 'text/csv');
  } catch (e) { toastError(e); }
}
