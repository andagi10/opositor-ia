import { sb, ok } from '../lib/supabase.js';
import { store, prefs, guardarPreferencias, cargarTemas } from '../lib/store.js';
import { esc, icon, toast, toastError, confirmar, modal, descargar, fmtNum } from '../lib/ui.js';
import { registrarIntentos, todas } from '../lib/api.js';

export async function render(cont) {
  const p = prefs();
  const temaActual = localStorage.getItem('opo-tema') || 'auto';
  const { count: legado } = await sb.from('preguntas').select('id', { count: 'exact', head: true }).eq('oposicion_id', store.oposicion.id).eq('origen', 'legado');

  cont.innerHTML = `
    <div class="page-head"><div><h1>Configuración</h1><p>Tu perfil, preferencias y datos.</p></div></div>
    <div class="grid grid-2">
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Perfil</h3></div>
          <div class="card-body form-grid">
            <label class="field">Nombre<input class="input" data-nombre value="${esc(store.perfil?.nombre || '')}"></label>
            <label class="field">Email<input class="input" value="${esc(store.user.email)}" disabled></label>
            <div><button class="btn btn-primary" data-guardar-perfil>Guardar</button></div>
          </div></div>
        <div class="card"><div class="card-head"><h3>Apariencia</h3></div>
          <div class="card-body"><div class="seg" data-tema>${[['auto', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button data-t="${k}" class="${temaActual === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
        <div class="card"><div class="card-head"><h3>Preferencias de estudio</h3></div>
          <div class="card-body form-grid">
            <label class="field">Penalización por defecto en simulacros
              <select class="input" data-pen>${[[0, 'Sin penalización'], [0.25, '1/4 por error'], [0.333, '1/3 por error'], [0.5, '1/2 por error'], [1, '1 por error']].map(([v, l]) => `<option value="${v}" ${Math.abs(v - p.penalizacion) < 0.01 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field">Preguntas por práctica<input class="input" type="number" min="5" max="200" data-pn value="${p.practicaN}"></label>
            <label class="field">Preguntas por sesión de repaso<input class="input" type="number" min="5" max="200" data-rn value="${p.repasoN}"></label>
            <div><button class="btn btn-primary" data-guardar-prefs>Guardar preferencias</button></div>
          </div></div>
        <div class="card"><div class="card-head"><h3>Seguridad</h3></div>
          <div class="card-body row"><button class="btn" data-pass>Cambiar contraseña</button><button class="btn" data-logout>${icon('logout')} Cerrar sesión</button></div></div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h3>Versión anterior (examen de la Constitución)</h3></div>
          <div class="card-body stack" style="gap:12px">
            <p class="muted small" style="margin:0">Importa a <b>${esc(store.oposicion.nombre)}</b> las 435 preguntas de los Temas 1 a 4 (Constitución, división de poderes, Gobierno y AGE, sector público institucional) con sus explicaciones y referencias. Se crean los temas que falten. Se puede repetir sin duplicar.</p>
            <div class="row"><button class="btn ${legado ? '' : 'btn-primary'}" data-legado>${icon('upload')} ${legado ? `Banco anterior importado (${fmtNum(legado)}) · reimportar` : 'Importar banco anterior'}</button></div>
            <p class="muted small" style="margin:0">Si en la versión anterior exportaste una copia de seguridad de tus estadísticas, pégala aquí para no perder tu historial.</p>
            <div class="row"><button class="btn" data-stats ${legado ? '' : 'disabled title="Importa antes el banco anterior"'}>${icon('chart')} Importar estadísticas antiguas</button></div>
            <div data-progreso-legado class="small muted"></div>
          </div></div>
        <div class="card"><div class="card-head"><h3>Mis datos</h3></div>
          <div class="card-body stack" style="gap:10px">
            <p class="muted small" style="margin:0">Descarga una copia completa de esta oposición (temas, material, preguntas, sesiones e historial) en JSON.</p>
            <div><button class="btn" data-backup>${icon('download')} Descargar copia completa</button></div>
            <p class="muted small" style="margin:0">Las estadísticas por pregunta, tema y simulacro en CSV están en <a href="#/progreso">Mi progreso → Exportar</a>.</p>
          </div></div>
      </div>
    </div>`;

  cont.querySelector('[data-guardar-perfil]').onclick = async () => {
    try { store.perfil = ok(await sb.from('perfiles').update({ nombre: cont.querySelector('[data-nombre]').value.trim() }).eq('id', store.user.id).select().single()); toast('Perfil guardado', 'ok'); } catch (e) { toastError(e); }
  };
  cont.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
    localStorage.setItem('opo-tema', b.dataset.t);
    const dark = b.dataset.t === 'dark' || (b.dataset.t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    cont.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
  });
  cont.querySelector('[data-guardar-prefs]').onclick = async () => {
    try {
      await guardarPreferencias({
        penalizacion: +cont.querySelector('[data-pen]').value,
        practicaN: Math.max(5, +cont.querySelector('[data-pn]').value || 20),
        repasoN: Math.max(5, +cont.querySelector('[data-rn]').value || 20),
      });
      toast('Preferencias guardadas', 'ok');
    } catch (e) { toastError(e); }
  };
  cont.querySelector('[data-logout]').onclick = () => sb.auth.signOut();
  cont.querySelector('[data-pass]').onclick = () => modal({
    title: 'Cambiar contraseña',
    body: '<label class="field">Nueva contraseña (mínimo 8 caracteres)<input class="input" type="password" minlength="8" data-p autocomplete="new-password"></label>',
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Cambiar</button>',
    onMount: (m) => m.$('[data-ok]').onclick = async () => {
      const v = m.$('[data-p]').value;
      if (v.length < 8) return toast('Mínimo 8 caracteres', 'err');
      const { error } = await sb.auth.updateUser({ password: v });
      if (error) return toastError(error);
      m.close(); toast('Contraseña cambiada', 'ok');
    },
  });
  cont.querySelector('[data-legado]').onclick = (e) => importarLegado(e.currentTarget, cont.querySelector('[data-progreso-legado]'));
  cont.querySelector('[data-stats]').onclick = importarStatsAntiguas;
  cont.querySelector('[data-backup]').onclick = copiaCompleta;
}

async function importarLegado(btn, prog) {
  btn.disabled = true;
  try {
    const banco = await (await fetch('data/banco-anterior.json')).json();
    const existentes = ok(await sb.from('temas').select('id,numero,titulo,archivado').eq('oposicion_id', store.oposicion.id));
    let total = 0;
    const norm = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\W+/g, ' ').trim();
    for (const t of banco.temas) {
      // Se reutiliza un tema solo si tiene el mismo título; si el número está ocupado por otro tema, se usa el siguiente libre
      let tema = existentes.find((x) => norm(x.titulo) === norm(t.nombre) && !x.archivado);
      if (!tema) {
        const ocupado = existentes.some((x) => x.numero === t.numero);
        const numero = ocupado ? Math.max(0, ...existentes.map((x) => x.numero || 0)) + 1 : t.numero;
        tema = ok(await sb.from('temas').insert({ oposicion_id: store.oposicion.id, numero, titulo: t.nombre, orden: numero }).select().single());
        existentes.push(tema);
      }
      const lista = t.preguntas.map((q) => ({
        oposicion_id: store.oposicion.id, tema_id: tema.id, enunciado: q.enunciado, explicacion: q.explicacion, fuente: q.ubicacion,
        dificultad: 2, origen: 'legado', estado: 'activa', legacy_id: q.legacy_id,
        opciones: q.opciones.map((o, i) => ({ texto: o, es_correcta: i === q.correcta })),
      }));
      for (let i = 0; i < lista.length; i += 40) {
        prog.textContent = `Tema ${t.numero}: ${Math.min(i + 40, lista.length)} de ${lista.length}…`;
        total += ok(await sb.rpc('guardar_preguntas_lote', { lista: lista.slice(i, i + 40) }));
      }
    }
    await cargarTemas();
    prog.textContent = '';
    toast(total ? `${total} preguntas importadas` : 'Ya estaban todas importadas', 'ok');
    location.reload();
  } catch (e) { toastError(e); btn.disabled = false; prog.textContent = ''; }
}

function importarStatsAntiguas() {
  modal({
    title: 'Importar estadísticas antiguas',
    body: `<p class="small muted">En la versión anterior: <b>Ver mis estadísticas → Exportar copia de seguridad → Copiar</b>. Pega aquí ese texto.</p>
      <textarea class="input mono" rows="8" style="font-size:12px" data-t placeholder='{"exportedAt":"…","app":"ce1978-quiz","stats":{…}}'></textarea>
      <p class="small faint" style="margin:8px 0 0">Las respuestas antiguas no tenían fecha: se guardan como “importadas”, cuentan para tu dominio y la repetición espaciada, pero no aparecen en las gráficas por día.</p>`,
    footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Importar</button>',
    onMount: (m) => m.$('[data-ok]').onclick = async () => {
      let datos;
      try { datos = JSON.parse(m.$('[data-t]').value.trim()); } catch { return toast('El texto no es una copia válida.', 'err'); }
      const stats = datos?.stats || datos;
      if (!stats || typeof stats !== 'object') return toast('El texto no es una copia válida.', 'err');
      try {
        const { count } = await sb.from('intentos').select('id', { count: 'exact', head: true }).eq('oposicion_id', store.oposicion.id).eq('importado', true);
        if (count && !(await confirmar(`Ya importaste ${count} respuestas antiguas. ¿Importar de nuevo? Se duplicarían.`, { ok: 'Importar igualmente' }))) return;
        const preguntas = await todas(() => sb.from('preguntas').select('id,tema_id,legacy_id,dificultad,opciones(id,es_correcta)').eq('oposicion_id', store.oposicion.id).not('legacy_id', 'is', null));
        const mapa = Object.fromEntries(preguntas.map((p) => [p.legacy_id, p]));
        const base = new Date(datos.exportedAt || Date.now()).getTime();
        const filas = [];
        let n = 0;
        for (const [lid, s] of Object.entries(stats)) {
          const p = mapa[lid];
          if (!p || typeof s?.correct !== 'number') continue;
          n++;
          const hist = Array.isArray(s.history) ? s.history.slice(-5) : [];
          const previosC = Math.max(0, s.correct - hist.filter(Boolean).length);
          const previosW = Math.max(0, s.wrong - hist.filter((x) => !x).length);
          const secuencia = [...Array(previosW).fill(false), ...Array(previosC).fill(true), ...hist];
          const ok1 = p.opciones.find((o) => o.es_correcta)?.id;
          const mal = p.opciones.find((o) => !o.es_correcta)?.id;
          secuencia.forEach((c, k) => filas.push({
            pregunta_id: p.id, tema_id: p.tema_id, correcta: c, opcion_id: c ? ok1 : null, en_blanco: false,
            dificultad: p.dificultad, importado: true, respondida_at: new Date(base - (secuencia.length - k) * 60000).toISOString(),
          }));
          void mal;
        }
        if (!filas.length) return toast('No se ha encontrado ninguna pregunta del banco anterior en esa copia.', 'err');
        filas.sort((a, b) => a.respondida_at.localeCompare(b.respondida_at));
        await registrarIntentos(filas);
        m.close();
        toast(`Historial de ${n} preguntas importado (${filas.length} respuestas)`, 'ok');
      } catch (e) { toastError(e); }
    },
  });
}

async function copiaCompleta() {
  try {
    toast('Preparando la copia…');
    const id = store.oposicion.id;
    const temas = ok(await sb.from('temas').select('*').eq('oposicion_id', id));
    const [preguntas, intentos, sesiones, materiales, documentos] = await Promise.all([
      todas(() => sb.from('preguntas').select('id,tema_id,enunciado,explicacion,fuente,dificultad,origen,estado,favorita,created_at,opciones(id,texto,es_correcta,explicacion,orden)').eq('oposicion_id', id)),
      todas(() => sb.from('intentos').select('pregunta_id,tema_id,sesion_id,opcion_id,correcta,en_blanco,tiempo_ms,respondida_at,importado').eq('oposicion_id', id)),
      todas(() => sb.from('sesiones').select('id,tipo,config,pregunta_ids,estado,iniciada_at,finalizada_at,duracion_seg').eq('oposicion_id', id)),
      temas.length ? todas(() => sb.from('materiales').select('tema_id,tipo,version,activo,contenido,datos,avisos,created_at').in('tema_id', temas.map((t) => t.id))) : [],
      todas(() => sb.from('documentos').select('id,tema_id,tipo,nombre,created_at,activo').eq('oposicion_id', id)),
    ]);
    descargar(`opositor-ia-${store.oposicion.nombre.replace(/\W+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ version: 1, exportado: new Date().toISOString(), oposicion: store.oposicion, temas, documentos, materiales, preguntas, sesiones, intentos }, null, 1), 'application/json');
  } catch (e) { toastError(e); }
}
