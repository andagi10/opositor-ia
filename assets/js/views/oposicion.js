import { sb, ok } from '../lib/supabase.js';
import { store, cargarOposiciones, cambiarOposicion } from '../lib/store.js';
import { esc, icon, toast, toastError, confirmar, modal, fmtNum, fmtFecha, fmtPct } from '../lib/ui.js';
import { resumen, statsTemas } from '../lib/api.js';

export async function render(cont, _p, query) {
  const [res, temas] = await Promise.all([resumen(), statsTemas()]);
  const op = store.oposicion;
  const { count: nDocs } = await sb.from('documentos').select('id', { count: 'exact', head: true }).eq('oposicion_id', op.id).eq('activo', true);

  cont.innerHTML = `
    <div class="page-head"><div><h1>Mi oposición</h1><p>Datos de la oposición activa y gestión de tus oposiciones.</p></div>
      <div class="page-actions"><button class="btn" data-nueva>${icon('plus')} Nueva oposición</button></div></div>
    <div class="grid grid-3">
      <div class="card span-2">
        <div class="card-head"><h3>Datos</h3></div>
        <form class="card-body form-grid" data-form>
          <label class="field">Nombre<input class="input" name="nombre" value="${esc(op.nombre)}" required></label>
          <label class="field">Descripción, convocatoria o notas<textarea class="input" name="descripcion" rows="3" placeholder="Ej.: OEP 2026, BOE-A-2025-…, 187 plazas, examen tipo test de 100 preguntas">${esc(op.descripcion || '')}</textarea></label>
          <label class="field" style="max-width:260px">Fecha prevista del examen<input class="input" type="date" name="fecha_examen" value="${op.fecha_examen || ''}"></label>
          <div><button class="btn btn-primary">Guardar cambios</button></div>
        </form>
      </div>
      <div class="card card-pad stack" style="gap:12px">
        <div class="row-between"><span class="muted">Temas</span><b>${fmtNum(temas.length)}</b></div>
        <div class="row-between"><span class="muted">Documentos</span><b>${fmtNum(nDocs || 0)}</b></div>
        <div class="row-between"><span class="muted">Preguntas activas</span><b>${fmtNum(res.preguntas_activas)}</b></div>
        <div class="row-between"><span class="muted">Pendientes de revisar</span><b>${fmtNum(res.borradores)}</b></div>
        <div class="row-between"><span class="muted">Respuestas registradas</span><b>${fmtNum(res.intentos)}</b></div>
        <div class="row-between"><span class="muted">Acierto global</span><b>${fmtPct(res.intentos ? 100 * res.aciertos / res.intentos : null)}</b></div>
        <div class="row-between"><span class="muted">Simulacros</span><b>${fmtNum(res.simulacros)}</b></div>
        <div class="row-between"><span class="muted">Creada</span><b>${fmtFecha(op.created_at)}</b></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Mis oposiciones</h3></div>
      ${store.oposiciones.map((o) => `
        <div class="list-item">
          <div class="grow"><div style="font-weight:550">${esc(o.nombre)} ${o.id === op.id ? '<span class="badge badge-accent">Activa</span>' : ''}</div>
            <div class="small faint">${o.fecha_examen ? `Examen: ${fmtFecha(o.fecha_examen)}` : 'Sin fecha de examen'}</div></div>
          ${o.id !== op.id ? `<button class="btn btn-sm" data-activar="${o.id}">Activar</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-archivar="${o.id}" title="Archivar">${icon('archive')}</button>
          <button class="btn btn-sm btn-ghost btn-danger" data-borrar="${o.id}" title="Eliminar">${icon('trash')}</button>
        </div>`).join('')}
    </div>`;

  cont.querySelector('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      ok(await sb.from('oposiciones').update({ nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, fecha_examen: f.fecha_examen || null }).eq('id', op.id));
      await cargarOposiciones();
      toast('Guardado', 'ok');
    } catch (ex) { toastError(ex); }
  };
  cont.querySelector('[data-nueva]').onclick = nuevaOposicion;
  cont.querySelectorAll('[data-activar]').forEach((b) => b.onclick = async () => { await cambiarOposicion(b.dataset.activar); location.hash = '#/'; });
  cont.querySelectorAll('[data-archivar]').forEach((b) => b.onclick = async () => {
    if (store.oposiciones.length === 1) return toast('Crea otra oposición antes de archivar esta.', 'err');
    if (!(await confirmar('La oposición se ocultará pero conservará todos sus datos.', { titulo: 'Archivar oposición', ok: 'Archivar' }))) return;
    ok(await sb.from('oposiciones').update({ archivada: true }).eq('id', b.dataset.archivar));
    await cargarOposiciones(); location.hash = '#/';
  });
  cont.querySelectorAll('[data-borrar]').forEach((b) => b.onclick = () => borrar(store.oposiciones.find((o) => o.id === b.dataset.borrar)));
  if (query.nueva) nuevaOposicion();
}

function nuevaOposicion() {
  modal({
    title: 'Nueva oposición',
    body: `<div class="form-grid">
      <label class="field">Nombre<input class="input" data-n placeholder="Ej.: OPE Osakidetza · Técnico/a de Enfermería"></label>
      <label class="field">Fecha del examen (opcional)<input class="input" type="date" data-f></label></div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Crear</button>',
    onMount: (m) => m.$('[data-ok]').onclick = async () => {
      const nombre = m.$('[data-n]').value.trim();
      if (!nombre) return;
      try {
        const op = ok(await sb.from('oposiciones').insert({ nombre, fecha_examen: m.$('[data-f]').value || null }).select().single());
        await cargarOposiciones(); await cambiarOposicion(op.id);
        m.close(); toast('Oposición creada', 'ok'); location.hash = '#/temario';
      } catch (e) { toastError(e); }
    },
  });
}

function borrar(o) {
  modal({
    title: 'Eliminar oposición',
    body: `<p>Se eliminarán <b>definitivamente</b> todos los temas, documentos, preguntas, simulacros e historial de <b>${esc(o.nombre)}</b>. No se puede deshacer.</p>
      <p class="muted small">Si solo quieres ocultarla, usa “Archivar”.</p>
      <label class="field">Escribe el nombre de la oposición para confirmar<input class="input" data-c></label>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-danger" data-ok disabled>Eliminar definitivamente</button>',
    onMount: (m) => {
      m.$('[data-c]').oninput = (e) => { m.$('[data-ok]').disabled = e.target.value.trim() !== o.nombre.trim(); };
      m.$('[data-ok]').onclick = async () => {
        try {
          const { data: docs } = await sb.from('documentos').select('storage_path').eq('oposicion_id', o.id);
          const paths = (docs || []).map((d) => d.storage_path).filter(Boolean);
          if (paths.length) await sb.storage.from('documentos').remove(paths);
          ok(await sb.from('oposiciones').delete().eq('id', o.id));
          m.close(); await cargarOposiciones();
          if (!store.oposicion) location.reload(); else location.hash = '#/';
          toast('Oposición eliminada');
        } catch (e) { toastError(e); }
      };
    },
  });
}
