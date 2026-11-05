import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema, temaPorId } from '../lib/store.js';
import { esc, icon, toast, toastError, confirmar, vacio, fmtNum, LETRAS, badgeDificultad, ORIGENES, cargando } from '../lib/ui.js';
import { editorPregunta, opcionesTemas } from '../lib/pregunta-ui.js';
import { cargarPreguntas, todas } from '../lib/api.js';

const LOTE = 25;

export async function render(cont, _p, query) {
  const filtroTema = query.tema || '';
  const filtroTrabajo = query.trabajo || '';
  let ids = [];
  let mostradas = 0;

  const base = () => {
    let q = sb.from('preguntas').select('id,tema_id').eq('oposicion_id', store.oposicion.id).eq('estado', 'borrador');
    if (filtroTema) q = q.eq('tema_id', filtroTema);
    if (filtroTrabajo) q = q.eq('trabajo_id', filtroTrabajo);
    return q.order('created_at').order('id');
  };

  cont.innerHTML = `
    <div class="page-head"><div><a class="small" href="#/banco">${icon('left')} Banco de preguntas</a>
      <h1 style="margin-top:6px">Revisar preguntas</h1>
      <p>${filtroTema ? esc(nombreTema(temaPorId(filtroTema))) : filtroTrabajo ? 'Preguntas de este procesamiento' : 'Todas las preguntas pendientes'} · acepta, corrige o descarta antes de que entren en tu banco.</p></div>
      <div class="page-actions" data-acciones></div></div>
    <div data-sintema></div>
    <div class="stack" data-lista>${cargando()}</div>
    <div class="center" style="margin-top:14px" data-mas></div>`;

  async function cargarIds() {
    const filas = await todas(base, 5000);
    if (!cont.querySelector('[data-acciones]')) return;
    ids = filas.map((f) => f.id);
    const sinTema = filas.filter((f) => !f.tema_id).map((f) => f.id);
    cont.querySelector('[data-acciones]').innerHTML = ids.length ? `
      <button class="btn btn-ghost btn-danger" data-descartar-todas>${icon('trash')} Descartar todas</button>
      <button class="btn btn-primary" data-aceptar-todas>${icon('check')} Aceptar todas las válidas (${fmtNum(ids.length)})</button>` : '';
    cont.querySelector('[data-sintema]').innerHTML = sinTema.length && store.temas.length ? `<div class="alert alert-warn" style="margin-bottom:14px">${icon('alert')}
      <div style="flex:1">${fmtNum(sinTema.length)} pregunta(s) no tienen tema asignado. Asígnalo para poder filtrarlas por tema.</div>
      <select class="input" style="width:auto;min-height:32px" data-tema-lote>${opcionesTemas(null).replace('Sin tema', 'Elegir tema…')}</select>
      <button class="btn btn-sm" data-asignar>Asignar</button></div>` : '';
    const asig = cont.querySelector('[data-asignar]');
    if (asig) asig.onclick = async () => {
      const t = cont.querySelector('[data-tema-lote]').value;
      if (!t) return toast('Elige un tema', 'err');
      for (let i = 0; i < sinTema.length; i += 200) ok(await sb.from('preguntas').update({ tema_id: t }).in('id', sinTema.slice(i, i + 200)));
      toast('Tema asignado', 'ok'); reiniciar();
    };
    const at = cont.querySelector('[data-aceptar-todas]');
    if (at) at.onclick = async () => {
      at.disabled = true;
      let n = 0;
      for (let i = 0; i < ids.length; i += 200) n += ok(await sb.rpc('activar_preguntas', { ids: ids.slice(i, i + 200) }));
      toast(n < ids.length ? `${n} añadidas al banco. ${ids.length - n} necesitan que marques la respuesta correcta.` : `${n} preguntas añadidas al banco`, 'ok');
      reiniciar();
    };
    const dt = cont.querySelector('[data-descartar-todas]');
    if (dt) dt.onclick = async () => {
      if (!(await confirmar(`¿Descartar las ${ids.length} preguntas pendientes? Se eliminarán.`, { ok: 'Descartar', peligro: true }))) return;
      for (let i = 0; i < ids.length; i += 200) ok(await sb.from('preguntas').delete().in('id', ids.slice(i, i + 200)));
      toast('Descartadas'); reiniciar();
    };
  }

  async function cargarMas() {
    const lote = ids.slice(mostradas, mostradas + LOTE);
    const lista = cont.querySelector('[data-lista]');
    if (!lista) return;
    if (mostradas === 0) lista.innerHTML = '';
    if (!ids.length) {
      lista.innerHTML = `<div class="card">${vacio('check', 'No hay nada pendiente de revisar', 'Todas las preguntas están en tu banco.', '<a class="btn" href="#/banco">Ir al banco</a>')}</div>`;
      cont.querySelector('[data-mas]').innerHTML = '';
      return;
    }
    const preguntas = await cargarPreguntas(lote);
    if (!lista.isConnected) return;
    preguntas.forEach((p) => lista.insertAdjacentHTML('beforeend', tarjeta(p)));
    preguntas.forEach((p) => enlazar(lista.querySelector(`[data-p="${p.id}"]`), p));
    mostradas += lote.length;
    const mas = cont.querySelector('[data-mas]');
    if (!mas) return;
    mas.innerHTML = mostradas < ids.length ? `<button class="btn">Mostrar más (${fmtNum(ids.length - mostradas)})</button>` : '';
    const b = mas.querySelector('button');
    if (b) b.onclick = () => { b.disabled = true; cargarMas(); };
  }

  function tarjeta(p) {
    const sinCorrecta = p.opciones.filter((o) => o.es_correcta).length !== 1;
    return `<div class="card q-card" data-p="${p.id}">
      <div class="q-meta">
        <span class="badge badge-accent">${esc(nombreTema(temaPorId(p.tema_id)))}</span>${badgeDificultad(p.dificultad)}<span class="badge">${ORIGENES[p.origen]}</span>
        ${sinCorrecta ? '<span class="badge badge-bad">Falta la respuesta correcta</span>' : ''}
      </div>
      ${p.aviso ? `<div class="alert alert-warn" style="margin-bottom:10px">${icon('alert')}<div>${esc(p.aviso)}</div></div>` : ''}
      <div style="font-weight:600;margin-bottom:10px">${esc(p.enunciado)}</div>
      <div class="opts">${p.opciones.map((o, i) => `<div class="opt ${o.es_correcta ? 'ok' : ''}" style="cursor:default;padding:8px 12px"><span class="letter">${LETRAS[i]}</span>
        <span>${esc(o.texto)}${o.explicacion ? `<span class="opt-exp">${esc(o.explicacion)}</span>` : ''}</span></div>`).join('')}</div>
      ${p.explicacion || p.fuente ? `<div class="explain small">${esc(p.explicacion || '')}${p.fuente ? `<div class="faint" style="margin-top:4px">${esc(p.fuente)}</div>` : ''}</div>` : ''}
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button class="btn btn-ghost btn-danger btn-sm" data-descartar>${icon('trash')} Descartar</button>
        <button class="btn btn-sm" data-editar>${icon('edit')} Editar</button>
        <button class="btn btn-primary btn-sm" data-aceptar ${sinCorrecta ? 'disabled title="Edita la pregunta y marca la respuesta correcta"' : ''}>${icon('check')} Aceptar</button>
      </div></div>`;
  }

  function quitar(el, id) {
    el.style.transition = 'opacity .2s'; el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
    ids = ids.filter((x) => x !== id); mostradas--;
    if (!ids.length) setTimeout(reiniciar, 250);
  }

  function enlazar(el, p) {
    el.querySelector('[data-aceptar]').onclick = async () => {
      try { const n = ok(await sb.rpc('activar_preguntas', { ids: [p.id] })); if (n) { toast('Añadida al banco', 'ok'); quitar(el, p.id); } } catch (e) { toastError(e); }
    };
    el.querySelector('[data-descartar]').onclick = async () => {
      try { ok(await sb.from('preguntas').delete().eq('id', p.id)); quitar(el, p.id); } catch (e) { toastError(e); }
    };
    el.querySelector('[data-editar]').onclick = async () => {
      const r = await editorPregunta(p, { estado: 'borrador', titulo: 'Revisar pregunta' });
      if (!r) return;
      const [act] = await cargarPreguntas([p.id]);
      if (act.estado === 'activa') quitar(el, p.id);
      else { el.outerHTML = tarjeta(act); enlazar(cont.querySelector(`[data-p="${p.id}"]`), act); }
    };
  }

  async function reiniciar() { mostradas = 0; await cargarIds(); await cargarMas(); }
  await reiniciar();
}
