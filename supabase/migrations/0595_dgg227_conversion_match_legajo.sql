-- 0595_dgg227_conversion_match_legajo.sql
-- DGG-227 · El trigger de detección de conversión prospecto→cliente ahora matchea
-- también por LEGAJO RPAC (antes sólo CUIT o email).
--
-- Motivo: hay clientes cuyo CUIT/email difieren del padrón (p.ej. prospecto =
-- empresa SRL con CUIT 30…, cliente = la persona física con CUIL 20…) pero
-- comparten el mismo legajo de matrícula. El motor YA los excluía del mailing por
-- el cerco de legajo (mig 0559), así que NUNCA hubo riesgo de mailearlos; pero el
-- TRIGGER de conversión no los marcaba 'convertido' → el contador de conversiones
-- los sub-contaba (se vio con Dima y Giromini, que se marcaron sólo por un backfill
-- único). Con el legajo en el trigger, el contador queda completo a futuro.
--
-- Se agrega legajo_rpac a la cláusula OF del trigger para que también dispare
-- cuando se carga/edita el legajo (no sólo cuit/email). Match EXACTO
-- `p.legajo = NEW.legajo_rpac`, consistente con el backfill 0559 y los cercos del
-- motor. Idempotente (sólo toca prospectos aún no convertidos).
--
-- Reglas: R16 (CREATE OR REPLACE, firma trigger sin args), R17 (SECDEF, escribe
-- prospectos que tiene RLS).

CREATE OR REPLACE FUNCTION private.prospecto_detectar_conversion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cuit text; v_email text; v_legajo text;
BEGIN
  v_cuit   := regexp_replace(COALESCE(NEW.cuit, ''), '[^0-9]', '', 'g');
  v_email  := lower(btrim(COALESCE(NEW.email, '')));
  v_legajo := btrim(COALESCE(NEW.legajo_rpac, ''));
  IF v_cuit = '' AND v_email = '' AND v_legajo = '' THEN RETURN NULL; END IF;
  UPDATE public.prospectos p
     SET convertido_a_administracion_id = NEW.id, convertido_at = COALESCE(p.convertido_at, now()),
         estado_captacion = 'convertido', updated_at = now()
   WHERE p.convertido_a_administracion_id IS NULL
     AND ( (v_cuit   <> '' AND p.cuit   = v_cuit)
        OR (v_email  <> '' AND p.email  = v_email)
        OR (v_legajo <> '' AND p.legajo = v_legajo) );
  RETURN NULL;
END $function$;

-- Re-crear el trigger para que también dispare al cargar/editar legajo_rpac.
DROP TRIGGER IF EXISTS trg_prospecto_detectar_conversion ON public.administraciones;
CREATE TRIGGER trg_prospecto_detectar_conversion
  AFTER INSERT OR UPDATE OF cuit, email, legajo_rpac ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION private.prospecto_detectar_conversion();

-- Backfill idempotente: marcar los prospectos cuyo legajo coincide con un cliente
-- y que todavía no estén convertidos (hoy debería ser 0; 0559 ya corrió una vez).
UPDATE public.prospectos p
   SET convertido_a_administracion_id = a.id, convertido_at = COALESCE(p.convertido_at, now()),
       estado_captacion = 'convertido', updated_at = now()
  FROM public.administraciones a
 WHERE p.convertido_a_administracion_id IS NULL
   AND p.legajo IS NOT NULL AND btrim(p.legajo) <> ''
   AND a.legajo_rpac = p.legajo;
