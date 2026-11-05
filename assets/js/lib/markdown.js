// Renderizador de markdown mínimo y SEGURO (escapa todo el HTML de entrada).
// Soporta: # títulos, listas (- * 1.) anidadas por sangría, **negrita**, *cursiva*,
// `código`, > citas, tablas simples con | y párrafos.
import { esc } from './ui.js';

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
}

export function markdown(texto) {
  const lineas = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const pila = []; // listas abiertas: {tipo, indent}
  let parrafo = [];

  const cerrarParrafo = () => { if (parrafo.length) { out.push(`<p>${inline(parrafo.join(' '))}</p>`); parrafo = []; } };
  const cerrarListas = (hasta = -1) => {
    while (pila.length && pila[pila.length - 1].indent > hasta) out.push(`</li></${pila.pop().tipo}>`);
  };

  for (let i = 0; i < lineas.length; i++) {
    const raw = lineas[i];
    const linea = raw.replace(/\t/g, '  ');
    if (!linea.trim()) { cerrarParrafo(); continue; }

    const h = linea.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { cerrarParrafo(); cerrarListas(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const li = linea.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/);
    if (li) {
      cerrarParrafo();
      const indent = li[1].length;
      const tipo = /\d/.test(li[2]) ? 'ol' : 'ul';
      const top = pila[pila.length - 1];
      if (!top || indent > top.indent) {
        out.push(`<${tipo}><li>`);
        pila.push({ tipo, indent });
      } else {
        cerrarListas(indent);
        const t2 = pila[pila.length - 1];
        if (t2 && t2.indent === indent) out.push('</li><li>');
        else { out.push(`<${tipo}><li>`); pila.push({ tipo, indent }); }
      }
      out.push(inline(li[3]));
      continue;
    }

    if (/^\s*>\s?/.test(linea)) { cerrarParrafo(); cerrarListas(); out.push(`<blockquote>${inline(linea.replace(/^\s*>\s?/, ''))}</blockquote>`); continue; }

    if (/^\s*\|.*\|\s*$/.test(linea)) {
      cerrarParrafo(); cerrarListas();
      const filas = [];
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) { filas.push(lineas[i]); i++; }
      i--;
      const celdas = (f) => f.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const cuerpo = filas.filter((f) => !/^\s*\|[\s:-|]+\|\s*$/.test(f));
      if (cuerpo.length) {
        const [cab, ...resto] = cuerpo;
        out.push(`<table><thead><tr>${celdas(cab).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
          resto.map((f) => `<tr>${celdas(f).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      }
      continue;
    }

    if (pila.length && /^\s{2,}\S/.test(linea)) { out.push(' ' + inline(linea.trim())); continue; }
    cerrarListas();
    parrafo.push(linea.trim());
  }
  cerrarParrafo();
  cerrarListas();
  return out.join('');
}
