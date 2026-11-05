import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, prefs, guardarPreferencias } from '../lib/store.js';
import { esc, icon, toast, toastError, fmtNum, vacio } from '../lib/ui.js';
import { cargarPreguntas, statsTemas } from '../lib/api.js';
import { iniciarSesion } from '../lib/runner.js';

export async function render(cont) {
  const cfg = { n: prefs().repasoN, temas: new Set() };

  const pintar = async () => {
    const [stats, conteo] = await Promise.all([
      statsTemas(),
      sb.from('v_pregunta_stats').select('dominio,vencimiento,veces,veces_confusa').eq('oposicion_id', store.oposicion.id).eq('estado', 'activa').then(ok),
    ]);
    const ahora = Date.now();
    const vencidas = conteo.filter((p) => p.veces > 0 && p.vencimiento && new Date(p.vencimiento) <= ahora).length;
    const nunca = conteo.filter((p) => p.veces === 0).length;
    const dificiles = conteo.filter((p) => p.dominio === 'dificil').length;
    const confusas = conteo.filter((p) => p.veces_confusa >= 2).length;
    const flojos = stats.filter((t) => t.intentos > 0).sort((a, b) => (a.pct_acierto ?? 0) - (b.pct_acierto ?? 0)).slice(0, 3);

    cont.innerHTML = `
      <div class="page-head"><div><h1>Repaso inteligente</h1><p>La app elige por ti las preguntas que más te conviene repasar hoy, según tu historial real.</p></div></div>
      ${conteo.length ? `
      <div class="grid grid-4">
        <div class="card stat"><div class="label">${icon('clock')} Toca repasar</div><div class="value">${fmtNum(vencidas)}</div><div class="sub">su intervalo de repaso ha vencido</div></div>
        <div class="card stat"><div class="label">${icon('alert')} Difíciles</div><div class="value">${fmtNum(dificiles)}</div><div class="sub">falladas varias veces</div></div>
        <div class="card stat"><div class="label">${icon('refresh')} Sueles confundir</div><div class="value">${fmtNum(confusas)}</div><div class="sub">eliges la misma opción incorrecta</div></div>
        <div class="card stat"><div class="label">${icon('eye')} Nunca vistas</div><div class="value">${fmtNum(nunca)}</div><div class="sub">aún sin responder</div></div>
      </div>
      <div class="grid grid-3" style="margin-top:16px">
        <div class="card span-2"><div class="card-body stack" style="gap:16px">
          <h3>Sesión de repaso</h3>
          <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Número de preguntas</div>
            <div class="seg">${[10, 20, 30, 50].map((n) => `<button data-n="${n}" class="${cfg.n === n ? 'on' : ''}">${n}</button>`).join('')}</div></div>
          <div><div class="small muted" style="font-weight:600;margin-bottom:8px">Limitar a temas (opcional)</div>
            <div class="chips">${stats.map((t) => `<button class="chip ${cfg.temas.has(t.tema_id) ? 'on' : ''}" data-t="${t.tema_id}" title="${esc(nombreTema(t))}">${t.numero ? `T${t.numero}` : esc(t.titulo.slice(0, 18))}</button>`).join('')}</div></div>
          <div><button class="btn btn-primary btn-lg" data-empezar>${icon('brain')} Empezar repaso</button></div>
        </div></div>
        <div class="card card-pad">
          <h3 style="margin-bottom:10px">Cómo elige las preguntas</h3>
          <ul class="small muted" style="padding-left:18px;margin:0;display:grid;gap:6px">
            <li>Las que <b>fallas</b> vuelven a los pocos minutos; las que aciertas se espacian (1, 3, 8, 20… días, según lo fácil que te resulte).</li>
            <li>Prioriza las <b>vencidas</b>, las falladas varias veces y las que <b>sueles confundir</b>.</li>
            <li>Mezcla preguntas <b>nunca vistas</b> y de tus <b>temas más flojos</b>${flojos.length ? ` (${flojos.map((t) => t.numero ? `T${t.numero}` : esc(t.titulo.slice(0, 14))).join(', ')})` : ''}.</li>
            <li>Las <b>dominadas</b> solo aparecen cuando toca recordarlas.</li>
          </ul>
        </div>
      </div>` : `<div class="card">${vacio('brain', 'Todavía no hay preguntas en tu banco', 'Procesa algún tema con IA o importa preguntas para empezar a repasar.', '<a class="btn btn-primary" href="#/temario">Mi temario</a>')}</div>`}`;

    cont.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { cfg.n = +b.dataset.n; cont.querySelectorAll('[data-n]').forEach((x) => x.classList.toggle('on', x === b)); guardarPreferencias({ repasoN: cfg.n }).catch(() => {}); });
    cont.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { cfg.temas.has(b.dataset.t) ? cfg.temas.delete(b.dataset.t) : cfg.temas.add(b.dataset.t); b.classList.toggle('on'); });
    const e = cont.querySelector('[data-empezar]');
    if (e) e.onclick = empezar;
  };

  async function empezar() {
    try {
      const sel = ok(await sb.rpc('seleccionar_repaso', { p_oposicion: store.oposicion.id, p_n: cfg.n, p_temas: cfg.temas.size ? [...cfg.temas] : null }));
      if (!sel.length) return toast('No hay preguntas para repasar.', 'err');
      const preguntas = await cargarPreguntas(sel.map((s) => s.pregunta_id));
      await iniciarSesion(cont, {
        tipo: 'repaso', preguntas, titulo: 'Repaso inteligente',
        motivos: Object.fromEntries(sel.map((s) => [s.pregunta_id, s.motivo])),
        config: { n: cfg.n, temas: [...cfg.temas] }, onSalir: pintar,
      });
    } catch (err) { toastError(err); }
  }

  await pintar();
}
