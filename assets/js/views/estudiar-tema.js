import { sb, ok } from '../lib/supabase.js';
import { store, nombreTema } from '../lib/store.js';
import { esc, icon, toast, toastError, modal, vacio, fmtFechaHora, LETRAS, badgeDificultad, badgeDominio, debounce, barajar } from '../lib/ui.js';
import { markdown } from '../lib/markdown.js';
import { registrarEstudio } from '../lib/api.js';

const CATEGORIAS = { definicion: 'Definiciones', ley: 'Leyes y normas', fecha: 'Fechas', plazo: 'Plazos', cifra: 'Cifras y datos', formula: 'Fórmulas', organo: 'Órganos', persona: 'Personas', otro: 'Otros' };

export async function render(cont, [temaId], query) {
  const tema = ok(await sb.from('temas').select('*').eq('id', temaId).maybeSingle());
  if (!tema) { cont.innerHTML = vacio('book', 'Tema no encontrado'); return; }
  let mats = ok(await sb.from('materiales').select('id,tipo,version,activo,editado,created_at,contenido,datos,avisos').eq('tema_id', temaId).order('version', { ascending: false }));
  let tab = query.tab || (mats.some((m) => m.tipo === 'esquema' && m.activo) ? 'esquema' : mats.some((m) => m.activo) ? mats.find((m) => m.activo).tipo : 'preguntas');
  const verSel = {};

  // Tiempo de estudio: solo cuenta mientras la pestaña está visible
  let acumulado = 0; let desde = Date.now();
  const onVis = () => { if (document.hidden) { acumulado += Date.now() - desde; } else { desde = Date.now(); } };
  document.addEventListener('visibilitychange', onVis);

  cont.innerHTML = `
    <div class="page-head"><div><a class="small" href="#/estudiar">${icon('left')} Estudiar</a><h1 style="margin-top:6px">${esc(nombreTema(tema))}</h1></div>
      <div class="page-actions"><a class="btn" href="#/temario/${temaId}">${icon('file')} Documentos</a>
        <a class="btn btn-primary" href="#/estudiar?tema=${temaId}&empezar=1">${icon('target')} Practicar este tema</a></div></div>
    <div class="tabs" data-tabs>${[['esquema', 'Esquema'], ['resumen', 'Resumen'], ['conceptos', 'Conceptos clave'], ['preguntas', 'Preguntas']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
    <div data-panel></div>`;

  const panel = cont.querySelector('[data-panel]');
  cont.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; pintar(); });

  function material(tipo) {
    const versiones = mats.filter((m) => m.tipo === tipo);
    const id = verSel[tipo];
    return { versiones, actual: versiones.find((m) => m.id === id) || versiones.find((m) => m.activo) || versiones[0] };
  }

  function barraVersiones(tipo, actual, versiones) {
    return `<div class="row-between" style="margin-bottom:12px">
      <div class="row small muted">
        ${versiones.length > 1 ? `<select class="input" style="width:auto;min-height:32px;font-size:13px" data-version>${versiones.map((v) => `<option value="${v.id}" ${v.id === actual.id ? 'selected' : ''}>Versión ${v.version}${v.activo ? ' (actual)' : ''}${v.editado ? ' · editada' : ''}</option>`).join('')}</select>` : `<span>Versión ${actual.version}${actual.editado ? ' · editada por ti' : ' · generada por IA'}</span>`}
        <span>· ${fmtFechaHora(actual.created_at)}</span>
      </div>
      <div class="row" style="gap:6px">
        ${!actual.activo ? '<button class="btn btn-sm" data-activar>Usar esta versión</button>' : ''}
        ${tipo !== 'conceptos' ? `<button class="btn btn-sm" data-editar>${icon('edit')} Editar</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-imprimir title="Imprimir o guardar como PDF">${icon('download')}</button>
      </div></div>
      ${actual.avisos ? `<div class="alert alert-warn" style="margin-bottom:14px">${icon('alert')}<div><b>Avisos de la IA sobre el documento</b><div class="small" style="white-space:pre-line">${esc(actual.avisos)}</div></div></div>` : ''}`;
  }

  function enlazarVersiones(tipo, actual) {
    const sel = panel.querySelector('[data-version]');
    if (sel) sel.onchange = () => { verSel[tipo] = sel.value; pintar(); };
    const act = panel.querySelector('[data-activar]');
    if (act) act.onclick = async () => {
      ok(await sb.from('materiales').update({ activo: false }).eq('tema_id', temaId).eq('tipo', tipo));
      ok(await sb.from('materiales').update({ activo: true }).eq('id', actual.id));
      mats.forEach((m) => { if (m.tipo === tipo) m.activo = m.id === actual.id; });
      toast('Versión activada', 'ok'); pintar();
    };
    const ed = panel.querySelector('[data-editar]');
    if (ed) ed.onclick = () => editar(tipo, actual);
    panel.querySelector('[data-imprimir]').onclick = () => imprimir(tipo, actual);
  }

  function pintar() {
    cont.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'preguntas') return pintarPreguntas();
    const { versiones, actual } = material(tab);
    if (!actual) {
      panel.innerHTML = `<div class="card">${vacio('sparkles', `Todavía no hay ${tab === 'conceptos' ? 'conceptos clave' : tab}`, 'Sube los documentos del tema y procésalos con IA para generarlo.', `<a class="btn btn-primary" href="#/temario/${temaId}">Ir al tema</a>`)}</div>`;
      return;
    }
    if (tab === 'conceptos') return pintarConceptos(actual, versiones);
    panel.innerHTML = `<div class="card card-pad">${barraVersiones(tab, actual, versiones)}<div class="md ${tab === 'esquema' ? 'esquema' : ''}" style="max-width:860px">${markdown(actual.contenido)}</div></div>`;
    enlazarVersiones(tab, actual);
  }

  function pintarConceptos(actual, versiones) {
    const lista = actual.datos || [];
    let modo = 'lista';
    let filtro = '';
    let cat = '';
    panel.innerHTML = `<div class="card card-pad">${barraVersiones('conceptos', actual, versiones)}
      <div class="row" style="margin-bottom:14px">
        <input class="input" style="flex:1;min-width:200px" placeholder="Buscar concepto…" data-buscar>
        <select class="input" style="width:auto" data-cat><option value="">Todas las categorías</option>${Object.entries(CATEGORIAS).filter(([k]) => lista.some((c) => c.categoria === k)).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <div class="seg"><button data-modo="lista" class="on">Lista</button><button data-modo="tarjetas">Tarjetas</button></div>
      </div><div data-cont></div></div>`;
    enlazarVersiones('conceptos', actual);
    const c = panel.querySelector('[data-cont]');
    const filtrados = () => lista.filter((x) => (!cat || x.categoria === cat) && (!filtro || `${x.termino} ${x.definicion}`.toLowerCase().includes(filtro)));
    const pintarC = () => {
      const fl = filtrados();
      if (modo === 'lista') {
        const grupos = {};
        fl.forEach((x) => { (grupos[x.categoria] = grupos[x.categoria] || []).push(x); });
        c.innerHTML = fl.length ? Object.entries(grupos).map(([k, xs]) => `<h3 style="margin:16px 0 8px">${CATEGORIAS[k] || k} <span class="faint small">${xs.length}</span></h3>
          <div class="stack" style="gap:6px">${xs.map((x) => `<div class="job"><b>${esc(x.termino)}</b><div class="muted" style="margin-top:2px">${esc(x.definicion)}</div></div>`).join('')}</div>`).join('') : '<p class="muted">Sin resultados.</p>';
      } else {
        const mazo = barajar(fl);
        let i = 0;
        const carta = () => {
          if (!mazo.length) { c.innerHTML = '<p class="muted">Sin conceptos.</p>'; return; }
          const x = mazo[i];
          c.innerHTML = `<div style="max-width:560px;margin:0 auto">
            <div class="flashcard" data-flip><div class="inner">
              <div class="face"><div class="small faint" style="margin-bottom:8px">${CATEGORIAS[x.categoria] || ''}</div><div style="font-size:20px;font-weight:650">${esc(x.termino)}</div><div class="small faint" style="margin-top:14px">Toca para ver la definición</div></div>
              <div class="face back"><div style="font-size:15.5px">${esc(x.definicion)}</div></div>
            </div></div>
            <div class="row-between" style="margin-top:14px"><button class="btn" data-ant ${i === 0 ? 'disabled' : ''}>${icon('left')} Anterior</button><span class="small muted">${i + 1} / ${mazo.length}</span><button class="btn" data-sig ${i === mazo.length - 1 ? 'disabled' : ''}>Siguiente ${icon('right')}</button></div></div>`;
          c.querySelector('[data-flip]').onclick = (e) => e.currentTarget.classList.toggle('flip');
          c.querySelector('[data-ant]').onclick = () => { i--; carta(); };
          c.querySelector('[data-sig]').onclick = () => { i++; carta(); };
        };
        carta();
      }
    };
    panel.querySelector('[data-buscar]').oninput = debounce((e) => { filtro = e.target.value.toLowerCase().trim(); pintarC(); }, 200);
    panel.querySelector('[data-cat]').onchange = (e) => { cat = e.target.value; pintarC(); };
    panel.querySelectorAll('[data-modo]').forEach((b) => b.onclick = () => { modo = b.dataset.modo; panel.querySelectorAll('[data-modo]').forEach((x) => x.classList.toggle('on', x === b)); pintarC(); });
    pintarC();
  }

  async function pintarPreguntas() {
    panel.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    const ps = ok(await sb.from('v_banco').select('id,enunciado,dificultad,dominio,explicacion,fuente').eq('tema_id', temaId).eq('estado', 'activa').order('created_at').limit(1000));
    const ops = ps.length ? await (async () => {
      const r = [];
      for (let i = 0; i < ps.length; i += 100) r.push(...ok(await sb.from('opciones').select('pregunta_id,texto,es_correcta,orden').in('pregunta_id', ps.slice(i, i + 100).map((p) => p.id))));
      return r;
    })() : [];
    panel.innerHTML = ps.length ? `<div class="card">
      <div class="card-head"><h3>${ps.length} preguntas</h3><button class="btn btn-sm" data-revelar>${icon('eye')} Mostrar todas las respuestas</button></div>
      ${ps.map((p, n) => {
        const os = ops.filter((o) => o.pregunta_id === p.id).sort((a, b) => a.orden - b.orden);
        return `<details class="list-item" style="display:block"><summary style="cursor:pointer;list-style:none"><div class="row" style="flex-wrap:nowrap;align-items:flex-start">
          <span class="faint small" style="width:28px;flex-shrink:0">${n + 1}.</span><span style="flex:1;font-weight:500">${esc(p.enunciado)}</span>${badgeDominio(p.dominio)}</div></summary>
          <div style="padding:10px 0 4px 28px">${os.map((o, i) => `<div style="${o.es_correcta ? 'color:var(--ok);font-weight:600' : ''}">${LETRAS[i]}) ${esc(o.texto)}</div>`).join('')}
          ${p.explicacion ? `<div class="explain small" style="margin-top:8px">${esc(p.explicacion)}${p.fuente ? `<div class="faint">${esc(p.fuente)}</div>` : ''}</div>` : ''}
          <div style="margin-top:6px">${badgeDificultad(p.dificultad)}</div></div></details>`;
      }).join('')}</div>` : `<div class="card">${vacio('bank', 'Este tema no tiene preguntas activas', '', `<a class="btn" href="#/temario/${temaId}">Generar con IA</a>`)}</div>`;
    const rv = panel.querySelector('[data-revelar]');
    if (rv) rv.onclick = () => { const abrir = !panel.querySelector('details[open]'); panel.querySelectorAll('details').forEach((d) => { d.open = abrir; }); };
  }

  function editar(tipo, actual) {
    modal({
      title: `Editar ${tipo}`, size: 'lg',
      body: `<p class="small muted">Formato markdown: <code>## Título</code>, <code>- punto</code>, <code>**negrita**</code>. Se guarda como una versión nueva; la anterior se conserva.</p>
        <textarea class="input mono" rows="20" style="font-size:13px" data-t>${esc(actual.contenido || '')}</textarea>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar versión</button>',
      onMount: (m) => m.$('[data-ok]').onclick = async () => {
        try {
          const version = Math.max(...mats.filter((x) => x.tipo === tipo).map((x) => x.version)) + 1;
          ok(await sb.from('materiales').update({ activo: false }).eq('tema_id', temaId).eq('tipo', tipo));
          const nuevo = ok(await sb.from('materiales').insert({ tema_id: temaId, tipo, contenido: m.$('[data-t]').value, version, activo: true, editado: true }).select('id,tipo,version,activo,editado,created_at,contenido,datos,avisos').single());
          mats.forEach((x) => { if (x.tipo === tipo) x.activo = false; });
          mats.unshift(nuevo); verSel[tipo] = nuevo.id;
          m.close(); toast('Guardado', 'ok'); pintar();
        } catch (e) { toastError(e); }
      },
    });
  }

  function imprimir(tipo, actual) {
    const w = window.open('', '_blank');
    if (!w) return toast('Permite las ventanas emergentes para imprimir.', 'err');
    const cuerpo = tipo === 'conceptos'
      ? (actual.datos || []).map((c) => `<p><b>${esc(c.termino)}</b>: ${esc(c.definicion)}</p>`).join('')
      : markdown(actual.contenido);
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(nombreTema(tema))} · ${tipo}</title>
      <style>body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:30px auto;padding:0 20px;color:#111}h1{font-size:20px}h2{font-size:17px;margin-top:1.4em}h3{font-size:15px}ul{padding-left:1.3em}</style></head>
      <body><h1>${esc(nombreTema(tema))} · ${tipo[0].toUpperCase() + tipo.slice(1)}</h1>${cuerpo}<script>onload=()=>print()<\/script></body></html>`);
    w.document.close();
  }

  pintar();
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    if (!document.hidden) acumulado += Date.now() - desde;
    registrarEstudio(temaId, acumulado / 1000).catch(() => {});
    void store;
  };
}
