-- 0613_dgg234_f5b_matricula_extra_no_confirmado.sql
-- DGG-234 · Fase 5b (§6-A#6c) — invariante: una matrícula CABA/Neuquén NUNCA es
-- 'confirmado'. Ver DGG-234_matricula_multijurisdiccion.md §2.3 (asimetría de
-- inferencia: TRAMIX es PBA-only → no hay fuente oficial para CABA/NEU).
-- --------------------------------------------------------------------------
-- Por qué: el materializador `perfil_declarado_sync_venc` sólo crea el recordatorio
-- de renovación cuando la certeza ∈ ('declarado','inferido'). Si alguien marcara una
-- fila CABA/NEU como 'confirmado', calc daría proxima_renovacion 'confirmado' →
-- v_debe=false → el cliente quedaría SIN ningún recordatorio (no hay vencimiento
-- oficial para CABA/NEU que lo cubra) = mudo silencioso. El CHECK lo impide.
-- La hija está VACÍA hoy → el constraint se agrega sin validar filas (0 riesgo).
-- --------------------------------------------------------------------------

ALTER TABLE public.matricula_extra
  ADD CONSTRAINT matricula_extra_no_confirmado
  CHECK (certeza <> 'confirmado');

COMMENT ON CONSTRAINT matricula_extra_no_confirmado ON public.matricula_extra IS
  'DGG-234 §6-A#6c: CABA/NEU nunca ''confirmado'' (sin fuente oficial tipo TRAMIX); evita que el materializador deje al cliente sin recordatorio.';
