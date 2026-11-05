// Simula la API de Anthropic devolviendo datos estructurados coherentes con la herramienta pedida.
import http from 'node:http';
let llamadas = 0;
http.createServer((req, res) => {
  const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => {
    const b = JSON.parse(Buffer.concat(c));
    llamadas++;
    const tool = b.tools[0].name;
    const texto = b.messages[0].content.map((x) => x.text || '').join('\n');
    let input;
    if (tool === 'registrar_fragmento') {
      const n = Number((texto.match(/Genera exactamente (\d+)/) || [])[1] || 0);
      const frag = (texto.match(/FRAGMENTO (\d+) DE/) || [])[1];
      input = {
        notas: `## Apartado del fragmento ${frag}\n- Idea **clave** ${frag}\n- Otra idea`,
        conceptos: [{ termino: `Concepto ${frag}`, definicion: `Definición del concepto ${frag}`, categoria: 'definicion' }, { termino: 'Ley 40/2015', definicion: 'Régimen Jurídico del Sector Público', categoria: 'ley' }],
        preguntas: Array.from({ length: n }, (_, i) => ({
          enunciado: `¿Pregunta ${i + 1} generada del fragmento ${frag}?`, dificultad: ['facil', 'intermedio', 'dificil'][i % 3], fuente: `Fragmento ${frag}`,
          explicacion: 'Porque lo dice el texto.', opciones: [{ texto: 'Correcta', es_correcta: true, explicacion: 'Sí' }, { texto: 'Incorrecta 1', es_correcta: false }, { texto: 'Incorrecta 2', es_correcta: false }, { texto: 'Incorrecta 3', es_correcta: false }],
        })),
        avisos: frag === '1' ? ['El apartado 2 menciona una ley sin indicar su número.'] : [],
      };
    } else if (tool === 'registrar_esquema') input = { esquema: '- Bloque 1\n  - Sub 1.1\n  - Sub 1.2\n- Bloque 2\n  - Sub 2.1' };
    else if (tool === 'registrar_resumen') input = { resumen: '## Resumen\nTexto del **resumen** completo.\n\n### Parte 2\n- Punto' };
    else if (tool === 'registrar_preguntas') input = { preguntas: [
      { enunciado: 'Importada con respuesta', opciones: [{ texto: 'A', es_correcta: false }, { texto: 'B', es_correcta: true }], dificultad: 'facil', tema_id: null },
      { enunciado: 'Importada sin respuesta', opciones: [{ texto: 'A', es_correcta: false }, { texto: 'B', es_correcta: false }], aviso: 'No se indica la respuesta.' } ] };
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: tool, input }] }));
    }, 300);
  });
}).listen(54400, () => console.log('mock anthropic 54400'));
