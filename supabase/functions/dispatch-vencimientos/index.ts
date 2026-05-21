// dispatch-vencimientos
//
// Cron diario disparado por pg_cron via pg_net (09:00 AR = 12:00 UTC).
// Auth con bearer custom (CRON_SECRET) — mismo patrón que notify-vencimientos
// (migración 0011). Subsistema 9 del Documento Maestro (regla 1, decisión
// 2026-05-19).
//
// Flujo:
// 1. Recorre vencimientos estado='vigente' con días restantes ∈ {30,20,10}
//    (los umbrales se leen de vencimientos_config — override per-admin o
//    default global con administracion_id IS NULL).
// 2. Para cada par (vencimiento, umbral) cuya alerta_NNd_enviada IS NULL y
//    cuyo config esté activo: llama RPC public.encolar_email(...) con
//    template = 'recordatorio-vencimiento-30d' o '...10d' (10/20 ambos van
//    a la misma plantilla 10d porque la cercanía manda).
// 3. Marca alerta_NNd_enviada = now().
// 4. Inserta una fila en dispatch_vencimientos_log con el resumen.
//
// Resiliencia: el RPC encolar_email lo está creando otro agente. Si todavía
// no existe, capturamos el error y lo registramos como error de la corrida —
// la corrida no se rompe, no se marcan flags y el siguiente día reintenta.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

interface VencimientoRow {
  id: string;
  tipo: string;
  sujeto: string;
  sujeto_id: string;
  administracion_id: string;
  consorcio_id: string | null;
  fecha_vencimiento: string;
  fecha_emision: string | null;
  descripcion: string | null;
  estado: string;
  alerta_30d_enviada: string | null;
  alerta_20d_enviada: string | null;
  alerta_10d_enviada: string | null;
}

interface ConfigRow {
  administracion_id: string | null;
  tipo: string;
  dias_alerta_1: number;
  dias_alerta_2: number;
  dias_alerta_3: number;
  activo: boolean;
  email_destinatario: string | null;
  sugerencia_servicio_slug: string | null;
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
  umbral?: number;
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

  // Auth: si CRON_SECRET está seteado lo exigimos; sino aceptamos cualquier
  // call (verify_jwt=false). Patrón heredado de dispatch-emails: la función
  // es internal-only (solo lee/escribe tablas propias, dispara emails con
  // flag idempotente), así que la superficie de abuso es mínima.
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

  let procesados = 0;
  let encolados = 0;
  const errores: ErrorLog[] = [];

  try {
    // 1. Cargar configs (override per-admin + globales con admin NULL).
    const { data: configs, error: errCfg } = await supabase
      .from('vencimientos_config')
      .select('*');
    if (errCfg) throw new Error(`cargar configs: ${errCfg.message}`);

    const cfgByKey = new Map<string, ConfigRow>();
    const cfgGlobalByTipo = new Map<string, ConfigRow>();
    for (const c of (configs ?? []) as ConfigRow[]) {
      if (c.administracion_id === null) {
        cfgGlobalByTipo.set(c.tipo, c);
      } else {
        cfgByKey.set(`${c.administracion_id}:${c.tipo}`, c);
      }
    }

    function resolveConfig(admin_id: string, tipo: string): ConfigRow | null {
      return (
        cfgByKey.get(`${admin_id}:${tipo}`) ??
        cfgGlobalByTipo.get(tipo) ??
        null
      );
    }

    // 2. Cargar vencimientos vigentes en ventana amplia (hasta 60 días).
    const horizonte = new Date();
    horizonte.setDate(horizonte.getDate() + 60);
    const horizonteIso = horizonte.toISOString().slice(0, 10);

    const { data: vencs, error: errV } = await supabase
      .from('vencimientos')
      .select(
        'id, tipo, sujeto, sujeto_id, administracion_id, consorcio_id, fecha_vencimiento, fecha_emision, descripcion, estado, alerta_30d_enviada, alerta_20d_enviada, alerta_10d_enviada',
      )
      .eq('estado', 'vigente')
      .lte('fecha_vencimiento', horizonteIso);
    if (errV) throw new Error(`cargar vencimientos: ${errV.message}`);

    const lista = (vencs ?? []) as VencimientoRow[];

    // 3. Bulk load de administraciones + consorcios referenciados.
    const adminIds = Array.from(new Set(lista.map((v) => v.administracion_id)));
    const consIds = Array.from(
      new Set(lista.map((v) => v.consorcio_id).filter((x): x is string => !!x)),
    );

    const adminsRes = adminIds.length
      ? await supabase
          .from('administraciones')
          .select('id, nombre, email, responsable_nombre, responsable_apellido')
          .in('id', adminIds)
      : { data: [], error: null };
    if (adminsRes.error) throw new Error(`cargar admins: ${adminsRes.error.message}`);
    const adminMap = new Map<string, AdministracionRow>();
    for (const a of (adminsRes.data ?? []) as AdministracionRow[]) {
      adminMap.set(a.id, a);
    }

    const consRes = consIds.length
      ? await supabase.from('consorcios').select('id, nombre').in('id', consIds)
      : { data: [], error: null };
    if (consRes.error) throw new Error(`cargar consorcios: ${consRes.error.message}`);
    const consMap = new Map<string, ConsorcioRow>();
    for (const c of (consRes.data ?? []) as ConsorcioRow[]) {
      consMap.set(c.id, c);
    }

    // 4. Procesar cada vencimiento.
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    for (const v of lista) {
      procesados++;
      const cfg = resolveConfig(v.administracion_id, v.tipo);
      if (!cfg || !cfg.activo) continue;

      const fv = new Date(v.fecha_vencimiento + 'T00:00:00');
      const dias = Math.round((fv.getTime() - hoy.getTime()) / 86_400_000);

      // Determinamos qué umbral disparar (cercano gana). Cada flag
      // corresponde a un umbral fijo según el orden 1>2>3 de la config.
      let umbral: number | null = null;
      let flagCol: 'alerta_10d_enviada' | 'alerta_20d_enviada' | 'alerta_30d_enviada' | null = null;
      let template = 'recordatorio-vencimiento-10d';

      if (dias <= cfg.dias_alerta_3 && dias >= 0 && !v.alerta_10d_enviada) {
        umbral = cfg.dias_alerta_3;
        flagCol = 'alerta_10d_enviada';
        template = 'recordatorio-vencimiento-10d';
      } else if (dias <= cfg.dias_alerta_2 && dias > cfg.dias_alerta_3 && !v.alerta_20d_enviada) {
        umbral = cfg.dias_alerta_2;
        flagCol = 'alerta_20d_enviada';
        // Reusamos plantilla 30d para 20d (cercanía intermedia).
        template = 'recordatorio-vencimiento-30d';
      } else if (dias <= cfg.dias_alerta_1 && dias > cfg.dias_alerta_2 && !v.alerta_30d_enviada) {
        umbral = cfg.dias_alerta_1;
        flagCol = 'alerta_30d_enviada';
        template = 'recordatorio-vencimiento-30d';
      }

      if (umbral === null || flagCol === null) continue;

      const admin = adminMap.get(v.administracion_id);
      if (!admin) {
        errores.push({
          vencimiento_id: v.id,
          umbral,
          mensaje: 'administracion_no_encontrada',
        });
        continue;
      }

      const destinatario =
        (cfg.email_destinatario && cfg.email_destinatario.trim()) ||
        (admin.email && admin.email.trim()) ||
        null;
      if (!destinatario) {
        errores.push({
          vencimiento_id: v.id,
          umbral,
          mensaje: 'sin_email_destinatario',
        });
        continue;
      }

      const consorcio = v.consorcio_id ? consMap.get(v.consorcio_id) : null;
      const sujetoNombre =
        v.sujeto === 'consorcio' && consorcio
          ? consorcio.nombre
          : admin.nombre;
      const nombreContacto =
        [admin.responsable_nombre, admin.responsable_apellido]
          .filter(Boolean)
          .join(' ')
          .trim() || admin.nombre;

      const variables = {
        tipo: v.tipo,
        tipo_label: TIPO_LABEL[v.tipo] ?? v.tipo,
        fecha: v.fecha_vencimiento,
        dias_restantes: dias,
        sujeto: v.sujeto,
        sujeto_nombre: sujetoNombre,
        administracion_nombre: admin.nombre,
        consorcio_nombre: consorcio?.nombre ?? null,
        descripcion: v.descripcion,
        servicio_sugerido: cfg.sugerencia_servicio_slug,
      };

      // 5. Encolar email vía RPC. Si todavía no existe (otro agente),
      // capturamos para no romper el cron.
      const encolarOk = await safeEncolarEmail(supabase, {
        template,
        toEmail: destinatario,
        toNombre: nombreContacto,
        variables,
        administracionId: v.administracion_id,
        consorcioId: v.consorcio_id,
        relatedTable: 'vencimientos',
        relatedId: v.id,
        prioridad: dias <= 10 ? 2 : 5,
      });

      if (!encolarOk.ok) {
        errores.push({
          vencimiento_id: v.id,
          umbral,
          mensaje: encolarOk.error,
        });
        continue;
      }

      // 6. Marcar flag.
      const patch: Record<string, string> = {};
      patch[flagCol] = new Date().toISOString();
      const { error: errMark } = await supabase
        .from('vencimientos')
        .update(patch)
        .eq('id', v.id);
      if (errMark) {
        errores.push({
          vencimiento_id: v.id,
          umbral,
          mensaje: `marcar_flag: ${errMark.message}`,
        });
        continue;
      }

      encolados++;
    }
  } catch (e) {
    errores.push({ mensaje: `fatal: ${(e as Error).message}` });
  }

  const duracion = Date.now() - t0;
  await supabase.from('dispatch_vencimientos_log').insert({
    vencimientos_procesados: procesados,
    emails_encolados: encolados,
    errores: errores as unknown as Record<string, unknown>[],
    duracion_ms: duracion,
  });

  return json(
    {
      ok: true,
      procesados,
      encolados,
      errores_count: errores.length,
      duracion_ms: duracion,
    },
    200,
  );
});

interface EncolarParams {
  template: string;
  toEmail: string;
  toNombre: string;
  variables: Record<string, unknown>;
  administracionId: string;
  consorcioId: string | null;
  relatedTable: string;
  relatedId: string;
  prioridad: number;
}

async function safeEncolarEmail(
  supabase: SupabaseClient,
  p: EncolarParams,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc('encolar_email', {
      p_template: p.template,
      p_to_email: p.toEmail,
      p_to_nombre: p.toNombre,
      p_variables: p.variables,
      p_administracion_id: p.administracionId,
      p_consorcio_id: p.consorcioId,
      p_related_table: p.relatedTable,
      p_related_id: p.relatedId,
      p_prioridad: p.prioridad,
    });
    if (error) return { ok: false, error: `rpc_encolar_email: ${error.message}` };
    return { ok: true, id: data as string };
  } catch (e) {
    return { ok: false, error: `rpc_encolar_email_throw: ${(e as Error).message}` };
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
