// Utilidades puras de texto (sin dependencias, se prueban también en Node).

/** Normaliza saltos de línea y espacios sin perder la estructura de párrafos. */
export function normalizarTexto(t: string): string {
  return (t || "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Divide un texto en fragmentos de tamaño parecido cortando por párrafos,
 * para que la IA cubra TODO el tema y no solo el principio.
 */
export function dividirEnFragmentos(texto: string, objetivo = 9000, maximo = 12000): string[] {
  const limpio = normalizarTexto(texto);
  if (!limpio) return [];
  if (limpio.length <= maximo) return [limpio];

  const parrafos = limpio.split(/\n\s*\n/);
  const fragmentos: string[] = [];
  let actual = "";
  const cerrar = () => { if (actual.trim()) fragmentos.push(actual.trim()); actual = ""; };

  for (const p of parrafos) {
    if (p.length > maximo) {
      // párrafo gigante: se corta por frases
      cerrar();
      const frases = p.split(/(?<=[.;:!?])\s+/);
      for (const f of frases) {
        if ((actual + " " + f).length > objetivo && actual) cerrar();
        actual += (actual ? " " : "") + f;
        while (actual.length > maximo) {
          fragmentos.push(actual.slice(0, maximo));
          actual = actual.slice(maximo);
        }
      }
      cerrar();
      continue;
    }
    if ((actual + "\n\n" + p).length > objetivo && actual) cerrar();
    actual += (actual ? "\n\n" : "") + p;
  }
  cerrar();

  // Une un último fragmento muy pequeño con el anterior
  if (fragmentos.length > 1 && fragmentos[fragmentos.length - 1].length < objetivo * 0.25) {
    const ultimo = fragmentos.pop()!;
    fragmentos[fragmentos.length - 1] += "\n\n" + ultimo;
  }
  return fragmentos;
}

/** Busca una plantilla de soluciones al final de un documento de preguntas (p.ej. "Soluciones: 1-B, 2-C..."). */
export function extraerPlantillaRespuestas(texto: string): string | null {
  const t = normalizarTexto(texto);
  const desde = Math.floor(t.length * 0.6);
  const cola = t.slice(desde);
  const m = cola.search(/(soluciones|plantilla( de respuestas)?|respuestas correctas|clave de respuestas|hoja de respuestas)\s*:?\s*\n?/i);
  if (m < 0) return null;
  const bloque = cola.slice(m, m + 8000);
  // Debe parecer una plantilla: muchos pares número-letra
  const pares = bloque.match(/\b\d{1,3}\s*[-.):]?\s*[a-eA-E]\b/g) || [];
  return pares.length >= 5 ? bloque : null;
}

/** Clave para detectar preguntas duplicadas. */
export function claveEnunciado(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Calcula cuántas preguntas pedir para un fragmento según su longitud. */
export function preguntasParaFragmento(longitud: number, densidad = 1): number {
  // ~1 pregunta cada 650 caracteres, entre 6 y 16 por fragmento
  const n = Math.round((longitud / 650) * densidad);
  return Math.max(6, Math.min(16, n));
}
