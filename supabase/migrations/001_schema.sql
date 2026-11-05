-- =====================================================================
-- Opositor IA · Esquema de base de datos
-- Supabase / PostgreSQL 15+
-- Ejecutar completo en el SQL Editor de Supabase (es idempotente en lo posible).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PERFILES
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  nombre              text,
  oposicion_activa_id uuid,
  preferencias        jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_crear_perfil on auth.users;
create trigger trg_crear_perfil after insert on auth.users
for each row execute function public.crear_perfil_nuevo_usuario();

-- ---------------------------------------------------------------------
-- OPOSICIONES Y TEMAS
-- ---------------------------------------------------------------------
create table if not exists public.oposiciones (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre       text not null check (length(trim(nombre)) > 0),
  descripcion  text,
  fecha_examen date,
  archivada    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_oposiciones_user on public.oposiciones(user_id);

alter table public.perfiles
  drop constraint if exists perfiles_oposicion_activa_fk;
alter table public.perfiles
  add constraint perfiles_oposicion_activa_fk
  foreign key (oposicion_activa_id) references public.oposiciones(id) on delete set null;

create table if not exists public.temas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id uuid not null references public.oposiciones(id) on delete cascade,
  numero       integer,
  titulo       text not null check (length(trim(titulo)) > 0),
  descripcion  text,
  orden        integer not null default 0,
  archivado    boolean not null default false,  -- "borrar" un tema lo archiva: su historial se conserva
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_temas_oposicion on public.temas(oposicion_id, orden);
create index if not exists idx_temas_user on public.temas(user_id);

-- ---------------------------------------------------------------------
-- DOCUMENTOS
-- ---------------------------------------------------------------------
create table if not exists public.documentos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id   uuid not null references public.oposiciones(id) on delete cascade,
  tema_id        uuid references public.temas(id) on delete set null,
  tipo           text not null default 'temario' check (tipo in ('temario','preguntas')),
  nombre         text not null,
  storage_path   text,
  mime           text,
  tamano_bytes   bigint,
  texto          text,                 -- texto extraído en el navegador (PDF/DOCX/TXT...)
  num_caracteres integer generated always as (coalesce(length(texto), 0)) stored,
  activo         boolean not null default true,   -- al sustituir un documento, el antiguo queda inactivo
  sustituye_a    uuid references public.documentos(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_documentos_tema on public.documentos(tema_id);
create index if not exists idx_documentos_user on public.documentos(user_id);

-- ---------------------------------------------------------------------
-- TRABAJOS DE PROCESAMIENTO (IA asíncrona)
-- ---------------------------------------------------------------------
create table if not exists public.trabajos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id  uuid not null references public.oposiciones(id) on delete cascade,
  tema_id       uuid references public.temas(id) on delete set null,
  documento_id  uuid references public.documentos(id) on delete set null,
  tipo          text not null check (tipo in ('procesar_tema','importar_preguntas')),
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','procesando','completado','error','cancelado')),
  paso          integer not null default 0,
  total_pasos   integer not null default 0,
  mensaje       text,
  error         text,
  reintentos    integer not null default 0,
  opciones      jsonb not null default '{}'::jsonb,
  estado_interno jsonb not null default '{}'::jsonb,  -- resultados parciales entre pasos
  resultado     jsonb not null default '{}'::jsonb,
  bloqueado_hasta timestamptz,                         -- evita que dos procesos ejecuten el mismo paso
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
alter table public.trabajos add column if not exists bloqueado_hasta timestamptz;
create index if not exists idx_trabajos_user on public.trabajos(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- MATERIALES DE ESTUDIO (esquema, resumen, conceptos) con versiones
-- ---------------------------------------------------------------------
create table if not exists public.materiales (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tema_id     uuid not null references public.temas(id) on delete cascade,
  tipo        text not null check (tipo in ('esquema','resumen','conceptos')),
  contenido   text,                  -- markdown (esquema/resumen)
  datos       jsonb,                 -- conceptos: [{termino, definicion, categoria}]
  avisos      text,                  -- ambigüedades o lagunas detectadas por la IA
  version     integer not null default 1,
  activo      boolean not null default true,
  editado     boolean not null default false,
  trabajo_id  uuid references public.trabajos(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_materiales_tema on public.materiales(tema_id, tipo, activo);

-- ---------------------------------------------------------------------
-- PREGUNTAS Y OPCIONES
-- ---------------------------------------------------------------------
create table if not exists public.preguntas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id  uuid not null references public.oposiciones(id) on delete cascade,
  tema_id       uuid references public.temas(id) on delete set null,
  documento_id  uuid references public.documentos(id) on delete set null,
  trabajo_id    uuid references public.trabajos(id) on delete set null,
  enunciado     text not null check (length(trim(enunciado)) > 0),
  explicacion   text,
  fuente        text,                -- ubicación en el documento ("Apartado 3 · pág. 4")
  aviso         text,                -- la IA indica si algo es ambiguo o dudoso
  dificultad    smallint not null default 2 check (dificultad between 1 and 3), -- 1 fácil, 2 intermedio, 3 difícil
  origen        text not null default 'manual' check (origen in ('ia','importada','manual','legado')),
  estado        text not null default 'activa' check (estado in ('borrador','activa','archivada')),
  favorita      boolean not null default false,
  legacy_id     text,
  version       integer not null default 1,
  busqueda      tsvector generated always as (
                  to_tsvector('spanish', coalesce(enunciado,'') || ' ' || coalesce(explicacion,''))
                ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_preguntas_tema on public.preguntas(tema_id, estado);
create index if not exists idx_preguntas_opos on public.preguntas(oposicion_id, estado);
create index if not exists idx_preguntas_user on public.preguntas(user_id);
create index if not exists idx_preguntas_busqueda on public.preguntas using gin(busqueda);
create unique index if not exists uq_preguntas_legacy on public.preguntas(user_id, oposicion_id, legacy_id) where legacy_id is not null;

create table if not exists public.opciones (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pregunta_id uuid not null references public.preguntas(id) on delete cascade,
  orden       smallint not null default 0,
  texto       text not null,
  es_correcta boolean not null default false,
  explicacion text,                  -- por qué esta opción es (in)correcta
  created_at  timestamptz not null default now()
);
create index if not exists idx_opciones_pregunta on public.opciones(pregunta_id, orden);

-- ---------------------------------------------------------------------
-- SESIONES (práctica, simulacro, repaso, estudio) e INTENTOS
-- ---------------------------------------------------------------------
create table if not exists public.sesiones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id  uuid not null references public.oposiciones(id) on delete cascade,
  tipo          text not null check (tipo in ('practica','simulacro','repaso','estudio')),
  config        jsonb not null default '{}'::jsonb,   -- temas, dificultad, penalización, tiempo límite...
  pregunta_ids  uuid[] not null default '{}',
  estado        text not null default 'en_curso' check (estado in ('en_curso','finalizada','abandonada')),
  iniciada_at   timestamptz not null default now(),
  finalizada_at timestamptz,
  duracion_seg  integer
);
create index if not exists idx_sesiones_user on public.sesiones(user_id, iniciada_at desc);

-- Cada respuesta queda registrada para siempre (no hay políticas UPDATE/DELETE).
create table if not exists public.intentos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  oposicion_id  uuid references public.oposiciones(id) on delete set null,
  pregunta_id   uuid references public.preguntas(id) on delete set null,
  tema_id       uuid references public.temas(id) on delete set null,
  sesion_id     uuid references public.sesiones(id) on delete set null,
  opcion_id     uuid references public.opciones(id) on delete set null,
  en_blanco     boolean not null default false,
  correcta      boolean not null default false,
  tiempo_ms     integer check (tiempo_ms is null or tiempo_ms >= 0),
  dificultad    smallint,
  importado     boolean not null default false,  -- intentos migrados de la versión antigua
  respondida_at timestamptz not null default now()
);
create index if not exists idx_intentos_pregunta on public.intentos(user_id, pregunta_id, respondida_at);
create index if not exists idx_intentos_fecha on public.intentos(user_id, oposicion_id, respondida_at);
create index if not exists idx_intentos_sesion on public.intentos(sesion_id);

-- ---------------------------------------------------------------------
-- REPETICIÓN ESPACIADA (estado derivado; se actualiza por trigger)
-- ---------------------------------------------------------------------
create table if not exists public.srs_estado (
  user_id        uuid not null references auth.users(id) on delete cascade,
  pregunta_id    uuid not null references public.preguntas(id) on delete cascade,
  repeticiones   integer not null default 0,   -- aciertos consecutivos "útiles" (SM-2)
  racha          integer not null default 0,   -- aciertos consecutivos
  lapsos         integer not null default 0,   -- veces que se olvidó tras haberla acertado
  facilidad      numeric(4,2) not null default 2.50,
  intervalo_dias numeric(8,2) not null default 0,
  vencimiento    timestamptz not null default now(),
  ultima_at      timestamptz,
  primary key (user_id, pregunta_id)
);
create index if not exists idx_srs_venc on public.srs_estado(user_id, vencimiento);

-- ---------------------------------------------------------------------
-- REPORTES DE PREGUNTAS
-- ---------------------------------------------------------------------
create table if not exists public.reportes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pregunta_id uuid not null references public.preguntas(id) on delete cascade,
  motivo      text not null check (motivo in ('respuesta_incorrecta','enunciado_confuso','fuera_de_temario','duplicada','otro')),
  comentario  text,
  resuelto    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_reportes_pregunta on public.reportes(pregunta_id) where not resuelto;

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['perfiles','oposiciones','temas','documentos','trabajos','preguntas'] loop
    execute format('drop trigger if exists trg_updated_%1$s on public.%1$s', t);
    execute format('create trigger trg_updated_%1$s before update on public.%1$s
                    for each row execute function public.tocar_updated_at()', t);
  end loop;
end $$;

-- =====================================================================
-- INTEGRIDAD ENTRE USUARIOS
-- Impide enlazar filas propias con filas de otro usuario (p.ej. crear una
-- pregunta en el tema de otra persona adivinando su UUID).
-- =====================================================================
create or replace function public.validar_propiedad()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if TG_TABLE_NAME in ('temas','documentos','preguntas','trabajos','sesiones','intentos') then
    if new.oposicion_id is not null then
      select user_id into owner from oposiciones where id = new.oposicion_id;
      if owner is distinct from new.user_id then raise exception 'oposicion_id no pertenece al usuario'; end if;
    end if;
  end if;
  if TG_TABLE_NAME in ('documentos','preguntas','trabajos','materiales','intentos') then
    if new.tema_id is not null then
      select user_id into owner from temas where id = new.tema_id;
      if owner is distinct from new.user_id then raise exception 'tema_id no pertenece al usuario'; end if;
    end if;
  end if;
  if TG_TABLE_NAME in ('opciones','intentos','reportes') then
    if new.pregunta_id is not null then
      select user_id into owner from preguntas where id = new.pregunta_id;
      if owner is distinct from new.user_id then raise exception 'pregunta_id no pertenece al usuario'; end if;
    end if;
  end if;
  if TG_TABLE_NAME = 'intentos' then
    if new.sesion_id is not null then
      select user_id into owner from sesiones where id = new.sesion_id;
      if owner is distinct from new.user_id then raise exception 'sesion_id no pertenece al usuario'; end if;
    end if;
    if new.opcion_id is not null then
      select user_id into owner from opciones where id = new.opcion_id;
      if owner is distinct from new.user_id then raise exception 'opcion_id no pertenece al usuario'; end if;
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['temas','documentos','preguntas','opciones','trabajos','materiales','sesiones','intentos','reportes'] loop
    execute format('drop trigger if exists trg_propiedad_%1$s on public.%1$s', t);
    execute format('create trigger trg_propiedad_%1$s before insert or update on public.%1$s
                    for each row execute function public.validar_propiedad()', t);
  end loop;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.perfiles    enable row level security;
alter table public.oposiciones enable row level security;
alter table public.temas       enable row level security;
alter table public.documentos  enable row level security;
alter table public.trabajos    enable row level security;
alter table public.materiales  enable row level security;
alter table public.preguntas   enable row level security;
alter table public.opciones    enable row level security;
alter table public.sesiones    enable row level security;
alter table public.intentos    enable row level security;
alter table public.srs_estado  enable row level security;
alter table public.reportes    enable row level security;

do $$
declare t text;
begin
  -- CRUD completo sobre las filas propias
  foreach t in array array['oposiciones','temas','documentos','materiales','preguntas','opciones','sesiones','reportes'] loop
    execute format('drop policy if exists "propias_select" on public.%I', t);
    execute format('drop policy if exists "propias_insert" on public.%I', t);
    execute format('drop policy if exists "propias_update" on public.%I', t);
    execute format('drop policy if exists "propias_delete" on public.%I', t);
    execute format('create policy "propias_select" on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "propias_insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "propias_update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "propias_delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- perfiles: la clave es id
drop policy if exists "perfil_select" on public.perfiles;
drop policy if exists "perfil_update" on public.perfiles;
create policy "perfil_select" on public.perfiles for select to authenticated using (id = auth.uid());
create policy "perfil_update" on public.perfiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- intentos: solo lectura e inserción (historial permanente)
drop policy if exists "intentos_select" on public.intentos;
drop policy if exists "intentos_insert" on public.intentos;
create policy "intentos_select" on public.intentos for select to authenticated using (user_id = auth.uid());
create policy "intentos_insert" on public.intentos for insert to authenticated with check (user_id = auth.uid());

-- trabajos: el usuario los crea y consulta; la Edge Function (service role) los actualiza.
drop policy if exists "trabajos_select" on public.trabajos;
drop policy if exists "trabajos_insert" on public.trabajos;
drop policy if exists "trabajos_update" on public.trabajos;
create policy "trabajos_select" on public.trabajos for select to authenticated using (user_id = auth.uid());
create policy "trabajos_insert" on public.trabajos for insert to authenticated with check (user_id = auth.uid());
create policy "trabajos_update" on public.trabajos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- srs_estado: solo lectura (lo mantiene el trigger)
drop policy if exists "srs_select" on public.srs_estado;
create policy "srs_select" on public.srs_estado for select to authenticated using (user_id = auth.uid());

-- =====================================================================
-- REPETICIÓN ESPACIADA · SM-2 adaptado a preguntas tipo test
--   calidad: fallo/blanco = 1 · acierto lento = 3 · acierto normal = 4 · acierto rápido = 5
--   la dificultad de la pregunta ajusta la facilidad inicial
-- =====================================================================
create or replace function public.srs_aplicar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s        public.srs_estado%rowtype;
  q        integer;
  nuevo_int numeric;
begin
  if new.pregunta_id is null then return new; end if;

  select * into s from srs_estado where user_id = new.user_id and pregunta_id = new.pregunta_id for update;
  if not found then
    s.user_id := new.user_id; s.pregunta_id := new.pregunta_id;
    s.repeticiones := 0; s.racha := 0; s.lapsos := 0; s.intervalo_dias := 0;
    s.facilidad := case coalesce(new.dificultad, 2) when 1 then 2.60 when 3 then 2.30 else 2.50 end;
  end if;

  -- Los intentos importados de la versión antigua se aplican en orden, sin fechas fiables
  if new.correcta then
    q := case
           when new.tiempo_ms is null then 4
           when new.tiempo_ms < 8000 then 5
           when new.tiempo_ms > 45000 then 3
           else 4 end;
    s.repeticiones := s.repeticiones + 1;
    s.racha := s.racha + 1;
    nuevo_int := case s.repeticiones
                   when 1 then 1
                   when 2 then 3
                   else greatest(s.intervalo_dias * s.facilidad, s.intervalo_dias + 1) end;
    s.facilidad := greatest(1.30, s.facilidad + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  else
    if s.repeticiones > 0 then s.lapsos := s.lapsos + 1; end if;
    s.repeticiones := 0;
    s.racha := 0;
    s.facilidad := greatest(1.30, s.facilidad - 0.20);
    nuevo_int := 0.007; -- ~10 minutos: vuelve a salir pronto
  end if;

  s.intervalo_dias := least(nuevo_int, 365);
  s.ultima_at := new.respondida_at;
  s.vencimiento := new.respondida_at + make_interval(secs => (s.intervalo_dias * 86400)::double precision);

  insert into srs_estado values (s.*)
  on conflict (user_id, pregunta_id) do update set
    repeticiones = excluded.repeticiones, racha = excluded.racha, lapsos = excluded.lapsos,
    facilidad = excluded.facilidad, intervalo_dias = excluded.intervalo_dias,
    vencimiento = excluded.vencimiento, ultima_at = excluded.ultima_at;
  return new;
end $$;

drop trigger if exists trg_srs on public.intentos;
create trigger trg_srs after insert on public.intentos
for each row execute function public.srs_aplicar();

-- =====================================================================
-- VISTAS DE ESTADÍSTICAS (calculadas a partir de los intentos; respetan RLS)
-- =====================================================================
create or replace view public.v_pregunta_stats with (security_invoker = on) as
with agg as (
  select i.pregunta_id,
         count(*) filter (where not i.en_blanco)                     as respondidas,
         count(*) filter (where i.correcta)                          as aciertos,
         count(*) filter (where not i.correcta and not i.en_blanco)  as fallos,
         count(*) filter (where i.en_blanco)                         as blancos,
         max(i.respondida_at)                                        as ultima_at,
         avg(i.tiempo_ms) filter (where i.tiempo_ms is not null)     as tiempo_medio_ms
  from public.intentos i
  where i.pregunta_id is not null
  group by i.pregunta_id
),
conf as (  -- la opción incorrecta que más veces se ha elegido
  select distinct on (pregunta_id) pregunta_id, opcion_id as opcion_confusa, n as veces_confusa
  from (
    select pregunta_id, opcion_id, count(*) as n
    from public.intentos
    where not correcta and opcion_id is not null and pregunta_id is not null
    group by pregunta_id, opcion_id
  ) x
  order by pregunta_id, n desc
)
select p.id as pregunta_id, p.user_id, p.oposicion_id, p.tema_id, p.dificultad, p.estado, p.favorita,
       coalesce(a.respondidas, 0) + coalesce(a.blancos, 0) as veces,
       coalesce(a.aciertos, 0)  as aciertos,
       coalesce(a.fallos, 0)    as fallos,
       coalesce(a.blancos, 0)   as blancos,
       case when coalesce(a.respondidas,0) + coalesce(a.blancos,0) > 0
            then round(100.0 * a.aciertos / (a.respondidas + a.blancos), 1) end as pct_acierto,
       a.ultima_at,
       round(a.tiempo_medio_ms)::int as tiempo_medio_ms,
       coalesce(s.racha, 0)     as racha,
       coalesce(s.lapsos, 0)    as lapsos,
       s.vencimiento,
       s.intervalo_dias,
       c.opcion_confusa,
       coalesce(c.veces_confusa, 0) as veces_confusa,
       case
         when coalesce(a.respondidas,0) + coalesce(a.blancos,0) = 0 then 'nunca'
         when s.racha >= 3 and a.aciertos >= 0.8 * (a.respondidas + a.blancos) then 'dominada'
         when (a.fallos + a.blancos) >= 3 and a.aciertos < 0.5 * (a.respondidas + a.blancos) then 'dificil'
         when s.racha >= 1 and a.aciertos >= 0.6 * (a.respondidas + a.blancos) then 'buen_nivel'
         else 'repasar'
       end as dominio,
       coalesce(t.archivado, false) as tema_archivado
from public.preguntas p
left join public.temas t on t.id = p.tema_id
left join agg a on a.pregunta_id = p.id
left join public.srs_estado s on s.pregunta_id = p.id and s.user_id = p.user_id
left join conf c on c.pregunta_id = p.id;

create or replace view public.v_tema_stats with (security_invoker = on) as
select t.id as tema_id, t.user_id, t.oposicion_id, t.numero, t.titulo, t.orden, t.archivado,
       count(ps.pregunta_id) filter (where ps.estado = 'activa')                         as preguntas_activas,
       count(ps.pregunta_id) filter (where ps.estado = 'borrador')                       as preguntas_borrador,
       count(ps.pregunta_id) filter (where ps.estado = 'activa' and ps.veces > 0)        as preguntas_respondidas,
       coalesce(sum(ps.veces), 0)    as intentos,
       coalesce(sum(ps.aciertos), 0) as aciertos,
       coalesce(sum(ps.fallos), 0)   as fallos,
       coalesce(sum(ps.blancos), 0)  as blancos,
       case when sum(ps.veces) > 0 then round(100.0 * sum(ps.aciertos) / sum(ps.veces), 1) end as pct_acierto,
       count(*) filter (where ps.estado = 'activa' and ps.dominio = 'dominada')   as dominadas,
       count(*) filter (where ps.estado = 'activa' and ps.dominio = 'buen_nivel') as buen_nivel,
       count(*) filter (where ps.estado = 'activa' and ps.dominio = 'repasar')    as repasar,
       count(*) filter (where ps.estado = 'activa' and ps.dominio = 'dificil')    as dificiles,
       count(*) filter (where ps.estado = 'activa' and ps.dominio = 'nunca')      as nunca,
       -- Dominio estimado 0-100: dominada=100, buen nivel=70, repasar=35, difícil=10, nunca=0
       case when count(*) filter (where ps.estado = 'activa') > 0 then round(
         (100 * count(*) filter (where ps.estado='activa' and ps.dominio='dominada')
         + 70 * count(*) filter (where ps.estado='activa' and ps.dominio='buen_nivel')
         + 35 * count(*) filter (where ps.estado='activa' and ps.dominio='repasar')
         + 10 * count(*) filter (where ps.estado='activa' and ps.dominio='dificil'))::numeric
         / count(*) filter (where ps.estado='activa'), 0) end as dominio_estimado,
       max(ps.ultima_at) as ultima_at
from public.temas t
left join public.v_pregunta_stats ps on ps.tema_id = t.id
group by t.id;

create or replace view public.v_sesiones_resumen with (security_invoker = on) as
select s.id, s.user_id, s.oposicion_id, s.tipo, s.config, s.estado, s.iniciada_at, s.finalizada_at,
       coalesce(s.duracion_seg, extract(epoch from (s.finalizada_at - s.iniciada_at))::int) as duracion_seg,
       cardinality(s.pregunta_ids) as num_preguntas,
       count(i.id) filter (where i.correcta)                           as aciertos,
       count(i.id) filter (where not i.correcta and not i.en_blanco)   as errores,
       cardinality(s.pregunta_ids)
         - count(i.id) filter (where i.correcta)
         - count(i.id) filter (where not i.correcta and not i.en_blanco) as blancos,
       coalesce((s.config->>'penalizacion')::numeric, 0) as penalizacion,
       case when cardinality(s.pregunta_ids) > 0 then round(10.0 * greatest(0,
           count(i.id) filter (where i.correcta)
           - coalesce((s.config->>'penalizacion')::numeric, 0) * count(i.id) filter (where not i.correcta and not i.en_blanco)
         ) / cardinality(s.pregunta_ids), 2) end as nota
from public.sesiones s
left join public.intentos i on i.sesion_id = s.id
group by s.id;

-- =====================================================================
-- FUNCIONES (RPC) · se ejecutan con los permisos del usuario (RLS activo)
-- =====================================================================

-- Guarda una pregunta con sus opciones de forma atómica, validando que haya exactamente una correcta.
-- Conserva los IDs de opciones existentes para no romper el historial.
create or replace function public.guardar_pregunta(p jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id','')::uuid;
  v_ops jsonb := p->'opciones';
  v_correctas int;
  v_keep uuid[] := '{}';
  o jsonb; v_oid uuid; i int := 0;
begin
  if v_ops is null or jsonb_array_length(v_ops) < 2 then
    raise exception 'La pregunta necesita al menos 2 opciones';
  end if;
  select count(*) into v_correctas from jsonb_array_elements(v_ops) e where (e->>'es_correcta')::boolean;
  -- Un borrador importado puede no tener respuesta identificada; una pregunta activa necesita exactamente una.
  if v_correctas > 1 or (v_correctas = 0 and coalesce(p->>'estado', 'activa') <> 'borrador') then
    raise exception 'Debe haber exactamente una opción correcta';
  end if;

  if v_id is null then
    insert into preguntas (oposicion_id, tema_id, documento_id, trabajo_id, enunciado, explicacion, fuente, aviso,
                           dificultad, origen, estado, favorita, legacy_id)
    values ((p->>'oposicion_id')::uuid, nullif(p->>'tema_id','')::uuid, nullif(p->>'documento_id','')::uuid,
            nullif(p->>'trabajo_id','')::uuid, p->>'enunciado', p->>'explicacion', p->>'fuente', p->>'aviso',
            coalesce((p->>'dificultad')::smallint, 2), coalesce(p->>'origen','manual'),
            coalesce(p->>'estado','activa'), coalesce((p->>'favorita')::boolean, false), p->>'legacy_id')
    returning id into v_id;
  else
    update preguntas set
      tema_id     = nullif(p->>'tema_id','')::uuid,
      enunciado   = p->>'enunciado',
      explicacion = p->>'explicacion',
      fuente      = p->>'fuente',
      aviso       = p->>'aviso',
      dificultad  = coalesce((p->>'dificultad')::smallint, dificultad),
      estado      = coalesce(p->>'estado', estado),
      favorita    = coalesce((p->>'favorita')::boolean, favorita),
      version     = version + 1
    where id = v_id;
    if not found then raise exception 'Pregunta no encontrada'; end if;
  end if;

  for o in select * from jsonb_array_elements(v_ops) loop
    v_oid := nullif(o->>'id','')::uuid;
    if v_oid is not null and exists (select 1 from opciones where id = v_oid and pregunta_id = v_id) then
      update opciones set texto = o->>'texto', es_correcta = coalesce((o->>'es_correcta')::boolean,false),
                          explicacion = o->>'explicacion', orden = i
      where id = v_oid;
    else
      insert into opciones (pregunta_id, orden, texto, es_correcta, explicacion)
      values (v_id, i, o->>'texto', coalesce((o->>'es_correcta')::boolean,false), o->>'explicacion')
      returning id into v_oid;
    end if;
    v_keep := v_keep || v_oid;
    i := i + 1;
  end loop;
  delete from opciones where pregunta_id = v_id and not (id = any(v_keep));
  return v_id;
end $$;

-- Inserta muchas preguntas a la vez (importación / IA / banco antiguo)
create or replace function public.guardar_preguntas_lote(lista jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare e jsonb; n int := 0;
begin
  for e in select * from jsonb_array_elements(lista) loop
    if e->>'legacy_id' is not null and exists (
         select 1 from preguntas where legacy_id = e->>'legacy_id'
           and oposicion_id = (e->>'oposicion_id')::uuid and user_id = auth.uid()) then
      continue;
    end if;
    perform public.guardar_pregunta(e);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Activa borradores revisados (solo los que tienen exactamente una opción correcta)
create or replace function public.activar_preguntas(ids uuid[])
returns integer language sql security invoker set search_path = public as $$
  with ok as (
    select p.id from preguntas p
    where p.id = any(ids)
      and (select count(*) from opciones o where o.pregunta_id = p.id and o.es_correcta) = 1
      and (select count(*) from opciones o where o.pregunta_id = p.id) >= 2
  ), upd as (
    update preguntas set estado = 'activa' where id in (select id from ok) returning 1
  ) select count(*)::int from upd;
$$;

-- Selección de preguntas para práctica y simulacros.
-- Reparte las preguntas entre los temas elegidos (round-robin aleatorio) para cubrir todo el temario.
create or replace function public.seleccionar_preguntas(
  p_oposicion uuid,
  p_temas uuid[] default null,
  p_dificultades int[] default null,
  p_n int default 20,
  p_modo text default 'aleatorio'   -- aleatorio | falladas | no_respondidas | favoritas
) returns setof uuid language sql stable security invoker set search_path = public as $$
  with base as (
    select ps.*
    from v_pregunta_stats ps
    where ps.oposicion_id = p_oposicion
      and ps.estado = 'activa'
      and not ps.tema_archivado
      and (p_temas is null or cardinality(p_temas) = 0 or ps.tema_id = any(p_temas))
      and (p_dificultades is null or cardinality(p_dificultades) = 0 or ps.dificultad = any(p_dificultades))
      and case p_modo
            when 'falladas' then ps.fallos > 0
            when 'no_respondidas' then ps.veces = 0
            when 'favoritas' then ps.favorita
            else true end
  ),
  ordenadas as (
    select pregunta_id,
           row_number() over (partition by tema_id order by
             case when p_modo = 'falladas' then -(ps2.fallos::numeric / greatest(ps2.veces,1)) - random()*0.3 else random() end
           ) as rn
    from base ps2
  )
  select pregunta_id from ordenadas order by rn, random() limit greatest(p_n, 1);
$$;

-- Repaso inteligente: prioriza vencidas, falladas, confundidas, nunca vistas y temas flojos.
create or replace function public.seleccionar_repaso(
  p_oposicion uuid,
  p_n int default 20,
  p_temas uuid[] default null
) returns table (pregunta_id uuid, prioridad numeric, motivo text)
language sql stable security invoker set search_path = public as $$
  with tema_pct as (
    select tema_id, coalesce(pct_acierto, 50) as pct from v_tema_stats where oposicion_id = p_oposicion
  ),
  base as (
    select ps.*, coalesce(tp.pct, 50) as tema_pct
    from v_pregunta_stats ps
    left join tema_pct tp on tp.tema_id = ps.tema_id
    where ps.oposicion_id = p_oposicion and ps.estado = 'activa' and not ps.tema_archivado
      and (p_temas is null or cardinality(p_temas) = 0 or ps.tema_id = any(p_temas))
  ),
  puntuada as (
    select b.pregunta_id,
      ( case when b.veces = 0 then 3.0 else 0 end
      + case when b.vencimiento is not null and b.vencimiento <= now()
             then 2.0 + least(extract(epoch from now() - b.vencimiento) / 86400.0, 10) * 0.3 else 0 end
      + least(b.fallos, 6) * 1.2
      + case when b.veces > 0 then (100 - coalesce(b.pct_acierto, 0)) / 25.0 else 0 end
      + least(b.veces_confusa, 4) * 0.8
      + (100 - b.tema_pct) / 35.0
      + case when b.ultima_at is not null then least(extract(epoch from now() - b.ultima_at) / 86400.0 / 7, 3) else 0 end
      + b.dificultad * 0.2
      - case when b.dominio = 'dominada' and (b.vencimiento is null or b.vencimiento > now()) then 6 else 0 end
      + random() * 0.6
      )::numeric(8,2) as prioridad,
      case
        when b.veces = 0 then 'Nunca respondida'
        when b.dominio = 'dificil' then 'Fallada varias veces'
        when b.veces_confusa >= 2 then 'Sueles confundirla'
        when b.vencimiento <= now() then 'Toca repasarla'
        when b.ultima_at < now() - interval '14 days' then 'Hace tiempo que no la ves'
        else 'Tema con menor acierto'
      end as motivo
    from base b
  )
  select pregunta_id, prioridad, motivo from puntuada order by prioridad desc limit greatest(p_n, 1);
$$;

-- Resumen general del usuario para una oposición
create or replace function public.resumen_oposicion(p_oposicion uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'intentos',   (select count(*) from intentos where oposicion_id = p_oposicion),
    'aciertos',   (select count(*) from intentos where oposicion_id = p_oposicion and correcta),
    'fallos',     (select count(*) from intentos where oposicion_id = p_oposicion and not correcta and not en_blanco),
    'blancos',    (select count(*) from intentos where oposicion_id = p_oposicion and en_blanco),
    'simulacros', (select count(*) from sesiones where oposicion_id = p_oposicion and tipo = 'simulacro' and estado = 'finalizada'),
    'tiempo_seg', coalesce((select sum(coalesce(duracion_seg, extract(epoch from (finalizada_at - iniciada_at))::int))
                            from sesiones where oposicion_id = p_oposicion and finalizada_at is not null), 0),
    'preguntas_activas', (select count(*) from preguntas where oposicion_id = p_oposicion and estado = 'activa'),
    'borradores', (select count(*) from preguntas where oposicion_id = p_oposicion and estado = 'borrador'),
    'pendientes_hoy', (select count(*) from v_pregunta_stats where oposicion_id = p_oposicion and estado = 'activa'
                         and not tema_archivado and (vencimiento <= now() or veces = 0)),
    'dominio', (select jsonb_object_agg(dominio, n) from (
                  select dominio, count(*) n from v_pregunta_stats
                  where oposicion_id = p_oposicion and estado = 'activa' and not tema_archivado group by dominio) d),
    'dias_estudio', (select count(distinct (respondida_at at time zone 'Europe/Madrid')::date)
                     from intentos where oposicion_id = p_oposicion and not importado),
    'racha_dias', (
       with dias as (select distinct (respondida_at at time zone 'Europe/Madrid')::date d
                     from intentos where oposicion_id = p_oposicion and not importado),
       g as (select d, d - (row_number() over (order by d))::int as grp from dias)
       select coalesce(max(cnt), 0) from (
         select grp, count(*) cnt, max(d) ultimo from g group by grp
       ) x where ultimo >= (now() at time zone 'Europe/Madrid')::date - 1)
  );
$$;

-- Evolución diaria del porcentaje de acierto (opcionalmente de un tema)
drop function if exists public.evolucion_diaria(uuid, int);
create or replace function public.evolucion_diaria(p_oposicion uuid, p_dias int default 60, p_tema uuid default null)
returns table (dia date, intentos bigint, aciertos bigint, errores bigint, blancos bigint, pct numeric)
language sql stable security invoker set search_path = public as $$
  select (respondida_at at time zone 'Europe/Madrid')::date as dia,
         count(*), count(*) filter (where correcta),
         count(*) filter (where not correcta and not en_blanco),
         count(*) filter (where en_blanco),
         round(100.0 * count(*) filter (where correcta) / count(*), 1)
  from intentos
  where oposicion_id = p_oposicion and not importado
    and (p_tema is null or tema_id = p_tema)
    and respondida_at >= now() - make_interval(days => p_dias)
  group by 1 order by 1;
$$;

-- Vista para el banco de preguntas: contenido + estadísticas + reportes abiertos
create or replace view public.v_banco with (security_invoker = on) as
select p.id, p.user_id, p.oposicion_id, p.tema_id, p.documento_id, p.trabajo_id, p.enunciado, p.explicacion,
       p.fuente, p.aviso, p.dificultad, p.origen, p.estado, p.favorita, p.created_at, p.updated_at, p.busqueda,
       ps.veces, ps.aciertos, ps.fallos, ps.blancos, ps.pct_acierto, ps.ultima_at, ps.racha, ps.dominio,
       ps.vencimiento, ps.veces_confusa,
       (select count(*) from public.reportes r where r.pregunta_id = p.id and not r.resuelto) as reportes_abiertos
from public.preguntas p
join public.v_pregunta_stats ps on ps.pregunta_id = p.id;

-- Reserva atómica de un paso de un trabajo de IA (solo la Edge Function con service_role)
create or replace function public.reclamar_trabajo(p_id uuid, p_segundos int default 170)
returns setof public.trabajos language sql security definer set search_path = public as $$
  update trabajos
     set estado = 'procesando', bloqueado_hasta = now() + make_interval(secs => p_segundos)
   where id = p_id
     and estado in ('pendiente', 'procesando')
     and (bloqueado_hasta is null or bloqueado_hasta < now())
  returning *;
$$;

-- Permisos para el rol autenticado
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.v_pregunta_stats, public.v_tema_stats, public.v_sesiones_resumen, public.v_banco to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke execute on function public.reclamar_trabajo(uuid, int) from public, anon, authenticated;
grant execute on function public.reclamar_trabajo(uuid, int) to service_role;
