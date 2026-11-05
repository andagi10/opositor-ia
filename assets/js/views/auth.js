import { sb } from '../lib/supabase.js';
import { esc, icon, toast, mensajeError } from '../lib/ui.js';

export function renderAuth(root) {
  let modo = 'entrar';
  const pintar = () => {
    root.innerHTML = `
    <div class="auth-wrap">
      <section class="auth-side">
        <div class="brand" style="padding:0"><div class="brand-logo">O</div>Opositor IA</div>
        <div>
          <h1>Prepara tu oposición con método, de principio a fin.</h1>
          <p style="color:#9aa4b5;max-width:440px">Sube tu temario y la IA lo convierte en esquemas, resúmenes y preguntas tipo test. Practica, haz simulacros y deja que el repaso inteligente te diga qué estudiar cada día.</p>
          <ul>
            <li>${icon('sparkles')}<div><b>Temario procesado con IA</b>Solo a partir de tus documentos, sin inventar datos.</div></li>
            <li>${icon('exam')}<div><b>Simulacros reales</b>Tiempo límite, penalización y navegación como en el examen.</div></li>
            <li>${icon('brain')}<div><b>Repetición espaciada</b>Cada pregunta guarda su historial y vuelve cuando la necesitas.</div></li>
          </ul>
        </div>
        <div class="small" style="color:#6b7487">Tus datos son privados: nadie más puede ver tus documentos, preguntas ni resultados.</div>
      </section>
      <section class="auth-main">
        <div class="auth-card">
          <h1 style="margin-bottom:6px">${modo === 'entrar' ? 'Inicia sesión' : modo === 'registro' ? 'Crea tu cuenta' : 'Recuperar contraseña'}</h1>
          <p class="muted" style="margin-bottom:22px">${modo === 'entrar' ? 'Continúa donde lo dejaste, desde cualquier dispositivo.' : modo === 'registro' ? 'Gratis. Solo necesitas un email.' : 'Te enviaremos un enlace para crear una nueva.'}</p>
          <form class="form-grid" data-form>
            ${modo === 'registro' ? '<label class="field">Nombre<input class="input" name="nombre" autocomplete="name" required></label>' : ''}
            <label class="field">Email<input class="input" type="email" name="email" autocomplete="email" required></label>
            ${modo !== 'recuperar' ? `<label class="field">Contraseña<input class="input" type="password" name="password" minlength="8" autocomplete="${modo === 'registro' ? 'new-password' : 'current-password'}" required></label>` : ''}
            <div class="alert alert-bad hidden" data-err></div>
            <div class="alert alert-ok hidden" data-ok></div>
            <button class="btn btn-primary btn-lg" type="submit">${modo === 'entrar' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}</button>
          </form>
          <div class="small muted" style="margin-top:18px;display:flex;flex-direction:column;gap:8px">
            ${modo === 'entrar' ? `<span>¿No tienes cuenta? <a href="#" data-modo="registro">Regístrate</a></span><a href="#" data-modo="recuperar">¿Olvidaste la contraseña?</a>`
              : '<span>¿Ya tienes cuenta? <a href="#" data-modo="entrar">Inicia sesión</a></span>'}
          </div>
        </div>
      </section>
    </div>`;
    root.querySelectorAll('[data-modo]').forEach((a) => a.onclick = (e) => { e.preventDefault(); modo = a.dataset.modo; pintar(); });
    const form = root.querySelector('[data-form]');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const btn = form.querySelector('button[type=submit]');
      const err = root.querySelector('[data-err]'); const okEl = root.querySelector('[data-ok]');
      err.classList.add('hidden'); okEl.classList.add('hidden');
      btn.disabled = true;
      try {
        if (modo === 'entrar') {
          const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
          if (error) throw error;
        } else if (modo === 'registro') {
          const { data, error } = await sb.auth.signUp({
            email: f.email, password: f.password,
            options: { data: { nombre: f.nombre }, emailRedirectTo: location.origin + location.pathname },
          });
          if (error) throw error;
          if (!data.session) { okEl.textContent = 'Cuenta creada. Revisa tu email para confirmarla y luego inicia sesión.'; okEl.classList.remove('hidden'); }
        } else {
          const { error } = await sb.auth.resetPasswordForEmail(f.email, { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          okEl.textContent = 'Si el email existe, recibirás un enlace en unos minutos.'; okEl.classList.remove('hidden');
        }
      } catch (ex) {
        const m = mensajeError(ex);
        err.textContent = /Invalid login/i.test(m) ? 'Email o contraseña incorrectos.' : /already registered/i.test(m) ? 'Ese email ya tiene cuenta. Inicia sesión.' : m;
        err.classList.remove('hidden');
      } finally { btn.disabled = false; }
    };
  };
  pintar();
}

export function renderNuevaPassword(root) {
  root.innerHTML = `<div class="auth-main" style="min-height:100vh"><div class="auth-card card card-pad">
    <h2 style="margin-bottom:14px">Nueva contraseña</h2>
    <form class="form-grid" data-form>
      <label class="field">Contraseña nueva<input class="input" type="password" name="p" minlength="8" required autocomplete="new-password"></label>
      <button class="btn btn-primary">Guardar</button>
    </form></div></div>`;
  root.querySelector('[data-form]').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: e.target.p.value });
    if (error) return toast(mensajeError(error), 'err');
    toast('Contraseña actualizada', 'ok');
    location.hash = '';
    location.reload();
  };
}

export { esc };
