import { sb, ok } from '../lib/supabase.js';
import { store, cargarOposiciones, cambiarOposicion } from '../lib/store.js';
import { toastError } from '../lib/ui.js';

/** Primera vez: crear la oposición y, opcionalmente, la lista de temas. */
export function renderOnboarding(root, alTerminar) {
  root.innerHTML = `
  <div class="auth-main" style="min-height:100vh">
    <div class="card" style="max-width:600px;width:100%">
      <div class="card-body" style="padding:28px">
        <div class="badge badge-accent" style="margin-bottom:12px">Paso 1 de 1</div>
        <h1>¿Qué oposición estás preparando?</h1>
        <p class="muted" style="margin:8px 0 20px">Podrás añadir más oposiciones, temas y documentos cuando quieras.</p>
        <form class="form-grid" data-form>
          <label class="field">Nombre de la oposición
            <input class="input" name="nombre" required placeholder="Ej.: Cuerpo de Ingenieros Industriales del Estado"></label>
          <label class="field">Fecha prevista del examen (opcional)
            <input class="input" type="date" name="fecha"></label>
          <label class="field">Temas (opcional, uno por línea)
            <textarea class="input" name="temas" rows="6" placeholder="Organización del Estado&#10;Derecho Administrativo&#10;Economía"></textarea>
            <span class="small faint" style="font-weight:400">Se numerarán en orden. Si ya tienes el banco de preguntas de la versión anterior, puedes importarlo después desde Configuración.</span></label>
          <button class="btn btn-primary btn-lg">Empezar</button>
        </form>
      </div>
    </div>
  </div>`;
  const form = root.querySelector('[data-form]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const f = Object.fromEntries(new FormData(form));
      const op = ok(await sb.from('oposiciones').insert({ nombre: f.nombre.trim(), fecha_examen: f.fecha || null }).select().single());
      const temas = f.temas.split('\n').map((t) => t.replace(/^\s*(tema\s*)?\d+\s*[.:)\-–]\s*/i, '').trim()).filter(Boolean);
      if (temas.length) ok(await sb.from('temas').insert(temas.map((t, i) => ({ oposicion_id: op.id, numero: i + 1, titulo: t, orden: i + 1 }))));
      await cargarOposiciones();
      await cambiarOposicion(op.id);
      location.hash = temas.length ? '#/temario' : '#/';
      alTerminar();
    } catch (ex) { toastError(ex); btn.disabled = false; }
  };
  void store;
}
