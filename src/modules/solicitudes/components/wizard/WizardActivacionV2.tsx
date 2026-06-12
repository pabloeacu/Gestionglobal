// Wizard de activación v2 (shell). Orquesta los 6 pasos collect-only con
// encabezado de contexto fijo, stepper (Campus condicional) y navegación
// (Atrás / Siguiente / Cancelar; último = Comenzar proceso). Nada se procesa
// hasta el ProcesadorFinal. Cita: PDF "Wizard rediseñado" + decisiones Q1-Q4.

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { Button, Modal, Stepper, type Step } from '@/components/common';
import type { SolicitudDetalle } from '@/services/api/solicitudes';
import { useWizardActivacion } from './useWizardActivacion';
import { ProcesadorFinal } from './ProcesadorFinal';
import { PasoCliente } from './PasoCliente';
import { PasoDocumentacion } from './PasoDocumentacion';
import { PasoComprobante } from './PasoComprobante';
import { PasoGestoria } from './PasoGestoria';
import { PasoTracking } from './PasoTracking';
import { PasoCampus } from './PasoCampus';
import { totalComprobante } from './types';
import type { PasoKey, PasoProps, SolicitudFlags, WizardState } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  solicitud: SolicitudDetalle;
  onActivated?: (trackingId: string) => void;
}

// Validación mínima por paso para habilitar "Siguiente" (las específicas de
// documentación/comprobante/gestoría/campus llegan en B/C/D).
function validarPaso(key: PasoKey, state: WizardState): boolean {
  switch (key) {
    case 'cliente':
      return state.modoCliente === 'nuevo'
        ? state.nuevoCliente.nombre.trim().length > 0
        : state.clienteIdExistente.length > 0;
    case 'tracking':
      return state.periodo.trim().length > 0 && state.fechaInicio.length > 0;
    case 'documentacion': {
      const hayCruz = Object.values(state.docChecks).some((v) => v === false);
      // 'completa' sólo es válido si no hay ningún ✗; cualquier otra rama
      // (pedir/revisión/rechazo/descarte) exige el mensaje/motivo.
      if (state.docOutcome === 'completa') return !hayCruz;
      return state.docMensajeCliente.trim().length > 0;
    }
    case 'comprobante': {
      const c = state.comprobante;
      if (c.omitir || c.gratuito) return true;
      if (!c.descripcion.trim()) return false;
      const total = totalComprobante(c);
      // $0 (bonif 100) o "sin cobro ahora" → no exige caja.
      if (total === 0 || c.pagoModo === 'ninguno') return true;
      if (!c.cajaId) return false;
      if (c.pagoModo === 'parcial') {
        const m = Number(c.montoCobrado);
        return Number.isFinite(m) && m > 0 && m <= total;
      }
      return true;
    }
    case 'gestoria':
      // Si la derivación está activa, exige el email del gestor.
      return state.gestoria.activa ? state.gestoria.email.trim().length > 0 : true;
    default:
      return true;
  }
}

export function WizardActivacionV2({ open, onClose, solicitud, onActivated }: Props) {
  const navigate = useNavigate();
  // Mientras el ProcesadorFinal corre, bloqueamos el cierre del modal (X/Escape)
  // para no abandonar el proceso a mitad.
  const [procesando, setProcesando] = useState(false);
  const wiz = useWizardActivacion(solicitud, open);
  const {
    flags,
    pasos,
    state,
    set,
    step,
    setStep,
    fase,
    pasoActual,
    esPasoFinal,
    goBack,
    goNext,
    draftPresente,
    reset,
  } = wiz;

  const steps: Step[] = pasos.map((p, i) => ({
    key: p.key,
    label: p.label,
    state: i < step ? 'done' : i === step ? 'current' : 'pending',
  }));

  const canAvanzar = validarPaso(pasoActual.key, state);
  const pasoProps: PasoProps = { solicitud, flags, state, set };

  function renderPaso() {
    switch (pasoActual.key) {
      case 'cliente':
        return <PasoCliente {...pasoProps} />;
      case 'documentacion':
        return <PasoDocumentacion {...pasoProps} />;
      case 'comprobante':
        return <PasoComprobante {...pasoProps} />;
      case 'gestoria':
        return <PasoGestoria {...pasoProps} />;
      case 'tracking':
        return <PasoTracking {...pasoProps} />;
      case 'campus':
        return <PasoCampus {...pasoProps} />;
      default:
        return null;
    }
  }

  return (
    <Modal
      open={open}
      onClose={procesando ? () => {} : onClose}
      title="Wizard de activación"
      kicker="Solicitud · Flujo Maestro"
      width={820}
      closeOnBackdrop={false}
    >
      <div className="space-y-5">
        <ContextoHeader solicitud={solicitud} flags={flags} />

        {fase === 'pasos' ? (
          <>
            {draftPresente && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                <span className="inline-flex items-center gap-2 font-medium">
                  <Sparkles size={12} /> Retomás la activación en el paso {step + 1}.
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-800 transition hover:bg-amber-100"
                >
                  Empezar de cero
                </button>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-3">
              <Stepper steps={steps} current={step} onJump={setStep} compact />
            </div>

            {renderPaso()}

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <div className="flex gap-2">
                {step > 0 && (
                  <Button variant="ghost" onClick={goBack}>
                    <ArrowLeft size={14} /> Atrás
                  </Button>
                )}
                <Button onClick={goNext} disabled={!canAvanzar}>
                  {esPasoFinal ? (
                    <>
                      Comenzar proceso <Sparkles size={14} />
                    </>
                  ) : (
                    <>
                      Siguiente <ArrowRight size={14} />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <ProcesadorFinal
            solicitud={solicitud}
            flags={flags}
            state={state}
            onRunningChange={setProcesando}
            onDone={(trackingId) => {
              if (trackingId) onActivated?.(trackingId);
              onClose();
              // Terminal (revisión/rechazo/descarte) → no hay trámite: volvemos a
              // la lista, donde la solicitud ya refleja su nuevo estado.
              navigate(trackingId ? `/gerencia/trackings/${trackingId}` : '/gerencia/solicitudes');
            }}
          />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Encabezado de contexto fijo (propuesta premium #2): servicio, origen,
// voucher/bonificación, importe de referencia y cliente, visible en todo el
// recorrido.
// ---------------------------------------------------------------------------
function ContextoHeader({
  solicitud,
  flags,
}: {
  solicitud: SolicitudDetalle;
  flags: SolicitudFlags;
}) {
  const importe = solicitud.precio_final ?? solicitud.servicio_precio_base ?? null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-brand-ink">
          {solicitud.servicio_nombre ?? solicitud.formulario_titulo ?? 'Servicio'}
        </span>
        <Badge tone="slate">
          {flags.origen === 'portal' ? 'Portal cliente' : 'Landing pública'}
        </Badge>
        {flags.esGratuito && <Badge tone="emerald">Gratuito / bonificado</Badge>}
        {solicitud.voucher_codigo && <Badge tone="cyan">Voucher {solicitud.voucher_codigo}</Badge>}
        {flags.esDDJJ && <Badge tone="amber">DDJJ</Badge>}
        {flags.esCurso && <Badge tone="cyan">Curso</Badge>}
        {flags.esWebinar && <Badge tone="cyan">Webinar</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-brand-muted">
        <span>
          Solicitante:{' '}
          <strong className="text-brand-ink">{solicitud.solicitante_nombre ?? '—'}</strong>
        </span>
        {solicitud.cliente_nombre && (
          <span>
            Cliente: <strong className="text-brand-ink">{solicitud.cliente_nombre}</strong>
          </span>
        )}
        {importe != null && !flags.esGratuito && (
          <span>
            Importe ref.:{' '}
            <strong className="text-brand-ink">
              ${Number(importe).toLocaleString('es-AR')}
            </strong>
          </span>
        )}
      </div>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'slate' | 'emerald' | 'cyan' | 'amber';
  children: ReactNode;
}) {
  const cls = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    cyan: 'border-brand-cyan/30 bg-brand-cyan-pale/40 text-brand-cyan',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }[tone];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}
