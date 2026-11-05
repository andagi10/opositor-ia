import { sb, ok } from '../lib/supabase.js';
import { store } from '../lib/store.js';
import { esc, icon, toast, toastError, fmtNum, LETRAS } from '../lib/ui.js';
import { extraerTexto } from '../lib/extraer.js';
import { parsearPreguntas } from '../lib/parser-preguntas.js';
import { subirDocumento, EXTENSIONES } from '../lib/api.js';
import { iniciarTrabajo, onTrabajos } from '../lib/trabajos.js';
import { opcionesTemas } from '../lib/pregunta-ui.js';

export async function render(cont) {
  let archivo = null;
  let texto = '';
  let analisis = null;
  let trabajoId = null;

  cont.innerHTML = `
    <div class="page-head"><div><a class="small" href="#/banco">${icon('left')} Banco de preguntas</a>
      <h1 style="margin-top:6px">Importar preguntas existentes</h1>
      <p>Sube un documento con preguntas tipo test (y sus respuestas) o pega el texto. Las revisarás antes de añadirlas al banco.</p></div></div>
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h3>1. Origen</h3></div>
        <div class="card-body stack">
          <label class="dropzone" data-drop>
            <input type="file" accept="${EXTENSIONES}" hidden data-file>
            ${icon('upload')}<div style="margin-top:6px" data-nombre><b>Elige o arrastra un documento</b></div>
            <div class="small faint">PDF, DOCX, TXT…</div>
          </label>
          <div class="center small faint">o pega el texto</div>
          <textarea class="input" rows="8" data-texto placeholder="Pregunta 1: ¿Cuál es la capital de España?&#10;A) Barcelona&#10;B) Madrid&#10;C) Sevilla&#10;D) Valencia&#10;Respuesta correcta: B"></textarea>
          <label class="field">Tema de destino
            <select class="input" data-tema><option value="">Detectar automáticamente / asignar después</option>${opcionesTemas(null).replace('<option value="">Sin tema</option>', '')}</select></label>
          <button class="btn btn-primary" data-analizar>${icon('search')} Analizar</button>
        </div>
      </div>
      <div class="card" data-resultado>
        <div class="card-head"><h3>2. Resultado</h3></div>
        <div class="card-body muted small">
          <p>Primero se intenta reconocer el formato sin IA (instantáneo y gratis): numeración, opciones A-D, “Respuesta: B”, asteriscos o una plantilla de soluciones al final.</p>
          <p style="margin:0">Si el formato es irregular o el documento está escaneado, puedes usar la IA. La IA <b>nunca deduce</b> la respuesta correcta: si el documento no la indica, la pregunta queda marcada para que la completes.</p>
        </div>
      </div>
    </div>`;

  const drop = cont.querySelector('[data-drop]');
  const inp = cont.querySelector('[data-file]');
  const elegir = (f) => { archivo = f; cont.querySelector('[data-nombre]').innerHTML = `<b>${esc(f.name)}</b>`; cont.querySelector('[data-texto]').value = ''; };
  inp.onchange = () => inp.files[0] && elegir(inp.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && elegir(e.dataTransfer.files[0]));
  cont.querySelector('[data-texto]').oninput = () => { if (archivo) { archivo = null; cont.querySelector('[data-nombre]').innerHTML = '<b>Elige o arrastra un documento</b>'; } };

  const res = cont.querySelector('[data-resultado]');
  const temaSel = () => cont.querySelector('[data-tema]').value || null;

  cont.querySelector('[data-analizar]').onclick = async () => {
    const btn = cont.querySelector('[data-analizar]');
    btn.disabled = true;
    try {
      texto = archivo ? await extraerTexto(archivo, (m) => { btn.textContent = m; }) : cont.querySelector('[data-texto]').value;
      if (!texto.trim() && !archivo) { toast('Sube un documento o pega el texto.', 'err'); return; }
      analisis = parsearPreguntas(texto);
      pintarResultado();
    } catch (e) {
      analisis = { total: 0, conCorrecta: 0, fiable: false, preguntas: [], error: e.message };
      pintarResultado();
    } finally { btn.disabled = false; btn.innerHTML = `${icon('search')} Analizar`; }
  };

  function pintarResultado() {
    const a = analisis;
    const ejemplo = a.preguntas[0];
    res.innerHTML = `<div class="card-head"><h3>2. Resultado</h3></div><div class="card-body stack">
      ${a.total ? `<div class="alert ${a.fiable ? 'alert-ok' : 'alert-warn'}">${icon(a.fiable ? 'check' : 'alert')}<div>
          Detectadas <b>${fmtNum(a.total)}</b> preguntas, <b>${fmtNum(a.conCorrecta)}</b> con respuesta correcta${a.plantillaDetectada ? ' (plantilla de soluciones encontrada)' : ''}.
          ${a.fiable ? '' : '<br>El formato no se ha reconocido del todo bien: te recomendamos usar la IA.'}</div></div>
        ${ejemplo ? `<div class="job small"><div class="faint" style="margin-bottom:4px">Ejemplo detectado:</div><b>${esc(ejemplo.enunciado)}</b>
          ${ejemplo.opciones.map((o, i) => `<div style="${o.es_correcta ? 'color:var(--ok);font-weight:600' : ''}">${LETRAS[i]}) ${esc(o.texto)}</div>`).join('')}</div>` : ''}
        <button class="btn ${a.fiable ? 'btn-primary' : ''}" data-local>${icon('check')} Importar ${fmtNum(a.total)} preguntas para revisar</button>`
      : `<div class="alert alert-warn">${icon('alert')}<div>${a.error ? esc(a.error) : 'No se ha reconocido ninguna pregunta con el formato estándar.'}${archivo && !texto ? ' Parece un PDF escaneado.' : ''}</div></div>`}
      <button class="btn ${a.fiable ? '' : 'btn-primary'}" data-usar-ia>${icon('sparkles')} ${a.total ? 'Usar IA en su lugar' : 'Interpretar con IA'}</button>
      <div data-progreso></div></div>`;
    const bl = res.querySelector('[data-local]');
    if (bl) bl.onclick = () => importarLocal(bl);
    res.querySelector("[data-usar-ia]").onclick = (e) => importarIA(e.currentTarget);
  }

  async function importarLocal(btn) {
    btn.disabled = true;
    try {
      const tema = temaSel();
      const lista = analisis.preguntas.map((p) => ({
        oposicion_id: store.oposicion.id, tema_id: tema, enunciado: p.enunciado, explicacion: p.explicacion || null,
        dificultad: 2, origen: 'importada', estado: 'borrador',
        aviso: p.tieneCorrecta ? null : 'El documento no indicaba la respuesta correcta.',
        opciones: p.opciones.map((o) => ({ texto: o.texto, es_correcta: o.es_correcta })),
      }));
      let n = 0;
      for (let i = 0; i < lista.length; i += 40) {
        btn.textContent = `Guardando ${Math.min(i + 40, lista.length)} de ${lista.length}…`;
        n += ok(await sb.rpc('guardar_preguntas_lote', { lista: lista.slice(i, i + 40) }));
      }
      toast(`${n} preguntas listas para revisar`, 'ok');
      location.hash = `#/banco/revision${tema ? `?tema=${tema}` : ''}`;
    } catch (e) { toastError(e); btn.disabled = false; }
  }

  async function importarIA(btn) {
    btn.disabled = true;
    const prog = res.querySelector('[data-progreso]');
    try {
      const file = archivo || new File([texto], `preguntas-pegadas-${Date.now()}.txt`, { type: 'text/plain' });
      prog.innerHTML = '<div class="small muted">Subiendo documento…</div>';
      const doc = await subirDocumento(file, { temaId: temaSel(), tipo: 'preguntas', onEstado: (m) => { prog.innerHTML = `<div class="small muted">${esc(m)}</div>`; } });
      const t = await iniciarTrabajo({ tipo: 'importar_preguntas', documento_id: doc.id, tema_id: temaSel() });
      trabajoId = t.id;
      prog.innerHTML = '<div class="small muted">Procesando con IA…</div>';
    } catch (e) { toastError(e); btn.disabled = false; prog.innerHTML = ''; }
  }

  return onTrabajos((lista) => {
    if (!trabajoId) return;
    const t = lista.find((x) => x.id === trabajoId);
    const prog = res.querySelector('[data-progreso]');
    if (!t || !prog) return;
    const pct = t.total_pasos ? (100 * t.paso) / t.total_pasos : 0;
    prog.innerHTML = `<div class="job"><div class="row-between small"><b>IA</b><span>${t.paso}/${t.total_pasos}</span></div>
      <div class="bar" style="margin:8px 0"><span style="width:${Math.max(4, pct)}%"></span></div>
      <div class="small muted">${esc(t.estado === 'error' ? t.error : t.mensaje || '')}</div>
      ${t.estado === 'completado' ? `<a class="btn btn-primary btn-sm" style="margin-top:8px" href="#/banco/revision?trabajo=${t.id}">Revisar ${fmtNum(t.resultado?.preguntas || 0)} preguntas</a>` : ''}</div>`;
  });
}
