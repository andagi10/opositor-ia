import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, prefs } from '../lib/store.js';
import { esc, icon, toast, toastError, vacio, fmtFechaHora, fmtDuracion, fmtPct, confirmar, fmtNum } from '../lib/ui.js';
import { statsTemas, cargarPreguntas, abandonarSesion } from '../lib/api.js';
import { iniciarSesion, simulacrosGuardados, descartarSimulacroGuardado, reanudarSimulacro } from '../lib/runner.js';
import { grafico, colores } from '../lib/charts.js';

const PENALIZACIONES = [[0, 'Sin penalización'], [0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [1, '1 por error']];

export async function render(cont) {
  const stats = await statsTemas();
  const cfg = { n: 50, todos: true, temas: new Set(stats.map((t) => t.tema_id)), dif: new Set([1, 2, 3]), tiempo: true, minutos: 60, pen: prefs().penalizacion };
  let historial = [];

  const pintar = async () => {
    historial = ok(await sb.from('v_sesiones_resumen').select('*').eq('oposicion_id', store.oposicion.id).eq('tipo', 'simulacro').eq('estado', 'finalizada').order('iniciada_at', { ascending: false }).limit(50));
    const guardados = simulacrosGuardados().filter((s) => s.sesion?.oposicion_id === store.oposicion.id);
    const disponibles = stats.filter((t) => cfg.temas.has(t.tema_id)).reduce((s, t) => s + t.preguntas_activas, 0);

    cont.innerHTML = `
      <div class="page-head"><div><h1>Simulacros</h1><p>Exámenes con preguntas aleatorias de tu banco, sin repeticiones, como en el examen oficial.</p></div></div>
      ${guardados.map((g) => `<div class="alert alert-info" style="margin-bottom:12px">${icon('exam')}<div style="flex:1"><b>Simulacro sin terminar</b> · empezado ${fmtFechaHora(g.inicio)} · ${Object.values(g.respuestas || {}).filter(Boolean).length}/${g.preguntaIds.length} respondidas${g.config?.tiempo_min ? ' · el tiempo sigue corriendo' : ''}</div>
        <button class="btn btn-sm" data-descartar="${g.sesion.id}">Descartar</button><button class="btn btn-sm btn-primary" data-continuar="${g.sesion.id}">Continuar</button></div>`).join('')}
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>Nuevo simulacro</h3><span class="small faint">${fmtNum(disponibles)} preguntas disponibles en los temas elegidos</span></div>
        <div class="card-body stack" style="gap:18px">
          <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Número de preguntas</div>
            <div class="row" style="gap:8px"><div class="seg">${[10, 20, 50, 100].map((n) => `<button data-n="${n}" class="${cfg.n === n ? 'on' : ''}">${n}</button>`).join('')}</div>
            <input class="input" type="number" min="1" max="500" style="width:110px" placeholder="Personalizado" data-ncustom value="${[10, 20, 50, 100].includes(cfg.n) ? '' : cfg.n}"></div></div>
          <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Temas que entran</div>
            <div class="seg" style="margin-bottom:10px"><button data-todos="1" class="${cfg.todos ? 'on' : ''}">Todo el temario</button><button data-todos="0" class="${cfg.todos ? '' : 'on'}">Elegir temas</button></div>
            <div class="chips ${cfg.todos ? 'hidden' : ''}" data-chips>${stats.map((t) => `<button class="chip ${cfg.temas.has(t.tema_id) ? 'on' : ''}" data-t="${t.tema_id}" title="${esc(nombreTema(t))}">${t.numero ? `T${t.numero} · ` : ''}${esc(t.titulo.length > 26 ? t.titulo.slice(0, 24) + '…' : t.titulo)}</button>`).join('')}</div></div>
          <div class="row" style="gap:28px;align-items:flex-start">
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Dificultad</div>
              <div class="chips">${[[1, 'Fácil'], [2, 'Intermedio'], [3, 'Difícil']].map(([d, l]) => `<button class="chip ${cfg.dif.has(d) ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</div></div>
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Tiempo límite</div>
              <div class="row" style="gap:8px"><label class="check"><input type="checkbox" data-tiempo ${cfg.tiempo ? 'checked' : ''}> Con límite</label>
              <input class="input" type="number" min="1" max="600" style="width:90px" data-min value="${cfg.minutos}" ${cfg.tiempo ? '' : 'disabled'}><span class="small muted">min</span></div></div>
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Penalización por error</div>
              <select class="input" style="width:auto" data-pen>${PENALIZACIONES.map(([v, l]) => `<option value="${v}" ${Math.abs(v - cfg.pen) < 0.001 ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom">Personalizada…</option></select>
              <input class="input hidden" type="number" step="0.01" min="0" max="2" style="width:90px;margin-top:6px" data-pencustom placeholder="0,33"></div>
          </div>
          <div><button class="btn btn-primary btn-lg" data-empezar>${icon('exam')} Empezar simulacro</button></div>
        </div>
      </div>
      <div class="grid grid-3">
        <div class="card span-2"><div class="card-head"><h3>Historial</h3></div>
          ${historial.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Preguntas</th><th>Nota</th><th>Aciertos</th><th>Errores</th><th>Blanco</th><th>Tiempo</th></tr></thead><tbody>
            ${historial.map((h) => `<tr class="click" data-ver="${h.id}"><td>${fmtFechaHora(h.iniciada_at)}</td><td>${h.num_preguntas}</td>
              <td><b style="color:${h.nota >= 7 ? 'var(--ok)' : h.nota >= 5 ? 'var(--warn)' : 'var(--bad)'}">${Number(h.nota).toFixed(2).replace('.', ',')}</b></td>
              <td>${h.aciertos}</td><td>${h.errores}</td><td>${h.blancos}</td><td>${fmtDuracion(h.duracion_seg)}</td></tr>`).join('')}</tbody></table></div>`
          : vacio('exam', 'Aún no has hecho simulacros', 'Tus resultados aparecerán aquí para que compares tu evolución.')}</div>
        <div class="card"><div class="card-head"><h3>Comparativa</h3></div><div class="card-body">${historial.length > 1 ? '<div class="chart-box"><canvas data-chart></canvas></div>' : '<p class="small muted">Haz al menos dos simulacros para comparar.</p>'}
          ${historial.length ? `<div class="row-between small" style="margin-top:12px"><span class="muted">Nota media</span><b>${(historial.reduce((s, h) => s + Number(h.nota), 0) / historial.length).toFixed(2).replace('.', ',')}</b></div>
          <div class="row-between small" style="margin-top:4px"><span class="muted">Mejor nota</span><b>${Math.max(...historial.map((h) => Number(h.nota))).toFixed(2).replace('.', ',')}</b></div>` : ''}</div></div>
      </div>`;
    enlazar(guardados);
    if (historial.length > 1) {
      const c = colores();
      const ult = historial.slice(0, 15).reverse();
      grafico(cont.querySelector('[data-chart]'), {
        data: {
          labels: ult.map((h) => new Date(h.iniciada_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })),
          datasets: [
            { type: 'bar', label: 'Nota', data: ult.map((h) => +h.nota), backgroundColor: ult.map((h) => (h.nota >= 5 ? c.accent : c.bad)), borderRadius: 4, yAxisID: 'y' },
            { type: 'line', label: '% acierto', data: ult.map((h) => h.num_preguntas ? Math.round((100 * h.aciertos) / h.num_preguntas) : 0), borderColor: c.ok, pointRadius: 3, yAxisID: 'y2', tension: .3 },
          ],
        },
        options: { scales: { y: { min: 0, max: 10 }, y2: { position: 'right', min: 0, max: 100, grid: { display: false }, ticks: { callback: (v) => v + '%' } } } },
      });
    }
  };

  function enlazar(guardados) {
    cont.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { cfg.n = +b.dataset.n; if (cfg.tiempo) cfg.minutos = Math.round(cfg.n * 1.2); pintar(); });
    cont.querySelector('[data-ncustom]').onchange = (e) => { if (+e.target.value > 0) { cfg.n = +e.target.value; cfg.minutos = Math.round(cfg.n * 1.2); pintar(); } };
    cont.querySelectorAll('[data-todos]').forEach((b) => b.onclick = () => { cfg.todos = b.dataset.todos === '1'; if (cfg.todos) stats.forEach((t) => cfg.temas.add(t.tema_id)); pintar(); });
    cont.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { cfg.temas.has(b.dataset.t) ? cfg.temas.delete(b.dataset.t) : cfg.temas.add(b.dataset.t); pintar(); });
    cont.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const d = +b.dataset.d; cfg.dif.has(d) ? cfg.dif.delete(d) : cfg.dif.add(d); b.classList.toggle('on'); });
    cont.querySelector('[data-tiempo]').onchange = (e) => { cfg.tiempo = e.target.checked; cont.querySelector('[data-min]').disabled = !cfg.tiempo; };
    cont.querySelector('[data-min]').oninput = (e) => { cfg.minutos = +e.target.value || cfg.minutos; };
    const pen = cont.querySelector('[data-pen]'); const penC = cont.querySelector('[data-pencustom]');
    pen.onchange = () => { penC.classList.toggle('hidden', pen.value !== 'custom'); if (pen.value !== 'custom') cfg.pen = +pen.value; };
    penC.oninput = () => { cfg.pen = Math.max(0, +penC.value.replace(',', '.') || 0); };
    cont.querySelector('[data-empezar]').onclick = empezar;
    cont.querySelectorAll('[data-ver]').forEach((tr) => tr.onclick = () => { location.hash = `#/simulacros/${tr.dataset.ver}`; });
    cont.querySelectorAll('[data-continuar]').forEach((b) => b.onclick = async () => {
      const g = guardados.find((x) => x.sesion.id === b.dataset.continuar);
      try { await reanudarSimulacro(cont, g, cargarPreguntas, pintar); } catch (e) { toastError(e); }
    });
    cont.querySelectorAll('[data-descartar]').forEach((b) => b.onclick = async () => {
      if (!(await confirmar('Se descartará el simulacro sin guardar resultados.', { ok: 'Descartar', peligro: true }))) return;
      descartarSimulacroGuardado(b.dataset.descartar); await abandonarSesion(b.dataset.descartar); pintar();
    });
  }

  async function empezar() {
    const temas = cfg.todos ? null : [...cfg.temas];
    if (!cfg.todos && !cfg.temas.size) return toast('Elige al menos un tema.', 'err');
    if (!cfg.dif.size) return toast('Elige al menos una dificultad.', 'err');
    try {
      const ids = ok(await sb.rpc('seleccionar_preguntas', { p_oposicion: store.oposicion.id, p_temas: temas, p_dificultades: [...cfg.dif], p_n: cfg.n, p_modo: 'aleatorio' }));
      if (!ids.length) return toast('No hay preguntas activas con esos filtros.', 'err');
      if (ids.length < cfg.n && !(await confirmar(`Solo hay <b>${ids.length}</b> preguntas disponibles con esos filtros. ¿Hacer el simulacro con ${ids.length}?`, { ok: 'Empezar' }))) return;
      const preguntas = await cargarPreguntas(ids);
      const minutos = cfg.tiempo ? (ids.length < cfg.n ? Math.max(1, Math.round((cfg.minutos * ids.length) / cfg.n)) : cfg.minutos) : null;
      await iniciarSesion(cont, {
        tipo: 'simulacro', preguntas, titulo: `Simulacro · ${preguntas.length} preguntas`,
        config: { n: preguntas.length, temas: temas || 'todos', dificultades: [...cfg.dif], tiempo_min: minutos, penalizacion: cfg.pen },
        onSalir: pintar,
      });
    } catch (e) { toastError(e); }
  }

  await pintar();
  void fmtPct;
}
