import { dividirEnFragmentos, extraerPlantillaRespuestas, claveEnunciado } from '../supabase/functions/_shared/texto.ts';
const largo = Array.from({ length: 40 }, (_, i) => `Párrafo ${i} ` + 'texto '.repeat(120)).join('\n\n');
const f = dividirEnFragmentos(largo);
if (f.length < 3) throw new Error('debería trocear');
if (f.some((x) => x.length > 12000)) throw new Error('fragmento demasiado grande');
if (f.join('').replace(/\s/g, '').length !== largo.replace(/\s/g, '').length) throw new Error('se perdió texto');
if (!extraerPlantillaRespuestas('x\n'.repeat(50) + 'SOLUCIONES\n1-B 2-C 3-A 4-D 5-B 6-A')) throw new Error('plantilla');
if (claveEnunciado('¿Qué ÓRGANO?') !== claveEnunciado('que organo')) throw new Error('clave');
console.log('texto OK');
