import { sb, ok } from '../lib/supabase.js';
import { store, cargarTemas, nombreTema } from '../lib/store.js';
import { esc, icon, toast, toastError, modal, vacio, fmtNum } from '../lib/ui.js';
import { statsTemas } from '../lib/api.js';
import { onTrabajos } from '../lib/trabajos.js';

export async function render(cont) {
  const pintar = async () => {
    const [stats, docs, mats, archivados] = await Promise.all([
      statsTemas(),
      sb.from('documentos').select('tema_id,tipo').eq('oposicion_id', store.oposicion.id).eq('activo', true).then(ok),
      sb.from('materiales').select('tema_id,tipo').eq('activo', true).in('tema_id', store.temas.map((t) => t.id).concat('00000000-0000-0000-0000-000000000000')).then(ok),
      sb.from('temas').select('id,numero,titulo').eq('oposicion_id', store.oposicion.id).eq('archivado', true).order('numero').then(ok),
    ]);
    const nDocs = (id) => docs.filter((d) => d.tema_id === id).length;
    const tiene = (id, tipo) => mats.some((m) => m.tema_id === id && m.tipo === tipo);

    cont.innerHTML = `
      <div class="page-head"><div><h1>Mi temario</h1><p>Organiza los temas, sube tus documentos y deja que la IA genere el material de estudio.</p></div>
        <div class="page-actions"><a class="btn" href="#/banco/importar">${icon('upload')} Importar preguntas</a><button class="btn btn-primary" data-add>${icon('plus')} Añadir temas</button></div></div>
      <div data-trabajos></div>
      <div class="card">
        ${stats.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th style="width:56px">Nº</th><th>Tema</th><th>Documentos</th><th>Material IA</th><th>Preguntas</th><th style="width:96px">Orden</th></tr></thead>
          <tbody>${stats.map((t, i) => `
            <tr class="click" data-ir="${t.tema_id}">
              <td class="faint">${t.numero ?? '—'}</td>
              <td><div style="font-weight:550">${esc(t.titulo)}</div></td>
              <td>${nDocs(t.tema_id) ? `<span class="badge">${icon('file')} ${nDocs(t.tema_id)}</span>` : '<span class="faint small">Sin documentos</span>'}</td>
              <td><div class="row" style="gap:4px">${['esquema', 'resumen', 'conceptos'].map((k) => `<span class="badge ${tiene(t.tema_id, k) ? 'badge-ok' : ''}" title="${k}">${k[0].toUpperCase() + k.slice(1)}</span>`).join('')}</div></td>
              <td><span class="nowrap">${fmtNum(t.preguntas_activas)}</span>${t.preguntas_borrador ? ` <span class="badge badge-warn">${t.preguntas_borrador} por revisar</span>` : ''}</td>
              <td class="nowrap" data-noclick>
                <button class="btn btn-ghost btn-icon btn-sm" data-sube="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('up')}</button>
                <button class="btn btn-ghost btn-icon btn-sm" data-baja="${i}" ${i === stats.length - 1 ? 'disabled' : ''} aria-label="Bajar">${icon('down')}</button>
              </td>
            </tr>`).join('')}</tbody></table></div>`
        : vacio('book', 'Todavía no hay temas', 'Crea los temas de tu oposición. Después podrás subir los documentos de cada uno.', '<button class="btn btn-primary" data-add>Añadir temas</button>')}
      </div>
      ${archivados.length ? `<details style="margin-top:16px"><summary class="small muted" style="cursor:pointer">Temas archivados (${archivados.length})</summary>
        <div class="card" style="margin-top:8px">${archivados.map((t) => `<div class="list-item"><div class="grow">${esc(nombreTema(t))}</div><button class="btn btn-sm" data-restaurar="${t.id}">Restaurar</button></div>`).join('')}</div></details>` : ''}`;

    cont.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => modalAñadir(stats.length, pintar));
    cont.querySelectorAll('[data-ir]').forEach((tr) => tr.onclick = (e) => { if (!e.target.closest('[data-noclick]')) location.hash = `#/temario/${tr.dataset.ir}`; });
    const mover = async (i, d) => {
      const lista = stats.map((t) => t.tema_id);
      [lista[i], lista[i + d]] = [lista[i + d], lista[i]];
      try {
        await Promise.all(lista.map((id, k) => sb.from('temas').update({ orden: k + 1 }).eq('id', id)));
        await cargarTemas(); pintar();
      } catch (e) { toastError(e); }
    };
    cont.querySelectorAll('[data-sube]').forEach((b) => b.onclick = () => mover(+b.dataset.sube, -1));
    cont.querySelectorAll('[data-baja]').forEach((b) => b.onclick = () => mover(+b.dataset.baja, 1));
    cont.querySelectorAll('[data-restaurar]').forEach((b) => b.onclick = async () => {
      ok(await sb.from('temas').update({ archivado: false }).eq('id', b.dataset.restaurar));
      await cargarTemas(); pintar(); toast('Tema restaurado con todo su historial', 'ok');
    });
    pintarTrabajos();
  };

  const pintarTrabajos = (lista) => {
    const el = cont.querySelector('[data-trabajos]');
    if (!el) return;
    lista = lista || [];
    const visibles = lista.filter((t) => ['pendiente', 'procesando', 'error'].includes(t.estado)).slice(0, 5);
    el.innerHTML = visibles.length ? `<div class="card card-pad" style="margin-bottom:16px"><h3 style="margin-bottom:10px">Procesamiento con IA</h3>${visibles.map((t) => `
      <div class="job row-between"><div><b>${esc(nombreTema(store.temas.find((x) => x.id === t.tema_id)) || 'Documento')}</b>
        <div class="small muted">${esc(t.estado === 'error' ? t.error || 'Error' : t.mensaje || '')}</div></div>
        <a class="btn btn-sm" href="#/temario/${t.tema_id || ''}">${t.estado === 'error' ? 'Ver y reintentar' : `${t.paso}/${t.total_pasos}`}</a></div>`).join('')}</div>` : '';
  };

  await pintar();
  return onTrabajos(pintarTrabajos);
}

function modalAñadir(n, alTerminar) {
  modal({
    title: 'Añadir temas',
    body: `<div class="form-grid">
      <label class="field">Títulos de los temas (uno por línea)
        <textarea class="input" rows="8" data-t placeholder="Organización del Estado&#10;Derecho Administrativo&#10;Economía"></textarea></label>
      <label class="field" style="max-width:200px">Empezar numeración en<input class="input" type="number" min="1" value="${n + 1}" data-n></label>
      <p class="small muted" style="margin:0">Puedes pegar el índice del temario: los números del principio de cada línea se usan como número de tema.</p></div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Añadir</button>',
    onMount: (m) => m.$('[data-ok]').onclick = async () => {
      let num = Number(m.$('[data-n]').value) || n + 1;
      const filas = m.$('[data-t]').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const mm = l.match(/^\s*(?:tema\s*)?(\d+)\s*[.:)\-–]\s*(.+)$/i);
        const numero = mm ? Number(mm[1]) : num;
        num = numero + 1;
        return { oposicion_id: store.oposicion.id, numero, titulo: (mm ? mm[2] : l).trim(), orden: numero };
      });
      if (!filas.length) return;
      try {
        ok(await sb.from('temas').insert(filas));
        await cargarTemas(); m.close(); toast(`${filas.length} tema(s) añadidos`, 'ok'); alTerminar();
      } catch (e) { toastError(e); }
    },
  });
}
