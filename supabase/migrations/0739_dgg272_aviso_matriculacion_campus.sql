-- 0739 · DGG-272 — Aviso de matriculación al alumno (pedido de Pablo) + Guía del Alumno.
-- Hallazgo: el aviso de matriculación NO se enviaba (0 en toda la historia pese a 105 matrículas
-- en 90d). La plantilla `curso-inscripcion-confirmada` sólo la emitía `curso_matricular` (RPC
-- deprecada, 0 callers); el flujo real (`curso_asignar_alumno` → INSERT en curso_matriculas) no
-- mandaba nada. Y la copy vieja ("en la fecha vas a recibir el link") era para cursos a futuro,
-- no para el acceso inmediato que da la matriculación hoy.
--
-- Fix: (1) reescribir la plantilla para acceso inmediato + enlazar la Guía del Alumno (tutorial del
-- campus, subido a Storage); CTA "Entrar al campus" → /portal/campus (home del alumno, confirmado
-- por Pablo). (2) trigger AFTER INSERT en curso_matriculas que encola el aviso UNA vez por matrícula.
-- Transaccional (prioridad 5, sale por Gmail). SIN backfill (Pablo: "los 105 ya están cursando,
-- no necesitan el manual; mandalo a los que se matriculen de ahora en más").
-- Guarda clave: el encolado va en BEGIN/EXCEPTION → un fallo del mail NUNCA bloquea la matriculación.

-- ───────────── (1) Plantilla: acceso inmediato + Guía del Alumno ─────────────
UPDATE public.email_templates SET
  asunto = 'Ya tenés acceso al campus · {{nombre_curso}}',
  titulo_visual = 'Tu acceso al campus ya está activo',
  cta_text = 'Entrar al campus',
  cta_url = 'https://www.gestionglobal.ar/portal/campus',
  variables = '["nombre","nombre_curso"]'::jsonb,
  cuerpo_html_visual = $gg$<p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>, ¡ya quedaste matriculado/a en <strong>{{nombre_curso}}</strong>! Tu acceso al campus ya está activo: entrá cuando quieras y avanzá a tu ritmo.</p><p style="margin:0 0 16px;">Para aprovecharlo al máximo preparamos una <strong>Guía del Alumno</strong> de un minuto: cómo cursar, asistir a las clases en vivo, descargar el material y obtener tu certificado.</p><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 4px;"><tr><td><a href="https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/tutorial-alumno/guia-del-alumno.pdf" target="_blank" rel="noopener" style="display:inline-block;background:#E7F1F9;border:1px solid #009ECA;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:700;color:#0B1F33;text-decoration:none;">📘 Descargar la Guía del Alumno (PDF)</a></td></tr></table>$gg$,
  body_html = $gg$<h2>¡Ya tenés acceso al campus!</h2><p>Hola {{nombre}}, quedaste matriculado/a en <strong>{{nombre_curso}}</strong>. Entrá al campus cuando quieras y descargá la Guía del Alumno para aprovecharlo al máximo: https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/tutorial-alumno/guia-del-alumno.pdf</p>$gg$,
  updated_at = now()
WHERE slug = 'curso-inscripcion-confirmada';

-- ───────────── (2) Trigger de bienvenida al matricular ─────────────
CREATE OR REPLACE FUNCTION public.curso_matricula_bienvenida()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_email text; v_nombre text; v_curso text;
BEGIN
  SELECT u.email, COALESCE(NULLIF(btrim(p.full_name), ''), split_part(u.email, '@', 1))
    INTO v_email, v_nombre
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = NEW.profile_id;

  SELECT c.titulo INTO v_curso FROM public.cursos c WHERE c.id = NEW.curso_id;

  -- Sin email real → no se puede avisar (no bloquea la matrícula).
  IF v_email IS NULL OR btrim(v_email) = '' OR v_email ILIKE '%@padron.invalid' THEN
    RETURN NEW;
  END IF;

  -- El encolado NUNCA debe tumbar la matriculación: cualquier error se traga con WARNING.
  BEGIN
    PERFORM public.encolar_email(
      'curso-inscripcion-confirmada',
      lower(btrim(v_email)),
      initcap(v_nombre),
      jsonb_build_object('nombre', v_nombre, 'nombre_curso', COALESCE(v_curso, 'tu curso')),
      NEW.administracion_id, NULL, 'curso_matriculas', NEW.id, 5::smallint
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'curso_matricula_bienvenida: encolar_email falló para matrícula % (%): %', NEW.id, v_email, SQLERRM;
  END;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_curso_matricula_bienvenida ON public.curso_matriculas;
CREATE TRIGGER trg_curso_matricula_bienvenida
AFTER INSERT ON public.curso_matriculas
FOR EACH ROW EXECUTE FUNCTION public.curso_matricula_bienvenida();
