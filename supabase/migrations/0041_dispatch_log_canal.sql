-- ============================================================================
-- 0041_dispatch_log_canal · Idempotencia per-(vencimiento, offset, canal)
-- para el edge function dispatch-vencimientos (Ronda 6 cierre · DGG-07).
--
-- Contexto: la tabla `dispatch_vencimientos_log` original (mig 0025) es un
-- LOG de corrida (resumen del cron). El nuevo motor que respeta
-- `vencimientos.alarmas_offsets[]` necesita además una marca por TRÍADA
-- (vencimiento_id, offset_dias, canal) para que el cron sea idempotente
-- aunque corra dos veces el mismo día.
--
-- Estrategia: agregar columnas a la tabla existente y crear un índice único
-- parcial que sólo aplica cuando la fila representa un DISPATCH ITEM (no un
-- resumen de corrida). Mantenemos compat con las filas-resumen viejas.
-- ============================================================================

ALTER TABLE public.dispatch_vencimientos_log
  ADD COLUMN IF NOT EXISTS vencimiento_id uuid REFERENCES public.vencimientos(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS offset_dias int,
  ADD COLUMN IF NOT EXISTS canal text
    CHECK (canal IS NULL OR canal IN ('push','email_cliente')),
  ADD COLUMN IF NOT EXISTS resultado text
    CHECK (resultado IS NULL OR resultado IN ('ok','skipped','error'));

-- Índice único parcial: 1 fila por (vencimiento, offset, canal). Aplica sólo
-- a items reales (vencimiento_id NOT NULL); las filas de resumen quedan fuera.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_log_item
  ON public.dispatch_vencimientos_log (vencimiento_id, offset_dias, canal)
  WHERE vencimiento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_log_venc
  ON public.dispatch_vencimientos_log(vencimiento_id)
  WHERE vencimiento_id IS NOT NULL;

COMMENT ON COLUMN public.dispatch_vencimientos_log.vencimiento_id IS
  'Si NOT NULL, la fila es un dispatch item (no un resumen de corrida).';
COMMENT ON COLUMN public.dispatch_vencimientos_log.offset_dias IS
  'Offset de la alarma (ej: 30, 7, 2). NULL en filas-resumen.';
COMMENT ON COLUMN public.dispatch_vencimientos_log.canal IS
  '"push" (notificación interna gerente) o "email_cliente" (mail al administrador).';

-- ---------------------------------------------------------------------------
-- Seed · plantilla email_templates `vencimiento_alerta_cliente`
-- (idempotente por slug). Voz Gestión Global, paleta cyan, plain text fallback.
-- ---------------------------------------------------------------------------
INSERT INTO public.email_templates
  (slug, nombre, asunto, body_html, body_text, from_casilla, descripcion, variables)
VALUES (
  'vencimiento_alerta_cliente',
  'Alerta de vencimiento (cliente)',
  'Aviso de vencimiento: {{tipo_label}} · {{admin_o_consorcio}}',
  $html$
<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f8fafc;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <tr><td style="background:linear-gradient(135deg,#0891b2,#06b6d4);padding:24px 28px;color:#ffffff;">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">Gestión Global</div>
          <h1 style="margin:6px 0 0 0;font-size:22px;line-height:1.2;font-weight:700;">Te avisamos de un vencimiento</h1>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;">Hola {{nombre_contacto}},</p>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;">
            Te recordamos que el <strong>{{tipo_label}}</strong> de
            <strong>{{admin_o_consorcio}}</strong> vence el
            <strong>{{fecha_vencimiento}}</strong>. Faltan <strong>{{dias_restantes}}</strong> días.
          </p>
          <div style="margin:18px 0;padding:14px 16px;border-radius:10px;background:#ecfeff;border:1px solid #a5f3fc;">
            <div style="font-size:12px;color:#0e7490;letter-spacing:.06em;text-transform:uppercase;">Próxima fecha</div>
            <div style="font-size:18px;font-weight:700;color:#155e75;margin-top:2px;">{{fecha_vencimiento}}</div>
          </div>
          <p style="margin:16px 0 8px 0;font-size:14px;line-height:1.55;color:#475569;">
            Si ya gestionaste la renovación podés ignorar este aviso. Ante cualquier consulta, respondé a este mismo correo y te ayudamos.
          </p>
          <p style="margin:18px 0 0 0;font-size:14px;color:#0f172a;">
            <strong>Equipo Gestión Global</strong><br/>
            <span style="color:#64748b;font-size:13px;">gestionglobal.ar</span>
          </p>
        </td></tr>
      </table>
      <div style="font-size:11px;color:#94a3b8;margin-top:14px;">Este correo se envía por tu suscripción al servicio de seguimiento de vencimientos.</div>
    </td></tr>
  </table>
</body>
</html>
  $html$,
  $txt$
Hola {{nombre_contacto}},

Te recordamos que el {{tipo_label}} de {{admin_o_consorcio}} vence el {{fecha_vencimiento}}.
Faltan {{dias_restantes}} días.

Si ya gestionaste la renovación podés ignorar este aviso. Ante cualquier consulta respondé a este mismo correo.

— Equipo Gestión Global
gestionglobal.ar
  $txt$,
  'tramites',
  'Alerta automática al cliente administrador cuando un vencimiento entra en alguna de sus alarmas_offsets[] (Ronda 6 / DGG-07).',
  '["nombre_contacto","tipo_label","admin_o_consorcio","fecha_vencimiento","dias_restantes"]'::jsonb
)
ON CONFLICT (slug) DO UPDATE
  SET nombre      = EXCLUDED.nombre,
      asunto      = EXCLUDED.asunto,
      body_html   = EXCLUDED.body_html,
      body_text   = EXCLUDED.body_text,
      descripcion = EXCLUDED.descripcion,
      variables   = EXCLUDED.variables,
      updated_at  = now();

-- ============================================================================
-- Fin 0041_dispatch_log_canal
-- ============================================================================
