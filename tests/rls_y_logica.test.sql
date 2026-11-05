\set ON_ERROR_STOP 1
-- Usuarios de prueba
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-00000000000a','ander@test.com'),
 ('00000000-0000-0000-0000-00000000000b','prima@test.com') on conflict do nothing;

create or replace function pg_temp.como(uid text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); execute 'set role authenticated'; end $$;
create temp table r(k text, v text); grant all on r to authenticated;

-- ===== Usuario A crea su oposición, tema y preguntas
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into oposiciones(id,nombre) values ('10000000-0000-0000-0000-00000000000a','Ingenieros Industriales');
insert into temas(id,oposicion_id,numero,titulo) values ('20000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a',1,'Constitución');
insert into temas(id,oposicion_id,numero,titulo) values ('20000000-0000-0000-0000-0000000000a2','10000000-0000-0000-0000-00000000000a',2,'Economía');
select guardar_pregunta(jsonb_build_object('oposicion_id','10000000-0000-0000-0000-00000000000a','tema_id','20000000-0000-0000-0000-00000000000a',
  'enunciado','¿Capital de España?','dificultad',1,'opciones',jsonb_build_array(
   jsonb_build_object('texto','Madrid','es_correcta',true), jsonb_build_object('texto','Sevilla','es_correcta',false),
   jsonb_build_object('texto','Bilbao','es_correcta',false)))) \gset q1_
insert into r select 'q1', :'q1_guardar_pregunta';
-- validación: dos correctas debe fallar
do $$ begin
  perform guardar_pregunta('{"oposicion_id":"10000000-0000-0000-0000-00000000000a","enunciado":"x","opciones":[{"texto":"a","es_correcta":true},{"texto":"b","es_correcta":true}]}');
  raise exception 'FALLO: aceptó dos correctas';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; end $$;
-- 25 preguntas más en 2 temas
select guardar_pregunta(jsonb_build_object('oposicion_id','10000000-0000-0000-0000-00000000000a',
  'tema_id', case when g%2=0 then '20000000-0000-0000-0000-00000000000a' else '20000000-0000-0000-0000-0000000000a2' end,
  'enunciado','Pregunta '||g,'dificultad',1+g%3,'opciones',jsonb_build_array(
   jsonb_build_object('texto','ok','es_correcta',true), jsonb_build_object('texto','no','es_correcta',false))))
from generate_series(1,25) g;

-- Sesión y respuestas: q1 acertada 3 veces => dominada; otra fallada 3 veces => difícil
insert into sesiones(id,oposicion_id,tipo,pregunta_ids,config) values
 ('30000000-0000-0000-0000-00000000000a','10000000-0000-0000-0000-00000000000a','simulacro',
  array[(select v::uuid from r where k='q1')], '{"penalizacion":0.333}');
insert into intentos(oposicion_id,pregunta_id,tema_id,sesion_id,opcion_id,correcta,tiempo_ms)
select '10000000-0000-0000-0000-00000000000a', p.id, p.tema_id, '30000000-0000-0000-0000-00000000000a', o.id, true, 5000
from preguntas p join opciones o on o.pregunta_id=p.id and o.es_correcta where p.enunciado='¿Capital de España?';
insert into intentos(oposicion_id,pregunta_id,tema_id,opcion_id,correcta,tiempo_ms)
select '10000000-0000-0000-0000-00000000000a', p.id, p.tema_id, o.id, true, 6000
from preguntas p join opciones o on o.pregunta_id=p.id and o.es_correcta, generate_series(1,2) where p.enunciado='¿Capital de España?';
insert into intentos(oposicion_id,pregunta_id,tema_id,opcion_id,correcta,tiempo_ms)
select '10000000-0000-0000-0000-00000000000a', p.id, p.tema_id, o.id, false, 20000
from preguntas p join opciones o on o.pregunta_id=p.id and not o.es_correcta, generate_series(1,3) where p.enunciado='Pregunta 1';

do $$ declare d text; s record; begin
  select dominio into d from v_pregunta_stats ps join preguntas p on p.id=ps.pregunta_id where p.enunciado='¿Capital de España?';
  if d <> 'dominada' then raise exception 'FALLO dominio q1 = %', d; end if;
  select dominio into d from v_pregunta_stats ps join preguntas p on p.id=ps.pregunta_id where p.enunciado='Pregunta 1';
  if d <> 'dificil' then raise exception 'FALLO dominio P1 = %', d; end if;
  select * into s from srs_estado st join preguntas p on p.id=st.pregunta_id where p.enunciado='¿Capital de España?';
  if s.repeticiones <> 3 or s.intervalo_dias < 5 then raise exception 'FALLO SRS acierto %', row_to_json(s); end if;
  select * into s from srs_estado st join preguntas p on p.id=st.pregunta_id where p.enunciado='Pregunta 1';
  if s.vencimiento > now() + interval '1 hour' or s.facilidad > 2.0 then raise exception 'FALLO SRS fallo %', row_to_json(s); end if;
  select veces_confusa into d from v_pregunta_stats ps join preguntas p on p.id=ps.pregunta_id where p.enunciado='Pregunta 1';
  if d::int <> 3 then raise exception 'FALLO confusión %', d; end if;
  select nota into d from v_sesiones_resumen where id='30000000-0000-0000-0000-00000000000a';
  if d::numeric <> 10 then raise exception 'FALLO nota %', d; end if;
  raise notice 'OK estadísticas, dominio, SRS, confusión y nota';
end $$;

-- Selección: sin repetidas, reparto por temas, filtro dificultad
do $$ declare n int; nd int; t1 int; t2 int; begin
  select count(*), count(distinct x) into n, nd from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, null, 10) x;
  if n<>10 or nd<>10 then raise exception 'FALLO selección % %', n, nd; end if;
  select count(*) filter (where p.tema_id='20000000-0000-0000-0000-00000000000a'), count(*) filter (where p.tema_id='20000000-0000-0000-0000-0000000000a2')
    into t1,t2 from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, null, 10) x join preguntas p on p.id=x;
  if abs(t1-t2) > 1 then raise exception 'FALLO reparto % %', t1, t2; end if;
  select count(*) into n from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, array[1], 100) x join preguntas p on p.id=x where p.dificultad<>1;
  if n<>0 then raise exception 'FALLO filtro dificultad'; end if;
  select count(*) into n from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, null, 100, 'falladas');
  if n<>1 then raise exception 'FALLO modo falladas %', n; end if;
  select count(*) into n from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, null, 1000);
  if n<>26 then raise exception 'FALLO total %', n; end if;
  raise notice 'OK selección sin repetidas y repartida por temas';
end $$;

-- Repaso: la difícil va antes que la dominada
do $$ declare top uuid; pos_dom int; begin
  select pregunta_id into top from seleccionar_repaso('10000000-0000-0000-0000-00000000000a', 1);
  if (select enunciado from preguntas where id=top) <> 'Pregunta 1' then raise exception 'FALLO repaso top=%', (select enunciado from preguntas where id=top); end if;
  select rn into pos_dom from (select pregunta_id, row_number() over () rn from seleccionar_repaso('10000000-0000-0000-0000-00000000000a', 100)) z
    join preguntas p on p.id=z.pregunta_id where p.enunciado='¿Capital de España?';
  if pos_dom < 20 then raise exception 'FALLO dominada demasiado arriba %', pos_dom; end if;
  raise notice 'OK repaso inteligente';
end $$;

-- Edición conserva IDs de opciones y el historial
do $$ declare pid uuid; oid uuid; antes int; despues int; begin
  select id into pid from preguntas where enunciado='¿Capital de España?';
  select id into oid from opciones where pregunta_id=pid and es_correcta;
  select count(*) into antes from intentos where pregunta_id=pid;
  perform guardar_pregunta(jsonb_build_object('id',pid,'enunciado','¿Cuál es la capital de España? (corregida)','tema_id','20000000-0000-0000-0000-00000000000a',
    'opciones', jsonb_build_array(jsonb_build_object('id',oid,'texto','Madrid','es_correcta',true), jsonb_build_object('texto','Toledo','es_correcta',false))));
  select count(*) into despues from intentos where pregunta_id=pid and opcion_id=oid;
  if despues <> antes then raise exception 'FALLO historial tras editar % %', antes, despues; end if;
  raise notice 'OK edición sin perder historial';
end $$;

-- Intentos inmutables
update intentos set correcta = true where not correcta;
do $$ begin if exists (select 1 from intentos where not correcta) then raise notice 'OK intentos no modificables'; else raise exception 'FALLO intentos modificados'; end if; end $$;
delete from intentos;
do $$ begin if (select count(*) from intentos) > 0 then raise notice 'OK intentos no borrables'; else raise exception 'FALLO intentos borrados'; end if; end $$;

select jsonb_pretty(resumen_oposicion('10000000-0000-0000-0000-00000000000a'));
reset role;

-- ===== Usuario B no ve nada de A ni puede inyectar
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
do $$ declare n int; begin
  select (select count(*) from oposiciones)+(select count(*) from temas)+(select count(*) from preguntas)+(select count(*) from opciones)
        +(select count(*) from intentos)+(select count(*) from sesiones)+(select count(*) from srs_estado)+(select count(*) from v_pregunta_stats)
        +(select count(*) from v_tema_stats)+(select count(*) from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a',null,null,50)) into n;
  if n <> 0 then raise exception 'FALLO: B ve % filas de A', n; end if;
  raise notice 'OK aislamiento de lectura';
end $$;
update preguntas set enunciado='hack';
delete from temas;
do $$ begin
  insert into temas(oposicion_id,titulo) values ('10000000-0000-0000-0000-00000000000a','intruso');
  raise exception 'FALLO: B creó tema en oposición de A';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'OK no puede escribir en datos ajenos (%).', sqlerrm; end $$;
insert into oposiciones(id,nombre) values ('10000000-0000-0000-0000-00000000000b','OPE Sanidad');
do $$ begin
  insert into temas(oposicion_id,titulo,user_id) values ('10000000-0000-0000-0000-00000000000b','x','00000000-0000-0000-0000-00000000000a');
  raise exception 'FALLO: B suplantó user_id';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'OK no puede suplantar user_id'; end $$;
-- storage
do $$ begin
  insert into storage.objects(bucket_id,name) values ('documentos','00000000-0000-0000-0000-00000000000a/robo.pdf');
  raise exception 'FALLO storage ajeno';
exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'OK storage: no puede subir a la carpeta de otro'; end $$;
insert into storage.objects(bucket_id,name) values ('documentos','00000000-0000-0000-0000-00000000000b/tema1.pdf');
reset role;
do $$ begin
  if (select count(*) from preguntas where enunciado='hack')>0 or (select count(*) from temas where user_id='00000000-0000-0000-0000-00000000000a')<>2
  then raise exception 'FALLO: B modificó datos de A'; end if;
  raise notice 'OK B no pudo modificar ni borrar datos de A';
end $$;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
do $$ begin if (select count(*) from storage.objects)<>0 then raise exception 'FALLO A ve ficheros de B'; end if; raise notice 'OK storage aislado'; end $$;
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
update temas set archivado = true where id='20000000-0000-0000-0000-0000000000a2';
do $$ declare n int; begin
  select count(*) into n from seleccionar_preguntas('10000000-0000-0000-0000-00000000000a', null, null, 1000) x join preguntas p on p.id=x where p.tema_id='20000000-0000-0000-0000-0000000000a2';
  if n<>0 then raise exception 'FALLO: salen preguntas de tema archivado'; end if;
  select count(*) into n from intentos where tema_id='20000000-0000-0000-0000-0000000000a2';
  if n=0 then raise exception 'FALLO: se perdió el historial del tema archivado'; end if;
  raise notice 'OK tema archivado: fuera de exámenes, historial conservado';
end $$;
-- borrador sin correcta permitido; activar_preguntas lo rechaza
do $$ declare pid uuid; n int; begin
  pid := guardar_pregunta('{"oposicion_id":"10000000-0000-0000-0000-00000000000a","estado":"borrador","enunciado":"sin correcta","opciones":[{"texto":"a","es_correcta":false},{"texto":"b","es_correcta":false}]}');
  n := activar_preguntas(array[pid]);
  if n<>0 then raise exception 'FALLO activó sin correcta'; end if;
  raise notice 'OK borrador sin correcta no se activa';
end $$;
-- banco view & lote con legacy (no duplica)
do $$ declare n int; begin
  n := guardar_preguntas_lote('[{"oposicion_id":"10000000-0000-0000-0000-00000000000a","legacy_id":"L1","enunciado":"leg","opciones":[{"texto":"a","es_correcta":true},{"texto":"b"}]}]');
  n := n + guardar_preguntas_lote('[{"oposicion_id":"10000000-0000-0000-0000-00000000000a","legacy_id":"L1","enunciado":"leg","opciones":[{"texto":"a","es_correcta":true},{"texto":"b"}]}]');
  if n<>1 then raise exception 'FALLO lote legacy %', n; end if;
  select count(*) into n from v_banco where enunciado ilike '%capital%';
  if n<>1 then raise exception 'FALLO v_banco'; end if;
  perform * from evolucion_diaria('10000000-0000-0000-0000-00000000000a', 30, null);
  raise notice 'OK lote sin duplicados, v_banco y evolución';
end $$;
