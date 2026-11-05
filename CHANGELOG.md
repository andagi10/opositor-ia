# Cambios

## 1.0.0 · 5 de noviembre de 2026

Reescritura completa como plataforma multiusuario. Sustituye al examen HTML de la Constitución (un único fichero con las preguntas en el código y las estadísticas en `localStorage`).

### Conservado de la versión anterior
- Las 435 preguntas de los Temas 1 a 4, con explicaciones y ubicación en el documento (`data/banco-anterior.json`), importables en un clic.
- La importación de la copia de seguridad de estadísticas antigua.
- El reparto de preguntas entre apartados y temas, el orden aleatorio de las opciones, la corrección inmediata, los cuadraditos de historial y el modo oscuro.

### Nuevo
- Cuentas de usuario (Supabase Auth), varias oposiciones por usuario y separación total de datos (RLS).
- Mi temario: temas ordenables y archivables, y subida múltiple de documentos con sustitución por versiones.
- Procesamiento con IA asíncrono y por fragmentos: esquema, resumen, conceptos y preguntas con tres niveles de dificultad, avisos de ambigüedad, reintentos y regeneración por versiones.
- Banco de preguntas: búsqueda, filtros, edición, alta manual, favoritas, reportes, acciones en lote y exportación a CSV.
- Importación de preguntas existentes, con un parser local o con IA, y revisión previa.
- Estudiar: material por tema con versiones editables, tarjetas de conceptos e impresión.
- Práctica por temas: número de preguntas, temas, dificultad y modo (aleatorias, falladas, no respondidas o favoritas).
- Simulacros: 10/20/50/100 o personalizado, tiempo límite, penalización, preguntas en blanco y marcadas, guardar y continuar, historial y comparativa.
- Repaso inteligente con repetición espaciada (SM-2 adaptado) y detección de confusiones.
- Mi progreso: evolución, aciertos frente a errores, dominadas en el tiempo, rendimiento y dominio por tema, listas por pregunta, historial individual y exportación.
- Diseño SaaS responsive con menú lateral y modo claro/oscuro.

### Corregido durante las pruebas
- El bloqueo de pasos de la IA con un filtro `or` en un UPDATE de PostgREST devolvía vacío y dejaba el trabajo en cola. Se sustituyó por la función atómica `reclamar_trabajo`.
- Las prácticas terminadas antes de tiempo contaban como no respondidas las preguntas que no se llegaron a ver.
- Volver a pulsar la sección activa del menú no recargaba la vista.
- Algunos iconos aparecían sin tamaño, y en móvil la opción tocada parecía seleccionada por el efecto *hover*.
