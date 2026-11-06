-- DGG-244 · F2h — Alta blanda a LexPH al enviar un formulario de solicitud de servicio
-- ---------------------------------------------------------------------------
-- Frente A del motor de audiencia (pedido #7 de Pablo): al enviar un formulario
-- de SOLICITUD DE SERVICIO (categorías tramite/curso/consulta) con email válido,
-- el mail queda suscripto al newsletter de LexPH (modelo opt-out: alta por AVISO
-- en el form — leyenda "Al enviar, te sumás gratis a LexPH… Baja con un clic" —,
-- no doble opt-in). Trigger sobre `formulario_submissions` (sin tocar el edge
-- money-crítico `submit-formulario`, R7). Usa la columna canónica `email_contacto`.
--
-- Respeta el consentimiento: NO re-suscribe emails suprimidos (email_suppression)
-- ni dados de baja de LexPH. Si ya es 'pendiente' (se anotó por la web y no
-- confirmó), la solicitud de servicio ES el consentimiento → lo promueve a
-- 'confirmado'. 'evento' queda fuera a propósito (es un registro, no una
-- solicitud de servicio). El alta como 'confirmado' dispara el aviso a gerencia
-- (trigger F2f) y, por la supresión unificada, una baja corta esta vía también.

create or replace function public.formulario_submission_lexph_optin_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_email     text := lower(btrim(coalesce(NEW.email_contacto, '')));
  v_categoria text;
begin
  -- email válido
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return NEW;
  end if;

  -- sólo formularios de solicitud de servicio
  select categoria into v_categoria from public.formularios where id = NEW.formulario_id;
  if coalesce(v_categoria, '') not in ('tramite', 'curso', 'consulta') then
    return NEW;
  end if;

  -- opt-out global: no re-suscribir
  if exists (select 1 from public.email_suppression s where s.email = v_email) then
    return NEW;
  end if;

  -- baja previa de LexPH (anterior a la unificación de supresión): respetar
  if exists (
    select 1 from public.lexph_suscriptores x
     where x.email_norm = v_email and x.estado = 'baja'
  ) then
    return NEW;
  end if;

  -- alta blanda: confirmado directo, origen formulario.
  insert into public.lexph_suscriptores (email, email_norm, estado, origen, confirmed_at)
  values (btrim(NEW.email_contacto), v_email, 'confirmado', 'formulario', now())
  on conflict (email_norm) do update
     set estado = case when public.lexph_suscriptores.estado = 'pendiente'
                       then 'confirmado' else public.lexph_suscriptores.estado end,
         confirmed_at = coalesce(public.lexph_suscriptores.confirmed_at, now())
   where public.lexph_suscriptores.estado <> 'baja';

  return NEW;
end;
$$;

drop trigger if exists trg_formulario_submission_lexph_optin on public.formulario_submissions;
create trigger trg_formulario_submission_lexph_optin
  after insert on public.formulario_submissions
  for each row execute function public.formulario_submission_lexph_optin_trg();
