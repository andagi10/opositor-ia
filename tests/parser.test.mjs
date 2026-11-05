import { parsearPreguntas } from '../assets/js/lib/parser-preguntas.js';
import assert from 'node:assert/strict';

// Formato del enunciado del usuario
let r = parsearPreguntas(`Pregunta 1: ¿Cuál es la capital de España?

A) Barcelona
B) Madrid
C) Sevilla
D) Valencia

Respuesta correcta: B.

Pregunta 2: ¿Cuántos artículos tiene la CE?
A) 169
B) 170
C) 150
D) 200
Respuesta correcta: A
Explicación: La CE tiene 169 artículos.`);
assert.equal(r.total, 2); assert.equal(r.conCorrecta, 2);
assert.equal(r.preguntas[0].opciones[1].es_correcta, true);
assert.equal(r.preguntas[1].explicacion, 'La CE tiene 169 artículos.');

// Numeración + plantilla final + opciones en minúscula y multilínea
r = parsearPreguntas(`1. Según el artículo 1.1 de la Constitución,
España se constituye en:
a) Un Estado federal
b) Un Estado social y democrático de Derecho
c) Una república
d) Un Estado confederal
2.- El Defensor del Pueblo es elegido por:
a) El Gobierno
b) Las Cortes Generales
c) El Rey
d) El Tribunal Supremo
3) ¿Qué título regula la Corona?
a) Título I
b) Título II
c) Título III
d) Título IV

SOLUCIONES
1-B 2-B 3-B`);
assert.equal(r.total, 3); assert.equal(r.conCorrecta, 3); assert.ok(r.plantillaDetectada);
assert.match(r.preguntas[0].enunciado, /España se constituye en/);

// Asterisco marcando la correcta
r = parsearPreguntas(`1. Pregunta con asterisco
a) uno
b) dos *
c) tres
2. Otra
a) x
b) y
c) *z`);
assert.equal(r.preguntas[0].opciones[1].es_correcta, true);
assert.equal(r.preguntas[1].opciones[2].es_correcta, true);
assert.equal(r.preguntas[1].opciones[2].texto, 'z');

// Sin respuesta: no se inventa
r = parsearPreguntas(`1. Sin solución\na) uno\nb) dos\n2. Otra\na) x\nb) y`);
assert.equal(r.conCorrecta, 0); assert.equal(r.fiable, false);
console.log('parser OK');
