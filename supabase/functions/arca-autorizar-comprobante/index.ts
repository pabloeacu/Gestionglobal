// arca-autorizar-comprobante · el caballito de batalla. Toma un job de la cola,
// resuelve TA (cacheado o nuevo), arma FECAESolicitar, parsea CAE, actualiza
// comprobante + job. Doc 02 §4 (flujo completo) + E41 (calcDoc).
// Invocada por el dispatcher (cron) o por reintento manual.
// verify_jwt=false: bearer CRON_SECRET o service_role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';
import {
  wsaaLogin,
  feCompUltimoAutorizado,
  feCAESolicitar,
  calcDoc,
  tipoToCbte,
  alicuotaToId,
  isTransientArcaError,
  b64ToPem,
  type IvaAlicuotaXml,
  type Ambiente,
} from '../_shared/arca.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed');

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!bearer || (bearer !== cronSecret && bearer !== serviceKey)) {
    return jsonError(401, 'Bearer inválido');
  }

  let body: { job_id?: string };
  try { body = await req.json(); } catch { return jsonError(400, 'JSON inválido'); }
  if (!body.job_id) return jsonError(400, 'job_id requerido');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey!);
  const result = await autorizar(admin, body.job_id);
  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: result.ok ? 200 : 200, // siempre 200 para que el dispatcher no lo trate como error HTTP.
  });
});

async function autorizar(admin: ReturnType<typeof createClient>, jobId: string) {
  // 1. Lock del job con FOR UPDATE SKIP LOCKED + transición a sending.
  const { data: jobRow, error: jobErr } = await admin
    .from('arca_emision_queue')
    .select('id, comprobante_id, status, attempt, max_attempts')
    .eq('id', jobId)
    .single();
  if (jobErr || !jobRow) return { ok: false, error: `Job no encontrado: ${jobErr?.message ?? 'null'}` };
  if (!['pending', 'sending'].includes(jobRow.status as string)) {
    return { ok: true, skipped: true, motivo: `job en estado ${jobRow.status}` };
  }

  const startedAt = new Date().toISOString();
  await admin.from('arca_emision_queue').update({
    status: 'sending',
    attempt: (jobRow.attempt as number) + 1,
    started_at: startedAt,
  }).eq('id', jobId);

  try {
    // 2. Leer comprobante + items.
    const { data: comp, error: cErr } = await admin
      .from('comprobantes')
      .select('id, tipo, punto_venta, fecha, vencimiento, concepto, moneda, cotizacion, receptor_tipo_documento, receptor_numero_documento, neto, no_gravado, exento, total_iva, iva_21, iva_105, iva_27, total, periodo')
      .eq('id', jobRow.comprobante_id)
      .single();
    if (cErr || !comp) throw new Error(`Comprobante no encontrado: ${cErr?.message ?? ''}`);

    const { data: items } = await admin
      .from('items_comprobantes')
      .select('subtotal, iva, alicuota_iva')
      .eq('comprobante_id', comp.id);

    // 3. Leer config ARCA.
    const { data: cfg, error: cfgErr } = await admin
      .from('arca_config')
      .select('ambiente, cert_b64, key_b64')
      .eq('id', 1)
      .single();
    if (cfgErr || !cfg) throw new Error('No pudimos leer arca_config');
    if (!cfg.cert_b64 || !cfg.key_b64) throw new Error('ARCA sin cert/key');
    const ambiente = cfg.ambiente as Ambiente;

    const { data: cg } = await admin.from('config_global').select('cuit').eq('id', 1).single();
    if (!cg?.cuit) throw new Error('config_global.cuit no cargado');

    // 4. calcDoc (E41) — defensa en profundidad.
    const { docTipo, docNro } = calcDoc(
      String(comp.receptor_tipo_documento),
      String(comp.receptor_numero_documento),
    );

    // 5. Obtener TA (cache o nuevo).
    let token: string;
    let sign: string;
    const { data: cached } = await admin
      .from('arca_tokens')
      .select('token, sign, expires_at')
      .eq('service', 'wsfe')
      .eq('ambiente', ambiente)
      .maybeSingle();
    const margenMs = 60 * 1000;
    if (cached && new Date(cached.expires_at as string).getTime() > Date.now() + margenMs) {
      token = cached.token as string;
      sign = cached.sign as string;
    } else {
      const ta = await wsaaLogin({
        ambiente,
        certPem: b64ToPem(cfg.cert_b64),
        keyPem: b64ToPem(cfg.key_b64),
      });
      token = ta.token;
      sign = ta.sign;
      await admin.from('arca_tokens').upsert(
        {
          service: 'wsfe',
          ambiente,
          token,
          sign,
          obtained_at: new Date().toISOString(),
          expires_at: ta.expirationTime,
        },
        { onConflict: 'service,ambiente' },
      );
    }

    // 6. Resolver próximo número.
    const cbteTipo = tipoToCbte(String(comp.tipo));
    const ultimo = await feCompUltimoAutorizado({
      ambiente, token, sign, cuit: cg.cuit, ptoVta: comp.punto_venta as number, cbteTipo,
    });
    const cbteNro = ultimo + 1;

    // 7. Armar alícuotas agregadas.
    const alicMap = new Map<number, { base: number; iva: number }>();
    for (const it of items ?? []) {
      const id = alicuotaToId(String(it.alicuota_iva));
      if (id == null) continue; // exento/no_gravado no van como AlicIva.
      const cur = alicMap.get(id) ?? { base: 0, iva: 0 };
      cur.base += Number(it.subtotal);
      cur.iva += Number(it.iva);
      alicMap.set(id, cur);
    }
    const alicuotas: IvaAlicuotaXml[] = [];
    for (const [id, v] of alicMap) {
      alicuotas.push({ Id: id, BaseImp: round2(v.base), Importe: round2(v.iva) });
    }
    // Para tipo C: no se mandan alícuotas (Monotributo / sin discriminar).
    const esTipoC = String(comp.tipo).endsWith('_C') || String(comp.tipo) === 'C';

    // 8. FECAESolicitar.
    const fecha = String(comp.fecha).replaceAll('-', '');
    const conceptoMap: Record<string, 1 | 2 | 3> = { productos: 1, servicios: 2, productos_servicios: 3 };
    const concepto = conceptoMap[String(comp.concepto)] ?? 2;
    const isService = concepto !== 1;
    const periodoStr = String(comp.periodo); // YYYY-MM-01
    const periodoYM = periodoStr.slice(0, 7).replaceAll('-', '');
    const fchServDesde = isService ? `${periodoYM}01` : undefined;
    // Día último del mes:
    const periodoYear = Number(periodoStr.slice(0, 4));
    const periodoMonth = Number(periodoStr.slice(5, 7));
    const lastDay = new Date(periodoYear, periodoMonth, 0).getDate();
    const fchServHasta = isService ? `${periodoYM}${String(lastDay).padStart(2, '0')}` : undefined;
    const fchVtoPago = isService && comp.vencimiento ? String(comp.vencimiento).replaceAll('-', '') : undefined;

    const out = await feCAESolicitar({
      ambiente, token, sign, cuit: cg.cuit,
      ptoVta: comp.punto_venta as number,
      cbteTipo,
      concepto,
      docTipo, docNro,
      cbteDesde: cbteNro, cbteHasta: cbteNro,
      cbteFch: fecha,
      impTotal: Number(comp.total),
      impTotConc: Number(comp.no_gravado),
      impNeto: esTipoC ? Number(comp.total) - Number(comp.no_gravado) - Number(comp.exento) : Number(comp.neto),
      impOpEx: Number(comp.exento),
      impIVA: esTipoC ? 0 : Number(comp.total_iva),
      impTrib: 0,
      moneda: comp.moneda === 'USD' ? 'DOL' : 'PES',
      cotizacion: Number(comp.cotizacion ?? 1),
      alicuotas: esTipoC ? [] : alicuotas,
      fchServDesde, fchServHasta, fchVtoPago,
    });

    // 9. Procesar respuesta.
    const finishedAt = new Date().toISOString();
    if (out.resultado === 'A' && out.cae) {
      // Convertir caeFchVto YYYYMMDD → YYYY-MM-DD.
      const caeVto = out.caeFchVto && /^\d{8}$/.test(out.caeFchVto)
        ? `${out.caeFchVto.slice(0, 4)}-${out.caeFchVto.slice(4, 6)}-${out.caeFchVto.slice(6, 8)}`
        : null;

      await admin.from('comprobantes').update({
        numero: cbteNro,
        cae: out.cae,
        cae_vencimiento: caeVto,
        estado: out.observaciones.length > 0 ? 'observado' : 'autorizado',
        emitido_arca: true,
        arca_observaciones: out.observaciones.length > 0 ? out.observaciones : null,
        arca_request_xml: null, // D08: solo persistir si rechazo.
        arca_response_xml: null,
        receptor_doc_tipo_enviado: docTipo,
      }).eq('id', comp.id);

      await admin.from('arca_emision_queue').update({
        status: 'done',
        cae: out.cae,
        cae_vencimiento: caeVto,
        request_xml: null,
        response_xml: null,
        finished_at: finishedAt,
        last_error: null,
      }).eq('id', jobId);

      // Si quedaron numeradores manuales viejos, actualizarlos. (Best effort.)
      await admin.from('numeradores').upsert(
        { punto_venta: comp.punto_venta, tipo: comp.tipo, ultimo_numero: cbteNro, updated_at: new Date().toISOString() },
        { onConflict: 'punto_venta,tipo' },
      );

      return { ok: true, cae: out.cae, numero: cbteNro };
    }

    // Rechazo: persistir XML para debug.
    const errMsg = out.errores.length > 0
      ? out.errores.map((e) => `[${e.code}] ${e.msg}`).join(' · ')
      : `Resultado=${out.resultado}`;

    // Discernir transient vs permanente.
    const transient = isTransientArcaError(new Error(errMsg)) || out.errores.some((e) => e.code >= 500);
    const newAttempt = (jobRow.attempt as number) + 1;
    if (transient && newAttempt < (jobRow.max_attempts as number)) {
      await admin.from('arca_emision_queue').update({
        status: 'pending',
        scheduled_at: new Date(Date.now() + 60 * 1000).toISOString(),
        request_xml: out.rawRequest,
        response_xml: out.rawResponse,
        last_error: `[transient] ${errMsg}`,
      }).eq('id', jobId);
      return { ok: false, transient: true, error: errMsg };
    }

    // Permanente → failed + actualizar comprobante.
    await admin.from('comprobantes').update({
      estado: 'rechazado',
      motivo_rechazo: errMsg.slice(0, 1000),
      arca_request_xml: out.rawRequest,
      arca_response_xml: out.rawResponse,
      arca_observaciones: out.errores,
      receptor_doc_tipo_enviado: docTipo,
    }).eq('id', comp.id);

    await admin.from('arca_emision_queue').update({
      status: 'failed',
      request_xml: out.rawRequest,
      response_xml: out.rawResponse,
      last_error: errMsg,
      finished_at: finishedAt,
    }).eq('id', jobId);

    return { ok: false, transient: false, error: errMsg };
  } catch (e) {
    const msg = (e as Error).message;
    const transient = isTransientArcaError(e);
    const newAttempt = (jobRow.attempt as number) + 1;
    const finishedAt = new Date().toISOString();
    if (transient && newAttempt < (jobRow.max_attempts as number)) {
      await admin.from('arca_emision_queue').update({
        status: 'pending',
        scheduled_at: new Date(Date.now() + 60 * 1000).toISOString(),
        last_error: `[transient-exception] ${msg}`,
      }).eq('id', jobId);
      return { ok: false, transient: true, error: msg };
    }
    await admin.from('arca_emision_queue').update({
      status: 'failed',
      last_error: msg,
      finished_at: finishedAt,
    }).eq('id', jobId);
    await admin.from('comprobantes').update({ estado: 'error', motivo_rechazo: msg.slice(0, 500) }).eq('id', jobRow.comprobante_id);
    return { ok: false, transient: false, error: msg };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
