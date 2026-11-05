import type { Herramienta } from "./claude.ts";

// ---------------------------------------------------------------------------
// Reglas comunes: fidelidad absoluta al material del usuario
// ---------------------------------------------------------------------------
const REGLAS_FIDELIDAD = `
REGLAS DE FIDELIDAD (obligatorias):
- Usa EXCLUSIVAMENTE el material proporcionado como fuente. No añadas leyes, artículos, fechas, cifras ni datos que no aparezcan en él.
- Si algo es ambiguo, incompleto, contradictorio o parece un error del documento, dilo explícitamente en el campo de avisos correspondiente.
- No completes lagunas con conocimiento propio. Prefiere omitir antes que inventar.
- Escribe en español de España, con terminología precisa de oposiciones.`;

// ---------------------------------------------------------------------------
// 1) Procesar un fragmento del temario
// ---------------------------------------------------------------------------
export const SISTEMA_FRAGMENTO = `Eres un preparador experto de oposiciones en España. Conviertes temarios en material de estudio y preguntas tipo test de calidad de examen oficial.
${REGLAS_FIDELIDAD}

CÓMO REDACTAR LAS PREGUNTAS:
- Reparte las preguntas por TODOS los apartados del fragmento, en proporción a su extensión e importancia (no te centres en el principio).
- 4 opciones por pregunta, una sola correcta. Distractores plausibles, del mismo tipo y longitud similar que la correcta.
- Varía la posición de la respuesta correcta. Evita "todas/ninguna de las anteriores" y las dobles negaciones.
- Dificultad: fácil (dato directo), intermedio (relacionar o distinguir conceptos parecidos), difícil (detalle fino, excepciones, plazos, mayorías, números de artículo). Reparto aproximado 30% / 45% / 25%.
- "explicacion": por qué la correcta lo es, citando lo que dice el texto.
- En cada opción incorrecta, "explicacion" breve de por qué no lo es cuando aporte valor (confusiones típicas).
- "fuente": apartado o epígrafe del texto donde está la respuesta (y página si aparece).
- No repitas preguntas ya existentes (se te da la lista).`;

export function herramientaFragmento(): Herramienta {
  return {
    name: "registrar_fragmento",
    description: "Registra el material de estudio y las preguntas generadas para este fragmento del tema.",
    input_schema: {
      type: "object",
      required: ["notas", "conceptos", "preguntas", "avisos"],
      properties: {
        notas: {
          type: "string",
          description: "Resumen fiel y estructurado de ESTE fragmento en markdown (títulos ##, ###, listas). Incluye todos los apartados que aparecen.",
        },
        conceptos: {
          type: "array",
          description: "Conceptos clave: definiciones, leyes, fechas, plazos, mayorías, fórmulas, órganos, nombres y cifras importantes.",
          items: {
            type: "object",
            required: ["termino", "definicion", "categoria"],
            properties: {
              termino: { type: "string" },
              definicion: { type: "string" },
              categoria: { type: "string", enum: ["definicion", "ley", "fecha", "plazo", "cifra", "formula", "organo", "persona", "otro"] },
            },
          },
        },
        preguntas: {
          type: "array",
          items: {
            type: "object",
            required: ["enunciado", "opciones", "explicacion", "dificultad", "fuente"],
            properties: {
              enunciado: { type: "string" },
              opciones: {
                type: "array", minItems: 3, maxItems: 5,
                items: {
                  type: "object", required: ["texto", "es_correcta"],
                  properties: {
                    texto: { type: "string" },
                    es_correcta: { type: "boolean" },
                    explicacion: { type: "string" },
                  },
                },
              },
              explicacion: { type: "string" },
              dificultad: { type: "string", enum: ["facil", "intermedio", "dificil"] },
              fuente: { type: "string" },
              aviso: { type: "string", description: "Solo si el texto es ambiguo o dudoso para esta pregunta." },
            },
          },
        },
        avisos: { type: "array", items: { type: "string" }, description: "Ambigüedades, lagunas o posibles errores del documento." },
      },
    },
  };
}

export function promptFragmento(p: {
  tema: string; indice: number; total: number; fragmento: string; numPreguntas: number;
  existentes: string[]; generar: string[];
}): string {
  const soloPreguntas = !p.generar.some((g) => g !== "preguntas");
  const sinPreguntas = !p.generar.includes("preguntas");
  return `TEMA: ${p.tema}
FRAGMENTO ${p.indice + 1} DE ${p.total}

${sinPreguntas ? "No generes preguntas (devuelve la lista vacía)." : `Genera exactamente ${p.numPreguntas} preguntas tipo test que cubran todo este fragmento.`}
${soloPreguntas ? "Las notas pueden ser muy breves (2-3 líneas) y los conceptos pueden ir vacíos." : "Redacta notas completas y extrae todos los conceptos clave."}

${p.existentes.length ? `PREGUNTAS QUE YA EXISTEN EN ESTE TEMA (no las repitas):\n${p.existentes.map((e) => "- " + e).join("\n")}\n` : ""}
<material>
${p.fragmento}
</material>`;
}

// ---------------------------------------------------------------------------
// 2) Síntesis final: esquema y resumen del tema completo
// ---------------------------------------------------------------------------
export const SISTEMA_SINTESIS = `Eres un preparador experto de oposiciones. Recibes las notas de todos los fragmentos de un tema (en orden) y produces el material definitivo.
${REGLAS_FIDELIDAD}
- Las notas ya son fieles al temario: no añadas nada que no esté en ellas.`;

export function herramientaEsquema(): Herramienta {
  return {
    name: "registrar_esquema",
    description: "Registra el esquema jerárquico del tema.",
    input_schema: {
      type: "object", required: ["esquema"],
      properties: {
        esquema: {
          type: "string",
          description: "Esquema jerárquico en markdown usando listas anidadas (- nivel 1, '  - ' nivel 2, '    - ' nivel 3). Apartados y subapartados con las ideas, datos y artículos clave en pocas palabras.",
        },
        avisos: { type: "array", items: { type: "string" } },
      },
    },
  };
}

export function herramientaResumen(): Herramienta {
  return {
    name: "registrar_resumen",
    description: "Registra el resumen completo del tema.",
    input_schema: {
      type: "object", required: ["resumen"],
      properties: {
        resumen: {
          type: "string",
          description: "Resumen claro y organizado de TODO el tema en markdown (## y ### por apartado, párrafos breves y listas). Destaca en **negrita** los conceptos fundamentales, plazos, mayorías y artículos.",
        },
        avisos: { type: "array", items: { type: "string" } },
      },
    },
  };
}

export function promptSintesis(tema: string, notas: string[], que: "esquema" | "resumen"): string {
  return `TEMA: ${tema}

A partir de las notas de los ${notas.length} fragmentos, elabora el ${que === "esquema" ? "ESQUEMA jerárquico" : "RESUMEN completo"} del tema entero, respetando el orden del temario y sin omitir apartados.

${notas.map((n, i) => `<notas fragmento="${i + 1}">\n${n}\n</notas>`).join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// 3) Importar preguntas ya existentes de un documento
// ---------------------------------------------------------------------------
export const SISTEMA_IMPORTAR = `Extraes preguntas tipo test de documentos de oposiciones y las conviertes en datos estructurados.
- Copia el enunciado y las opciones tal cual (solo corrige saltos de línea o guiones de corte).
- Identifica la respuesta correcta SOLO si el documento la indica (marca, "Respuesta: B", negrita, asterisco, plantilla de soluciones...). Si no se indica, deja todas las opciones con es_correcta=false y pon un aviso. NUNCA deduzcas la respuesta por tu cuenta.
- Si el documento incluye explicación o justificación, cópiala en "explicacion".
- Asigna "tema_id" solo si el documento lo indica claramente o el contenido encaja sin duda con uno de los temas listados; si no, deja null.
- Estima la dificultad (facil, intermedio, dificil) según el tipo de pregunta.
- Si la última pregunta del fragmento está cortada (faltan opciones), NO la incluyas: copia su texto literal en "resto_incompleto".`;

export function herramientaImportar(): Herramienta {
  return {
    name: "registrar_preguntas",
    description: "Registra las preguntas extraídas del fragmento.",
    input_schema: {
      type: "object", required: ["preguntas"],
      properties: {
        preguntas: {
          type: "array",
          items: {
            type: "object", required: ["enunciado", "opciones"],
            properties: {
              numero_original: { type: "string" },
              enunciado: { type: "string" },
              opciones: {
                type: "array", minItems: 2, maxItems: 6,
                items: { type: "object", required: ["texto", "es_correcta"],
                  properties: { texto: { type: "string" }, es_correcta: { type: "boolean" } } },
              },
              explicacion: { type: "string" },
              tema_id: { type: ["string", "null"] },
              dificultad: { type: "string", enum: ["facil", "intermedio", "dificil"] },
              aviso: { type: "string" },
            },
          },
        },
        resto_incompleto: { type: "string" },
      },
    },
  };
}

export function promptImportar(p: {
  fragmento: string; indice: number; total: number; temas: { id: string; numero: number | null; titulo: string }[];
  plantilla: string | null; temaFijo: string | null;
}): string {
  return `FRAGMENTO ${p.indice + 1} DE ${p.total} de un documento de preguntas.
${p.temaFijo ? `Todas las preguntas pertenecen al tema con id ${p.temaFijo}.` : `TEMAS DISPONIBLES:\n${p.temas.map((t) => `- id ${t.id}: Tema ${t.numero ?? "?"} · ${t.titulo}`).join("\n")}`}
${p.plantilla ? `\nEl documento contiene esta PLANTILLA DE SOLUCIONES (úsala para marcar la correcta por número de pregunta):\n<plantilla>\n${p.plantilla}\n</plantilla>\n` : ""}
<documento>
${p.fragmento}
</documento>`;
}

export const DIFICULTAD: Record<string, number> = { facil: 1, intermedio: 2, dificil: 3 };
