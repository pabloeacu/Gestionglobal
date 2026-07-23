// Wizard de activación v2 (rediseño · Pablo 2026-06-07).
// Tipos compartidos del wizard "collect-only": cada paso JUNTA información en
// memoria y NADA se procesa hasta el paso final ("Comenzar proceso"), donde el
// ProcesadorFinal ejecuta los RPCs existentes en orden con una checklist en
// vivo. Cita: PDF "Wizard rediseñado", decisiones Q1 (secuencial+reintento),
// Q2 (Paso 2 terminal), Q3 (DDJJ saltea / gratis=$0), Q4 (paneles intactos).

import type { Dispatch, SetStateAction } from 'react';
import type { CrearClienteInput, SolicitudDetalle } from '@/services/api/solicitudes';

export type ModoCliente = 'nuevo' | 'existente';

// Resultado del Paso 2 (revisión de documentación y pagos).
export type DocOutcome =
  | 'completa' // todo ✓ → activación normal
  | 'pedir_y_avanzar' // hay ✗ pero se activa igual + PedidoDoc como primer tracking
  | 'revision' // TERMINAL: deja la solicitud en_revision + mail explicativo
  | 'rechazo' // TERMINAL: solicitud_rechazar (mail formal al cliente)
  | 'descarte'; // TERMINAL: solicitud_descartar (interno, sin mail)

// Outcomes que cortan el wizard en el Paso 2 (Q2 = terminal).
export const DOC_OUTCOMES_TERMINALES: DocOutcome[] = ['revision', 'rechazo', 'descarte'];

export type PagoModo = 'total' | 'parcial' | 'ninguno';

export interface ComprobanteState {
  /** DDJJ → no se emite comprobante en el wizard (se hará al cerrar el trámite). */
  omitir: boolean;
  /** Servicio gratuito / 100% bonificado → comprobante en $0 sin cobranza. */
  gratuito: boolean;
  /** Descripción del ítem (nombre del servicio). El concepto fiscal es 'servicios'. */
  descripcion: string;
  /** Precio unitario bruto del ítem (antes de bonificación). */
  precio: string;
  /** Bonificación 0..100 (%). 100 = gratis. */
  bonifPorc: string;
  pagoModo: PagoModo;
  /** Monto efectivamente cobrado si pagoModo='parcial'. */
  montoCobrado: string;
  cajaId: string;
  /** E-GG-153: fecha real del pago/transferencia (YYYY-MM-DD). Puede diferir de
   *  la fecha del comprobante (el cliente pudo transferir otro día). */
  fechaPago: string;
  /** E-GG-153: N° de comprobante / transferencia (referencia del movimiento).
   *  Opcional — no todo pago tiene número (efectivo). Va a cobranza.referencia. */
  referencia: string;
  /** Categoría de ingreso (opcional) para reportes financieros. */
  categoriaId: string;
  compartePartner: boolean;
  partnerId: string | null;
}

export interface GestoriaAdjunto {
  path: string;
  filename: string;
  mime: string;
  size: number;
}

export interface GestoriaState {
  /** Switch maestro: si está apagado, el paso se saltea por completo. */
  activa: boolean;
  email: string;
  nombre: string;
  observaciones: string;
  diasValidez: number;
  /** Monto interno que paga la empresa a la gestoría (no visible al cliente). */
  montoGestoria: string;
  cajaId: string;
  adjuntos: GestoriaAdjunto[];
}

export interface CampusState {
  cursoId: string | null;
  webinarId: string | null;
}

// Estado central "collect-only" del wizard. Nada acá dispara mutaciones; el
// ProcesadorFinal lo lee al final y ejecuta la secuencia.
export interface WizardState {
  // Paso 1 · Cliente
  modoCliente: ModoCliente;
  clienteIdExistente: string;
  nuevoCliente: CrearClienteInput;
  // Paso 2 · Documentación
  /** key del adjunto (campo::nombre) → true (✓ correcto) / false (✗ incorrecto). */
  docChecks: Record<string, boolean>;
  docOutcome: DocOutcome;
  docMensajeCliente: string;
  // Paso 3 · Comprobante + cobranza
  comprobante: ComprobanteState;
  // Paso 4 · Gestoría (opcional)
  gestoria: GestoriaState;
  // Paso 5 · Tracking
  periodo: string;
  fechaInicio: string;
  observacionesTracking: string;
  // Paso 6 · Campus
  campus: CampusState;
}

// Flags derivados de la solicitud: clasificación del servicio + origen +
// idempotencia. Se calculan una vez al abrir el wizard.
export interface SolicitudFlags {
  origen: 'portal' | 'landing';
  clienteConocido: boolean;
  esCurso: boolean;
  esWebinar: boolean;
  esDDJJ: boolean;
  /** 100% bonificado / precio_final 0 / voucher 100% → comprobante en $0 sin cobranza. */
  esGratuito: boolean;
  yaActivada: boolean;
  yaTieneTramite: boolean;
  yaTieneComprobante: boolean;
}

export type PasoKey =
  | 'cliente'
  | 'documentacion'
  | 'comprobante'
  | 'gestoria'
  | 'tracking'
  | 'campus';

export interface PasoDef {
  key: PasoKey;
  label: string;
}

// Props comunes a cada panel de paso.
export interface PasoProps {
  solicitud: SolicitudDetalle;
  flags: SolicitudFlags;
  state: WizardState;
  set: Dispatch<SetStateAction<WizardState>>;
}

/** Total del comprobante (1 ítem · precio · bonificación). Redondeado a 2 dec. */
export function totalComprobante(c: ComprobanteState): number {
  const precio = Number(c.precio) || 0;
  const bonif = Math.min(100, Math.max(0, Number(c.bonifPorc) || 0));
  return Math.round(precio * (1 - bonif / 100) * 100) / 100;
}

/** Clave estable de un adjunto del formulario (índice + campo + nombre).
 *  Usada por el Paso 2 (docChecks) y por el ProcesadorFinal (PedidoDoc). */
export function adjKey(campo: string, nombre: string, i: number): string {
  return `${i}::${campo}::${nombre}`;
}
