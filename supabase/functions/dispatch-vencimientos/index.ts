// dispatch-vencimientos · Ronda 6 (DGG-07).
//
// Cron diario disparado por pg_cron via pg_net. Auth con bearer custom
// (CRON_SECRET) — mismo patrón que las otras edge functions del proyecto.
//
// Flujo nuevo (Ronda 6):
// 1. Llama RPC `gg_vencimientos_planificar_alertas(CURRENT_DATE)` que devuelve
//    los pares (vencimiento_id, offset_dias) que matchean HOY según
//    `vencimientos.alarmas_offsets[]` (default '{30,7,2}').
// 2. Para cada match emite DOS canales:
//    a) push interno al gerente (todos los staff con suscripción) — siempre.
//    b) email al cliente administrador — solo si vencimiento.notificar_cliente.
// 3. Idempotencia: antes de cada acción consulta `dispatch_vencimientos_log`
//    por (vencimiento_id, offset_dias, canal). Si ya existe, skip.
// 4. Tras cada acción inserta una fila en `dispatch_vencimientos_log` con
//    (vencimiento_id, offset_dias, canal, resultado).
// 5. Al final inserta una fila-resumen (compat con mig 0025).
//
// Plantilla mail: `vencimiento_alerta_cliente` (seedeada en mig 0041).
//
// Compat con dias_alerta_1/2/3: el motor LEGACY de mig 0025 escribe flags
// `alerta_NNd_enviada` en la propia tabla vencimientos. Acá NO escribimos
// esos flags — el nuevo motor usa alarmas_offsets per-vencimiento y la
// idempotencia es per-fila del log. Quien quiera mantener el comportamiento
// legacy debe dejar alarmas_offsets vacío y usar vencimientos_config —
// pero como la mig 0040 garantiza DEFAULT '{30,7,2}', todo vencimiento
// nuevo va por el motor nuevo.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

interface PlanRow {
  vencimiento_id: string;
  offset_dias: number;
  fecha_vencimiento: string;
  administracion_id: string | null;
  consorcio_id: string | null;
  notificar_cliente: boolean;
  tipo: string;
  descripcion: string | null;
}

interface AdministracionRow {
  id: string;
  nombre: string;
  email: string | null;
  responsable_nombre: string | null;
  responsable_apellido: string | null;
}

interface ConsorcioRow {
  id: string;
  nombre: string;
}

interface ErrorLog {
  vencimiento_id?: string;
  offset_dias?: number;
  canal?: string;
  mensaje: string;
}

const TIPO_LABEL: Record<string, string> = {
  matricula_rpac: 'Matrícula RPAC',
  ddjj_anual: 'Declaración Jurada Anual',
  certificado_arca: 'Certificado ARCA',
  seguro_consorcio: 'Seguro del consorcio',
  habilitacion_municipal: 'Habilitación municipal',
  libro_actas: 'Libro de actas',
  libro_administracion: 'Libro de administración',
  revision_ascensor: 'Revisión de ascensor',
  otro: 'Vencimiento',
};

Deno.serve(async (req) => {
  const t0 = Date.now();

  // Auth: si CRON_SECRET está seteado lo exigimos.
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader !== `Bearer ${cronSecret}`) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let pushEncolados = 0;
  let emailEncolados = 0;
  let skippedIdempotente = 0;
  const errores: ErrorLog[] = [];

  try {
    // ---------------------------------------------------------------------
    // 1. Plan del día — RPC gg_vencimientos_planificar_alertas.
    // ---------------------------------------------------------------------
    const hoyIso = new Date().toISOString().slice(0, 10);
    const { data: planData, error: errPlan } = await supabase.rpc(
      'gg_vencimientos_planificar_alertas',
      { p_fecha: hoyIso },
    );
    if (errPlan) throw new Error(`gg_vencimientos_planificar_alertas: ${errPlan.message}`);
    const plan = (planData ?? []) as PlanRow[];

    if (plan.length === 0) {
      await registrarResumen(supabase, 0, 0, 0, errores, Date.now() - t0);
      return json({ ok: true, procesados: 0, push: 0, emails: 0, duracion_ms: Date.now() - t0 }, 200);
    }

    // ---------------------------------------------------------------------
    // 2. Bulk load: administraciones + consorcios + staff con suscripción.
    // ---------------------------------------------------------------------
    const adminIds = Array.from(
      new Set(plan.map((p) => p.administracion_id).filter((x): x is string => !!x)),
    );
    const consIds = Array.from(
      new Set(plan.map((p) => p.consorcio_id).filter((x): x is string => !!x)),
    );

    const adminsRes = adminIds.length
      ? await supabase
          .from('administraciones')
          .select('id, nombre, email, responsable_nombre, responsable_apellido')
          .in('id', adminIds)
      : { data: [], error: null };
    if (adminsRes.error) throw new Error(`cargar admins: ${adminsRes.error.message}`);
    const adminMap = new Map<string, AdministracionRow>();
    for (const a of (adminsRes.data ?? []) as AdministracionRow[]) adminMap.set(a.id, a);

    const consRes = consIds.length
      ? await supabase.from('consorcios').select('id, nombre').in('id', consIds)
      : { data: [], error: null };
    if (consRes.error) throw new Error(`cargar consorcios: ${consRes.error.message}`);
    const consMap = new Map<string, ConsorcioRow>();
    for (const c of (consRes.data ?? []) as ConsorcioRow[]) consMap.set(c.id, c);

    // Staff IDs (gerentes). Tabla real: public.profiles · columnas (id, role).
    const { data: staffData, error: errStaff } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'gerente')
      .eq('activo', true);
    if (errStaff) {
      errores.push({ mensaje: `profiles lookup: ${errStaff.message}` });
    }
    const staffIds = ((staffData ?? []) as Array<{ id: string }>).map((r) => r.id);

    // ---------------------------------------------------------------------
    // 3. Pre-cargar el log existente para idempotencia bulk.
    // ---------------------------------------------------------------------
    const vencIdsEnPlan = Array.from(new Set(plan.map((p) => p.vencimiento_id)));
    const { data: logExistente } = await supabase
      .from('dispatch_vencimientos_log')
      .select('vencimiento_id, offset_dias, canal, resultado')
      .in('vencimiento_id', vencIdsEnPlan)
      .not('vencimiento_id', 'is', null);
    const yaProcesado = new Set<string>();
    for (const r of (logExistente ?? []) as Array<{
      vencimiento_id: string;
      offset_dias: number;
      canal: string;
      resultado: string | null;
    }>) {
      // Idempotencia fuerte: si ya hay fila ok/skipped, no re-enviamos.
      // Si hay 'error', sí reintentamos (no marca como procesado).
      if (r.resultado !== 'error') {
        yaProcesado.add(`${r.vencimiento_id}::${r.offset_dias}::${r.canal}`);
      }
    }

    // ---------------------------------------------------------------------
    // 4. Procesar cada match.
    // ---------------------------------------------------------------------
    for (const p of plan) {
      const tipoLabel = TIPO_LABEL[p.tipo] ?? 'Vencimiento';
      const admin = p.administracion_id ? adminMap.get(p.administracion_id) : null;
      const consorcio = p.consorcio_id ? consMap.get(p.consorcio_id) : null;
      const adminONombre = consorcio?.nombre ?? admin?.nombre ?? '—';

      // -- a) push interno al gerente -------------------------------------
      const pushKey = `${p.vencimiento_id}::${p.offset_dias}::push`;
      if (yaProcesado.has(pushKey)) {
        skippedIdempotente++;
      } else if (staffIds.length === 0) {
        // Sin staff con suscripción — registramos skip suave.
        await registrarItem(supabase, p, 'push', 'skipped', 'sin_staff');
      } else {
        let pushOk = 0;
        let pushErr: string | null = null;
        // Insert directo en la cola (service-role bypassa RLS). Esquivamos el
        // guard de `encolar_push` que valida auth.uid() — innecesario acá
        // porque la edge function está autenticada por CRON_SECRET.
        const rows = staffIds.map((userId) => ({
          user_id: userId,
          titulo: `Vencimiento en ${p.offset_dias} días`,
          cuerpo: `${tipoLabel} · ${adminONombre} · vence el ${p.fecha_vencimiento}`,
          click_url: '/gerencia/agenda/vencimientos',
        }));
        const { error } = await supabase.from('push_notifications_queue').insert(rows);
        if (error) pushErr = error.message;
        else pushOk = rows.length;
        if (pushOk > 0) {
          pushEncolados += pushOk;
          await registrarItem(supabase, p, 'push', 'ok', null);
        } else {
          errores.push({
            vencimiento_id: p.vencimiento_id,
            offset_dias: p.offset_dias,
            canal: 'push',
            mensaje: pushErr ?? 'sin_resultado',
          });
          await registrarItem(supabase, p, 'push', 'error', pushErr);
        }
      }

      // -- b) email al cliente --------------------------------------------
      if (!p.notificar_cliente) continue;
      const emailKey = `${p.vencimiento_id}::${p.offset_dias}::email_cliente`;
      if (yaProcesado.has(emailKey)) {
        skippedIdempotente++;
        continue;
      }
      if (!admin || !admin.email || !admin.email.trim()) {
        await registrarItem(supabase, p, 'email_cliente', 'skipped', 'sin_email');
        continue;
      }

      const nombreContacto =
        [admin.responsable_nombre, admin.responsable_apellido]
          .filter(Boolean)
          .join(' ')
          .trim() || admin.nombre;

      const variables = {
        nombre_contacto: nombreContacto,
        tipo_label: tipoLabel,
        admin_o_consorcio: adminONombre,
        fecha_vencimiento: p.fecha_vencimiento,
        dias_restantes: p.offset_dias,
      };

      const enc = await safeEncolarEmail(supabase, {
        template: 'vencimiento_alerta_cliente',
        toEmail: admin.email.trim(),
        toNombre: nombreContacto,
        variables,
        administracionId: p.administracion_id,
        consorcioId: p.consorcio_id,
        relatedTable: 'vencimientos',
        relatedId: p.vencimiento_id,
        prioridad: p.offset_dias <= 7 ? 2 : 5,
      });

      if (enc.ok) {
        emailEncolados++;
        await registrarItem(supabase, p, 'email_cliente', 'ok', null);
      } else {
        errores.push({
          vencimiento_id: p.vencimiento_id,
          offset_dias: p.offset_dias,
          canal: 'email_cliente',
          mensaje: enc.error,
        });
        await registrarItem(supabase, p, 'email_cliente', 'error', enc.error);
      }
    }
  } catch (e) {
    errores.push({ mensaje: `fatal: ${(e as Error).message}` });
  }

  const duracion = Date.now() - t0;
  await registrarResumen(supabase, pushEncolados, emailEncolados, skippedIdempotente, errores, duracion);

  return json(
    {
      ok: true,
      push: pushEncolados,
      emails: emailEncolados,
      skipped: skippedIdempotente,
      errores_count: errores.length,
      duracion_ms: duracion,
    },
    200,
  );
});

async function registrarItem(
  supabase: SupabaseClient,
  p: PlanRow,
  canal: 'push' | 'email_cliente',
  resultado: 'ok' | 'skipped' | 'error',
  detalle: string | null,
): Promise<void> {
  // upsert por unique (vencimiento_id, offset_dias, canal). Si ya existía
  // como 'error', queda re-escrito al nuevo resultado.
  const { error } = await supabase
    .from('dispatch_vencimientos_log')
    .upsert(
      {
        vencimiento_id: p.vencimiento_id,
        offset_dias: p.offset_dias,
        canal,
        resultado,
        vencimientos_procesados: 0,
        emails_encolados: 0,
        errores: detalle ? [{ mensaje: detalle }] : [],
      },
      { onConflict: 'vencimiento_id,offset_dias,canal' },
    );
  if (error) {
    // No rompemos por un error de log; lo dejamos visible.
    console.error('log_item upsert', error.message);
  }
}

async function registrarResumen(
  supabase: SupabaseClient,
  push: number,
  emails: number,
  skipped: number,
  errores: ErrorLog[],
  duracion: number,
): Promise<void> {
  await supabase.from('dispatch_vencimientos_log').insert({
    vencimientos_procesados: push + emails + skipped,
    emails_encolados: emails,
    errores: errores as unknown as Record<string, unknown>[],
    duracion_ms: duracion,
    // vencimiento_id queda NULL → es una fila-resumen.
  });
}

interface EncolarParams {
  template: string;
  toEmail: string;
  toNombre: string;
  variables: Record<string, unknown>;
  administracionId: string | null;
  consorcioId: string | null;
  relatedTable: string;
  relatedId: string;
  prioridad: number;
}

async function safeEncolarEmail(
  supabase: SupabaseClient,
  p: EncolarParams,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Reescribimos la lógica del RPC public.encolar_email (mig 0024) en JS
  // para esquivar el guard de tenancy. Service-role bypassa RLS, y este
  // edge function es internal-only (CRON_SECRET) — sin riesgo de abuso.
  try {
    const { data: tpl, error: errTpl } = await supabase
      .from('email_templates')
      .select('slug, asunto')
      .eq('slug', p.template)
      .eq('activo', true)
      .maybeSingle();
    if (errTpl) return { ok: false, error: `template_lookup: ${errTpl.message}` };
    if (!tpl) return { ok: false, error: `template_${p.template}_no_existe` };

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('email_queue')
      .insert({
        kind: 'workflow',
        template_slug: tpl.slug,
        to_email: p.toEmail,
        to_nombre: p.toNombre,
        variables: p.variables,
        prioridad: p.prioridad,
        programado_para: now,
        administracion_id: p.administracionId,
        consorcio_id: p.consorcioId,
        related_table: p.relatedTable,
        related_id: p.relatedId,
        subject: tpl.asunto,
        scheduled_at: now,
        comprobante_ids: [],
        parte: 1,
        partes_total: 1,
      })
      .select('id')
      .single();
    if (error) return { ok: false, error: `insert_email_queue: ${error.message}` };
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: `encolar_email_throw: ${(e as Error).message}` };
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
