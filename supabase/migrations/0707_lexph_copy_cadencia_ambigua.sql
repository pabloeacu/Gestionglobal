-- LexPH · copy de suscripción SIN promesa de cadencia (ambiguo).
-- ---------------------------------------------------------------------------
-- Pedido de Pablo (2026-11-22): la plataforma NO puede comprometer un régimen
-- de publicación ("cada pocas semanas" / "quincenal") porque no siempre se va a
-- poder cumplir. Toda copy de cara al suscriptor debe ser AMBIGUA en la frecuencia.
--
-- Superficies user-facing con promesa de cadencia (inventario completo):
--   1. Home pública #lexph (hero)  → src/modules/public/pages/LandingPage.tsx
--      "Una edición cada pocas semanas, directo a tu correo."
--      → "Suscribite y recibí cada edición en tu correo."  (cambio en el front)
--   2. Mail de bienvenida (este archivo) template `lexph-bienvenida`:
--      "...destiladas para administrar mejor, cada pocas semanas."
--      → "...destiladas para administrar mejor, en cada nueva edición."
--
-- Fuera de alcance (a propósito):
--   · Newsletter E3 ya enviado ("Una quincena concreta…") = standfirst editorial
--     de esa edición, no una promesa de cadencia, y es pieza archivada/enviada.
--   · Docs internos (PROJECT_STATUS/DECISIONES/LEXPH_MANUAL, headers de mig) usan
--     "quincenal" como plan del equipo, no son copy de cara al usuario.
--
-- El seed original vive en 0662 (inmutable). Acá lo corregimos de forma
-- idempotente: UPDATE por reemplazo exacto (no re-upsert, no toca otras columnas).
-- Ya aplicado en vivo el 2026-11-22; esta mig deja el repo = BD para un alta fresca.

update public.email_templates
set cuerpo_html_visual = replace(
      cuerpo_html_visual,
      'destiladas para administrar mejor, cada pocas semanas.',
      'destiladas para administrar mejor, en cada nueva edición.'
    ),
    updated_at = now()
where slug = 'lexph-bienvenida'
  and cuerpo_html_visual like '%destiladas para administrar mejor, cada pocas semanas.%';
