// dispatch-recupero
//
// Cron diario 09:30 AR = 12:30 UTC. Itera sobre `comprobantes_morosos()`,
// determina nivel R1/R2/R3 según config (override por admin o default
// global) y llama RPC `disparar_recupero_manual` que persiste la acción y
// encola el email. El trigger anti-dup (7 días) protege contra reenvíos.
//
// Auth: bearer CRON_SECRET opcional. Audita resumen en
// `dispatch_recupero_log`. Regla 1 (persistencia BD), regla 5 (RPC SD
// multi-tabla), D05/E42 (throttle vía dispatcher de emails).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

interface MorosoRow {
  comprobante_id: string;
  comprobante_tipo: string;
  comprobante_numero: number | null;
  punto_venta: number | null;
  fecha: string;
  vencimiento: string;
  total: number;
  saldo_pendiente: number;
  estado_cobranza: string;
  administracion_id: string;
  administracion_nombre: string;
  consorcio_id: string | null;
  consorcio_nombre: string | null;
  dias_vencido: number;
  nivel_sugerido: number | null;
  ultima_accion_at: string | null;
  ultima_accion_nivel: number | null;
}

interface ErrorLog {
  comprobante_id?: string;
  nivel?: number;
  mensaje: string;
}

Deno.serve(async (req) => {
  const t0 = Date.now();

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
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
    // 1. Listar morosos (RPC ya calcula nivel_sugerido).
    const { data, error } = await supabase.rpc('comprobantes_morosos', {
      p_administracion_id: null,
    });
    if (error) throw new Error(`comprobantes_morosos: ${error.message}`);

    const morosos = (data ?? []) as MorosoRow[];

    for (const m of morosos) {
      procesados++;

      // Sin nivel sugerido = el comprobante todavía no llegó al umbral R1.
      if (!m.nivel_sugerido) continue;

      // Si la última acción fue del MISMO nivel hace < 7 días, el trigger
      // anti-dup la rechazaría; salteamos para no contaminar errores.
      if (
        m.ultima_accion_at &&
        m.ultima_accion_nivel === m.nivel_sugerido
      ) {
        const ageDays =
          (Date.now() - new Date(m.ultima_accion_at).getTime()) / 86_400_000;
        if (ageDays < 7) continue;
      }

      const r = await safeDispararRecupero(supabase, {
        comprobanteId: m.comprobante_id,
        nivel: m.nivel_sugerido,
        observaciones: `Disparo automático cron — ${m.dias_vencido} días vencido`,
      });

      if (!r.ok) {
        // El error 23505 (trigger anti-dup) es esperado y silencioso.
        if (r.error.includes('23505') || r.error.includes('últimos 7 días')) {
          continue;
        }
        errores.push({
          comprobante_id: m.comprobante_id,
          nivel: m.nivel_sugerido,
          mensaje: r.error,
        });
        continue;
      }
      encolados++;
    }
  } catch (e) {
    errores.push({ mensaje: `fatal: ${(e as Error).message}` });
  }

  const duracion = Date.now() - t0;
  await supabase.from('dispatch_recupero_log').insert({
    procesados,
    encolados,
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

interface DispararParams {
  comprobanteId: string;
  nivel: number;
  observaciones: string;
}

async function safeDispararRecupero(
  supabase: SupabaseClient,
  p: DispararParams,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc('disparar_recupero_manual', {
      p_comprobante_id: p.comprobanteId,
      p_nivel: p.nivel,
      p_observaciones: p.observaciones,
    });
    if (error) {
      return {
        ok: false,
        error: `${error.code ?? ''} ${error.message}`.trim(),
      };
    }
    return { ok: true, id: data as string };
  } catch (e) {
    return { ok: false, error: `throw: ${(e as Error).message}` };
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
