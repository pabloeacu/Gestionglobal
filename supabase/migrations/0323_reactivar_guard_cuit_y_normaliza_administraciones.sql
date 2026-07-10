-- 0323 · Cierre del barrido de regresión (post E-GG-105).
-- (#1) administracion_reactivar (0318) hacía UPDATE activo=true incondicional.
--   Si mientras el cliente estaba de baja se creó OTRO activo con el mismo CUIT
--   (decisión de reingreso "crear cuenta nueva"), reactivar el viejo choca el
--   índice duro uq_admin_cuit_activo (0311) con un 23505 crudo ilegible. Fix:
--   detectar el gemelo activo por CUIT y avisar con mensaje humano.
-- (#2) BLINDAJE de formato de CUIT/DNI a nivel tabla: un trigger BEFORE normaliza
--   NEW.cuit a 11 dígitos pelados (formato inválido → NULL) y NEW.responsable_dni
--   a dígitos. Cierra de raíz la familia E-GG-105: ninguna RPC/import/trigger
--   puede volver a tumbar un INSERT/UPDATE de administraciones por CUIT con
--   guiones (incl. el INSERT crudo de solicitud_activar, mig 0278). Aditivo.

CREATE OR REPLACE FUNCTION public.administracion_reactivar(p_administracion_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cuit text; v_twin text;
BEGIN
  IF NOT private.is_staff() THEN RAISE EXCEPTION 'Solo gerencia puede reactivar un cliente'; END IF;
  SELECT regexp_replace(coalesce(cuit,''),'[^0-9]','','g') INTO v_cuit
    FROM public.administraciones WHERE id = p_administracion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;
  IF length(v_cuit) = 11 THEN
    SELECT nombre INTO v_twin FROM public.administraciones
     WHERE activo AND id <> p_administracion_id
       AND regexp_replace(coalesce(cuit,''),'[^0-9]','','g') = v_cuit
     LIMIT 1;
    IF v_twin IS NOT NULL THEN
      RAISE EXCEPTION 'reactivar_cuit_duplicado_activo:%', v_twin USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE public.administraciones SET estado='activo', activo=true WHERE id=p_administracion_id;
  UPDATE public.profiles SET activo=true
   WHERE administracion_id=p_administracion_id AND role='administrador';
END;
$function$;

CREATE OR REPLACE FUNCTION public.administraciones_normaliza_cuit_dni()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- CUIT siempre 11 dígitos pelados (lo exige administraciones_cuit_check).
  -- Formato con guiones/espacios entra normalizado; longitud inválida → NULL.
  IF NEW.cuit IS NOT NULL THEN
    NEW.cuit := regexp_replace(NEW.cuit, '[^0-9]', '', 'g');
    IF length(NEW.cuit) <> 11 THEN NEW.cuit := NULL; END IF;
  END IF;
  -- DNI a dígitos (consistente con uq_admin_dni_activo).
  IF NEW.responsable_dni IS NOT NULL THEN
    NEW.responsable_dni := NULLIF(regexp_replace(NEW.responsable_dni, '[^0-9]', '', 'g'), '');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_administraciones_normaliza ON public.administraciones;
CREATE TRIGGER trg_administraciones_normaliza
  BEFORE INSERT OR UPDATE OF cuit, responsable_dni ON public.administraciones
  FOR EACH ROW EXECUTE FUNCTION public.administraciones_normaliza_cuit_dni();
