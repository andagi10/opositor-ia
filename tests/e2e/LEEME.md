# Pruebas de extremo a extremo

Entorno local que imita Supabase para probar la app completa sin cuenta en la nube:

- Postgres 16 con `tests/supabase_stubs.sql` + migraciones
- PostgREST 12 (`postgrest.conf`)
- `gateway.mjs`: pasarela en :54321 con auth simulada, Storage en disco y proxy a REST y funciones
- Edge Function real `ia` ejecutada con Deno (`edge/run.sh`, mapea `jsr:` a `npm:`)
- `mock-anthropic.mjs`: IA simulada que devuelve datos con la forma real de la API
- `static.mjs`: sirve la app en :8080 con un `config.js` de pruebas
- `e2e.mjs`: 26 recorridos en Chromium (Playwright)

Las rutas son absolutas al entorno donde se crearon (`/home/claude/e2e`); ajústalas si lo ejecutas en otra máquina.
