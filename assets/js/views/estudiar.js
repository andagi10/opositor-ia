import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, prefs } from '../lib/store.js';
import { esc, icon, toast, toastError, vacio, fmtNum, fmtPct, barra } from '../lib/ui.js';
import { statsTemas, cargarPreguntas } from '../lib/api.js';
import { iniciarSesion } from '../lib/runner.js';

export async function render(cont, _p, query) {
  const stats = await statsTemas();
  const mats = stats.length ? ok(await sb.from('materiales').select('tema_id,tipo').eq('activo', true).in('tema_id', stats.map((t) => t.tema_id))) : [];
  const cfg = { temas: new Set(query.tema ? [query.tema] : stats.map((t) => t.tema_id)), n: prefs().practicaN, dif: new Set([1, 2, 3]), modo: 'aleatorio' };

  const pintar = () => {
    cont.innerHTML = `
      <div class="page-head"><div><h1>Estudiar</h1><p>Lee el material de cada tema o practica con preguntas tipo test con corrección inmediata.</p></div></div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3>${icon('target')} Práctica por temas</h3><span class="small faint">Corrección y explicación al momento</span></div>
        <div class="card-body stack" style="gap:16px">
          <div><div class="row-between" style="margin-bottom:8px"><span class="small muted" style="font-weight:600">Temas</span>
            <span class="small"><a href="#" data-todos>Todos</a> · <a href="#" data-ninguno>Ninguno</a></span></div>
            <div class="chips">${stats.map((t) => `<button class="chip ${cfg.temas.has(t.tema_id) ? 'on' : ''}" data-t="${t.tema_id}" title="${esc(nombreTema(t))}">${t.numero ? `T${t.numero}` : ''} ${esc(t.titulo.length > 28 ? t.titulo.slice(0, 26) + '…' : t.titulo)} <span class="faint">${t.preguntas_activas}</span></button>`).join('') || '<span class="faint small">Aún no hay temas.</span>'}</div></div>
          <div class="row" style="gap:24px;align-items:flex-start">
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Número de preguntas</div>
              <div class="row" style="gap:6px"><div class="seg" data-n>${[10, 20, 30, 50].map((n) => `<button data-v="${n}" class="${cfg.n === n ? 'on' : ''}">${n}</button>`).join('')}</div>
              <input class="input" type="number" min="1" max="500" style="width:80px" data-ncustom value="${[10, 20, 30, 50].includes(cfg.n) ? '' : cfg.n}" placeholder="Otro"></div></div>
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Dificultad</div>
              <div class="chips">${[[1, 'Fácil'], [2, 'Intermedio'], [3, 'Difícil']].map(([d, l]) => `<button class="chip ${cfg.dif.has(d) ? 'on' : ''}" data-d="${d}">${l}</button>`).join('')}</div></div>
            <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Qué preguntas</div>
              <div class="seg" data-modo>${[['aleatorio', 'Aleatorias'], ['falladas', 'Las que fallo'], ['no_respondidas', 'No respondidas'], ['favoritas', 'Favoritas']].map(([k, l]) => `<button data-m="${k}" class="${cfg.modo === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          </div>
          <div><button class="btn btn-primary btn-lg" data-empezar>${icon('right')} Empezar práctica</button></div>
        </div>
      </div>
      <h2 style="margin:24px 0 12px">Material por tema</h2>
      ${stats.length ? `<div class="grid grid-3">${stats.map((t) => {
        const tiene = (k) => mats.some((m) => m.tema_id === t.tema_id && m.tipo === k);
        return `<a class="card card-pad" href="#/estudiar/${t.tema_id}" style="text-decoration:none;color:inherit;display:block">
          <div class="small faint">${t.numero ? `Tema ${t.numero}` : 'Tema'}</div>
          <div style="font-weight:600;margin:2px 0 10px;min-height:42px" class="clamp-2">${esc(t.titulo)}</div>
          <div class="row" style="gap:4px;margin-bottom:12px">${['esquema', 'resumen', 'conceptos'].map((k) => `<span class="badge ${tiene(k) ? 'badge-ok' : ''}">${k[0].toUpperCase() + k.slice(1)}</span>`).join('')}</div>
          ${barra(t.dominio_estimado)}
          <div class="row-between small muted" style="margin-top:6px"><span>${fmtNum(t.preguntas_activas)} preguntas</span><span>${t.intentos ? `${fmtPct(t.pct_acierto)} acierto` : 'Sin practicar'}</span></div>
        </a>`;
      }).join('')}</div>` : `<div class="card">${vacio('book', 'Sin temas', 'Crea tus temas en Mi temario.', '<a class="btn btn-primary" href="#/temario">Mi temario</a>')}</div>`}`;

    cont.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { cfg.temas.has(b.dataset.t) ? cfg.temas.delete(b.dataset.t) : cfg.temas.add(b.dataset.t); b.classList.toggle('on'); });
    cont.querySelector('[data-todos]').onclick = (e) => { e.preventDefault(); stats.forEach((t) => cfg.temas.add(t.tema_id)); pintar(); };
    cont.querySelector('[data-ninguno]').onclick = (e) => { e.preventDefault(); cfg.temas.clear(); pintar(); };
    cont.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { cfg.n = +b.dataset.v; cont.querySelector('[data-ncustom]').value = ''; cont.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); });
    cont.querySelector('[data-ncustom]').oninput = (e) => { if (+e.target.value > 0) { cfg.n = +e.target.value; cont.querySelectorAll('[data-v]').forEach((x) => x.classList.remove('on')); } };
    cont.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const d = +b.dataset.d; cfg.dif.has(d) ? cfg.dif.delete(d) : cfg.dif.add(d); b.classList.toggle('on'); });
    cont.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { cfg.modo = b.dataset.m; cont.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); });
    cont.querySelector('[data-empezar]').onclick = empezar;
  };

  async function empezar() {
    if (!cfg.temas.size) return toast('Elige al menos un tema.', 'err');
    if (!cfg.dif.size) return toast('Elige al menos una dificultad.', 'err');
    try {
      const ids = ok(await sb.rpc('seleccionar_preguntas', {
        p_oposicion: store.oposicion.id, p_temas: [...cfg.temas], p_dificultades: [...cfg.dif], p_n: cfg.n, p_modo: cfg.modo,
      }));
      if (!ids.length) return toast(cfg.modo === 'falladas' ? 'No tienes preguntas falladas con esos filtros. ¡Bien!' : 'No hay preguntas con esos filtros.', 'err');
      if (ids.length < cfg.n) toast(`Solo hay ${ids.length} preguntas disponibles con esos filtros.`);
      const preguntas = await cargarPreguntas(ids);
      await iniciarSesion(cont, {
        tipo: 'practica', preguntas, titulo: 'Práctica por temas',
        config: { temas: [...cfg.temas], dificultades: [...cfg.dif], n: cfg.n, modo: cfg.modo },
        onSalir: pintar,
      });
    } catch (e) { toastError(e); }
  }

  pintar();
  if (query.empezar) empezar();
}
