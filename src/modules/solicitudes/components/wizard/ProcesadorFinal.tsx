// ProcesadorFinal · ejecuta la secuencia al apretar "Comenzar proceso" con una
// checklist en vivo (spinner → ✓ con artefacto / ✗ con motivo + Reintentar).
// Q1: secuencial + reintento desde el paso fallido, reusando los RPCs
// existentes. Best-effort (email/alta usuario) avisan pero NO detienen.
//
// Dos caminos:
//  - TERMINAL (Q2: revisión/rechazo/descarte) → una sola op, no se activa nada.
//  - NORMAL (completa / pedir_y_avanzar) → cliente+trámite → portal → comprobante
//    → cobranza → gestoría → campus → pedido de documentación.
//
// Idempotencia/resume: las ops chequean el estado real (tramite_id /
// comprobante_id / cobranzas existentes) para no duplicar al reintentar o
// reabrir el wizard sobre una solicitud parcialmente procesada.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  activar,
  derivar,
  descartar,
  pedirDocsRevision,
  rechazarSolicitud,
  setSolicitudComprobante,
  type SolicitudDetalle,
} from '@/services/api/solicitudes';
import { altaClientePortal, asegurarUsuarioAlumno } from '@/services/api/usuarios';
import { getTramiteAdministracionId } from '@/services/api/tramites';
import {
  emitirComprobanteManual,
  type EmitirComprobanteInput,
} from '@/services/api/comprobantes';
import { listCobranzasDeComprobante, registrarCobranza } from '@/services/api/cobranzas';
import { asignarAlumno } from '@/services/api/campus';
import { inscribirManual } from '@/services/api/webinars';
import { crearPedidoDoc } from '@/services/api/tramitePedidosDoc';
import { agregarLinea } from '@/services/api/trackings';
import { limpiarDraftV2 } from './useWizardActivacion';
import { adjKey, totalComprobante, type SolicitudFlags, type WizardState } from './types';

type OpStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

interface ProcCtx {
  trackingId?: string;
  administracionId?: string;
  comprobanteId?: string;
  /** profile/user del alumno creado en el alta de portal — se pasa explícito a
   *  la matrícula del curso para no depender de la resolución admin→user_id. */
  profileId?: string;
}

interface OpDef {
  key: string;
  label: string;
  bestEffort?: boolean;
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
  onDone: (trackingId: string | null) => void;
  /** Avisa al shell si el procesador está corriendo (para bloquear el cierre). */
  onRunningChange?: (running: boolean) => void;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(n: number): string {
  return `$${n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function adjuntosCruz(solicitud: SolicitudDetalle, state: WizardState): string[] {
  const adj = solicitud.submission_adjuntos ?? [];
  const out: string[] = [];
  adj.forEach((a, i) => {
    if (state.docChecks[adjKey(a.campo, a.nombre, i)] === false) {
      out.push(`${a.campo}: ${a.nombre}`);
    }
  });
  return out;
}

function construirOps(
  solicitud: SolicitudDetalle,
  flags: SolicitudFlags,
  state: WizardState,
): OpDef[] {
  // ---- TERMINAL (Q2): una sola op, sin activar.
  if (state.docOutcome === 'revision') {
    return [
      {
        key: 'revision',
        label: 'Dejar en revisión + avisar al cliente',
        run: async () => {
          const r = await pedirDocsRevision(solicitud.id, state.docMensajeCliente);
          if (!r.ok) throw new Error(humanizeError(r.error));
          return 'Solicitud en revisión · mail enviado';
        },
      },
    ];
  }
  if (state.docOutcome === 'rechazo') {
    return [
      {
        key: 'rechazo',
        label: 'Rechazar la solicitud + avisar al cliente',
        run: async () => {
          const r = await rechazarSolicitud(solicitud.id, state.docMensajeCliente);
          if (!r.ok) throw new Error(humanizeError(r.error));
          return 'Solicitud rechazada · mail enviado';
        },
      },
    ];
  }
  if (state.docOutcome === 'descarte') {
    return [
      {
        key: 'descarte',
        label: 'Descartar la solicitud (interno)',
        run: async () => {
          const r = await descartar(solicitud.id, state.docMensajeCliente);
          if (!r.ok) throw new Error(humanizeError(r.error));
          return 'Solicitud descartada';
        },
      },
    ];
  }

  // ---- NORMAL (completa / pedir_y_avanzar)
  const ops: OpDef[] = [];
  const c = state.comprobante;
  const total = totalComprobante(c);

  // 1 · Cliente + apertura del trámite (solicitud_activar hace ambas cosas).
  ops.push({
    key: 'cliente',
    label:
      state.modoCliente === 'nuevo'
        ? 'Alta del cliente + apertura del trámite'
        : 'Vínculo del cliente + apertura del trámite',
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

  // 1b · Observación interna del tracking (si la gerencia la cargó). Best-effort:
  //      línea interna (no visible al cliente) sobre la apertura.
  if (state.observacionesTracking.trim()) {
    ops.push({
      key: 'observacion',
      label: 'Registrar observación del tracking',
      bestEffort: true,
      run: async (ctx) => {
        if (!ctx.trackingId) return 'Sin trámite';
        const r = await agregarLinea(ctx.trackingId, {
          categoria: 'alta',
          descripcion: state.observacionesTracking.trim(),
          visible_cliente: false,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return 'Observación interna agregada';
      },
    });
  }

  // 2 · Acceso al portal + bienvenida (sólo cliente nuevo).
  //   F1: para un CURSO el usuario de portal es prerequisito de la matrícula
  //   (curso_asignar_alumno lo resuelve desde administraciones.user_id). Por eso
  //   este paso NO es best-effort cuando es curso: si el alta falla, frena antes
  //   de cobrar (no "cobrado sin matricular") y es reintentable (la edge fn es
  //   idempotente). Para no-curso sigue siendo best-effort (la bienvenida es
  //   un nice-to-have). Además capturamos el user_id para pasarlo explícito a
  //   la matrícula.
  if (state.modoCliente === 'nuevo') {
    ops.push({
      key: 'portal',
      label: 'Acceso al portal + correo de bienvenida',
      bestEffort: !flags.esCurso,
      run: async (ctx) => {
        if (!ctx.administracionId) throw new Error('No se pudo resolver el cliente creado');
        const email =
          (state.nuevoCliente.email ?? '').trim() || solicitud.solicitante_email || '';
        const nombre =
          (state.nuevoCliente.nombre ?? '').trim() || solicitud.solicitante_nombre || 'Cliente';
        if (!email) {
          if (flags.esCurso)
            throw new Error('El alumno necesita un email para crear su acceso al curso.');
          return 'Sin email: no se envió la bienvenida';
        }
        const r = await altaClientePortal({
          administracion_id: ctx.administracionId,
          email,
          nombre,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        ctx.profileId = (r.data as { user_id?: string } | null)?.user_id ?? undefined;
        return 'Bienvenida enviada con credenciales';
      },
    });
  }

  // 3 · Comprobante (si no se omite). DDJJ ya viene con omitir=true.
  if (!c.omitir) {
    ops.push({
      key: 'comprobante',
      label: total === 0 ? 'Emitir comprobante en $0' : 'Emitir comprobante',
      run: async (ctx) => {
        if (solicitud.comprobante_id) {
          ctx.comprobanteId = solicitud.comprobante_id;
          return 'El comprobante ya existía';
        }
        if (!ctx.administracionId) throw new Error('Falta el cliente para emitir el comprobante');
        const input: EmitirComprobanteInput = {
          administracion_id: ctx.administracionId,
          consorcio_id: null,
          tipo: 'X',
          punto_venta: 1,
          fecha: hoy(),
          vencimiento: hoy(),
          concepto: 'servicios',
          items: [
            {
              descripcion: c.descripcion || 'Servicio',
              cantidad: 1,
              precio_unitario: Number(c.precio) || 0,
              bonificacion_porc: Math.min(100, Math.max(0, Number(c.bonifPorc) || 0)),
              alicuota_iva: 'exento',
              servicio_id: null,
              consorcio_id: null,
            },
          ],
          observaciones: '',
        };
        const r = await emitirComprobanteManual(input);
        if (!r.ok) throw new Error(humanizeError(r.error));
        ctx.comprobanteId = r.data.id;
        await setSolicitudComprobante(solicitud.id, r.data.id);
        return total === 0 ? 'Comprobante $0 emitido' : `Comprobante emitido (${fmtMoney(total)})`;
      },
    });
  }

  // 4 · Cobranza (si hay comprobante con saldo y modo de cobro).
  if (!c.omitir && !c.gratuito && total > 0 && c.pagoModo !== 'ninguno') {
    ops.push({
      key: 'cobranza',
      label: 'Registrar cobranza',
      run: async (ctx) => {
        if (!ctx.comprobanteId) throw new Error('No hay comprobante para cobrar');
        // Idempotencia (reload): si ya tiene cobranza, no duplicar.
        const prev = await listCobranzasDeComprobante(ctx.comprobanteId);
        if (prev.ok && prev.data.length > 0) return 'Ya estaba cobrado';
        const monto = c.pagoModo === 'parcial' ? Number(c.montoCobrado) || 0 : total;
        const r = await registrarCobranza({
          comprobante_id: ctx.comprobanteId,
          caja_id: c.cajaId,
          fecha: hoy(),
          monto,
          descripcion: `Cobranza · ${c.descripcion}`,
          referencia: '',
          categoria_id: c.categoriaId || null,
          partner_id_atribucion: c.partnerId,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return `Cobranza ${fmtMoney(monto)} registrada`;
      },
    });
  }

  // 5 · Derivación a gestoría (si está activa) — mail + egreso diferidos.
  if (state.gestoria.activa) {
    ops.push({
      key: 'gestoria',
      label: 'Derivar a la gestoría',
      run: async () => {
        const gg = state.gestoria;
        const montoNum = parseFloat((gg.montoGestoria || '').replace(',', '.'));
        const tieneMonto = !isNaN(montoNum) && montoNum > 0;
        const r = await derivar(solicitud.id, {
          destinatario_email: gg.email.trim(),
          destinatario_nombre: gg.nombre.trim() || undefined,
          observaciones: gg.observaciones.trim() || undefined,
          dias_validez: gg.diasValidez,
          monto_pago_gestoria: tieneMonto ? montoNum : null,
          adjuntos: gg.adjuntos.length > 0 ? gg.adjuntos : undefined,
          caja_id: tieneMonto && gg.cajaId ? gg.cajaId : null,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return r.data.tieneEgreso ? 'Derivada · mail + egreso' : 'Derivada · mail enviado';
      },
    });
  }

  // 6 · Campus (curso o webinar) — sólo si se eligió uno.
  if (flags.esCurso && state.campus.cursoId) {
    const cursoId = state.campus.cursoId;
    ops.push({
      key: 'campus',
      label: 'Matricular en el curso',
      // F1: la matrícula del curso NO es best-effort — un curso cobrado no puede
      // quedar sin matricular en silencio. Falla VISIBLE + Reintentar.
      bestEffort: false,
      run: async (ctx) => {
        if (!ctx.administracionId) throw new Error('Falta el cliente para matricular');
        // F1: la matrícula necesita el usuario de portal del alumno
        // (curso_asignar_alumno lo resuelve desde administraciones.user_id). Lo
        // capturamos en el alta (cliente nuevo); para cliente EXISTENTE sin acceso
        // —o si se reabrió el modal y se perdió el ctx— lo resolvemos o lo creamos
        // acá. Así un curso cobrado NUNCA queda sin matricular.
        let profileId = ctx.profileId;
        if (!profileId) {
          const ensured = await asegurarUsuarioAlumno({
            administracionId: ctx.administracionId,
            fallbackEmail: solicitud.solicitante_email,
            fallbackNombre: solicitud.cliente_nombre ?? solicitud.solicitante_nombre,
          });
          if (!ensured.ok)
            throw new Error(
              'No se pudo preparar el acceso del alumno al portal (necesario para ' +
                `matricular): ${humanizeError(ensured.error)}`,
            );
          profileId = ensured.data.profileId;
          ctx.profileId = profileId;
        }
        const r = await asignarAlumno({
          cursoId,
          administracionId: ctx.administracionId,
          profileId,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return 'Alumno matriculado';
      },
    });
  }
  if (flags.esWebinar && state.campus.webinarId) {
    const webinarId = state.campus.webinarId;
    ops.push({
      key: 'webinar',
      label: 'Inscribir al evento',
      bestEffort: true,
      run: async () => {
        const email = (
          (state.modoCliente === 'nuevo' ? state.nuevoCliente.email : null) ??
          solicitud.solicitante_email ??
          ''
        ).trim();
        const nombre =
          (state.modoCliente === 'nuevo' ? state.nuevoCliente.nombre : solicitud.cliente_nombre) ??
          solicitud.solicitante_nombre ??
          'Cliente';
        if (!email) throw new Error('Falta email para inscribir al evento');
        const r = await inscribirManual({
          webinarId,
          email,
          nombre,
          telefono: solicitud.solicitante_telefono ?? undefined,
        });
        if (!r.ok) throw new Error(humanizeError(r.error));
        return 'Inscripto al evento';
      },
    });
  }

  // 7 · Pedido de documentación (si la rama es pedir_y_avanzar).
  if (state.docOutcome === 'pedir_y_avanzar') {
    ops.push({
      key: 'pedidodoc',
      label: 'Pedir documentación al cliente',
      run: async (ctx) => {
        if (!ctx.trackingId) throw new Error('No hay trámite para el pedido');
        const items = adjuntosCruz(solicitud, state);
        const r = await crearPedidoDoc(
          ctx.trackingId,
          state.docMensajeCliente.trim() || 'Documentación pendiente',
          items.length > 0 ? items : ['Documentación pendiente'],
        );
        if (!r.ok) throw new Error(humanizeError(r.error));
        return 'Pedido de documentación enviado';
      },
    });
  }

  return ops;
}

export function ProcesadorFinal({ solicitud, flags, state, onDone, onRunningChange }: Props) {
  const ops = useMemo(() => construirOps(solicitud, flags, state), [solicitud, flags, state]);
  const [views, setViews] = useState<OpView[]>(() =>
    ops.map((o) => ({ key: o.key, label: o.label, status: 'pending', bestEffort: o.bestEffort })),
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
      patchView(op.key, { status: 'running', error: undefined });
      try {
        const artefacto = await op.run(ctxRef.current);
        patchView(op.key, { status: 'done', artefacto: artefacto || undefined });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error inesperado';
        if (op.bestEffort) {
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
    const trackingId = ctxRef.current.trackingId ?? null;
    limpiarDraftV2(solicitud.id);
    toast.success(trackingId ? 'Proceso completado' : 'Solicitud actualizada');
    onDone(trackingId);
  }

  useEffect(() => {
    void correr(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Avisa al shell mientras corre (para bloquear el cierre del modal y evitar
  // abandonar el proceso a mitad — defensa contra duplicación al reabrir).
  useEffect(() => {
    onRunningChange?.(corriendo);
  }, [corriendo, onRunningChange]);

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
                {v.status === 'done' && <Check size={18} className="text-emerald-600" />}
                {v.status === 'running' && (
                  <Loader2 size={18} className="animate-spin text-brand-cyan" />
                )}
                {v.status === 'error' && (
                  <AlertTriangle
                    size={18}
                    className={v.bestEffort ? 'text-amber-500' : 'text-red-600'}
                  />
                )}
                {v.status === 'skipped' && <SkipForward size={18} className="text-slate-400" />}
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
                </span>
                {v.artefacto && <span className="block text-xs text-brand-muted">{v.artefacto}</span>}
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
