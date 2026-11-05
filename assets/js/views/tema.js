import { sb, ok } from '../lib/supabase.js';
import { store, cargarTemas, nombreTema } from '../lib/store.js';
import { esc, icon, toast, toastError, confirmar, modal, pedirTexto, fmtBytes, fmtFechaHora, fmtNum, vacio, fmtRelativo } from '../lib/ui.js';
import { subirDocumento, eliminarDocumento, urlDocumento, EXTENSIONES } from '../lib/api.js';
import { iniciarTrabajo, reintentarTrabajo, cancelarTrabajo, onTrabajos, refrescarTrabajos } from '../lib/trabajos.js';

export async function render(cont, [temaId]) {
  let tema = ok(await sb.from('temas').select('*').eq('id', temaId).maybeSingle());
  if (!tema) { cont.innerHTML = vacio('book', 'Tema no encontrado', '', '<a class="btn" href="#/temario">Volver</a>'); return; }
  let generar = ['esquema', 'resumen', 'conceptos', 'preguntas'];
  let densidad = 1;
  let subiendo = false;

  cont.innerHTML = `
    <div class="page-head">
      <div><a class="small" href="#/temario">${icon('left')} Mi temario</a><h1 style="margin-top:6px" data-titulo></h1><p data-desc></p></div>
      <div class="page-actions">
        <button class="btn" data-editar>${icon('edit')} Editar</button>
        <button class="btn btn-ghost" data-archivar>${icon('archive')} Archivar</button>
        <a class="btn btn-primary" href="#/estudiar/${temaId}">${icon('study')} Estudiar</a>
      </div>
    </div>
    <div class="grid grid-3">
      <div class="span-2 stack">
        <div class="card">
          <div class="card-head"><h3>Documentos del temario</h3><span class="small faint">PDF, DOCX, ODT, TXT, MD, HTML, RTF</span></div>
          <div class="card-body">
            <label class="dropzone" data-drop>
              <input type="file" multiple accept="${EXTENSIONES}" hidden data-file>
              ${icon('upload')}<div style="margin-top:6px"><b>Arrastra aquí tus documentos</b> o haz clic para elegirlos</div>
              <div class="small faint" style="margin-top:4px">Puedes subir varios a la vez. El texto se extrae en tu navegador.</div>
            </label>
            <div data-subidas class="stack" style="gap:6px;margin-top:10px"></div>
          </div>
          <div data-docs></div>
        </div>
        <div class="card" data-materiales></div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h3>${icon('sparkles')} Procesar con IA</h3></div>
          <div class="card-body stack" style="gap:14px">
            <div><div class="small muted" style="margin-bottom:6px;font-weight:600">Qué generar</div>
              <div class="chips" data-gen>${['esquema', 'resumen', 'conceptos', 'preguntas'].map((g) => `<button class="chip on" data-g="${g}">${g[0].toUpperCase() + g.slice(1)}</button>`).join('')}</div></div>
            <div><div class="small muted" style="margin-bottom:6px;font-weight:600">Cantidad de preguntas</div>
              <div class="seg" data-dens><button data-d="0.6">Menos</button><button data-d="1" class="on">Normal</button><button data-d="1.6">Más</button></div></div>
            <button class="btn btn-primary" data-procesar>${icon('sparkles')} Procesar tema</button>
            <p class="small faint" style="margin:0">La IA usa solo tus documentos. Las preguntas quedan en <b>revisión</b> para que las aceptes o corrijas antes de pasar a tu banco. Regenerar crea una nueva versión sin perder las anteriores.</p>
          </div>
          <div data-jobs></div>
        </div>
        <div class="card card-pad" data-resumen-preguntas></div>
      </div>
    </div>`;

  const pintarCabecera = () => {
    cont.querySelector('[data-titulo]').textContent = nombreTema(tema);
    cont.querySelector('[data-desc]').textContent = tema.descripcion || '';
  };
  pintarCabecera();

  // ---------- Documentos ----------
  async function pintarDocs() {
    const docs = ok(await sb.from('documentos').select('id,nombre,tipo,num_caracteres,tamano_bytes,created_at,storage_path,mime,activo,sustituye_a')
      .eq('tema_id', temaId).order('created_at', { ascending: false }));
    const activos = docs.filter((d) => d.activo);
    const antiguos = docs.filter((d) => !d.activo);
    const el = cont.querySelector('[data-docs]');
    if (!el) return;
    el.innerHTML = (activos.length ? activos.map((d) => filaDoc(d)).join('') : '<div class="card-body faint small" style="padding-top:0">Aún no hay documentos en este tema.</div>')
      + (antiguos.length ? `<details style="padding:4px 18px 12px"><summary class="small muted" style="cursor:pointer">Versiones sustituidas (${antiguos.length})</summary>${antiguos.map((d) => filaDoc(d, true)).join('')}</details>` : '');
    el.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => accionDoc(b.dataset.acc, docs.find((d) => d.id === b.dataset.id)));
    pintarProcesarEstado(activos.filter((d) => d.tipo === 'temario').length);
  }

  function filaDoc(d, antiguo = false) {
    const escaneado = !d.num_caracteres && (d.mime === 'application/pdf' || /\.pdf$/i.test(d.nombre));
    return `<div class="list-item" style="${antiguo ? 'opacity:.7;padding-left:0;padding-right:0' : ''}">
      <span style="color:var(--text-3)">${icon('file')}</span>
      <div class="grow"><div class="ellipsis" style="font-weight:550">${esc(d.nombre)} ${d.tipo === 'preguntas' ? '<span class="badge badge-info">Preguntas</span>' : ''}</div>
        <div class="small faint">${fmtBytes(d.tamano_bytes)} · ${d.num_caracteres ? `${fmtNum(d.num_caracteres)} caracteres` : escaneado ? 'PDF escaneado (la IA lo leerá como imagen)' : 'sin texto'} · ${fmtFechaHora(d.created_at)}</div></div>
      <button class="btn btn-ghost btn-icon btn-sm" data-acc="ver" data-id="${d.id}" title="Descargar">${icon('download')}</button>
      ${antiguo ? '' : `<button class="btn btn-ghost btn-icon btn-sm" data-acc="sustituir" data-id="${d.id}" title="Sustituir por una versión nueva">${icon('refresh')}</button>
      <button class="btn btn-ghost btn-icon btn-sm" data-acc="renombrar" data-id="${d.id}" title="Renombrar">${icon('edit')}</button>`}
      <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-acc="borrar" data-id="${d.id}" title="Eliminar">${icon('trash')}</button>
    </div>`;
  }

  async function accionDoc(acc, d) {
    try {
      if (acc === 'ver') window.open(await urlDocumento(d.storage_path), '_blank');
      if (acc === 'renombrar') {
        const n = await pedirTexto('Renombrar documento', { valor: d.nombre });
        if (n) { ok(await sb.from('documentos').update({ nombre: n }).eq('id', d.id)); pintarDocs(); }
      }
      if (acc === 'borrar') {
        if (!(await confirmar(`¿Eliminar <b>${esc(d.nombre)}</b>? Las preguntas y el material ya generados <b>se conservan</b>, igual que tu historial.`, { titulo: 'Eliminar documento', ok: 'Eliminar', peligro: true }))) return;
        await eliminarDocumento(d); toast('Documento eliminado'); pintarDocs();
      }
      if (acc === 'sustituir') {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = EXTENSIONES;
        inp.onchange = () => inp.files[0] && subir([inp.files[0]], d.id);
        inp.click();
      }
    } catch (e) { toastError(e); }
  }

  async function subir(files, sustituye = null) {
    if (subiendo) return toast('Espera a que termine la subida en curso.');
    subiendo = true;
    const box = cont.querySelector('[data-subidas]');
    let subidos = 0;
    for (const f of files) {
      const fila = document.createElement('div');
      fila.className = 'job small';
      fila.innerHTML = `<div class="row-between"><b class="ellipsis">${esc(f.name)}</b><span data-st class="muted">En cola…</span></div>`;
      box.appendChild(fila);
      const st = fila.querySelector('[data-st]');
      if (f.size > 50 * 1024 * 1024) { st.textContent = 'Supera 50 MB'; st.style.color = 'var(--bad)'; continue; }
      try {
        const d = await subirDocumento(f, { temaId, tipo: 'temario', sustituye, onEstado: (m) => { st.textContent = m; } });
        st.textContent = d.avisoLectura ? `Subido, pero: ${d.avisoLectura}` : d.num_caracteres ? `Listo · ${fmtNum(d.num_caracteres)} caracteres` : 'Listo · se leerá con IA visual';
        st.style.color = d.avisoLectura ? 'var(--warn)' : 'var(--ok)';
        subidos++;
      } catch (e) { st.textContent = 'Error: ' + (e.message || e); st.style.color = 'var(--bad)'; }
    }
    subiendo = false;
    setTimeout(() => { box.innerHTML = ''; }, 6000);
    await pintarDocs();
    if (subidos) toast(sustituye ? 'Documento sustituido. Puedes regenerar el material con la nueva versión.' : 'Documentos subidos. Pulsa “Procesar tema” para generar el material.', 'ok');
  }

  const drop = cont.querySelector('[data-drop]');
  const inputFile = cont.querySelector('[data-file]');
  inputFile.onchange = () => { if (inputFile.files.length) subir([...inputFile.files]); inputFile.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) subir([...e.dataTransfer.files]); });

  // ---------- IA ----------
  cont.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => {
    b.classList.toggle('on');
    generar = [...cont.querySelectorAll('[data-g].on')].map((x) => x.dataset.g);
  });
  cont.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
    densidad = +b.dataset.d;
    cont.querySelectorAll('[data-d]').forEach((x) => x.classList.toggle('on', x === b));
  });
  let hayMaterial = false;
  function pintarProcesarEstado(nDocs) {
    const b = cont.querySelector('[data-procesar]');
    if (!b) return;
    b.disabled = !nDocs;
    b.innerHTML = `${icon('sparkles')} ${hayMaterial ? 'Regenerar' : 'Procesar tema'}`;
    b.title = nDocs ? '' : 'Sube primero algún documento';
  }
  cont.querySelector('[data-procesar]').onclick = async () => {
    if (!generar.length) return toast('Elige al menos una cosa que generar.', 'err');
    const btn = cont.querySelector('[data-procesar]');
    btn.disabled = true;
    try {
      await iniciarTrabajo({ tipo: 'procesar_tema', tema_id: temaId, opciones: { generar, densidad } });
      toast('Procesamiento iniciado. Puedes seguir usando la app mientras tanto.', 'ok');
    } catch (e) { toastError(e); }
    btn.disabled = false;
  };

  const pintarJobs = (lista) => {
    const el = cont.querySelector('[data-jobs]');
    if (!el) return;
    const mios = lista.filter((t) => t.tema_id === temaId).slice(0, 4);
    el.innerHTML = mios.length ? `<div class="card-body" style="border-top:1px solid var(--border)">${mios.map((t) => {
      const pct = t.total_pasos ? Math.round((100 * t.paso) / t.total_pasos) : 0;
      const activo = ['pendiente', 'procesando'].includes(t.estado);
      return `<div class="job">
        <div class="row-between small"><b>${t.tipo === 'procesar_tema' ? 'Procesamiento' : 'Importación'}</b>
          <span class="badge ${t.estado === 'completado' ? 'badge-ok' : t.estado === 'error' ? 'badge-bad' : activo ? 'badge-accent' : ''}">${{ pendiente: 'En cola', procesando: 'Procesando', completado: 'Completado', error: 'Error', cancelado: 'Cancelado' }[t.estado]}</span></div>
        ${activo ? `<div class="bar" style="margin:8px 0"><span style="width:${Math.max(4, pct)}%"></span></div>` : ''}
        <div class="small muted" style="margin-top:4px">${esc(t.estado === 'error' ? t.error || '' : t.mensaje || '')}</div>
        <div class="row-between" style="margin-top:6px"><span class="small faint">${fmtRelativo(t.created_at)}</span>
          <div class="row" style="gap:4px">
            ${t.estado === 'error' || t.estado === 'cancelado' ? `<button class="btn btn-sm" data-retry="${t.id}">${icon('refresh')} Reintentar</button>` : ''}
            ${activo ? `<button class="btn btn-sm btn-ghost" data-cancel="${t.id}">Cancelar</button>` : ''}
            ${t.estado === 'completado' && t.resultado?.preguntas ? `<a class="btn btn-sm" href="#/banco/revision?trabajo=${t.id}">Revisar preguntas</a>` : ''}
          </div></div>
      </div>`;
    }).join('')}</div>` : '';
    el.querySelectorAll('[data-retry]').forEach((b) => b.onclick = () => reintentarTrabajo(b.dataset.retry).catch(toastError));
    el.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = () => cancelarTrabajo(b.dataset.cancel).catch(toastError));
    if (mios.some((t) => t.estado === 'completado' && new Date(t.finished_at) > new Date(Date.now() - 10000))) { pintarMateriales(); pintarResumenPreguntas(); }
  };

  // ---------- Material generado ----------
  async function pintarMateriales() {
    const mats = ok(await sb.from('materiales').select('id,tipo,version,created_at,editado,avisos').eq('tema_id', temaId).eq('activo', true));
    hayMaterial = mats.length > 0;
    const el = cont.querySelector('[data-materiales]');
    const fila = (tipo, label) => {
      const m = mats.find((x) => x.tipo === tipo);
      return `<div class="list-item"><div class="grow"><b>${label}</b><div class="small faint">${m ? `Versión ${m.version}${m.editado ? ' (editada)' : ''} · ${fmtFechaHora(m.created_at)}` : 'No generado todavía'}</div></div>
        ${m ? `<a class="btn btn-sm" href="#/estudiar/${temaId}?tab=${tipo}">Abrir</a>` : '<span class="badge">Pendiente</span>'}</div>`;
    };
    const avisos = mats.map((m) => m.avisos).filter(Boolean)[0];
    el.innerHTML = `<div class="card-head"><h3>Material de estudio</h3></div>${fila('esquema', 'Esquema')}${fila('resumen', 'Resumen')}${fila('conceptos', 'Conceptos clave')}
      ${avisos ? `<div class="card-body" style="border-top:1px solid var(--border)"><div class="alert alert-warn">${icon('alert')}<div><b>La IA ha detectado posibles ambigüedades o lagunas:</b><div class="small" style="white-space:pre-line;margin-top:4px">${esc(avisos.split('\n').slice(0, 6).join('\n'))}</div></div></div></div>` : ''}`;
    const nDocs = cont.querySelectorAll('[data-docs] [data-acc="sustituir"]').length;
    pintarProcesarEstado(nDocs);
  }

  async function pintarResumenPreguntas() {
    const { count: act } = await sb.from('preguntas').select('id', { count: 'exact', head: true }).eq('tema_id', temaId).eq('estado', 'activa');
    const { count: bor } = await sb.from('preguntas').select('id', { count: 'exact', head: true }).eq('tema_id', temaId).eq('estado', 'borrador');
    const el = cont.querySelector('[data-resumen-preguntas]');
    if (!el) return;
    el.innerHTML = `
      <h3 style="margin-bottom:10px">Preguntas del tema</h3>
      <div class="row-between"><span class="muted">En el banco</span><b>${fmtNum(act || 0)}</b></div>
      <div class="row-between" style="margin-top:6px"><span class="muted">Pendientes de revisar</span><b>${fmtNum(bor || 0)}</b></div>
      <div class="row" style="margin-top:14px">
        ${bor ? `<a class="btn btn-sm btn-primary" href="#/banco/revision?tema=${temaId}">Revisar ${bor}</a>` : ''}
        <a class="btn btn-sm" href="#/banco?tema=${temaId}">Ver en el banco</a>
      </div>`;
  }

  // ---------- Editar / archivar ----------
  cont.querySelector('[data-editar]').onclick = () => modal({
    title: 'Editar tema',
    body: `<div class="form-grid"><div class="row" style="align-items:flex-end">
      <label class="field" style="width:90px">Número<input class="input" type="number" data-num value="${tema.numero ?? ''}"></label>
      <label class="field" style="flex:1">Título<input class="input" data-tit value="${esc(tema.titulo)}"></label></div>
      <label class="field">Descripción (opcional)<textarea class="input" data-des rows="3">${esc(tema.descripcion || '')}</textarea></label></div>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>',
    onMount: (m) => m.$('[data-ok]').onclick = async () => {
      try {
        tema = ok(await sb.from('temas').update({
          numero: m.$('[data-num]').value ? +m.$('[data-num]').value : null, titulo: m.$('[data-tit]').value.trim() || tema.titulo,
          descripcion: m.$('[data-des]').value.trim() || null,
        }).eq('id', temaId).select().single());
        await cargarTemas(); pintarCabecera(); m.close(); toast('Tema actualizado', 'ok');
      } catch (e) { toastError(e); }
    },
  });
  cont.querySelector('[data-archivar]').onclick = async () => {
    if (!(await confirmar('El tema dejará de aparecer en el temario, las prácticas y los simulacros, pero <b>se conserva todo su historial</b> y podrás restaurarlo cuando quieras.', { titulo: 'Archivar tema', ok: 'Archivar' }))) return;
    ok(await sb.from('temas').update({ archivado: true }).eq('id', temaId));
    await cargarTemas(); location.hash = '#/temario';
  };

  await Promise.all([pintarDocs(), pintarMateriales(), pintarResumenPreguntas()]);
  refrescarTrabajos().catch(() => {});
  return onTrabajos(pintarJobs);
}
