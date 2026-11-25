-- 0716 · DGG-269 F1 — Captación Federal (segmento `import_nacional`).
-- Completa el hueco de DGG-267: los ~10.249 contactos de los Excel (CABA/PBA-no-padrón/OTRO)
-- estaban SOLO en LexPH, sin superficie de captación para campañas targeteadas (webinars,
-- consultoría, curso RPA CABA). Esto agrega el CRM federal: flag + helper de nombre + RPCs
-- (kpis/list/preview/enviar). Espeja la mecánica PBA (supresión global `email_esta_suprimido`,
-- anti-fatiga 30d gracia / 90d cooldown vía prospecto_mails, encola a email_queue prioridad 8 →
-- el dispatcher le pone goteo/UTM/List-Unsubscribe), PERO segmenta por JURISDICCIÓN (no por
-- vencimiento de matrícula, que no aplica a CABA/nacional) y encola con goteo por días.
-- ENVÍO GATEADO por `federal_campanas_activo` (default FALSE): nada sale hasta prenderlo
-- (idealmente con el carril SES vivo, DGG-268, para no cargar la reputación transaccional).

-- ───────────────────────── flag de gate ─────────────────────────
alter table public.config_global
  add column if not exists federal_campanas_activo boolean not null default false;
comment on column public.config_global.federal_campanas_activo is
  'DGG-269: gate del envío de Captación Federal (import_nacional). OFF por defecto; prender recién con el carril SES vivo (DGG-268).';

-- ───────────── helper: nombre de pila para formato "APELLIDO NOMBRES" ─────────────
-- prospecto_nombre_pila devuelve el primer token no-descartado → con surname-first (CABA)
-- devolvería el apellido. Este escanea TODOS los tokens y devuelve el PRIMERO que sea un
-- nombre de pila conocido (mismo diccionario). Sin match → NULL (el caller saluda genérico).
create or replace function public.nombre_pila_federal(p_nombre text)
returns text language plpgsql immutable set search_path to 'public','pg_temp'
as $fn$
declare
  v_tokens text[]; v_tok text; v_norm text; i int;
  v_fn text[] := array[
    'maria','ana','laura','lucia','sofia','paula','julia','carla','sara','elena','clara','nora',
    'rosa','rita','eva','ines','irene','nadia','vera','lara','mia','emma','abril','alma','aldana',
    'agustina','antonella','araceli','ariana','ariadna','ayelen','belen','brenda','camila','carolina',
    'catalina','cecilia','celeste','celina','cintia','cinthia','claudia','constanza','cristina','daiana',
    'dana','debora','deborah','delfina','denise','denisa','diana','dolores','elisa','elizabeth','eliana',
    'emilia','erika','erica','estefania','estela','ester','esther','eugenia','evangelina','fabiana','fatima',
    'fernanda','flavia','florencia','francisca','gabriela','georgina','gimena','gisela','giselle','gladys',
    'gladis','gloria','graciela','guadalupe','ivana','jazmin','jesica','jessica','jaqueline','jacqueline',
    'jimena','johana','johanna','jorgelina','josefina','juana','karen','karina','leticia','lidia','liliana',
    'lorena','lourdes','luciana','lucrecia','ludmila','lujan','luz','magali','magdalena','malena','mara',
    'marcela','margarita','mariana','marianela','maricel','mariela','marina','marisa','marta','martina',
    'melania','melina','melisa','mercedes','micaela','milagros','miranda','mirta','monica','morena','nancy',
    'natalia','natasha','nayla','nelida','nicole','noelia','noemi','norma','nuria','olga','ornella','pamela',
    'paola','patricia','paz','pia','pilar','priscila','rafaela','ramona','raquel','rebeca','regina','renata',
    'roberta','rocio','romina','rosana','rosario','roxana','ruth','sabrina','salome','samanta','samantha',
    'sandra','selena','selene','silvana','silvia','sol','solange','soledad','sonia','stella','susana','tamara',
    'tatiana','teresa','trinidad','valentina','valeria','vanesa','vanessa','veronica','victoria','violeta',
    'viridiana','virginia','viviana','wanda','yamila','yanina','yesica','yohana','zoe','beatriz','berta',
    'betina','bettina','blanca','brisa','carmen','dora','edith','emilce','ethel','haydee','hilda','josefa',
    'juliana','miriam','myriam','perla','aurora','elsa','adriana','alicia','alejandra','andrea','analia',
    'mabel','marcia','nidia','ivonne','yolanda','griselda','elvira','nilda','teresita','lucila','isabel',
    'astrid','amalia','delma','elda','abigail','aixa','antonia','barbara','carmela','daniela','daniella',
    'elina','evelin','evelyn','fabiola','gilda','guillermina','ileana','ilda','julieta','laila','leonela',
    'lia','maia','maite','manuela','marcelina','mayra','milena','nahir','nerina','olivia','rosalia','susan',
    'vilma','xiomara','yael','zulma','mirna','marien','rosaura','marisol','fiorella','matilde','luisa',
    'juan','jose','luis','carlos','jorge','miguel','angel','pedro','pablo','diego','mario','raul','ruben',
    'hugo','oscar','hector','daniel','david','marcos','marco','martin','nestor','roberto','ricardo','rodolfo',
    'ramon','sergio','javier','fabian','fernando','gabriel','gaston','german','gonzalo','gustavo','horacio',
    'ignacio','ivan','joaquin','kevin','leandro','leonardo','lucas','luciano','marcelo','mariano','matias',
    'mauricio','mauro','maximiliano','nahuel','nicolas','octavio','omar','pascual','patricio','rafael','ramiro',
    'enzo','emanuel','emmanuel','emiliano','esteban','eduardo','elias','enrique','ezequiel','facundo','federico',
    'felipe','francisco','franco','bruno','benjamin','bautista','agustin','alan','alberto','aldo','alejandro',
    'alex','alexis','alfredo','alvaro','andres','antonio','ariel','arturo','augusto','aaron','abel','adrian',
    'adolfo','braian','brian','cesar','cristian','christian','cristobal','claudio','damian','dario','dante',
    'dylan','dilan','dionisio','domingo','dositeo','fabio','fabricio','favio','felix','fidel','fredy','gaspar',
    'genaro','geronimo','gino','guillermo','guido','heriberto','hernan','isaac','isidro','ismael','jairo',
    'jonas','jonatan','jonathan','josue','julian','julio','lautaro','lino','lisandro','lorenzo','manuel',
    'mateo','matheo','maximo','nazareno','nehuen','nelson','norberto','osvaldo','rodrigo','rolando','salvador',
    'samuel','santiago','santino','saul','sebastian','simon','teo','teodoro','thiago','tiziano','tomas',
    'ulises','uriel','valentin','valentino','vicente','victor','walter','walther','wilson','yago','abelardo',
    'anibal','aquiles','baltasar','camilo','ciro','conrado','edgar','edgardo','efrain','eloy',
    'ernesto','eugenio','evaristo','ezio','fausto','gerardo','gregorio','homero','humberto','ibrahim','jacinto',
    'jaime','jeremias','jesus','joel','justo','leon','leonel','lucio','marcial','marcelino','matteo','moises',
    'nicanor','orlando','placido','primo','reinaldo','remo','renato','rene','rogelio','romeo','santos','sixto',
    'teofilo','ubaldo','valerio','venancio','vidal','virgilio','wenceslao','zacarias'];
begin
  if p_nombre is null or btrim(p_nombre) = '' then return null; end if;
  v_tokens := string_to_array(btrim(regexp_replace(p_nombre, '\s+', ' ', 'g')), ' ');
  for i in 1 .. coalesce(array_length(v_tokens, 1), 0) loop
    v_tok := v_tokens[i];
    v_norm := regexp_replace(
                translate(lower(v_tok),'áàäâãéèëêíìïîóòöôõúùüûñç','aaaaaeeeeiiiiooooouuuunc'),
                '[^a-z]', '', 'g');
    if v_norm <> '' and v_norm = any (v_fn) then
      return initcap(regexp_replace(v_tok, '[^[:alpha:]áàäâãéèëêíìïîóòöôõúùüûñçÁÉÍÓÚÑ]', '', 'g'));
    end if;
  end loop;
  return null;
end $fn$;

-- ───────────────────────── KPIs del universo federal ─────────────────────────
create or replace function public.prospectos_federal_kpis()
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; v_res jsonb;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  with base as (
    select p.*, public.email_esta_suprimido(p.email) as suprimido,
           (p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid') as email_ok
    from public.prospectos p where p.origen = 'import_nacional'
  )
  select jsonb_build_object(
    'total',        count(*),
    'caba',         count(*) filter (where jurisdiccion = 'CABA'),
    'pba',          count(*) filter (where jurisdiccion = 'PBA'),
    'otro',         count(*) filter (where jurisdiccion is distinct from 'CABA' and jurisdiccion is distinct from 'PBA'),
    'con_email',    count(*) filter (where email_ok),
    'suprimidos',   count(*) filter (where suprimido),
    'contactados',  count(*) filter (where ultimo_mail_at is not null),
    'convertidos',  count(*) filter (where convertido_at is not null),
    'bajas',        count(*) filter (where baja_at is not null),
    'activo',       (select coalesce(federal_campanas_activo,false) from public.config_global limit 1),
    'enviados_total', (select count(*) from public.prospecto_mails pm
                        join public.prospectos p2 on p2.id=pm.prospecto_id
                        where p2.origen='import_nacional' and pm.template_slug like 'federal-%'),
    'encolados_hoy', (select count(*) from public.email_queue q
                        join public.prospectos p3 on p3.id=q.related_id and q.related_table='prospectos'
                        where p3.origen='import_nacional' and q.template_slug like 'federal-%'
                          and (q.created_at at time zone 'America/Argentina/Buenos_Aires')::date = v_hoy),
    'cola_pendiente', (select count(*) from public.email_queue q
                        join public.prospectos p4 on p4.id=q.related_id and q.related_table='prospectos'
                        where p4.origen='import_nacional' and q.template_slug like 'federal-%' and q.enviado_at is null),
    'hoy',          v_hoy
  ) into v_res from base;
  return v_res;
end $fn$;

-- ───────────────────────── Listado paginado del universo federal ─────────────────────────
create or replace function public.prospectos_federal_list(
  p_jurisdiccion text default null, p_estado text default null, p_search text default null,
  p_solo_con_email boolean default false, p_limit int default 50, p_offset int default 0)
returns table(
  id uuid, nombre text, nombre_pila text, email text, telefono text, matricula text,
  jurisdiccion text, origen_detalle text, estado_captacion text, suprimido boolean,
  ultimo_mail_slug text, ultimo_mail_asunto text, ultimo_mail_at timestamptz,
  convertido_at timestamptz, baja_at timestamptz, campanas_enviadas jsonb, total_count bigint)
language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_lim int := least(greatest(coalesce(p_limit,50),1),200); v_off int := greatest(coalesce(p_offset,0),0);
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
  with filtrado as (
    select p.* from public.prospectos p
    where p.origen = 'import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and (p_estado is null or p.estado_captacion = p_estado)
      and (not coalesce(p_solo_con_email,false)
           or (p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid'))
      and (p_search is null or btrim(p_search) = '' or
           p.nombre ilike '%'||p_search||'%' or p.email ilike '%'||p_search||'%' or coalesce(p.matricula,'') ilike '%'||p_search||'%')
  ), total as (select count(*) c from filtrado)
  select f.id, f.nombre, public.nombre_pila_federal(f.nombre), f.email, f.telefono, f.matricula,
         f.jurisdiccion, f.observaciones, f.estado_captacion, public.email_esta_suprimido(f.email),
         f.ultimo_mail_slug, f.ultimo_mail_asunto, f.ultimo_mail_at, f.convertido_at, f.baja_at,
         (select coalesce(jsonb_object_agg(pm.template_slug, pm.ultima), '{}'::jsonb)
            from (select template_slug, max(enviado_at) ultima from public.prospecto_mails
                  where prospecto_id = f.id group by template_slug) pm),
         (select c from total)
  from filtrado f
  order by f.created_at desc, f.id
  limit v_lim offset v_off;
end $fn$;

-- ───────────────────────── Preview de una campaña federal ─────────────────────────
create or replace function public.prospectos_federal_preview_campana(
  p_template_slug text, p_jurisdiccion text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
as $fn$
declare v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
        v_gracia int := 30; v_cooldown int := 90; v_existe boolean; v_res jsonb;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  select exists(select 1 from public.email_templates where slug=p_template_slug and activo) into v_existe;
  with seg as (
    select p.id, p.email,
           (p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid') as email_ok
    from public.prospectos p
    where p.origen='import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and p.convertido_at is null and p.baja_at is null
      and p.estado_captacion is distinct from 'no_interesado'
  ), eval as (
    select s.id, s.email_ok,
           case when not s.email_ok then false else public.email_esta_suprimido(s.email) end as supr,
           exists(select 1 from public.prospecto_mails pm where pm.prospecto_id=s.id and pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             or exists(select 1 from public.email_queue q where q.related_table='prospectos' and q.related_id=s.id and q.created_at >= (v_hoy - v_gracia)::timestamptz) as en_gracia,
           exists(select 1 from public.prospecto_mails pm where pm.prospecto_id=s.id and pm.template_slug=p_template_slug and pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz) as en_cooldown
    from seg s
  )
  select jsonb_build_object(
    'template', p_template_slug, 'template_existe', v_existe, 'jurisdiccion', p_jurisdiccion,
    'en_segmento', count(*),
    'sin_email',   count(*) filter (where not email_ok),
    'suprimidos',  count(*) filter (where email_ok and supr),
    'en_gracia',   count(*) filter (where email_ok and not supr and en_gracia),
    'en_cooldown', count(*) filter (where email_ok and not supr and not en_gracia and en_cooldown),
    'elegibles',   count(*) filter (where email_ok and not supr and not en_gracia and not en_cooldown)
  ) into v_res from eval;
  return v_res;
end $fn$;

-- ───────────────────────── Enviar campaña federal (encola con goteo por días) ─────────────────────────
create or replace function public.prospectos_federal_enviar_campana(
  p_template_slug text, p_jurisdiccion text default null, p_limite_diario int default 1500, p_forzar boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp'
  set "TimeZone" to 'America/Argentina/Buenos_Aires'
as $fn$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_gracia int := 30; v_cooldown int := 90;
  v_cap int := least(greatest(coalesce(p_limite_diario,1500),1),5000);
  v_asunto text; v_toques int := 0; v_p record; v_rn int := 0; v_pila text;
begin
  if not private.is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  -- Guard duro: esta RPC sólo manda plantillas federales (nunca toca captación PBA ni transaccional).
  if p_template_slug is null or p_template_slug not like 'federal-%' then
    return jsonb_build_object('ok', false, 'error', 'template_no_federal');
  end if;
  if not (select coalesce(federal_campanas_activo, false) from public.config_global limit 1) then
    return jsonb_build_object('ok', false, 'error', 'federal_desactivado', 'gated', true, 'encolados', 0);
  end if;
  select asunto into v_asunto from public.email_templates where slug = p_template_slug and activo;
  if v_asunto is null then return jsonb_build_object('ok', false, 'error', 'template_inexistente'); end if;

  for v_p in
    select p.id, p.nombre, p.email
    from public.prospectos p
    where p.origen = 'import_nacional'
      and (p_jurisdiccion is null or p.jurisdiccion = p_jurisdiccion)
      and p.convertido_at is null and p.baja_at is null
      and p.estado_captacion is distinct from 'no_interesado'
      and p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and p.email not like '%.invalid'
    order by p.email
  loop
    continue when public.email_esta_suprimido(v_p.email);
    continue when exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.enviado_at >= (v_hoy - v_gracia)::timestamptz)
             or exists (select 1 from public.email_queue q
                         where q.related_table = 'prospectos' and q.related_id = v_p.id
                           and q.created_at >= (v_hoy - v_gracia)::timestamptz);
    continue when not p_forzar and exists (select 1 from public.prospecto_mails pm
                           where pm.prospecto_id = v_p.id and pm.template_slug = p_template_slug
                             and pm.enviado_at >= (v_hoy - v_cooldown)::timestamptz);
    v_pila := coalesce(public.nombre_pila_federal(v_p.nombre), 'colega');
    insert into public.email_queue
      (kind, template_slug, to_email, to_nombre, variables, prioridad, programado_para, scheduled_at,
       related_table, related_id, subject, comprobante_ids, parte, partes_total)
    values
      ('workflow', p_template_slug, lower(trim(v_p.email)), initcap(v_p.nombre),
       jsonb_build_object('nombre', v_pila), 8,
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       now() + (floor(v_rn / v_cap))::int * interval '1 day',
       'prospectos', v_p.id, v_asunto, '{}', 1, 1);
    v_toques := v_toques + 1; v_rn := v_rn + 1;
  end loop;

  return jsonb_build_object('ok', true, 'encolados', v_toques,
    'dias', ceil(v_toques::numeric / v_cap)::int, 'template', p_template_slug,
    'jurisdiccion', p_jurisdiccion, 'cap_diario', v_cap, 'forzado', p_forzar);
end $fn$;

-- ───────────────────────── Grants (SECDEF + is_staff adentro) ─────────────────────────
revoke all on function public.nombre_pila_federal(text) from public;
grant execute on function public.nombre_pila_federal(text) to authenticated, service_role;
grant execute on function public.prospectos_federal_kpis() to authenticated;
grant execute on function public.prospectos_federal_list(text,text,text,boolean,int,int) to authenticated;
grant execute on function public.prospectos_federal_preview_campana(text,text) to authenticated;
grant execute on function public.prospectos_federal_enviar_campana(text,text,int,boolean) to authenticated, service_role;
