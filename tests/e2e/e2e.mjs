// Prueba de extremo a extremo de Opositor IA contra el entorno local.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:8080/';
const SHOTS = '/home/claude/e2e/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const CDN = {
  'supabase-js': 'supabase.mjs', 'chart.js': 'chart.mjs', 'jszip': 'jszip.mjs',
  'pdf.worker.min.mjs': 'pdf.worker.min.mjs', 'pdf.min.mjs': 'pdf.min.mjs', 'mammoth.browser.min.js': 'mammoth.browser.min.js',
};
const errores = [];
const pasos = [];
let n = 0;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
await ctx.route('https://cdn.jsdelivr.net/**', (route) => {
  const url = route.request().url();
  const k = Object.keys(CDN).find((x) => url.includes(x));
  if (!k) return route.abort();
  route.fulfill({ path: `/home/claude/e2e/cdn/${CDN[k]}`, contentType: 'text/javascript' });
});
const page = await ctx.newPage();
page.setDefaultTimeout(12000);
page.on('pageerror', (e) => errores.push(`[pageerror] ${pasos.length} ${e.stack}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 40[0-4]/.test(m.text())) errores.push(`[console] ${m.text()}`); });
page.on('dialog', (d) => d.dismiss());

async function paso(nombre, fn) {
  const t0 = Date.now();
  const antes = errores.length;
  try {
    await fn();
    pasos.push(`✔ ${nombre} (${Date.now() - t0} ms)${errores.length > antes ? ' — con errores de consola' : ''}`);
  } catch (e) {
    pasos.push(`✘ ${nombre}: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${SHOTS}/FALLO-${++n}-${nombre.replace(/\W+/g, '_')}.png`, fullPage: true });
    if (/registro|Onboarding|banco anterior/.test(nombre)) { console.log(pasos.join('\n')); console.log(errores.join('\n')); process.exit(1); }
  }
}
const shot = (nombre, full = true) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${nombre}.png`, fullPage: full });
const ir = async (hash) => { await page.goto(BASE + hash); await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); };
const esperarTexto = (t, timeout = 15000) => page.getByText(t, { exact: false }).first().waitFor({ timeout });

await paso('Carga y registro', async () => {
  await page.goto(BASE);
  await page.getByText('Regístrate').click();
  await page.fill('input[name=nombre]', 'Ander Prueba');
  await page.fill('input[name=email]', 'ander@test.com');
  await page.fill('input[name=password]', 'contraseña123');
  await shot('registro');
  await page.click('button[type=submit]');
  await esperarTexto('¿Qué oposición estás preparando?');
  await shot('onboarding');
});

await paso('Onboarding con temas', async () => {
  await page.fill('input[name=nombre]', 'Cuerpo de Ingenieros Industriales del Estado');
  await page.fill('textarea[name=temas]', '1. Organización del Estado\n2. Derecho Administrativo\n3. Economía');
  await page.click('button:has-text("Empezar")');
  await esperarTexto('Mi temario');
  await page.waitForSelector('table.table');
  await shot('temario-inicial');
});

await paso('Importar banco anterior (435 preguntas)', async () => {
  await ir('#/configuracion');
  await page.click('[data-legado]');
  await page.waitForEvent('load', { timeout: 120000 });
  await page.waitForLoadState('networkidle');
  await ir('#/configuracion');
  await esperarTexto('Banco anterior importado (435)');
});

await paso('Dashboard', async () => {
  await ir('#/');
  await esperarTexto('Para repasar hoy');
  await esperarTexto('435');
  await shot('dashboard-vacio');
});

await paso('Práctica por temas (feedback inmediato)', async () => {
  await ir('#/estudiar');
  await page.click('[data-v="10"]');
  await page.click('[data-empezar]');
  await page.waitForSelector('.q-text');
  for (let i = 0; i < 10; i++) {
    const ops = page.locator('[data-op]');
    await ops.nth(i % 3 === 0 ? 1 : 0).click();
    await page.waitForSelector('.explain');
    if (i === 0) await shot('practica-feedback');
    await page.click('[data-sig]');
  }
  await esperarTexto('Revisión');
  await shot('practica-resultado');
});

await paso('Repetir falladas desde resultados', async () => {
  const b = page.locator('[data-repetir]');
  if (await b.count()) {
    await b.click();
    await page.waitForSelector('.q-text');
    await page.click('[data-blanco]');
    await page.click('[data-salir]');
    await page.click('[data-si]');
    await esperarTexto('Revisión');
  }
});

await paso('Simulacro con penalización, blancos y marcas', async () => {
  await ir('#/simulacros');
  await page.click('[data-n="20"]');
  await page.selectOption('[data-pen]', String(1 / 3));
  await page.click('[data-empezar]');
  await page.waitForSelector('.qgrid');
  for (let i = 0; i < 20; i++) {
    if (i % 5 !== 4) await page.locator('[data-op]').nth(i % 4).click();
    if (i === 2) await page.click('[data-marcar]');
    if (i === 3) await shot('simulacro-en-curso', false);
    if (i < 19) await page.click('[data-next]');
  }
  await page.click('[data-entregar]');
  await page.click('[data-si]');
  await esperarTexto('sobre 10');
  await shot('simulacro-resultado');
});

await paso('Simulacro guardado y reanudado', async () => {
  await ir('#/simulacros');
  await page.click('[data-n="10"]');
  await page.click('[data-empezar]');
  await page.waitForSelector('.qgrid');
  await page.locator('[data-op]').first().click();
  await page.click('[data-pausa]');
  await esperarTexto('Simulacro sin terminar');
  await page.click('[data-continuar]');
  await page.waitForSelector('.qgrid button.ans');
  await page.click('[data-entregar]');
  await page.click('[data-si]');
  await esperarTexto('sobre 10');
});

await paso('Historial de simulacros y detalle', async () => {
  await ir('#/simulacros');
  await page.waitForSelector('[data-ver]');
  await page.waitForTimeout(700);
  await shot('simulacros-historial');
  await page.locator('[data-ver]').first().click();
  await esperarTexto('Revisión');
});

await paso('Repaso inteligente', async () => {
  await ir('#/repaso');
  await esperarTexto('Sesión de repaso');
  await shot('repaso');
  await page.click('[data-n="10"]');
  await page.click('[data-empezar]');
  await page.waitForSelector('.q-text');
  for (let i = 0; i < 4; i++) { await page.locator('[data-op]').first().click(); await page.click('[data-sig]'); }
  await page.click('[data-salir]'); await page.click('[data-si]');
  await esperarTexto('Revisión');
});

await paso('Mi progreso con gráficos', async () => {
  await ir('#/progreso');
  await page.waitForSelector('canvas[data-evo]');
  await page.waitForTimeout(1200);
  const canvases = await page.locator('canvas').count();
  if (canvases < 5) throw new Error(`Solo ${canvases} gráficos`);
  await shot('progreso');
  await page.selectOption('[data-lista]', 'varias_veces');
  await page.waitForTimeout(500);
  const fila = page.locator('[data-preguntas] [data-p]').first();
  if (await fila.count()) { await fila.click(); await esperarTexto('Historial'); await shot('pregunta-historial', false); await page.keyboard.press('Escape'); }
});

await paso('Banco: búsqueda, filtros, detalle y edición sin perder historial', async () => {
  await ir('#/banco');
  await page.waitForSelector('[data-abrir]');
  await page.fill('[data-q]', 'Tribunal Constitucional');
  await page.waitForTimeout(900);
  const total = await page.textContent('[data-total]');
  if (!/\d+ pregunta/.test(total) || total.startsWith('0')) throw new Error('Búsqueda sin resultados: ' + total);
  await shot('banco-busqueda');
  await page.fill('[data-q]', '');
  await page.selectOption('[data-f="dominio"]', 'dificil');
  await page.waitForTimeout(700);
  await page.selectOption('[data-f="dominio"]', '');
  await page.selectOption('[data-f="orden"]', 'falladas');
  await page.waitForTimeout(700);
  await page.locator('[data-abrir]').first().click();
  await esperarTexto('Historial');
  const veces = await page.locator('.modal .stat .value').first().textContent();
  await page.click('[data-editar]');
  await page.fill('[data-enun]', 'Enunciado corregido por el usuario');
  await page.click('.modal [data-ok]');
  await esperarTexto('Pregunta guardada');
  await page.waitForTimeout(800);
  await page.fill('[data-q]', 'corregido por el usuario');
  await page.waitForTimeout(900);
  await page.locator('[data-abrir]').first().click();
  await esperarTexto('Historial');
  const veces2 = await page.locator('.modal .stat .value').first().textContent();
  if (veces !== veces2) throw new Error(`Historial cambió: ${veces} → ${veces2}`);
  await shot('banco-detalle', false);
  await page.click('.modal [data-fav]');
  await page.waitForTimeout(500);
});

await paso('Banco: nueva pregunta manual y acciones en lote', async () => {
  await ir('#/banco');
  await page.click('[data-nueva]');
  await page.fill('[data-enun]', '¿Pregunta manual de prueba?');
  await page.fill('[data-t="0"]', 'Correcta'); await page.fill('[data-t="1"]', 'Mala 1'); await page.fill('[data-t="2"]', 'Mala 2'); await page.fill('[data-t="3"]', 'Mala 3');
  await page.check('[data-c="0"]');
  await page.click('.modal [data-ok]');
  await esperarTexto('Pregunta guardada');
  await page.waitForTimeout(600);
  await page.locator('[data-sel]').nth(0).check();
  await page.locator('[data-sel]').nth(1).check();
  await page.waitForSelector('.sel-bar');
  await shot('banco-lote', false);
  await page.click('[data-b="dif"]');
  await page.selectOption('.modal [data-v]', '3');
  await page.click('.modal [data-ok]');
  await esperarTexto('Cambios aplicados');
});

await paso('Temario: subir TXT, PDF y DOCX', async () => {
  await ir('#/temario');
  await page.locator('tr[data-ir]').filter({ hasText: 'Derecho Administrativo' }).click();
  await page.waitForSelector('[data-drop]');
  await page.setInputFiles('[data-file]', ['/home/claude/e2e/fixtures/tema-derecho.txt', '/home/claude/e2e/fixtures/tema-pdf.pdf', '/home/claude/e2e/fixtures/tema.docx']);
  await esperarTexto('Documentos subidos', 30000);
  await page.waitForTimeout(800);
  const docs = await page.locator('[data-docs] .list-item').count();
  if (docs !== 3) throw new Error(`Esperados 3 documentos, hay ${docs}`);
  const txt = await page.textContent('[data-docs]');
  if (!/caracteres/.test(txt)) throw new Error('No se extrajo texto');
  await shot('tema-documentos');
});

await paso('IA: procesar tema (asíncrono, por fragmentos)', async () => {
  await page.click('[data-procesar]');
  await esperarTexto('Procesamiento iniciado');
  await page.waitForSelector('[data-jobs] .job');
  await shot('tema-procesando');
  await page.waitForSelector('[data-jobs] a:has-text("Revisar preguntas")', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot('tema-procesado');
});

await paso('Revisión de preguntas generadas', async () => {
  await page.click('[data-jobs] a:has-text("Revisar preguntas")');
  await page.waitForSelector('[data-p]');
  await shot('revision');
  await page.locator('[data-p] [data-descartar]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-p] [data-editar]').first().click();
  await page.fill('[data-enun]', 'Pregunta revisada y corregida');
  await page.click('.modal [data-ok]');
  await esperarTexto('Pregunta guardada');
  await page.click('[data-aceptar-todas]');
  await esperarTexto('añadidas al banco');
  await esperarTexto('No hay nada pendiente');
});

await paso('Estudiar tema: esquema, resumen, conceptos y edición de versión', async () => {
  await ir('#/estudiar');
  await page.locator('a.card').filter({ hasText: 'Derecho Administrativo' }).click();
  await page.waitForSelector('.md.esquema');
  await shot('estudiar-esquema');
  await page.click('[data-tab="resumen"]');
  await page.waitForSelector('.md');
  await page.click('[data-editar]');
  await page.fill('.modal textarea', '## Mi resumen editado\n- Punto **importante**');
  await page.click('.modal [data-ok]');
  await esperarTexto('Mi resumen editado');
  await page.click('[data-tab="conceptos"]');
  await esperarTexto('Ley 40/2015');
  await page.click('[data-modo="tarjetas"]');
  await page.click('[data-flip]');
  await shot('estudiar-tarjetas', false);
  await page.click('[data-tab="preguntas"]');
  await page.waitForSelector('details');
});

await paso('Importar preguntas: formato estándar sin IA', async () => {
  await ir('#/banco/importar');
  await page.fill('[data-texto]', 'Pregunta 1: ¿Cuál es la capital de España?\n\nA) Barcelona\nB) Madrid\nC) Sevilla\nD) Valencia\n\nRespuesta correcta: B.\n\nPregunta 2: ¿Cuántos artículos tiene la CE?\nA) 169\nB) 170\nC) 150\nD) 200\nRespuesta correcta: A\n\n3. ¿Sin respuesta?\na) x\nb) y\n');
  await page.selectOption('[data-tema]', { label: '3. Economía' }).catch(async () => { await page.selectOption('[data-tema]', { index: 3 }); });
  await page.click('[data-analizar]');
  await esperarTexto('Detectadas 3 preguntas');
  await shot('importar-local', false);
  await page.click('[data-local]');
  await page.waitForSelector('[data-p]');
  const desactivados = await page.locator('[data-aceptar][disabled]').count();
  if (desactivados !== 1) throw new Error('La pregunta sin respuesta debería no poder aceptarse');
  await page.click('[data-aceptar-todas]');
  await esperarTexto('necesitan que marques');
});

await paso('Importar preguntas con IA', async () => {
  await ir('#/banco/importar');
  await page.fill('[data-texto]', 'Texto raro con preguntas sin formato reconocible ...');
  await page.click('[data-analizar]');
  await page.click('[data-usar-ia]');
  await page.waitForSelector('[data-progreso] a:has-text("Revisar")', { timeout: 60000 });
  await page.click('[data-progreso] a:has-text("Revisar")');
  await esperarTexto('Importada sin respuesta');
  await esperarTexto('no tienen tema asignado');
  await shot('revision-importadas');
});

await paso('Mi oposición', async () => {
  await ir('#/oposicion');
  await esperarTexto('Mis oposiciones');
  await page.fill('input[name=fecha_examen]', '2027-06-15');
  await page.click('[data-form] button');
  await esperarTexto('Guardado');
  await shot('oposicion', false);
});

await paso('Segunda oposición y cambio de oposición activa', async () => {
  await ir('#/oposicion?nueva=1');
  await page.fill('.modal [data-n]', 'OPE Osakidetza');
  await page.click('.modal [data-ok]');
  await esperarTexto('Oposición creada');
  await ir('#/banco');
  await esperarTexto('No hay preguntas');
  await page.selectOption('[data-opos]', { label: 'Cuerpo de Ingenieros Industriales del Estado' });
  await page.waitForTimeout(1200);
});

await paso('Dashboard con datos', async () => {
  await ir('#/');
  await page.waitForTimeout(1200);
  await shot('dashboard');
});

await paso('Responsive móvil y modo oscuro', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ir('#/');
  await page.waitForTimeout(800);
  await shot('movil-dashboard');
  await page.click('[data-menu]');
  await page.waitForTimeout(300);
  await shot('movil-menu', false);
  await page.mouse.click(375, 400);
  await ir('#/simulacros');
  await page.click('[data-n="10"]');
  await page.click('[data-empezar]');
  await page.waitForSelector('.qgrid');
  await shot('movil-simulacro', false);
  await page.click('[data-pausa]');
  await page.setViewportSize({ width: 1360, height: 900 });
  await ir('#/configuracion');
  await page.click('[data-t="dark"]');
  await ir('#/progreso');
  await page.waitForTimeout(1500);
  await shot('oscuro-progreso');
  await page.click('[data-t="light"]').catch(() => {});
});

await paso('Archivar tema conserva historial y lo excluye', async () => {
  await ir('#/temario');
  await page.locator('tr[data-ir]').filter({ hasText: 'Organización del Estado' }).click();
  await page.click('[data-archivar]');
  await page.click('[data-si]');
  await esperarTexto('Temas archivados');
  await page.click('summary');
  await page.click('[data-restaurar]');
  await esperarTexto('Tema restaurado');
});

await paso('Cerrar sesión y volver a entrar', async () => {
  await ir('#/configuracion');
  await page.click('.content [data-logout]');
  await esperarTexto('Inicia sesión');
  await page.fill('input[name=email]', 'ander@test.com');
  await page.fill('input[name=password]', 'contraseña123');
  await page.click('button[type=submit]');
  await page.waitForSelector('[data-nav]');
  await esperarTexto('Preferencias de estudio');
});

await paso('Aislamiento: otra usuaria no ve nada', async () => {
  await ir('#/configuracion');
  await page.click('.content [data-logout]');
  await page.getByText('Regístrate').click();
  await page.fill('input[name=nombre]', 'Prima');
  await page.fill('input[name=email]', 'prima@test.com');
  await page.fill('input[name=password]', 'contraseña456');
  await page.click('button[type=submit]');
  await esperarTexto('¿Qué oposición estás preparando?');
  const opciones = await page.evaluate(async () => {
    const { sb } = await import('/assets/js/lib/supabase.js');
    const t = await Promise.all(['oposiciones', 'temas', 'preguntas', 'intentos', 'documentos', 'materiales'].map((x) => sb.from(x).select('id', { count: 'exact', head: true })));
    return t.map((r) => r.count);
  });
  if (opciones.some((c) => c !== 0)) throw new Error('La segunda usuaria ve datos: ' + opciones.join(','));
});

await browser.close();
console.log(pasos.join('\n'));
console.log(`\nErrores de consola/página: ${errores.length}`);
console.log([...new Set(errores)].slice(0, 30).join('\n'));
