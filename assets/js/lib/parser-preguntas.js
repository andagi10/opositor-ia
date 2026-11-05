// Parser local de documentos de preguntas tipo test (sin IA, gratis e instantáneo).
// Reconoce los formatos habituales:
//   1. Enunciado / 1) Enunciado / Pregunta 1: Enunciado
//   a) opción / A. opción / (b) opción / B- opción   (* o "(correcta)" marca la correcta)
//   Respuesta: B / Respuesta correcta: b / Solución: C / Correcta: A
//   Explicación: ... / Justificación: ...
//   Plantilla final: "Soluciones: 1-B 2-C 3.A ..."
// Si no reconoce bien el documento, la app ofrece usar la IA.

const RE_PREGUNTA = /^\s*(?:pregunta\s*n?[ºo°.]?\s*)?(\d{1,4})\s*(?:[.)\-:–]|\s(?=¿))\s*(.*)$/i;
const RE_PREGUNTA_PALABRA = /^\s*pregunta\s*n?[ºo°.]?\s*(\d{1,4})\s*[.):\-–]?\s*(.*)$/i;
const RE_OPCION = /^\s*\(?([a-fA-F])\s*[).\-:–]\s+(.+)$/;
const RE_RESPUESTA = /^\s*(?:respuesta(?:\s+correcta)?|soluci[oó]n|correcta|clave)\s*[:.\-–]?\s*\(?([a-fA-F])\)?(?:[\s.).,:;-]|$)(.*)$/i;
const RE_EXPLICACION = /^\s*(?:explicaci[oó]n|justificaci[oó]n|comentario|fundamento|motivo)\s*[:.\-–]\s*(.*)$/i;
const RE_PLANTILLA = /^\s*(?:soluciones|plantilla(?:\s+de\s+(?:respuestas|soluciones))?|respuestas\s+correctas|clave\s+de\s+respuestas|hoja\s+de\s+respuestas)\b/i;
const MARCA_CORRECTA = /(^\s*[*✓✔]\s*)|(\s*[*✓✔]\s*$)|\s*\((?:correcta|ok)\)\s*$/i;

export function parsearPlantilla(texto) {
  const mapa = {};
  const re = /\b(\d{1,4})\s*[-.):=]?\s*([a-fA-F])\b/g;
  let m;
  while ((m = re.exec(texto))) mapa[Number(m[1])] = m[2].toUpperCase();
  return mapa;
}

export function parsearPreguntas(textoEntrada) {
  const texto = String(textoEntrada || '').replace(/\r\n?/g, '\n').replace(/\[Página \d+\]\n?/g, '');
  const lineas = texto.split('\n');

  // 1) Plantilla de soluciones al final
  let plantilla = {};
  let finPreguntas = lineas.length;
  for (let i = Math.floor(lineas.length * 0.5); i < lineas.length; i++) {
    if (RE_PLANTILLA.test(lineas[i])) {
      const resto = lineas.slice(i).join('\n');
      const p = parsearPlantilla(resto);
      if (Object.keys(p).length >= 3) { plantilla = p; finPreguntas = i; break; }
    }
  }

  // 2) Preguntas
  const preguntas = [];
  let actual = null;
  let campo = null; // 'enunciado' | 'opcion' | 'explicacion'
  const cerrar = () => {
    if (actual && actual.enunciado.trim() && actual.opciones.length >= 2) preguntas.push(actual);
    actual = null; campo = null;
  };

  for (let i = 0; i < finPreguntas; i++) {
    const linea = lineas[i];
    if (!linea.trim()) continue;

    const mResp = linea.match(RE_RESPUESTA);
    if (actual && mResp && actual.opciones.length >= 2) {
      actual.letraCorrecta = mResp[1].toUpperCase();
      const extra = (mResp[2] || '').replace(/^[\s.):,;-]+/, '').trim();
      if (extra) { actual.explicacion = (actual.explicacion ? actual.explicacion + ' ' : '') + extra; }
      campo = 'explicacion';
      continue;
    }
    const mExp = linea.match(RE_EXPLICACION);
    if (actual && mExp) { actual.explicacion = ((actual.explicacion || '') + ' ' + mExp[1]).trim(); campo = 'explicacion'; continue; }

    const mOp = linea.match(RE_OPCION);
    const letraEsperada = actual ? String.fromCharCode(65 + actual.opciones.length) : null;
    if (actual && mOp && mOp[1].toUpperCase() === letraEsperada) {
      let t = mOp[2];
      const marcada = MARCA_CORRECTA.test(t);
      t = t.replace(MARCA_CORRECTA, '').trim();
      actual.opciones.push({ texto: t, es_correcta: false, marcada });
      campo = 'opcion';
      continue;
    }

    const mPreg = linea.match(RE_PREGUNTA_PALABRA) || linea.match(RE_PREGUNTA);
    const esNuevaPregunta = mPreg && (!actual || actual.opciones.length >= 2 || campo === 'explicacion')
      && !(actual && campo === 'enunciado' && actual.opciones.length === 0);
    if (esNuevaPregunta) {
      cerrar();
      actual = { numero: Number(mPreg[1]), enunciado: (mPreg[2] || '').trim(), opciones: [], explicacion: '', letraCorrecta: null };
      campo = 'enunciado';
      continue;
    }

    // Línea de continuación
    if (!actual) continue;
    const t = linea.trim();
    if (campo === 'enunciado') actual.enunciado += (actual.enunciado ? ' ' : '') + t;
    else if (campo === 'opcion') {
      const op = actual.opciones[actual.opciones.length - 1];
      const marcada = MARCA_CORRECTA.test(t);
      op.texto += ' ' + t.replace(MARCA_CORRECTA, '').trim();
      op.marcada = op.marcada || marcada;
    } else if (campo === 'explicacion') actual.explicacion = (actual.explicacion + ' ' + t).trim();
  }
  cerrar();

  // 3) Resolver respuesta correcta
  for (const p of preguntas) {
    const letra = p.letraCorrecta || plantilla[p.numero] || null;
    const marcadas = p.opciones.filter((o) => o.marcada);
    if (letra) {
      const idx = letra.charCodeAt(0) - 65;
      if (p.opciones[idx]) p.opciones[idx].es_correcta = true;
    } else if (marcadas.length === 1) {
      marcadas[0].es_correcta = true;
    }
    p.opciones.forEach((o) => delete o.marcada);
    p.tieneCorrecta = p.opciones.filter((o) => o.es_correcta).length === 1;
    p.enunciado = p.enunciado.replace(/\s+/g, ' ').trim();
    p.explicacion = (p.explicacion || '').replace(/\s+/g, ' ').trim();
    delete p.letraCorrecta;
  }

  const conCorrecta = preguntas.filter((p) => p.tieneCorrecta).length;
  return {
    preguntas,
    total: preguntas.length,
    conCorrecta,
    plantillaDetectada: Object.keys(plantilla).length > 0,
    fiable: preguntas.length >= 3 && conCorrecta / preguntas.length >= 0.8,
  };
}
