// =====================================================================
// Edge Function "ia" · Procesamiento asíncrono de documentos con IA
//
// Acciones (POST JSON):
//   { accion: "iniciar", tipo: "procesar_tema", tema_id, documento_id?, opciones? }
//   { accion: "iniciar", tipo: "importar_preguntas", documento_id, tema_id? }
//   { accion: "continuar", trabajo_id }   -> ejecuta el siguiente paso pendiente
//   { accion: "reintentar", trabajo_id }  -> reanuda un trabajo con error desde el paso fallido
//   { accion: "cancelar", trabajo_id }
//
// Cada paso es UNA llamada a la IA (un fragmento del documento) para no superar
// los límites de tiempo de las Edge Functions. El estado vive en la tabla "trabajos":
// si la función se corta, el navegador o la propia función lo reanudan.
// =====================================================================
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ErrorIA, llamarClaude } from "../_shared/claude.ts";
import {
  DIFICULTAD, herramientaEsquema, herramientaFragmento, herramientaImportar, herramientaResumen,
  promptFragmento, promptImportar, promptSintesis, SISTEMA_FRAGMENTO, SISTEMA_IMPORTAR, SISTEMA_SINTESIS,
} from "../_shared/prompts.ts";
import { claveEnunciado, dividirEnFragmentos, extraerPlantillaRespuestas, preguntasParaFragmento } from "../_shared/texto.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BLOQUEO_SEG = 170;
const PDF_MAX_BYTES = 25 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const auth = req.headers.get("authorization") || "";
  const interno = auth === `Bearer ${SERVICE_KEY}`;

  try {
    // Llamada interna (autoencadenado de pasos)
    if (interno) {
      if (body.accion === "continuar" && body.trabajo_id) {
        EdgeRuntime.waitUntil(ejecutarPaso(body.trabajo_id));
        return json({ ok: true });
      }
      return json({ error: "Acción interna no válida" }, 400);
    }

    // Llamada de usuario: se valida el JWT y se usa un cliente con sus permisos (RLS)
    const usuario = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    });
    const { data: u, error: eu } = await usuario.auth.getUser();
    if (eu || !u?.user) return json({ error: "No autenticado" }, 401);
    const uid = u.user.id;

    switch (body.accion) {
      case "iniciar": {
        const trabajo = await crearTrabajo(usuario, uid, body);
        EdgeRuntime.waitUntil(ejecutarPaso(trabajo.id));
        return json({ trabajo });
      }
      case "continuar":
      case "reintentar":
      case "cancelar": {
        const { data: t } = await usuario.from("trabajos").select("id,estado").eq("id", body.trabajo_id).maybeSingle();
        if (!t) return json({ error: "Trabajo no encontrado" }, 404);
        if (body.accion === "cancelar") {
          await admin.from("trabajos").update({ estado: "cancelado", bloqueado_hasta: null, finished_at: new Date().toISOString() }).eq("id", t.id);
          return json({ ok: true });
        }
        if (body.accion === "reintentar") {
          if (!["error", "cancelado"].includes(t.estado)) return json({ ok: true, mensaje: "El trabajo no tiene errores" });
          await admin.from("trabajos").update({ estado: "pendiente", error: null, bloqueado_hasta: null, finished_at: null }).eq("id", t.id);
        }
        EdgeRuntime.waitUntil(ejecutarPaso(t.id));
        return json({ ok: true });
      }
      default:
        return json({ error: "Acción desconocida" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

// ---------------------------------------------------------------------
// Creación del trabajo y plan de pasos
// ---------------------------------------------------------------------
async function crearTrabajo(usuario: SupabaseClient, uid: string, body: Record<string, any>) {
  const tipo = body.tipo;
  if (!["procesar_tema", "importar_preguntas"].includes(tipo)) throw new Error("Tipo de trabajo no válido");

  let oposicionId: string;
  let temaId: string | null = body.tema_id || null;
  let fragmentos: Array<{ texto?: string; pdf?: string; doc?: string }> = [];
  let plantilla: string | null = null;
  const opciones = {
    generar: Array.isArray(body.opciones?.generar) && body.opciones.generar.length
      ? body.opciones.generar.filter((g: string) => ["esquema", "resumen", "conceptos", "preguntas"].includes(g))
      : ["esquema", "resumen", "conceptos", "preguntas"],
    densidad: Math.min(2, Math.max(0.5, Number(body.opciones?.densidad) || 1)),
  };

  if (tipo === "procesar_tema") {
    if (!temaId) throw new Error("Falta tema_id");
    const { data: tema } = await usuario.from("temas").select("id,oposicion_id,titulo").eq("id", temaId).maybeSingle();
    if (!tema) throw new Error("Tema no encontrado");
    oposicionId = tema.oposicion_id;
    let q = usuario.from("documentos").select("id,nombre,texto,storage_path,mime,tamano_bytes")
      .eq("tema_id", temaId).eq("activo", true).eq("tipo", "temario").order("created_at");
    if (body.documento_id) q = q.eq("id", body.documento_id);
    const { data: docs } = await q;
    if (!docs?.length) throw new Error("El tema no tiene documentos de temario activos");
    for (const d of docs) {
      const texto = (d.texto || "").trim();
      if (texto.length >= 300) {
        const partes = dividirEnFragmentos(texto);
        partes.forEach((p, i) => fragmentos.push({
          texto: docs.length > 1 ? `[Documento: ${d.nombre}${partes.length > 1 ? ` · parte ${i + 1}/${partes.length}` : ""}]\n\n${p}` : p,
          doc: d.id,
        }));
      } else if (d.storage_path && (d.mime === "application/pdf" || d.storage_path.toLowerCase().endsWith(".pdf"))) {
        if ((d.tamano_bytes || 0) > PDF_MAX_BYTES) throw new Error(`"${d.nombre}" no tiene texto seleccionable y supera 25 MB para leerlo como imagen.`);
        fragmentos.push({ pdf: d.storage_path, doc: d.id });
      } else {
        throw new Error(`No se pudo leer texto de "${d.nombre}". Prueba a subirlo en PDF, DOCX o TXT.`);
      }
    }
  } else {
    if (!body.documento_id) throw new Error("Falta documento_id");
    const { data: d } = await usuario.from("documentos").select("id,oposicion_id,tema_id,texto,storage_path,mime,nombre,tamano_bytes")
      .eq("id", body.documento_id).maybeSingle();
    if (!d) throw new Error("Documento no encontrado");
    oposicionId = d.oposicion_id;
    temaId = temaId || d.tema_id;
    const texto = (d.texto || "").trim();
    if (texto.length >= 20) {
      fragmentos = dividirEnFragmentos(texto, 9000, 11000).map((t) => ({ texto: t, doc: d.id }));
      plantilla = extraerPlantillaRespuestas(texto);
    } else if (d.storage_path && (d.mime === "application/pdf" || d.storage_path.toLowerCase().endsWith(".pdf"))) {
      if ((d.tamano_bytes || 0) > PDF_MAX_BYTES) throw new Error("PDF escaneado demasiado grande (máx. 25 MB).");
      fragmentos = [{ pdf: d.storage_path, doc: d.id }];
    } else {
      throw new Error(`No se pudo leer texto de "${d.nombre}".`);
    }
  }

  const sintesis = tipo === "procesar_tema"
    ? ["esquema", "resumen"].filter((g) => opciones.generar.includes(g))
    : [];
  const total = fragmentos.length + sintesis.length;

  const { data: trabajo, error } = await admin.from("trabajos").insert({
    user_id: uid, oposicion_id: oposicionId, tema_id: temaId, documento_id: body.documento_id || null,
    tipo, estado: "pendiente", paso: 0, total_pasos: total, opciones,
    mensaje: `En cola · ${fragmentos.length} fragmento(s)`,
    estado_interno: { fragmentos, sintesis, plantilla, notas: [], conceptos: [], avisos: [], resto: "" },
    resultado: { preguntas: 0 },
  }).select("id,estado,paso,total_pasos,mensaje,tipo,tema_id,created_at").single();
  if (error) throw new Error(error.message);
  return trabajo;
}

// ---------------------------------------------------------------------
// Ejecución de un paso (con bloqueo para que no se ejecute dos veces)
// ---------------------------------------------------------------------
async function ejecutarPaso(trabajoId: string) {
  const { data: filas, error: eClaim } = await admin.rpc("reclamar_trabajo", { p_id: trabajoId, p_segundos: BLOQUEO_SEG });
  if (eClaim) { console.error("No se pudo reservar el trabajo", eClaim.message); return; }
  const reclamado = filas?.[0];
  if (!reclamado) return; // otro proceso lo tiene, o ya terminó

  const t = reclamado;
  const ei = t.estado_interno || {};
  console.log(`[trabajo ${t.id}] paso ${t.paso + 1}/${t.total_pasos} (${t.tipo})`);
  const nFrag = (ei.fragmentos || []).length;

  try {
    let mensaje = "";
    if (t.paso < nFrag) {
      mensaje = t.tipo === "procesar_tema" ? await pasoFragmentoTema(t, t.paso) : await pasoImportar(t, t.paso);
    } else {
      const que = ei.sintesis[t.paso - nFrag];
      mensaje = await pasoSintesis(t, que);
    }

    const siguiente = t.paso + 1;
    const fin = siguiente >= t.total_pasos;
    if (fin) await finalizar(t);
    const { data: actual } = await admin.from("trabajos").select("estado,estado_interno,resultado").eq("id", t.id).single();
    if (actual?.estado === "cancelado") return;
    await admin.from("trabajos").update({
      paso: siguiente,
      estado: fin ? "completado" : "procesando",
      mensaje: fin ? resumenFinal(t.tipo, actual?.resultado) : mensaje,
      bloqueado_hasta: null,
      finished_at: fin ? new Date().toISOString() : null,
      ...(fin ? { estado_interno: { avisos: actual?.estado_interno?.avisos || [] } } : {}),
    }).eq("id", t.id);

    if (!fin) encadenar(t.id);
  } catch (e) {
    console.error("Error en trabajo", trabajoId, e);
    const msg = e instanceof ErrorIA || e instanceof Error ? e.message : String(e);
    await admin.from("trabajos").update({
      estado: "error", error: msg, reintentos: (t.reintentos || 0) + 1, bloqueado_hasta: null,
      mensaje: `Error en el paso ${t.paso + 1} de ${t.total_pasos}`,
    }).eq("id", t.id);
  }
}

function encadenar(id: string) {
  // Lanza el siguiente paso en una invocación nueva (con su propio límite de tiempo).
  EdgeRuntime.waitUntil(
    fetch(`${SUPABASE_URL}/functions/v1/ia`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ accion: "continuar", trabajo_id: id }),
    }).catch((e) => console.warn("No se pudo encadenar; el navegador lo reanudará.", e)),
  );
}

function resumenFinal(tipo: string, r: any) {
  const n = r?.preguntas || 0;
  return tipo === "procesar_tema"
    ? `Completado · ${n} preguntas pendientes de revisión`
    : `Completado · ${n} preguntas importadas para revisar`;
}

async function actualizarInterno(id: string, cambios: (ei: any, res: any) => void) {
  const { data } = await admin.from("trabajos").select("estado_interno,resultado").eq("id", id).single();
  const ei = data?.estado_interno || {};
  const res = data?.resultado || {};
  cambios(ei, res);
  await admin.from("trabajos").update({ estado_interno: ei, resultado: res }).eq("id", id);
}

// ---------------------------------------------------------------------
// Pasos de "procesar_tema"
// ---------------------------------------------------------------------
async function pasoFragmentoTema(t: any, i: number): Promise<string> {
  const ei = t.estado_interno;
  const frag = ei.fragmentos[i];
  const { data: tema } = await admin.from("temas").select("numero,titulo").eq("id", t.tema_id).single();
  const nombreTema = `${tema?.numero ? `Tema ${tema.numero}. ` : ""}${tema?.titulo || ""}`;

  const { data: previas } = await admin.from("preguntas").select("enunciado")
    .eq("tema_id", t.tema_id).neq("estado", "archivada").order("created_at", { ascending: false }).limit(120);
  const existentes = (previas || []).map((p: any) => p.enunciado.slice(0, 110));

  const generar: string[] = t.opciones.generar;
  const numPreguntas = generar.includes("preguntas")
    ? preguntasParaFragmento(frag.texto ? frag.texto.length : 9000, t.opciones.densidad) : 0;
  const prompt = promptFragmento({
    tema: nombreTema, indice: i, total: ei.fragmentos.length,
    fragmento: frag.texto || "(el material es el PDF adjunto)", numPreguntas, existentes, generar,
  });
  const contenido: any[] = [];
  if (frag.pdf) contenido.push(await bloquePdf(frag.pdf));
  contenido.push({ type: "text", text: prompt });

  const r = await llamarClaude<any>({
    sistema: SISTEMA_FRAGMENTO, contenido, herramienta: herramientaFragmento(),
    maxTokens: frag.pdf ? 16000 : 9000,
  });

  const vistos = new Set(existentes.map(claveEnunciado));
  const nuevas = generar.includes("preguntas") ? await insertarPreguntas(t, r.preguntas || [], {
    origen: "ia", documentoId: frag.doc, temaId: t.tema_id, vistos,
  }) : 0;

  await actualizarInterno(t.id, (e, res) => {
    e.notas = e.notas || [];
    e.notas[i] = r.notas || "";
    e.conceptos = [...(e.conceptos || []), ...(r.conceptos || [])];
    e.avisos = [...(e.avisos || []), ...(r.avisos || [])];
    res.preguntas = (res.preguntas || 0) + nuevas;
  });
  return `Fragmento ${i + 1} de ${ei.fragmentos.length} procesado · ${nuevas} preguntas`;
}

async function pasoSintesis(t: any, que: "esquema" | "resumen"): Promise<string> {
  const { data } = await admin.from("trabajos").select("estado_interno").eq("id", t.id).single();
  const ei = data!.estado_interno;
  const { data: tema } = await admin.from("temas").select("numero,titulo").eq("id", t.tema_id).single();
  const nombreTema = `${tema?.numero ? `Tema ${tema.numero}. ` : ""}${tema?.titulo || ""}`;
  const notas: string[] = (ei.notas || []).filter((n: string) => n && n.trim());
  if (!notas.length) throw new Error("No hay notas de los fragmentos para sintetizar");

  let contenido: string;
  let avisos: string[] = [];
  if (que === "resumen" && notas.length === 1) {
    contenido = notas[0]; // un solo fragmento: sus notas ya son el resumen completo
  } else {
    const r = await llamarClaude<any>({
      sistema: SISTEMA_SINTESIS,
      contenido: [{ type: "text", text: promptSintesis(nombreTema, notas, que) }],
      herramienta: que === "esquema" ? herramientaEsquema() : herramientaResumen(),
      maxTokens: que === "esquema" ? 6000 : 12000,
    });
    contenido = r[que] || "";
    avisos = r.avisos || [];
  }
  await guardarMaterial(t, que, contenido, null, [...(ei.avisos || []), ...avisos]);
  return que === "esquema" ? "Esquema generado" : "Resumen generado";
}

async function finalizar(t: any) {
  if (t.tipo !== "procesar_tema") return;
  if (!t.opciones.generar.includes("conceptos")) return;
  const { data } = await admin.from("trabajos").select("estado_interno").eq("id", t.id).single();
  const ei = data!.estado_interno;
  const unicos = new Map<string, any>();
  for (const c of ei.conceptos || []) {
    const k = claveEnunciado(c.termino);
    if (!k) continue;
    if (!unicos.has(k) || (c.definicion || "").length > (unicos.get(k).definicion || "").length) unicos.set(k, c);
  }
  await guardarMaterial(t, "conceptos", null, [...unicos.values()], ei.avisos || []);
}

async function guardarMaterial(t: any, tipo: string, contenido: string | null, datos: unknown, avisos: string[]) {
  const { data: prev } = await admin.from("materiales").select("version")
    .eq("tema_id", t.tema_id).eq("tipo", tipo).order("version", { ascending: false }).limit(1);
  const version = (prev?.[0]?.version || 0) + 1;
  await admin.from("materiales").update({ activo: false }).eq("tema_id", t.tema_id).eq("tipo", tipo).eq("activo", true);
  const { error } = await admin.from("materiales").insert({
    user_id: t.user_id, tema_id: t.tema_id, tipo, contenido, datos, version, activo: true, trabajo_id: t.id,
    avisos: [...new Set(avisos)].filter(Boolean).join("\n") || null,
  });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------
// Paso de "importar_preguntas"
// ---------------------------------------------------------------------
async function pasoImportar(t: any, i: number): Promise<string> {
  const ei = t.estado_interno;
  const frag = ei.fragmentos[i];
  const { data: temas } = await admin.from("temas").select("id,numero,titulo")
    .eq("oposicion_id", t.oposicion_id).eq("archivado", false).order("orden");

  const texto = (ei.resto ? ei.resto + "\n\n" : "") + (frag.texto || "");
  const contenido: any[] = [];
  if (frag.pdf) contenido.push(await bloquePdf(frag.pdf));
  contenido.push({
    type: "text",
    text: promptImportar({
      fragmento: frag.pdf ? "(el documento es el PDF adjunto)" : texto, indice: i, total: ei.fragmentos.length,
      temas: temas || [], plantilla: ei.plantilla, temaFijo: t.tema_id,
    }),
  });
  const r = await llamarClaude<any>({
    sistema: SISTEMA_IMPORTAR, contenido, herramienta: herramientaImportar(), maxTokens: frag.pdf ? 20000 : 12000, temperatura: 0,
  });

  const idsValidos = new Set((temas || []).map((x: any) => x.id));
  const { data: previas } = await admin.from("preguntas").select("enunciado")
    .eq("oposicion_id", t.oposicion_id).neq("estado", "archivada").limit(5000);
  const vistos = new Set((previas || []).map((p: any) => claveEnunciado(p.enunciado)));

  const lista = (r.preguntas || []).map((p: any) => ({
    ...p, tema_id: t.tema_id || (idsValidos.has(p.tema_id) ? p.tema_id : null),
  }));
  const nuevas = await insertarPreguntas(t, lista, { origen: "importada", documentoId: frag.doc, temaId: null, vistos });

  await actualizarInterno(t.id, (e, res) => {
    e.resto = (r.resto_incompleto || "").slice(0, 4000);
    res.preguntas = (res.preguntas || 0) + nuevas;
    res.sin_tema = (res.sin_tema || 0) + lista.filter((p: any) => !p.tema_id).length;
  });
  return `Fragmento ${i + 1} de ${ei.fragmentos.length} · ${nuevas} preguntas detectadas`;
}

// ---------------------------------------------------------------------
// Guardado de preguntas como BORRADOR (el usuario las revisa antes de activarlas)
// ---------------------------------------------------------------------
async function insertarPreguntas(t: any, preguntas: any[], o: {
  origen: string; documentoId: string | null; temaId: string | null; vistos: Set<string>;
}): Promise<number> {
  let n = 0;
  for (const p of preguntas) {
    const enunciado = (p.enunciado || "").trim();
    const opciones = (p.opciones || []).filter((x: any) => (x.texto || "").trim());
    if (!enunciado || opciones.length < 2) continue;
    const clave = claveEnunciado(enunciado);
    if (o.vistos.has(clave)) continue;
    o.vistos.add(clave);

    const correctas = opciones.filter((x: any) => x.es_correcta).length;
    let aviso = (p.aviso || "").trim();
    if (correctas === 0) aviso = (aviso ? aviso + " · " : "") + "Falta marcar la respuesta correcta.";
    if (correctas > 1) {
      aviso = (aviso ? aviso + " · " : "") + "Había varias respuestas marcadas como correctas; revisa.";
      let primera = true;
      for (const x of opciones) { if (x.es_correcta) { x.es_correcta = primera; primera = false; } }
    }

    const { data: preg, error } = await admin.from("preguntas").insert({
      user_id: t.user_id, oposicion_id: t.oposicion_id, tema_id: p.tema_id ?? o.temaId,
      documento_id: o.documentoId, trabajo_id: t.id,
      enunciado, explicacion: (p.explicacion || "").trim() || null, fuente: (p.fuente || "").trim() || null,
      aviso: aviso || null, dificultad: DIFICULTAD[p.dificultad] || 2, origen: o.origen, estado: "borrador",
    }).select("id").single();
    if (error) { console.warn("No se pudo guardar una pregunta:", error.message); continue; }
    await admin.from("opciones").insert(opciones.map((x: any, idx: number) => ({
      user_id: t.user_id, pregunta_id: preg.id, orden: idx, texto: x.texto.trim(),
      es_correcta: !!x.es_correcta, explicacion: (x.explicacion || "").trim() || null,
    })));
    n++;
  }
  return n;
}

async function bloquePdf(path: string) {
  const { data, error } = await admin.storage.from("documentos").download(path);
  if (error || !data) throw new Error("No se pudo descargar el PDF del almacenamiento");
  const buf = new Uint8Array(await data.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: btoa(bin) } };
}
