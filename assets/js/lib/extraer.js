// Extracción de texto en el navegador (no se envían documentos a terceros para leerlos).
// PDF: pdf.js · DOCX: mammoth · ODT: JSZip · TXT/MD/CSV/HTML/RTF: nativo.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de documentos'));
    document.head.appendChild(s);
  });
}

const ext = (n) => (n.split('.').pop() || '').toLowerCase();

export async function extraerTexto(file, onProgreso) {
  const e = ext(file.name);
  if (e === 'pdf' || file.type === 'application/pdf') return extraerPDF(file, onProgreso);
  if (e === 'docx') return extraerDOCX(file);
  if (e === 'odt') return extraerODT(file);
  if (['html', 'htm'].includes(e)) return extraerHTML(await file.text());
  if (e === 'rtf') return extraerRTF(await file.text());
  if (['txt', 'md', 'markdown', 'csv'].includes(e) || file.type.startsWith('text/')) return limpiar(await leerTextoPlano(file));
  if (e === 'doc') throw new Error('El formato .doc antiguo no se puede leer. Guárdalo como .docx o PDF.');
  throw new Error(`Formato .${e} no soportado`);
}

async function leerTextoPlano(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  // Si hay muchos caracteres de reemplazo, probablemente es Windows-1252
  return (utf8.match(/�/g) || []).length > 5 ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

export function limpiar(t) {
  return String(t || '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/-\n(?=[a-záéíóúñ])/g, '')     // une palabras cortadas con guion a final de línea
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extraerPDF(file, onProgreso) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    onProgreso?.(`Leyendo página ${n} de ${doc.numPages}…`);
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let texto = '';
    let ultimaY = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform?.[5];
      if (ultimaY !== null && y !== undefined && Math.abs(y - ultimaY) > 2) {
        texto += Math.abs(y - ultimaY) > (it.height || 10) * 1.8 ? '\n\n' : '\n';
      } else if (texto && !texto.endsWith(' ') && it.str && !it.str.startsWith(' ')) {
        texto += ' ';
      }
      texto += it.str;
      if (it.hasEOL) texto += '\n';
      if (y !== undefined) ultimaY = y;
    }
    // Marcadores de página para que la IA pueda citar la ubicación exacta
    if (texto.trim()) paginas.push(`[Página ${n}]\n${texto.trim()}`);
  }
  const total = limpiar(paginas.join('\n\n'));
  // Un PDF escaneado no tiene capa de texto: se devolverá vacío y la IA lo leerá como documento visual
  return total.replace(/\[Página \d+\]/g, '').trim().length < 200 ? '' : total;
}

async function extraerDOCX(file) {
  await cargarScript(MAMMOTH);
  const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return extraerHTML(r.value);
}

async function extraerODT(file) {
  const { default: JSZip } = await import(JSZIP);
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('ODT sin contenido');
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  const parrafos = [...d.getElementsByTagName('*')].filter((n) => ['text:p', 'text:h'].includes(n.nodeName)).map((n) => n.textContent);
  return limpiar(parrafos.join('\n\n'));
}

/** Convierte HTML a texto conservando títulos y listas como markdown sencillo. */
export function extraerHTML(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script,style,noscript').forEach((n) => n.remove());
  const partes = [];
  const recorrer = (nodo, prefijo = '') => {
    for (const n of nodo.childNodes) {
      if (n.nodeType === 3) continue;
      const tag = n.nodeName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) partes.push('#'.repeat(Math.min(4, +tag[1])) + ' ' + n.textContent.trim());
      else if (tag === 'li') partes.push(prefijo + '- ' + [...n.childNodes].filter((c) => !['UL', 'OL'].includes(c.nodeName)).map((c) => c.textContent).join('').trim()), recorrer(n, prefijo + '  ');
      else if (['ul', 'ol'].includes(tag)) recorrer(n, prefijo);
      else if (['p', 'pre', 'blockquote', 'tr', 'dt', 'dd', 'caption'].includes(tag)) partes.push(n.textContent.trim());
      else if (['div', 'section', 'article', 'body', 'main', 'table', 'tbody', 'thead', 'dl'].includes(tag)) recorrer(n, prefijo);
      else if (n.textContent.trim()) partes.push(n.textContent.trim());
    }
  };
  recorrer(d.body);
  return limpiar(partes.filter(Boolean).join('\n\n'));
}

export function extraerRTF(rtf) {
  return limpiar(rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(h, 16)])))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(n < 0 ? 65536 + Number(n) : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, ''));
}
