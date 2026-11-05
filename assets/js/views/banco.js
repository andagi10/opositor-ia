import { sb, ok } from '../lib/supabase.js';
import { store, etiquetaTema, nombreTema } from '../lib/store.js';
import {
  esc, icon, toast, toastError, modal, vacio, debounce, fmtNum, fmtPct, fmtRelativo, badgeDificultad, badgeDominio,
  ORIGENES, DOMINIOS, descargar, aCSV, confirmar, cargando,
} from '../lib/ui.js';
import { editorPregunta, detallePregunta, opcionesTemas } from '../lib/pregunta-ui.js';
import { todas } from '../lib/api.js';

const POR_PAGINA = 40;

export async function render(cont, _p, query) {
  const f = {
    q: '', tema: query.tema || '', dificultad: '', estado: query.estado || 'activa', origen: '', dominio: query.dominio || '',
    favoritas: false, reportadas: !!query.reportadas, orden: 'recientes',
  };
  let pagina = 0;
  let total = 0;
  const seleccion = new Set();

  const { count: borradores } = await sb.from('preguntas').select('id', { count: 'exact', head: true })
    .eq('oposicion_id', store.oposicion.id).eq('estado', 'borrador');

  cont.innerHTML = `
    <div class="page-head"><div><h1>Banco de preguntas</h1><p>Todas tus preguntas, con su historial y nivel de dominio.</p></div>
      <div class="page-actions">
        ${borradores ? `<a class="btn" href="#/banco/revision">${icon('edit')} Revisar <span class="badge badge-warn">${borradores}</span></a>` : ''}
        <a class="btn" href="#/banco/importar">${icon('upload')} Importar</a>
        <button class="btn btn-primary" data-nueva>${icon('plus')} Nueva pregunta</button>
      </div></div>
    <div class="card card-pad" style="margin-bottom:14px">
      <div class="row" style="gap:8px">
        <div style="position:relative;flex:1;min-width:220px">
          <span style="position:absolute;left:10px;top:10px;color:var(--text-3)">${icon('search')}</span>
          <input class="input" data-q placeholder="Buscar por palabras clave en enunciado o explicación…" style="padding-left:36px">
        </div>
        <select class="input" style="width:auto" data-f="tema">${'<option value="">Todos los temas</option><option value="__sin">Sin tema</option>' + store.temas.map((t) => `<option value="${t.id}">${esc(nombreTema(t))}</option>`).join('')}</select>
        <select class="input" style="width:auto" data-f="dificultad"><option value="">Dificultad</option><option value="1">Fácil</option><option value="2">Intermedio</option><option value="3">Difícil</option></select>
        <select class="input" style="width:auto" data-f="dominio"><option value="">Dominio</option>${Object.entries(DOMINIOS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      </div>
      <div class="row" style="gap:8px;margin-top:10px">
        <div class="seg" data-estado>${['activa', 'borrador', 'archivada'].map((e) => `<button data-e="${e}">${{ activa: 'Activas', borrador: 'Por revisar', archivada: 'Archivadas' }[e]}</button>`).join('')}</div>
        <select class="input" style="width:auto" data-f="origen"><option value="">Cualquier origen</option>${Object.entries(ORIGENES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button class="chip" data-fav>${icon('star')} Favoritas</button>
        <button class="chip" data-rep>${icon('flag')} Reportadas</button>
        <span style="flex:1"></span>
        <select class="input" style="width:auto" data-f="orden">
          <option value="recientes">Más recientes</option><option value="falladas">Más falladas</option><option value="peor">Peor % de acierto</option>
          <option value="olvidadas">Más tiempo sin responder</option><option value="menos">Menos respondidas</option><option value="tema">Por tema</option>
        </select>
        <button class="btn btn-sm" data-export title="Exportar resultados filtrados">${icon('download')} CSV</button>
      </div>
    </div>
    <div class="row-between small muted" style="margin:0 2px 8px"><span data-total></span><label class="check"><input type="checkbox" data-selall> Seleccionar página</label></div>
    <div class="card" data-lista></div>
    <div class="center" style="margin-top:12px" data-mas></div>
    <div data-selbar></div>`;

  // Estado inicial de controles
  cont.querySelectorAll('[data-f]').forEach((s) => { s.value = f[s.dataset.f]; s.onchange = () => { f[s.dataset.f] = s.value; recargar(); }; });
  const pintarSeg = () => cont.querySelectorAll('[data-e]').forEach((b) => b.classList.toggle('on', b.dataset.e === f.estado));
  pintarSeg();
  cont.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { f.estado = b.dataset.e; pintarSeg(); recargar(); });
  const chipFav = cont.querySelector('[data-fav]'); const chipRep = cont.querySelector('[data-rep]');
  chipRep.classList.toggle('on', f.reportadas);
  chipFav.onclick = () => { f.favoritas = !f.favoritas; chipFav.classList.toggle('on', f.favoritas); recargar(); };
  chipRep.onclick = () => { f.reportadas = !f.reportadas; chipRep.classList.toggle('on', f.reportadas); recargar(); };
  cont.querySelector('[data-q]').oninput = debounce((e) => { f.q = e.target.value.trim(); recargar(); }, 300);
  cont.querySelector('[data-nueva]').onclick = async () => { if (await editorPregunta(null, { temaId: f.tema && f.tema !== '__sin' ? f.tema : null })) recargar(); };
  cont.querySelector('[data-export]').onclick = exportar;
  cont.querySelector('[data-selall]').onchange = (e) => {
    cont.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; c.checked ? seleccion.add(c.dataset.sel) : seleccion.delete(c.dataset.sel); });
    pintarSelBar();
  };

  function consulta(campos = 'id,enunciado,tema_id,dificultad,origen,estado,favorita,veces,aciertos,fallos,pct_acierto,ultima_at,dominio,reportes_abiertos,aviso', conteo = true) {
    let q = sb.from('v_banco').select(campos, conteo ? { count: 'exact' } : undefined).eq('oposicion_id', store.oposicion.id).eq('estado', f.estado);
    if (f.tema === '__sin') q = q.is('tema_id', null); else if (f.tema) q = q.eq('tema_id', f.tema);
    if (f.dificultad) q = q.eq('dificultad', +f.dificultad);
    if (f.origen) q = q.eq('origen', f.origen);
    if (f.dominio) q = q.eq('dominio', f.dominio);
    if (f.favoritas) q = q.eq('favorita', true);
    if (f.reportadas) q = q.gt('reportes_abiertos', 0);
    if (f.q) {
      const limpio = f.q.replace(/[,()%*\\]/g, ' ').trim();
      if (limpio) q = q.or(`enunciado.ilike.%${limpio}%,explicacion.ilike.%${limpio}%`);
    }
    const ord = {
      recientes: ['created_at', { ascending: false }], falladas: ['fallos', { ascending: false }], peor: ['pct_acierto', { ascending: true, nullsFirst: false }],
      olvidadas: ['ultima_at', { ascending: true, nullsFirst: false }], menos: ['veces', { ascending: true }], tema: ['tema_id', { ascending: true }],
    }[f.orden];
    return q.order(ord[0], ord[1]).order('id');
  }

  async function recargar() { if (!cont.querySelector('[data-lista]')) return; pagina = 0; seleccion.clear(); pintarSelBar(); cont.querySelector('[data-lista]').innerHTML = cargando(); await cargar(); }

  async function cargar() {
    try {
      const { data, error, count } = await consulta().range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      total = count || 0;
      const lista = cont.querySelector('[data-lista]');
      if (!lista || !lista.isConnected) return;
      if (pagina === 0) lista.innerHTML = '';
      cont.querySelector('[data-total]').textContent = `${fmtNum(total)} pregunta${total === 1 ? '' : 's'}`;
      if (!data.length && pagina === 0) {
        lista.innerHTML = vacio('bank', 'No hay preguntas con estos filtros', f.estado === 'activa' && !f.q ? 'Procesa un tema con IA, importa un documento de preguntas o crea una a mano.' : '');
      }
      lista.insertAdjacentHTML('beforeend', data.map(fila).join(''));
      lista.querySelectorAll('[data-abrir]:not([data-ok])').forEach((el) => {
        el.dataset.ok = '1';
        el.onclick = (e) => { if (!e.target.closest('[data-noclick]')) detallePregunta(el.dataset.abrir, recargar); };
      });
      lista.querySelectorAll('[data-sel]:not([data-ok])').forEach((c) => {
        c.dataset.ok = '1';
        c.onchange = () => { c.checked ? seleccion.add(c.dataset.sel) : seleccion.delete(c.dataset.sel); pintarSelBar(); };
      });
      const mas = cont.querySelector('[data-mas]');
      if (!mas) return;
      const cargadas = (pagina + 1) * POR_PAGINA;
      mas.innerHTML = cargadas < total ? `<button class="btn">Cargar más (${fmtNum(total - cargadas)} restantes)</button>` : '';
      const b = mas.querySelector('button');
      if (b) b.onclick = () => { pagina++; b.disabled = true; cargar(); };
    } catch (e) { toastError(e); }
  }

  function fila(p) {
    return `<div class="list-item click" data-abrir="${p.id}" style="align-items:flex-start">
      <label data-noclick style="padding-top:2px"><input type="checkbox" data-sel="${p.id}" ${seleccion.has(p.id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)"></label>
      <div class="grow">
        <div class="clamp-2" style="font-weight:500">${p.favorita ? `<span style="color:var(--warn)">★</span> ` : ''}${esc(p.enunciado)}</div>
        <div class="row" style="gap:6px;margin-top:6px">
          <span class="badge badge-accent">${esc(etiquetaTema(p.tema_id))}</span>${badgeDificultad(p.dificultad)}${badgeDominio(p.dominio)}
          ${p.reportes_abiertos ? `<span class="badge badge-bad">${icon('flag')} Reportada</span>` : ''}
          ${p.aviso ? '<span class="badge badge-warn">⚠ Revisar</span>' : ''}
          <span class="small faint">${ORIGENES[p.origen]}</span>
        </div>
      </div>
      <div class="right small nowrap" style="min-width:110px">
        ${p.veces ? `<div><b>${fmtPct(p.pct_acierto)}</b> <span class="faint">(${p.aciertos}/${p.veces})</span></div><div class="faint">${fmtRelativo(p.ultima_at)}</div>` : '<span class="faint">Sin responder</span>'}
      </div>
    </div>`;
  }

  function pintarSelBar() {
    const el = cont.querySelector('[data-selbar]');
    if (!el) return;
    if (!seleccion.size) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="sel-bar"><b>${seleccion.size} seleccionada(s)</b><span style="flex:1"></span>
      ${f.estado !== 'activa' ? '<button class="btn btn-sm" data-b="activar">Activar</button>' : ''}
      <button class="btn btn-sm" data-b="tema">Cambiar tema</button>
      <button class="btn btn-sm" data-b="dif">Dificultad</button>
      <button class="btn btn-sm" data-b="fav">Favoritas</button>
      ${f.estado !== 'archivada' ? '<button class="btn btn-sm" data-b="archivar">Archivar</button>' : ''}
      <button class="btn btn-sm" data-b="limpiar">${icon('x')}</button></div>`;
    el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => accionLote(b.dataset.b));
  }

  async function accionLote(acc) {
    const ids = [...seleccion];
    try {
      if (acc === 'limpiar') { seleccion.clear(); cont.querySelectorAll('[data-sel]').forEach((c) => { c.checked = false; }); return pintarSelBar(); }
      if (acc === 'activar') {
        const n = ok(await sb.rpc('activar_preguntas', { ids }));
        toast(n < ids.length ? `${n} activadas. ${ids.length - n} no tienen una única respuesta correcta.` : `${n} activadas`, n < ids.length ? 'err' : 'ok');
      }
      if (acc === 'archivar') {
        if (!(await confirmar(`¿Archivar ${ids.length} preguntas? Conservarán su historial.`, { ok: 'Archivar' }))) return;
        ok(await sb.from('preguntas').update({ estado: 'archivada' }).in('id', ids));
      }
      if (acc === 'fav') ok(await sb.from('preguntas').update({ favorita: true }).in('id', ids));
      if (acc === 'tema' || acc === 'dif') {
        const valor = await new Promise((res) => modal({
          title: acc === 'tema' ? 'Cambiar tema' : 'Cambiar dificultad',
          body: `<select class="input" data-v>${acc === 'tema' ? opcionesTemas(null) : '<option value="1">Fácil</option><option value="2" selected>Intermedio</option><option value="3">Difícil</option>'}</select>`,
          footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Aplicar</button>',
          onMount: (m) => { m.$('[data-ok]').onclick = () => { const v = m.$('[data-v]').value; m.close(); res(v); }; m.$('[data-close]').addEventListener('click', () => res(undefined)); },
        }));
        if (valor === undefined) return;
        ok(await sb.from('preguntas').update(acc === 'tema' ? { tema_id: valor || null } : { dificultad: +valor }).in('id', ids));
      }
      if (acc !== 'activar') toast('Cambios aplicados', 'ok');
      recargar();
    } catch (e) { toastError(e); }
  }

  async function exportar() {
    try {
      toast('Preparando exportación…');
      const filas = await todas(() => consulta('id,enunciado,tema_id,dificultad,origen,estado,favorita,veces,aciertos,fallos,pct_acierto,ultima_at,dominio', false));
      descargar(`banco-preguntas-${new Date().toISOString().slice(0, 10)}.csv`, aCSV(filas, [
        { titulo: 'ID', valor: (r) => r.id }, { titulo: 'Tema', valor: (r) => nombreTema(store.temas.find((t) => t.id === r.tema_id)) },
        { titulo: 'Enunciado', valor: (r) => r.enunciado }, { titulo: 'Dificultad', valor: (r) => ['', 'Fácil', 'Intermedio', 'Difícil'][r.dificultad] },
        { titulo: 'Origen', valor: (r) => ORIGENES[r.origen] }, { titulo: 'Favorita', valor: (r) => r.favorita ? 'Sí' : '' },
        { titulo: 'Veces', valor: (r) => r.veces }, { titulo: 'Aciertos', valor: (r) => r.aciertos }, { titulo: 'Fallos', valor: (r) => r.fallos },
        { titulo: '% acierto', valor: (r) => r.pct_acierto ?? '' }, { titulo: 'Última vez', valor: (r) => r.ultima_at || '' },
        { titulo: 'Dominio', valor: (r) => DOMINIOS[r.dominio]?.label },
      ]), 'text/csv');
    } catch (e) { toastError(e); }
  }

  await cargar();
}
