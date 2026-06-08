// ProcesadorFinal · ejecuta la secuencia de operaciones al apretar "Comenzar
// proceso", mostrando una checklist en vivo (spinner → ✓ con artefacto / ✗ con
// motivo + Reintentar). Q1: secuencial + reintento desde el paso fallido,
// reusando los RPCs existentes. Las ops best-effort (ej. email) avisan pero NO
// detienen la secuencia.
//
// Chunk A: ops cliente + acceso al portal (baseline). Chunk E suma comprobante,
// cobranza, derivación, campus y pedido de documentación + checkpoint/resume.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { activar, type SolicitudDetalle } from '@/services/api/solicitudes';
import { altaClientePortal } from '@/services/api/usuarios';
import { getTramiteAdministracionId } from '@/services/api/tramites';
import { limpiarDraftV2 } from './useWizardActivacion';
import type { SolicitudFlags, WizardState } from './types';

type OpStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

interface ProcCtx {
  trackingId?: string;
  administracionId?: string;
  comprobanteId?: string;
}

interface OpDef {
  key: string;
  label: string;
  /** Fallo NO detiene la secuencia (best-effort: email, alta de usuario, etc.). */
  bestEffort?: boolean;
  /** Se marca 'skipped' sin ejecutar. */
  skip?: boolean;
  /** Devuelve un texto de "artefacto" para mostrar en la checklist. */
  run: (ctx: ProcCtx) => Promise<string | void>;
}

interface OpView {
  key: string;
  label: string;
  status: OpStatus;
  artefacto?: string;
  error?: string;
  bestEffort?: boolean;
}

interface Props {
  solicitud: SolicitudDetalle;
  flags: SolicitudFlags;
  state: WizardState;
  onDone: (trackingId: string) => void;
}

// ---------------------------------------------------------------------------
// Construcción de la secuencia de operaciones desde el estado collect-only.
// ---------------------------------------------------------------------------
function construirOps(
  solicitud: SolicitudDetalle,
  flags: SolicitudFlags,
  state: WizardState,
): OpDef[] {
  const ops: OpDef[] = [];

  // 1 · Cliente + apertura del trámite (solicitud_activar hace ambas cosas
  //     atómicamente). Idempotencia: si la solicitud ya tiene trámite, se saltea.
  ops.push({
    key: 'cliente',
    label:
      state.modoCliente === 'nuevo'
        ? 'Alta del cliente + apertura del trámite'
        : 'Vínculo del cliente + apertura del trámite',
    skip: flags.yaTieneTramite,
    run: async (ctx) => {
      if (flags.yaTieneTramite && solicitud.tramite_id) {
        ctx.trackingId = solicitud.tramite_id;
        const adminPrev = await getTramiteAdministracionId(solicitud.tramite_id);
        if (adminPrev.ok) ctx.administracionId = adminPrev.data ?? undefined;
        return 'El trámite ya existía';
      }
      const res = await activar(solicitud.id, {
        cliente_id:
          state.modoCliente === 'existente' ? state.clienteIdExistente || null : null,
        crear_cliente: state.modoCliente === 'nuevo' ? state.nuevoCliente : null,
        periodo: state.periodo,
        fecha_inicio: state.fechaInicio,
      });
      if (!res.ok) throw new Error(humanizeError(res.error));
      ctx.trackingId = res.data.trackingId;
      const adminRes = await getTramiteAdministracionId(res.data.trackingId);
      if (adminRes.ok) ctx.administracionId = adminRes.data ?? undefined;
      return `Trámite abierto (${res.data.trackingId.slice(0, 8)}…)`;
    },
  });

  // 2 · Acceso al portal + bienvenida con credenciales (sólo cliente nuevo).
  //     Best-effort: si falla, no aborta la activación.
  if (state.modoCliente === 'nuevo') {
    ops.push({
      key: 'portal',
      label: 'Acceso al portal + correo de bienvenida',
      bestEffort: true,
      run: async (ctx) => {
        if (!ctx.administracionId) throw new Error('No se pudo resolver el cliente creado');
        const email =
          (state.nuevoCliente.email ?? '').trim() || solicitud.solicitante_email || '';
        const nombre =
          (state.nuevoCliente.nombre ?? '').trim() || solicitud.solicitante_nombre || 'Cliente';
        if (!email) return 'Sin email: no se envió la bienvenida';
        const r = await altaClientePortal({
          administracion_id: ctx.administracionId,
          email,
          nombre,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return 'Bienvenida enviada con credenciales';
      },
    });
  }

  return ops;
}

export function ProcesadorFinal({ solicitud, flags, state, onDone }: Props) {
  const ops = useMemo(() => construirOps(solicitud, flags, state), [solicitud, flags, state]);
  const [views, setViews] = useState<OpView[]>(() =>
    ops.map((o) => ({
      key: o.key,
      label: o.label,
      status: o.skip ? 'skipped' : 'pending',
      bestEffort: o.bestEffort,
    })),
  );
  const ctxRef = useRef<ProcCtx>({});
  const desdeRef = useRef(0);
  const [corriendo, setCorriendo] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [terminado, setTerminado] = useState(false);

  function patchView(key: string, patch: Partial<OpView>) {
    setViews((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  }

  async function correr(desde: number) {
    setCorriendo(true);
    setFallo(false);
    for (let i = desde; i < ops.length; i++) {
      const op = ops[i];
      if (!op) continue;
      if (op.skip) {
        patchView(op.key, { status: 'skipped' });
        continue;
      }
      patchView(op.key, { status: 'running', error: undefined });
      try {
        const artefacto = await op.run(ctxRef.current);
        patchView(op.key, { status: 'done', artefacto: artefacto || undefined });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error inesperado';
        if (op.bestEffort) {
          // Avisa pero continúa.
          patchView(op.key, { status: 'error', error: msg });
          continue;
        }
        patchView(op.key, { status: 'error', error: msg });
        desdeRef.current = i;
        setCorriendo(false);
        setFallo(true);
        return;
      }
    }
    setCorriendo(false);
    setTerminado(true);
    const trackingId = ctxRef.current.trackingId;
    if (trackingId) {
      limpiarDraftV2(solicitud.id);
      toast.success('Proceso completado');
      onDone(trackingId);
    }
  }

  // Arranca automáticamente al montar.
  useEffect(() => {
    void correr(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-brand-ink">
          {terminado
            ? '✓ Proceso completado'
            : fallo
              ? 'Se detuvo el proceso'
              : 'Procesando la solicitud…'}
        </p>
        <ul className="mt-3 space-y-2">
          {views.map((v) => (
            <li key={v.key} className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {v.status === 'done' && (
                  <Check size={18} className="text-emerald-600" />
                )}
                {v.status === 'running' && (
                  <Loader2 size={18} className="animate-spin text-brand-cyan" />
                )}
                {v.status === 'error' && (
                  <AlertTriangle
                    size={18}
                    className={v.bestEffort ? 'text-amber-500' : 'text-red-600'}
                  />
                )}
                {v.status === 'skipped' && (
                  <SkipForward size={18} className="text-slate-400" />
                )}
                {v.status === 'pending' && (
                  <span className="block h-[18px] w-[18px] rounded-full border-2 border-slate-200" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-medium ${
                    v.status === 'skipped' ? 'text-slate-400' : 'text-brand-ink'
                  }`}
                >
                  {v.label}
                  {v.status === 'skipped' && ' · omitido'}
                </span>
                {v.artefacto && (
                  <span className="block text-xs text-brand-muted">{v.artefacto}</span>
                )}
                {v.status === 'error' && v.error && (
                  <span
                    className={`block text-xs ${
                      v.bestEffort ? 'text-amber-600' : 'text-red-600'
                    }`}
                  >
                    {v.bestEffort ? 'Aviso: ' : ''}
                    {v.error}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {fallo && (
        <div className="flex justify-end">
          <Button onClick={() => void correr(desdeRef.current)} loading={corriendo}>
            <RotateCcw size={14} /> Reintentar
          </Button>
        </div>
      )}
    </div>
  );
}
