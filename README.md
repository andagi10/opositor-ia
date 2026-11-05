# Opositor IA

Plataforma web multiusuario para preparar oposiciones con IA. Está pensada para estudiar durante meses o años con tres pilares:

1. **Aprendizaje con IA.** Sube tu temario (PDF, DOCX, ODT, TXT, MD, HTML o RTF) y obtén un esquema, un resumen, los conceptos clave y preguntas tipo test, generados **solo** a partir de tus documentos.
2. **Práctica y simulacros.** Prácticas con corrección al momento y simulacros con tiempo límite, penalización configurable, preguntas en blanco y navegación libre.
3. **Seguimiento inteligente.** Cada respuesta queda registrada para siempre. Con ese historial se calculan el dominio por pregunta y por tema y la repetición espaciada.

Stack: HTML, CSS y JavaScript (módulos ES, sin compilación) · Supabase (Auth, Postgres con RLS, Storage, Edge Functions) · API de Claude (Anthropic) · GitHub Pages.

---

## Puesta en marcha (unos 15 minutos)

### 1. Supabase

1. Crea un proyecto en <https://supabase.com>.
2. En **SQL Editor**, ejecuta en este orden:
   - `supabase/migrations/001_schema.sql` (tablas, seguridad RLS, vistas de estadísticas y funciones)
   - `supabase/migrations/002_storage.sql` (bucket privado `documentos`)
3. En **Authentication → URL Configuration**:
   - **Site URL**: la URL donde publiques la app (por ejemplo, `https://andagi10.github.io/opositor-ia/`).
   - **Redirect URLs**: añade la misma URL. La necesitan la confirmación de email y la recuperación de contraseña.
4. Opcional: en **Authentication → Providers → Email** puedes desactivar "Confirm email" para entrar sin confirmar el email.

### 2. Función de IA (Edge Function)

Con la [CLI de Supabase](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # clave de https://console.anthropic.com
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5-5   # opcional (es el valor por defecto)
supabase functions deploy ia --no-verify-jwt
```

`--no-verify-jwt` es necesario: la función comprueba al usuario por su cuenta y se llama a sí misma para encadenar los pasos (ver `supabase/config.toml`). **La clave de la IA nunca llega al navegador.**

### 3. Frontend

Edita `assets/js/config.js` con la **Project URL** y la **anon/publishable key** (Settings → API). Las dos son públicas por diseño: la seguridad la garantiza RLS.

Para publicarlo en GitHub Pages: sube el repositorio y activa **Settings → Pages → Deploy from branch → main / root**.

Para probarlo en local basta con un servidor estático: `npx serve .` o `python3 -m http.server`.

### 4. Evitar que Supabase pause el proyecto (plan gratuito)

Supabase pausa los proyectos gratuitos que pasan una semana con poca actividad. No borra los datos, pero la app deja de funcionar hasta que pulses **Resume project** en el panel. Para evitarlo:

1. Ejecuta `supabase/migrations/003_ping.sql` en el SQL Editor.
2. En GitHub, ve a **Settings → Secrets and variables → Actions** y crea `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. El workflow `.github/workflows/mantener-supabase-activo.yml` hará una consulta cada día. Pruébalo en **Actions → Mantener Supabase activo → Run workflow**.

GitHub desactiva las tareas programadas de los repositorios públicos que pasan 60 días sin commits, y te avisa por email antes. Basta con hacer algún commit de vez en cuando o reactivarlo desde la pestaña Actions.

### 5. Recuperar el banco anterior

Entra en **Configuración → Versión anterior** y pulsa **Importar banco anterior**. Importa las 435 preguntas de los Temas 1 a 4 (CE 1978, división de poderes, Gobierno y AGE, sector público institucional), con sus explicaciones y referencias de página.

Si exportaste tus estadísticas en la versión antigua, usa **Importar estadísticas antiguas** para conservar tu historial.

---

## Cómo funciona

### Procesamiento de documentos

```
Navegador                                   Supabase
─────────                                   ────────
1. Extrae el texto (pdf.js / mammoth)  →    Storage: guarda el original
   y añade marcas [Página n]                documentos: guarda el texto
2. "Procesar tema"                     →    Edge Function `ia`  → crea un trabajo y responde al momento
                                            ├─ paso 1..N: un fragmento del tema = 1 llamada a la IA
                                            │   (notas, conceptos y preguntas en BORRADOR)
                                            ├─ paso N+1: esquema del tema completo
                                            └─ paso N+2: resumen del tema completo
3. Barra de progreso (sondeo)          ←    tabla trabajos: paso, mensaje, error
4. Revisión: aceptar / editar / descartar → las preguntas pasan a "activa"
```

- **Cobertura completa.** El texto se divide en fragmentos de unos 9.000 caracteres y cada uno genera preguntas en proporción a su longitud. Así se cubre todo el tema y no solo el principio.
- **Fidelidad.** El prompt obliga a usar solo el material y a señalar ambigüedades o lagunas (campo `avisos`). Las preguntas dudosas llegan marcadas.
- **Asíncrono y robusto.** Cada paso es una invocación distinta, para no superar el límite de tiempo de las Edge Functions (150 s en el plan gratuito). Un bloqueo atómico (`reclamar_trabajo`) evita ejecutar el mismo paso dos veces. Si algo se corta, la app reanuda el trabajo, y si hay un error puedes **reintentar** desde el paso que falló.
- **PDF escaneados.** Si no tienen texto, la IA los lee como documento visual (máximo 25 MB).
- **Regenerar** crea una versión nueva del material sin borrar las anteriores. Puedes volver a cualquier versión o editarla a mano.

### Importar preguntas existentes

1. **Sin IA** (instantáneo y gratis): reconoce los formatos habituales, como `1.`, `Pregunta 1:`, `a)`, `A.`, `Respuesta: B`, asteriscos o una plantilla de soluciones al final.
2. **Con IA**: para formatos irregulares o escaneados. La IA **nunca deduce** la respuesta correcta: si el documento no la indica, la pregunta queda pendiente de completar.

Todo lo importado pasa por la pantalla de **Revisión** antes de entrar en el banco.

### Repetición espaciada y dominio

- Es un SM-2 adaptado a preguntas tipo test. Fallar o dejar en blanco hace que la pregunta vuelva en unos 10 minutos. Acertar alarga el intervalo (1, 3, ~8, ~20… días). La rapidez de la respuesta y la dificultad ajustan la "facilidad".
- El **repaso inteligente** prioriza, en este orden: preguntas vencidas, falladas varias veces, las que sueles confundir (eliges siempre la misma opción incorrecta), nunca vistas, temas con menos acierto y las que llevas tiempo sin ver.
- **Dominio** de cada pregunta, calculado con el historial real:
  - *Dominada*: 3 o más aciertos seguidos y al menos un 80 % de acierto.
  - *Difícil*: 3 o más fallos y menos de un 50 % de acierto.
  - *Buen nivel*: última respuesta acertada y al menos un 60 % de acierto.
  - *Necesita repaso*: el resto de preguntas ya respondidas.
  - *Nunca respondida*: aún sin respuestas.
- No se guardan estadísticas redundantes: todo se calcula con vistas SQL a partir de `intentos`. La única excepción es `srs_estado`, el estado del algoritmo, que lo mantiene un trigger.

### Seguridad y datos

- Hay RLS en todas las tablas: cada usuario solo ve y modifica sus propias filas. Además, un trigger impide enlazar filas propias con las de otro usuario (por ejemplo, crear una pregunta en el tema de otra persona).
- `intentos` no admite UPDATE ni DELETE, así que el historial es permanente.
- Archivar un tema o una pregunta la saca de las prácticas y los simulacros **sin perder el historial**. Editar una pregunta conserva los IDs de sus opciones y todas sus respuestas anteriores.
- Storage es privado: cada usuario solo accede a la carpeta `{su_id}/…`.

## Estructura

```
index.html                 Shell de la SPA
assets/css/app.css         Estilos (claro/oscuro, responsive)
assets/js/app.js           Arranque, autenticación, layout y rutas (#/…)
assets/js/lib/             Supabase, estado, API, extracción, parser, motor de examen, gráficos…
assets/js/views/           Una vista por sección
data/banco-anterior.json   Las 435 preguntas de la versión anterior
supabase/migrations/       Esquema SQL
supabase/functions/ia/     Edge Function de IA (+ _shared/)
tests/                     Pruebas (ver abajo)
```

## Pruebas

| Prueba | Qué cubre | Cómo ejecutarla |
|---|---|---|
| `tests/rls_y_logica.test.sql` | Aislamiento entre usuarios (BD y Storage), historial inmutable, SM-2, dominio, selección sin repetidas y repartida por temas, repaso, edición sin perder historial, temas archivados | `psql -f tests/supabase_stubs.sql`, las migraciones y este fichero sobre un Postgres 15+ vacío |
| `tests/parser.test.mjs` | Parser local de preguntas | `node tests/parser.test.mjs` |
| `tests/texto.test.ts` | Troceado de documentos y plantillas | `deno run tests/texto.test.ts` |
| `tests/e2e/` | 26 recorridos completos en Chromium contra Postgres, PostgREST, la Edge Function real y una IA simulada | ver `tests/e2e/e2e.mjs` |

## Costes orientativos

- **Supabase**: el plan gratuito sobra para unos pocos usuarios.
- **IA**: se paga por uso en la consola de Anthropic. Procesar un tema cuesta aproximadamente una llamada por cada 9.000 caracteres, más dos llamadas de síntesis. Puedes usar un modelo más barato cambiando `ANTHROPIC_MODEL`.
