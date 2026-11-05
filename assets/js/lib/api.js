// Acceso a datos reutilizable por las vistas.
import { sb, ok } from './supabase.js';
import { store } from './store.js';
import { extraerTexto } from './extraer.js';

const SEL_PREGUNTA = 'id,enunciado,explicacion,fuente,aviso,dificultad,tema_id,favorita,estado,origen,opciones(id,texto,es_correcta,explicacion,orden)';

/** Carga preguntas con sus opciones manteniendo el orden de los IDs. */
export async function cargarPreguntas(ids) {
  const mapa = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const lote = ids.slice(i, i + 80);
    const filas = ok(await sb.from('preguntas').select(SEL_PREGUNTA).in('id', lote));
    filas.forEach((p) => { p.opciones.sort((a, b) => a.orden - b.orden); mapa.set(p.id, p); });
  }
  return ids.map((id) => mapa.get(id)).filter(Boolean);
}

export async function cargarPregunta(id) {
  const p = ok(await sb.from('preguntas').select(SEL_PREGUNTA + ',created_at,updated_at,documento_id,trabajo_id,version').eq('id', id).single());
  p.opciones.sort((a, b) => a.orden - b.orden);
  return p;
}

export async function guardarPregunta(p) {
  return ok(await sb.rpc('guardar_pregunta', { p }));
}

export async function crearSesion(tipo, config, preguntaIds) {
  return ok(await sb.from('sesiones').insert({
    oposicion_id: store.oposicion.id, tipo, config, pregunta_ids: preguntaIds,
  }).select().single());
}

export async function finalizarSesion(id, duracionSeg) {
  return ok(await sb.from('sesiones').update({
    estado: 'finalizada', finalizada_at: new Date().toISOString(), duracion_seg: Math.round(duracionSeg),
  }).eq('id', id));
}

export async function abandonarSesion(id) {
  await sb.from('sesiones').update({ estado: 'abandonada', finalizada_at: new Date().toISOString() }).eq('id', id);
}

export async function registrarIntentos(lista) {
  if (!lista.length) return;
  const filas = lista.map((x) => ({
    oposicion_id: store.oposicion.id,
    pregunta_id: x.pregunta_id, tema_id: x.tema_id || null, sesion_id: x.sesion_id || null,
    opcion_id: x.opcion_id || null, en_blanco: !!x.en_blanco, correcta: !!x.correcta,
    tiempo_ms: x.tiempo_ms != null ? Math.round(x.tiempo_ms) : null, dificultad: x.dificultad || null,
    ...(x.respondida_at ? { respondida_at: x.respondida_at } : {}),
    ...(x.importado ? { importado: true } : {}),
  }));
  for (let i = 0; i < filas.length; i += 200) ok(await sb.from('intentos').insert(filas.slice(i, i + 200)));
}

/** Guarda la duración de una sesión de estudio (lectura de material). */
export async function registrarEstudio(temaId, segundos) {
  if (!store.oposicion || segundos < 20) return;
  const inicio = new Date(Date.now() - segundos * 1000).toISOString();
  await sb.from('sesiones').insert({
    oposicion_id: store.oposicion.id, tipo: 'estudio', config: { tema_id: temaId }, estado: 'finalizada',
    iniciada_at: inicio, finalizada_at: new Date().toISOString(), duracion_seg: Math.round(segundos),
  });
}

export async function marcarFavorita(id, valor) {
  ok(await sb.from('preguntas').update({ favorita: valor }).eq('id', id));
}

export async function reportar(preguntaId, motivo, comentario) {
  ok(await sb.from('reportes').insert({ pregunta_id: preguntaId, motivo, comentario: comentario || null }));
}

export async function statsTemas() {
  if (!store.oposicion) return [];
  return ok(await sb.from('v_tema_stats').select('*').eq('oposicion_id', store.oposicion.id).eq('archivado', false).order('orden').order('numero'));
}

export async function resumen() {
  return ok(await sb.rpc('resumen_oposicion', { p_oposicion: store.oposicion.id }));
}

export async function historialPregunta(id) {
  return ok(await sb.from('intentos').select('id,correcta,en_blanco,opcion_id,tiempo_ms,respondida_at,importado,sesion_id')
    .eq('pregunta_id', id).order('respondida_at', { ascending: false }).limit(200));
}

/** Descarga todas las filas de una consulta paginando de 1000 en 1000. */
export async function todas(consulta, max = 50000) {
  const res = [];
  for (let desde = 0; desde < max; desde += 1000) {
    const filas = ok(await consulta().range(desde, desde + 999));
    res.push(...filas);
    if (filas.length < 1000) break;
  }
  return res;
}

// ---------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------
export const EXTENSIONES = '.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.rtf,.odt';

function nombreSeguro(n) {
  return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-120);
}

/**
 * Sube un documento: extrae el texto en el navegador, guarda el original en Storage
 * y crea la fila en "documentos". Si `sustituye` se indica, el antiguo queda inactivo.
 */
export async function subirDocumento(file, { temaId = null, tipo = 'temario', sustituye = null, onEstado } = {}) {
  onEstado?.('Leyendo el documento…');
  let texto = '';
  let avisoLectura = null;
  try {
    texto = await extraerTexto(file, (p) => onEstado?.(p));
  } catch (e) {
    avisoLectura = e.message;
  }
  onEstado?.('Subiendo a la nube…');
  const path = `${store.user.id}/${store.oposicion.id}/${Date.now()}_${nombreSeguro(file.name)}`;
  const { error: eUp } = await sb.storage.from('documentos').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (eUp) throw eUp;
  const doc = ok(await sb.from('documentos').insert({
    oposicion_id: store.oposicion.id, tema_id: temaId, tipo, nombre: file.name, storage_path: path,
    mime: file.type || null, tamano_bytes: file.size, texto: texto || null, sustituye_a: sustituye,
  }).select('id,nombre,num_caracteres,tipo,tema_id,created_at,storage_path,mime,tamano_bytes,activo').single());
  if (sustituye) await sb.from('documentos').update({ activo: false }).eq('id', sustituye);
  doc.avisoLectura = avisoLectura;
  return doc;
}

export async function eliminarDocumento(doc) {
  if (doc.storage_path) await sb.storage.from('documentos').remove([doc.storage_path]);
  ok(await sb.from('documentos').delete().eq('id', doc.id));
}

export async function urlDocumento(path) {
  const { data, error } = await sb.storage.from('documentos').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
