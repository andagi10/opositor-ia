// Editor y ficha de detalle de una pregunta (compartidos por Banco, Revisión, Progreso...).
import { sb, ok } from './supabase.js';
import { store, nombreTema, temaPorId } from './store.js';
import {
  esc, icon, modal, toast, toastError, confirmar, LETRAS, badgeDificultad, badgeDominio, fmtFechaHora, fmtRelativo,
  fmtPct, fmtDuracion, ORIGENES,
} from './ui.js';
import { cargarPregunta, guardarPregunta, historialPregunta, marcarFavorita } from './api.js';
import { markdown } from './markdown.js';

export function opcionesTemas(sel) {
  return `<option value="">Sin tema</option>` + store.temas.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(nombreTema(t))}</option>`).join('');
}

/** Abre el editor. `p` puede ser null (nueva). Devuelve una promesa con el id guardado o null. */
export function editorPregunta(p, { temaId = null, estado = null, titulo } = {}) {
  const nueva = !p?.id;
  const ops = p?.opciones?.length ? p.opciones.map((o) => ({ ...o })) : [0, 1, 2, 3].map(() => ({ texto: '', es_correcta: false, explicacion: '' }));
  return new Promise((resolve) => {
    let guardado = false;
    const m = modal({
      title: titulo || (nueva ? 'Nueva pregunta' : 'Editar pregunta'),
      size: 'lg',
      body: `<div class="form-grid">
        ${p?.aviso ? `<div class="alert alert-warn">${icon('alert')}<div>${esc(p.aviso)}</div></div>` : ''}
        <label class="field">Enunciado<textarea class="input" rows="3" data-enun>${esc(p?.enunciado || '')}</textarea></label>
        <div><div class="row-between" style="margin-bottom:6px"><span class="small muted" style="font-weight:600">Opciones · marca la correcta</span>
          <button class="btn btn-sm btn-ghost" data-addop>${icon('plus')} Opción</button></div>
          <div class="stack" style="gap:8px" data-ops></div></div>
        <label class="field">Explicación de la respuesta correcta<textarea class="input" rows="3" data-exp>${esc(p?.explicacion || '')}</textarea></label>
        <div class="grid grid-3">
          <label class="field">Tema<select class="input" data-tema>${opcionesTemas(p?.tema_id ?? temaId)}</select></label>
          <label class="field">Dificultad<select class="input" data-dif>${[1, 2, 3].map((d) => `<option value="${d}" ${(p?.dificultad ?? 2) === d ? 'selected' : ''}>${['', 'Fácil', 'Intermedio', 'Difícil'][d]}</option>`).join('')}</select></label>
          <label class="field">Fuente / ubicación<input class="input" data-fuente value="${esc(p?.fuente || '')}" placeholder="Apartado 3 · pág. 12"></label>
        </div>
        ${!nueva ? '<p class="small faint" style="margin:0">Editar no borra el historial: las respuestas anteriores siguen asociadas a esta pregunta.</p>' : ''}
      </div>`,
      footer: `<button class="btn" data-close>Cancelar</button>${estado === 'borrador' ? '<button class="btn" data-guardar-borrador>Guardar sin aceptar</button>' : ''}<button class="btn btn-primary" data-ok>${estado === 'borrador' ? 'Aceptar y añadir al banco' : 'Guardar'}</button>`,
      onMount: (api) => {
        const pintarOps = () => {
          api.$('[data-ops]').innerHTML = ops.map((o, i) => `
            <div class="row" style="align-items:flex-start;gap:8px;flex-wrap:nowrap">
              <label class="check" style="margin-top:9px" title="Correcta"><input type="radio" name="correcta" data-c="${i}" ${o.es_correcta ? 'checked' : ''}><b>${LETRAS[i]}</b></label>
              <div style="flex:1">
                <input class="input" data-t="${i}" value="${esc(o.texto)}" placeholder="Texto de la opción">
                <input class="input small" style="min-height:32px;font-size:12.5px;margin-top:4px" data-e="${i}" value="${esc(o.explicacion || '')}" placeholder="Por qué es (in)correcta (opcional)">
              </div>
              <button class="btn btn-ghost btn-icon btn-sm" data-del="${i}" ${ops.length <= 2 ? 'disabled' : ''} title="Quitar">${icon('x')}</button>
            </div>`).join('');
          api.$$('[data-t]').forEach((x) => x.oninput = () => { ops[+x.dataset.t].texto = x.value; });
          api.$$('[data-e]').forEach((x) => x.oninput = () => { ops[+x.dataset.e].explicacion = x.value; });
          api.$$('[data-c]').forEach((x) => x.onchange = () => ops.forEach((o, i) => { o.es_correcta = i === +x.dataset.c; }));
          api.$$('[data-del]').forEach((x) => x.onclick = () => { ops.splice(+x.dataset.del, 1); pintarOps(); });
        };
        pintarOps();
        api.$('[data-addop]').onclick = () => { if (ops.length < 6) { ops.push({ texto: '', es_correcta: false, explicacion: '' }); pintarOps(); } };
        const guardar = async (estadoFinal) => {
          const enunciado = api.$('[data-enun]').value.trim();
          const opsOk = ops.filter((o) => o.texto.trim());
          if (!enunciado) return toast('Escribe el enunciado.', 'err');
          if (opsOk.length < 2) return toast('Necesitas al menos dos opciones.', 'err');
          if (estadoFinal !== 'borrador' && opsOk.filter((o) => o.es_correcta).length !== 1) return toast('Marca exactamente una opción correcta.', 'err');
          try {
            const id = await guardarPregunta({
              id: p?.id || null, oposicion_id: store.oposicion.id, tema_id: api.$('[data-tema]').value || null,
              enunciado, explicacion: api.$('[data-exp]').value.trim() || null, fuente: api.$('[data-fuente]').value.trim() || null,
              aviso: estadoFinal === 'activa' ? null : p?.aviso || null,
              dificultad: +api.$('[data-dif]').value, origen: p?.origen || 'manual', estado: estadoFinal,
              opciones: opsOk.map((o) => ({ id: o.id || null, texto: o.texto.trim(), es_correcta: !!o.es_correcta, explicacion: (o.explicacion || '').trim() || null })),
            });
            guardado = true; api.close(); toast('Pregunta guardada', 'ok'); resolve(id);
          } catch (e) { toastError(e); }
        };
        api.$('[data-ok]').onclick = () => guardar(estado === 'borrador' ? 'activa' : (p?.estado || 'activa'));
        const gb = api.$('[data-guardar-borrador]');
        if (gb) gb.onclick = () => guardar('borrador');
        api.$$('[data-close]').forEach((b) => b.addEventListener('click', () => { if (!guardado) resolve(null); }));
      },
    });
    void m;
  });
}

/** Ficha completa de una pregunta con su historial individual. */
export async function detallePregunta(id, onCambio) {
  let p, hist, stats, reportes;
  try {
    [p, hist, stats, reportes] = await Promise.all([
      cargarPregunta(id),
      historialPregunta(id),
      sb.from('v_pregunta_stats').select('*').eq('pregunta_id', id).maybeSingle().then(ok),
      sb.from('reportes').select('*').eq('pregunta_id', id).eq('resuelto', false).then(ok),
    ]);
  } catch (e) { return toastError(e); }
  const opcion = (oid) => p.opciones.findIndex((o) => o.id === oid);

  const m = modal({
    title: 'Pregunta', size: 'lg',
    body: `
      <div class="q-meta">
        <span class="badge badge-accent">${esc(nombreTema(temaPorId(p.tema_id)))}</span>${badgeDificultad(p.dificultad)}${badgeDominio(stats?.dominio)}
        <span class="badge">${ORIGENES[p.origen] || p.origen}</span>${p.estado !== 'activa' ? `<span class="badge badge-warn">${p.estado}</span>` : ''}
      </div>
      ${reportes.length ? `<div class="alert alert-bad" style="margin-bottom:12px">${icon('flag')}<div style="flex:1">${reportes.map((r) => `<div><b>${r.motivo.replace(/_/g, ' ')}</b>${r.comentario ? `: ${esc(r.comentario)}` : ''}</div>`).join('')}</div><button class="btn btn-sm" data-resolver>Marcar resuelto</button></div>` : ''}
      ${p.aviso ? `<div class="alert alert-warn" style="margin-bottom:12px">${icon('alert')}<div>${esc(p.aviso)}</div></div>` : ''}
      <div class="q-text" style="font-size:16px">${esc(p.enunciado)}</div>
      <div class="opts">${p.opciones.map((o, i) => `<div class="opt ${o.es_correcta ? 'ok' : ''}" style="cursor:default"><span class="letter">${LETRAS[i]}</span><span>${esc(o.texto)}${o.explicacion ? `<span class="opt-exp">${esc(o.explicacion)}</span>` : ''}</span></div>`).join('')}</div>
      ${p.explicacion || p.fuente ? `<div class="explain">${p.explicacion ? `<div class="md">${markdown(p.explicacion)}</div>` : ''}${p.fuente ? `<div class="small faint">${esc(p.fuente)}</div>` : ''}</div>` : ''}
      <h3 style="margin:22px 0 10px">Historial</h3>
      <div class="grid grid-4" style="gap:10px">
        <div class="card stat" style="padding:12px"><div class="label">Veces</div><div class="value" style="font-size:20px">${stats?.veces || 0}</div></div>
        <div class="card stat" style="padding:12px"><div class="label">Acierto</div><div class="value" style="font-size:20px">${fmtPct(stats?.pct_acierto)}</div></div>
        <div class="card stat" style="padding:12px"><div class="label">Última vez</div><div class="value" style="font-size:15px">${fmtRelativo(stats?.ultima_at)}</div></div>
        <div class="card stat" style="padding:12px"><div class="label">Próximo repaso</div><div class="value" style="font-size:15px">${stats?.vencimiento ? fmtRelativo(stats.vencimiento) : '—'}</div></div>
      </div>
      ${stats?.veces_confusa >= 2 ? `<p class="small" style="margin-top:10px;color:var(--warn)">Sueles confundirla con la opción ${LETRAS[opcion(stats.opcion_confusa)] || '?'} (${stats.veces_confusa} veces).</p>` : ''}
      ${hist.length ? `<div class="table-wrap" style="margin-top:10px"><table class="table"><thead><tr><th>Fecha</th><th>Resultado</th><th>Respuesta</th><th>Tiempo</th></tr></thead><tbody>
        ${hist.map((h) => `<tr><td>${h.importado ? '<span class="faint">Importado</span>' : fmtFechaHora(h.respondida_at)}</td>
          <td>${h.correcta ? '<span class="badge badge-ok">Acierto</span>' : h.en_blanco ? '<span class="badge">En blanco</span>' : '<span class="badge badge-bad">Fallo</span>'}</td>
          <td>${h.opcion_id && opcion(h.opcion_id) >= 0 ? LETRAS[opcion(h.opcion_id)] : '—'}</td><td>${h.tiempo_ms ? fmtDuracion(h.tiempo_ms / 1000) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small" style="margin-top:10px">Todavía no has respondido esta pregunta.</p>'}`,
    footer: `
      <button class="btn btn-ghost btn-danger" data-borrar>${icon('trash')} ${hist.length ? 'Archivar' : 'Eliminar'}</button>
      <span style="flex:1"></span>
      <button class="btn" data-fav>${icon('star')} ${p.favorita ? 'Quitar favorita' : 'Favorita'}</button>
      ${p.estado === 'archivada' ? '<button class="btn" data-restaurar>Restaurar</button>' : ''}
      <button class="btn btn-primary" data-editar>${icon('edit')} Editar</button>`,
    onMount: (api) => {
      api.$('[data-editar]').onclick = async () => {
        api.close();
        const r = await editorPregunta(p, { estado: p.estado === 'borrador' ? 'borrador' : null });
        if (r) onCambio?.();
      };
      api.$('[data-fav]').onclick = async () => {
        try { await marcarFavorita(p.id, !p.favorita); api.close(); onCambio?.(); } catch (e) { toastError(e); }
      };
      const res = api.$('[data-resolver]');
      if (res) res.onclick = async () => { ok(await sb.from('reportes').update({ resuelto: true }).eq('pregunta_id', p.id)); api.close(); onCambio?.(); };
      const rest = api.$('[data-restaurar]');
      if (rest) rest.onclick = async () => { ok(await sb.from('preguntas').update({ estado: 'activa' }).eq('id', p.id)); api.close(); onCambio?.(); };
      api.$('[data-borrar]').onclick = async () => {
        if (hist.length) {
          if (!(await confirmar('La pregunta tiene historial, así que se <b>archiva</b>: deja de salir en prácticas y simulacros, pero tus estadísticas pasadas se conservan.', { titulo: 'Archivar pregunta', ok: 'Archivar' }))) return;
          ok(await sb.from('preguntas').update({ estado: 'archivada' }).eq('id', p.id));
        } else {
          if (!(await confirmar('¿Eliminar definitivamente esta pregunta?', { titulo: 'Eliminar pregunta', ok: 'Eliminar', peligro: true }))) return;
          ok(await sb.from('preguntas').delete().eq('id', p.id));
        }
        api.close(); toast('Hecho'); onCambio?.();
      };
    },
  });
  return m;
}
