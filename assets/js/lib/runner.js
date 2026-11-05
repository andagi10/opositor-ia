// Motor de sesiones de preguntas:
//  - modo "feedback" (práctica y repaso): corrige al momento y explica.
//  - modo "examen" (simulacro): navegación libre, preguntas en blanco, marcas, temporizador y penalización.
import {
  esc, icon, toast, toastError, modal, confirmar, barajar, fmtReloj, fmtDuracion, fmtPct, badgeDificultad,
  LETRAS, plural,
} from './ui.js';
import { crearSesion, finalizarSesion, abandonarSesion, registrarIntentos, marcarFavorita, reportar } from './api.js';
import { etiquetaTema, nombreTema, temaPorId } from './store.js';
import { markdown } from './markdown.js';

const CLAVE_SIM = (id) => `opo-sim-${id}`;

// ---------------------------------------------------------------------
// Entrada principal
// ---------------------------------------------------------------------
export async function iniciarSesion(cont, { tipo, preguntas, config = {}, titulo, motivos = {}, onSalir }) {
  if (!preguntas.length) { toast('No hay preguntas que cumplan esos criterios.', 'err'); return; }
  const validas = preguntas.filter((p) => p.opciones.length >= 2 && p.opciones.some((o) => o.es_correcta));
  if (validas.length < preguntas.length) toast(`${preguntas.length - validas.length} pregunta(s) sin respuesta correcta se han omitido.`);
  const sesion = await crearSesion(tipo, config, validas.map((p) => p.id));
  const orden = Object.fromEntries(validas.map((p) => [p.id, barajar(p.opciones.map((o) => o.id))]));
  const ctx = { cont, tipo, preguntas: validas, config, titulo, motivos, onSalir, sesion, orden };
  if (tipo === 'simulacro') return modoExamen(ctx, null);
  return modoFeedback(ctx);
}

// =====================================================================
// MODO FEEDBACK (práctica / repaso)
// =====================================================================
function modoFeedback(ctx) {
  const { cont, preguntas, sesion } = ctx;
  const st = { idx: 0, respuestas: [], inicio: Date.now(), tIni: Date.now(), respondida: false, pendientes: [] };
  let reloj = null;

  const salir = async () => {
    clearInterval(reloj);
    document.removeEventListener('keydown', teclas);
    if (st.respuestas.length) { await flush(); await finalizarSesion(sesion.id, (Date.now() - st.inicio) / 1000); }
    else await abandonarSesion(sesion.id);
  };

  const flush = async () => {
    if (!st.pendientes.length) return;
    const lote = st.pendientes.splice(0);
    try { await registrarIntentos(lote); } catch (e) { st.pendientes.unshift(...lote); toastError(e); }
  };

  function pintar() {
    const p = preguntas[st.idx];
    st.respondida = false;
    st.tIni = Date.now();
    const aciertos = st.respuestas.filter((r) => r.correcta).length;
    cont.innerHTML = `
      <div style="max-width:780px;margin:0 auto">
        <div class="runner-top">
          <button class="btn btn-ghost btn-sm" data-salir>${icon('left')} Salir</button>
          <div class="bar"><span style="width:${(100 * st.idx) / preguntas.length}%"></span></div>
          <span class="small muted nowrap">${st.idx + 1} / ${preguntas.length}</span>
          <span class="badge badge-ok">${aciertos} ✓</span>
          <span class="badge badge-bad">${st.respuestas.length - aciertos} ✗</span>
          <span class="timer" data-reloj>${fmtReloj((Date.now() - st.inicio) / 1000)}</span>
        </div>
        <div class="card q-card">
          ${cabeceraPregunta(p, ctx.motivos[p.id])}
          <div class="q-text">${esc(p.enunciado)}</div>
          <div class="opts">${ctx.orden[p.id].map((oid, i) => {
            const o = p.opciones.find((x) => x.id === oid);
            return `<button class="opt" data-op="${o.id}"><span class="letter">${LETRAS[i]}</span><span class="grow">${esc(o.texto)}<span class="opt-exp hidden"></span></span></button>`;
          }).join('')}</div>
          <div data-feedback></div>
          <div class="row-between" style="margin-top:18px">
            <button class="btn btn-ghost btn-sm" data-blanco>No lo sé</button>
            <button class="btn btn-primary hidden" data-sig>${st.idx === preguntas.length - 1 ? 'Ver resultados' : 'Siguiente'} ${icon('right')}</button>
          </div>
        </div>
        <p class="small faint center" style="margin-top:12px">Atajos: <span class="kbd">1-4</span> responder · <span class="kbd">Enter</span> siguiente</p>
      </div>`;
    cont.querySelector('[data-salir]').onclick = async () => {
      if (st.respuestas.length && !(await confirmar('¿Terminar la sesión ahora? Las respuestas dadas quedan guardadas.', { ok: 'Terminar' }))) return;
      await salir();
      if (st.respuestas.length) resultados(ctx, st.respuestas, (Date.now() - st.inicio) / 1000);
      else ctx.onSalir?.();
    };
    cont.querySelectorAll('[data-op]').forEach((b) => b.onclick = () => responder(b.dataset.op));
    cont.querySelector('[data-blanco]').onclick = () => responder(null);
    cont.querySelector('[data-sig]').onclick = siguiente;
    enlazarAcciones(cont, p);
  }

  function responder(opId) {
    if (st.respondida) return;
    st.respondida = true;
    const p = preguntas[st.idx];
    const correcta = p.opciones.find((o) => o.es_correcta);
    const ok = opId === correcta.id;
    const r = {
      pregunta_id: p.id, tema_id: p.tema_id, sesion_id: sesion.id, opcion_id: opId, en_blanco: !opId,
      correcta: ok, tiempo_ms: Date.now() - st.tIni, dificultad: p.dificultad,
    };
    st.respuestas.push(r);
    st.pendientes.push(r);
    flush();

    cont.querySelectorAll('[data-op]').forEach((b) => {
      b.disabled = true;
      const o = p.opciones.find((x) => x.id === b.dataset.op);
      if (o.es_correcta) b.classList.add('ok');
      else if (b.dataset.op === opId) b.classList.add('bad');
      if (o.explicacion && (o.es_correcta || b.dataset.op === opId)) {
        const e = b.querySelector('.opt-exp'); e.textContent = o.explicacion; e.classList.remove('hidden');
      }
    });
    cont.querySelector('[data-blanco]').classList.add('hidden');
    cont.querySelector('[data-feedback]').innerHTML = bloqueExplicacion(p, ok, !opId);
    const sig = cont.querySelector('[data-sig]');
    sig.classList.remove('hidden'); sig.focus();
  }

  function siguiente() {
    if (!st.respondida) return;
    if (st.idx < preguntas.length - 1) { st.idx++; pintar(); window.scrollTo({ top: 0 }); return; }
    salir().then(() => resultados(ctx, st.respuestas, (Date.now() - st.inicio) / 1000));
  }

  function teclas(e) {
    if (e.target.closest('input,textarea,select') || document.querySelector('.modal-back')) return;
    const p = preguntas[st.idx];
    const n = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(e.key.toLowerCase());
    if (n >= 0 && !st.respondida && ctx.orden[p.id][n]) responder(ctx.orden[p.id][n]);
    if (e.key === 'Enter' && st.respondida) { e.preventDefault(); siguiente(); }
  }
  document.addEventListener('keydown', teclas);
  reloj = setInterval(() => {
    const el = cont.querySelector('[data-reloj]');
    if (!el) { clearInterval(reloj); document.removeEventListener('keydown', teclas); return; }
    el.textContent = fmtReloj((Date.now() - st.inicio) / 1000);
  }, 1000);
  pintar();
}

function cabeceraPregunta(p, motivo) {
  return `<div class="q-meta">
      <span class="badge badge-accent" title="${esc(nombreTema(temaPorId(p.tema_id)))}">${esc(etiquetaTema(p.tema_id))}</span>
      ${badgeDificultad(p.dificultad)}
      ${motivo ? `<span class="badge badge-info">${esc(motivo)}</span>` : ''}
      <span style="flex:1"></span>
      <button class="btn btn-ghost btn-icon btn-sm" data-fav title="Favorita" style="color:${p.favorita ? 'var(--warn)' : ''}">${icon('star')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-rep title="Reportar pregunta">${icon('flag')}</button>
    </div>`;
}

function bloqueExplicacion(p, ok, blanco) {
  const correcta = p.opciones.find((o) => o.es_correcta);
  return `<div class="explain ${ok ? 'ok' : 'bad'}">
      <div style="font-weight:650;margin-bottom:6px;color:${ok ? 'var(--ok)' : 'var(--bad)'}">${ok ? '¡Correcto!' : blanco ? 'Sin responder' : 'Incorrecto'}${ok ? '' : ` · La respuesta correcta es: ${esc(correcta.texto)}`}</div>
      ${p.explicacion ? `<div class="md">${markdown(p.explicacion)}</div>` : ''}
      ${p.fuente ? `<div class="small faint" style="margin-top:6px">${icon('file', '')} ${esc(p.fuente)}</div>` : ''}
      ${p.aviso ? `<div class="small" style="margin-top:6px;color:var(--warn)">⚠ ${esc(p.aviso)}</div>` : ''}
    </div>`;
}

function enlazarAcciones(cont, p) {
  const fav = cont.querySelector('[data-fav]');
  if (fav) fav.onclick = async () => {
    p.favorita = !p.favorita;
    fav.style.color = p.favorita ? 'var(--warn)' : '';
    try { await marcarFavorita(p.id, p.favorita); toast(p.favorita ? 'Añadida a favoritas' : 'Quitada de favoritas'); } catch (e) { toastError(e); }
  };
  const rep = cont.querySelector('[data-rep]');
  if (rep) rep.onclick = () => modalReporte(p.id);
}

export function modalReporte(preguntaId) {
  modal({
    title: 'Reportar pregunta',
    body: `<div class="form-grid">
      <label class="field">Motivo<select class="input" data-motivo>
        <option value="respuesta_incorrecta">La respuesta marcada es incorrecta</option>
        <option value="enunciado_confuso">Enunciado confuso o mal redactado</option>
        <option value="fuera_de_temario">No está en el temario</option>
        <option value="duplicada">Pregunta duplicada</option>
        <option value="otro">Otro</option></select></label>
      <label class="field">Comentario (opcional)<textarea class="input" data-com rows="3"></textarea></label>
      <p class="small muted" style="margin:0">Las preguntas reportadas aparecen filtradas en el Banco de preguntas para que las corrijas.</p></div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Enviar reporte</button>',
    onMount: (m) => {
      m.$('[data-ok]').onclick = async () => {
        try { await reportar(preguntaId, m.$('[data-motivo]').value, m.$('[data-com]').value.trim()); toast('Reporte guardado', 'ok'); m.close(); }
        catch (e) { toastError(e); }
      };
    },
  });
}

// =====================================================================
// MODO EXAMEN (simulacro)
// =====================================================================
export function modoExamen(ctx, guardado) {
  const { cont, preguntas, sesion, config } = ctx;
  const st = guardado || {
    idx: 0, respuestas: {}, marcadas: [], tiempos: {}, inicio: Date.now(), orden: ctx.orden,
  };
  ctx.orden = st.orden;
  const limiteSeg = config.tiempo_min ? config.tiempo_min * 60 : null;
  let tVista = Date.now();
  let reloj = null;
  let entregado = false;

  const guardar = () => {
    try {
      localStorage.setItem(CLAVE_SIM(sesion.id), JSON.stringify({
        ...st, sesion, config, titulo: ctx.titulo, preguntaIds: preguntas.map((p) => p.id),
      }));
    } catch { /* almacenamiento lleno o bloqueado */ }
  };
  const acumular = () => {
    const p = preguntas[st.idx];
    st.tiempos[p.id] = (st.tiempos[p.id] || 0) + (Date.now() - tVista);
    tVista = Date.now();
  };
  const restante = () => limiteSeg - (Date.now() - st.inicio) / 1000;

  function pintar() {
    const p = preguntas[st.idx];
    const marcada = st.marcadas.includes(p.id);
    const resp = st.respuestas[p.id] || null;
    const nResp = Object.values(st.respuestas).filter(Boolean).length;
    cont.innerHTML = `
      <div class="exam-layout">
        <div>
          <div class="card q-card">
            <div class="q-meta">
              <span class="badge">Pregunta ${st.idx + 1} de ${preguntas.length}</span>
              <span class="badge badge-accent">${esc(etiquetaTema(p.tema_id))}</span>
              ${marcada ? '<span class="badge badge-warn">Marcada para revisar</span>' : ''}
            </div>
            <div class="q-text">${esc(p.enunciado)}</div>
            <div class="opts">${st.orden[p.id].map((oid, i) => {
              const o = p.opciones.find((x) => x.id === oid);
              return `<button class="opt ${resp === o.id ? 'sel' : ''}" data-op="${o.id}"><span class="letter">${LETRAS[i]}</span><span>${esc(o.texto)}</span></button>`;
            }).join('')}</div>
            <div class="row-between" style="margin-top:18px">
              <div class="row">
                <button class="btn btn-sm" data-blanco ${resp ? '' : 'disabled'}>Dejar en blanco</button>
                <button class="btn btn-sm" data-marcar>${icon('flag')} ${marcada ? 'Desmarcar' : 'Marcar'}</button>
              </div>
              <div class="row">
                <button class="btn btn-sm" data-prev ${st.idx === 0 ? 'disabled' : ''}>${icon('left')} Anterior</button>
                <button class="btn btn-sm btn-primary" data-next ${st.idx === preguntas.length - 1 ? 'disabled' : ''}>Siguiente ${icon('right')}</button>
              </div>
            </div>
          </div>
        </div>
        <aside class="card card-pad exam-nav">
          <div class="row-between" style="margin-bottom:12px">
            <strong>${esc(ctx.titulo || 'Simulacro')}</strong>
            <span class="timer" data-reloj></span>
          </div>
          <div class="small muted" style="margin-bottom:10px">${nResp} respondidas · ${preguntas.length - nResp} en blanco · ${st.marcadas.length} marcadas</div>
          <div class="qgrid">${preguntas.map((q, i) => `<button data-ir="${i}" class="${st.respuestas[q.id] ? 'ans' : ''} ${i === st.idx ? 'cur' : ''} ${st.marcadas.includes(q.id) ? 'flag' : ''}">${i + 1}</button>`).join('')}</div>
          <button class="btn btn-primary btn-block" style="margin-top:16px" data-entregar>${icon('check')} Entregar examen</button>
          <button class="btn btn-ghost btn-block btn-sm" style="margin-top:6px" data-pausa>Guardar y salir</button>
          ${config.penalizacion ? `<p class="small faint" style="margin:10px 0 0">Cada error resta ${String(+config.penalizacion.toFixed(3)).replace('.', ',')} aciertos. Las preguntas en blanco no penalizan.</p>` : ''}
        </aside>
      </div>`;
    cont.querySelectorAll('[data-op]').forEach((b) => b.onclick = () => {
      st.respuestas[p.id] = st.respuestas[p.id] === b.dataset.op ? null : b.dataset.op;
      guardar(); pintar();
    });
    cont.querySelector('[data-blanco]').onclick = () => { st.respuestas[p.id] = null; guardar(); pintar(); };
    cont.querySelector('[data-marcar]').onclick = () => {
      st.marcadas = marcada ? st.marcadas.filter((x) => x !== p.id) : [...st.marcadas, p.id];
      guardar(); pintar();
    };
    cont.querySelector('[data-prev]').onclick = () => ir(st.idx - 1);
    cont.querySelector('[data-next]').onclick = () => ir(st.idx + 1);
    cont.querySelectorAll('[data-ir]').forEach((b) => b.onclick = () => ir(+b.dataset.ir));
    cont.querySelector('[data-entregar]').onclick = () => pedirEntrega();
    cont.querySelector('[data-pausa]').onclick = () => { acumular(); guardar(); limpiar(); toast('Simulacro guardado. Puedes continuarlo desde Simulacros.'); ctx.onSalir?.(); };
    tick();
  }

  function ir(i) {
    if (i < 0 || i >= preguntas.length) return;
    acumular(); st.idx = i; guardar(); pintar(); window.scrollTo({ top: 0 });
  }

  async function pedirEntrega() {
    const nResp = Object.values(st.respuestas).filter(Boolean).length;
    const blancos = preguntas.length - nResp;
    const ok = await confirmar(
      `Has respondido <b>${nResp}</b> de ${preguntas.length} preguntas.${blancos ? ` ${plural(blancos, 'queda', 'quedan')} en blanco.` : ''}${st.marcadas.length ? ` Tienes ${plural(st.marcadas.length, 'pregunta marcada', 'preguntas marcadas')} para revisar.` : ''}<br><br>¿Entregar el examen?`,
      { titulo: 'Entregar examen', ok: 'Entregar' });
    if (ok) entregar();
  }

  async function entregar() {
    if (entregado) return;
    entregado = true;
    acumular();
    limpiar();
    cont.innerHTML = '<div class="loading"><span class="spinner"></span>Corrigiendo…</div>';
    const duracion = Math.min((Date.now() - st.inicio) / 1000, limiteSeg || Infinity);
    const respuestas = preguntas.map((p) => {
      const op = st.respuestas[p.id] || null;
      const correcta = p.opciones.find((o) => o.es_correcta);
      return {
        pregunta_id: p.id, tema_id: p.tema_id, sesion_id: sesion.id, opcion_id: op, en_blanco: !op,
        correcta: !!op && op === correcta.id, tiempo_ms: st.tiempos[p.id] || null, dificultad: p.dificultad,
      };
    });
    try {
      await registrarIntentos(respuestas);
      await finalizarSesion(sesion.id, duracion);
      localStorage.removeItem(CLAVE_SIM(sesion.id));
    } catch (e) {
      entregado = false;
      toastError(e);
      toast('No se pudo guardar. Tus respuestas siguen en este dispositivo; vuelve a entregar.', 'err');
      guardar(); pintar(); iniciarReloj();
      return;
    }
    resultados(ctx, respuestas, duracion);
  }

  function tick() {
    const el = cont.querySelector('[data-reloj]');
    if (!el) return;
    if (limiteSeg) {
      const r = restante();
      el.textContent = fmtReloj(r);
      el.classList.toggle('low', r < 300);
      if (r <= 0 && !entregado) { toast('Se acabó el tiempo. Examen entregado.'); entregar(); }
    } else {
      el.textContent = fmtReloj((Date.now() - st.inicio) / 1000);
    }
  }
  function iniciarReloj() { clearInterval(reloj); reloj = setInterval(() => { if (!cont.querySelector('[data-reloj]')) return limpiar(); tick(); }, 1000); }
  function limpiar() { clearInterval(reloj); window.removeEventListener('beforeunload', avisoSalida); }
  const avisoSalida = () => { acumular(); guardar(); };
  window.addEventListener('beforeunload', avisoSalida);

  guardar();
  pintar();
  iniciarReloj();
}

/** Simulacros guardados en este dispositivo que se pueden continuar. */
export function simulacrosGuardados() {
  const lista = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('opo-sim-')) continue;
    try { lista.push(JSON.parse(localStorage.getItem(k))); } catch { /* ignorar */ }
  }
  return lista.sort((a, b) => b.inicio - a.inicio);
}

export function descartarSimulacroGuardado(id) { localStorage.removeItem(CLAVE_SIM(id)); }

export async function reanudarSimulacro(cont, guardado, cargarPreguntas, onSalir) {
  const preguntas = await cargarPreguntas(guardado.preguntaIds);
  const ctx = { cont, tipo: 'simulacro', preguntas, config: guardado.config, titulo: guardado.titulo, motivos: {}, onSalir, sesion: guardado.sesion, orden: guardado.orden };
  modoExamen(ctx, guardado);
}

// =====================================================================
// RESULTADOS (comunes)
// =====================================================================
export function resultados(ctx, respuestas, duracionSeg) {
  const { cont, preguntas, config, tipo } = ctx;
  const porId = Object.fromEntries(preguntas.map((p) => [p.id, p]));
  const aciertos = respuestas.filter((r) => r.correcta).length;
  const blancos = respuestas.filter((r) => r.en_blanco).length;
  const errores = respuestas.length - aciertos - blancos;
  // En simulacro cuentan todas las preguntas; en práctica/repaso, solo las que se llegaron a responder
  const total = tipo === 'simulacro' ? preguntas.length : respuestas.length;
  const pct = total ? (100 * aciertos) / total : 0;
  const pen = Number(config.penalizacion || 0);
  const neta = Math.max(0, aciertos - pen * errores);
  const nota = total ? (10 * neta) / total : 0;

  const porTema = {};
  respuestas.forEach((r) => {
    const k = r.tema_id || 'x';
    porTema[k] = porTema[k] || { a: 0, n: 0 };
    porTema[k].n++; if (r.correcta) porTema[k].a++;
  });

  let filtro = errores + blancos ? 'falladas' : 'todas';
  const pintarRevision = () => {
    const lista = respuestas.filter((r) => filtro === 'todas' || (filtro === 'falladas' ? !r.correcta : r.en_blanco));
    cont.querySelector('[data-revision]').innerHTML = lista.length ? lista.map((r) => {
      const p = porId[r.pregunta_id];
      const n = preguntas.indexOf(p) + 1;
      return `<div class="list-item" style="align-items:flex-start;flex-direction:column;gap:8px">
        <div class="row" style="width:100%">
          <span class="badge ${r.correcta ? 'badge-ok' : r.en_blanco ? '' : 'badge-bad'}">${n}. ${r.correcta ? 'Acierto' : r.en_blanco ? 'En blanco' : 'Fallo'}</span>
          <span class="badge badge-accent">${esc(etiquetaTema(p.tema_id))}</span>
          <span style="flex:1"></span>
          <button class="btn btn-ghost btn-sm" data-rep="${p.id}">${icon('flag')} Reportar</button>
        </div>
        <div style="font-weight:550">${esc(p.enunciado)}</div>
        <div class="opts" style="width:100%">${p.opciones.map((o, i) => `
          <div class="opt ${o.es_correcta ? 'ok' : o.id === r.opcion_id ? 'bad' : ''}" style="cursor:default"><span class="letter">${LETRAS[i]}</span>
          <span>${esc(o.texto)}${o.explicacion && (o.es_correcta || o.id === r.opcion_id) ? `<span class="opt-exp">${esc(o.explicacion)}</span>` : ''}</span></div>`).join('')}</div>
        ${p.explicacion || p.fuente ? `<div class="explain" style="margin-top:0;width:100%">${p.explicacion ? `<div class="md">${markdown(p.explicacion)}</div>` : ''}${p.fuente ? `<div class="small faint">${esc(p.fuente)}</div>` : ''}</div>` : ''}
      </div>`;
    }).join('') : '<div class="empty">Nada que mostrar con este filtro.</div>';
    cont.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => modalReporte(b.dataset.rep));
  };

  const esSim = tipo === 'simulacro';
  cont.innerHTML = `
    <div style="max-width:900px;margin:0 auto" class="stack">
      <div class="card card-pad">
        <div class="row-between">
          <div>
            <div class="small muted">${esc(ctx.titulo || (esSim ? 'Simulacro' : 'Resultado'))}</div>
            <div class="row" style="align-items:baseline;gap:14px;margin-top:6px">
              <span class="score-big" style="color:${pct >= 70 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)'}">${esSim ? nota.toFixed(2).replace('.', ',') : fmtPct(pct)}</span>
              <span class="muted">${esSim ? `sobre 10 · ${fmtPct(pct)} de acierto` : `${aciertos} de ${total} correctas`}</span>
            </div>
            <p class="muted" style="margin:8px 0 0">${mensajeNota(pct)}</p>
          </div>
          <div class="row">
            ${errores + blancos ? '<button class="btn" data-repetir>Repetir falladas</button>' : ''}
            <button class="btn btn-primary" data-volver>Continuar</button>
          </div>
        </div>
      </div>
      <div class="grid grid-4">
        <div class="card stat"><div class="label">Aciertos</div><div class="value" style="color:var(--ok)">${aciertos}</div></div>
        <div class="card stat"><div class="label">Errores</div><div class="value" style="color:var(--bad)">${errores}</div>${pen && errores ? `<div class="sub">−${(pen * errores).toFixed(2).replace('.', ',')} por penalización</div>` : ''}</div>
        <div class="card stat"><div class="label">En blanco</div><div class="value">${blancos}</div></div>
        <div class="card stat"><div class="label">Tiempo</div><div class="value">${fmtDuracion(duracionSeg)}</div><div class="sub">${total ? fmtDuracion(duracionSeg / total) : '—'} por pregunta</div></div>
      </div>
      ${Object.keys(porTema).length > 1 ? `<div class="card"><div class="card-head"><h3>Por tema</h3></div><div class="card-body"><div class="stack" style="gap:10px">${
        Object.entries(porTema).map(([k, v]) => `<div class="row" style="gap:12px"><span class="ellipsis" style="width:45%">${esc(nombreTema(temaPorId(k)))}</span>
          <div class="bar ${v.a / v.n >= .75 ? 'ok' : v.a / v.n >= .5 ? 'warn' : 'bad'}" style="flex:1"><span style="width:${(100 * v.a) / v.n}%"></span></div>
          <span class="small nowrap" style="width:80px;text-align:right">${v.a}/${v.n} · ${fmtPct((100 * v.a) / v.n)}</span></div>`).join('')}</div></div></div>` : ''}
      <div class="card">
        <div class="card-head"><h3>Revisión</h3>
          <div class="seg" data-filtro>
            <button data-f="falladas" class="${filtro === 'falladas' ? 'on' : ''}">Falladas y en blanco (${errores + blancos})</button>
            <button data-f="todas" class="${filtro === 'todas' ? 'on' : ''}">Todas (${total})</button>
          </div>
        </div>
        <div data-revision></div>
      </div>
    </div>`;
  cont.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => {
    filtro = b.dataset.f;
    cont.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b));
    pintarRevision();
  });
  cont.querySelector('[data-volver]').onclick = () => ctx.onSalir?.();
  const rep = cont.querySelector('[data-repetir]');
  if (rep) rep.onclick = () => {
    const ids = respuestas.filter((r) => !r.correcta).map((r) => r.pregunta_id);
    iniciarSesion(cont, { tipo: 'practica', preguntas: ids.map((id) => porId[id]), config: { origen: 'repetir_falladas' }, titulo: 'Repaso de falladas', onSalir: ctx.onSalir })
      .catch(toastError);
  };
  pintarRevision();
  window.scrollTo({ top: 0 });
}

function mensajeNota(pct) {
  if (pct >= 90) return 'Excelente. Lo tienes muy dominado.';
  if (pct >= 75) return 'Muy bien. Repasa los fallos para consolidarlo.';
  if (pct >= 60) return 'Vas por buen camino. Insiste en los temas con menos acierto.';
  if (pct >= 40) return 'Aún hay margen. El repaso inteligente priorizará tus fallos.';
  return 'Conviene volver al resumen y al esquema antes de seguir practicando.';
}
