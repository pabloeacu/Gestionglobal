// Hook central del wizard v2. Posee: estado collect-only, flags derivados de la
// solicitud (clasificación servicio + origen + idempotencia), la secuencia de
// pasos (condicional: Campus solo si curso/webinar), persistencia de borrador
// en sessionStorage y los helpers de navegación. NO dispara mutaciones.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SolicitudDetalle } from '@/services/api/solicitudes';
import {
  DOC_OUTCOMES_TERMINALES,
  type DocOutcome,
  type ModoCliente,
  type PasoDef,
  type SolicitudFlags,
  type WizardState,
} from './types';

// ---------------------------------------------------------------------------
// Clasificación de la solicitud
// ---------------------------------------------------------------------------
function clasificar(sol: SolicitudDetalle): SolicitudFlags {
  const slug = (sol.servicio_slug ?? '').toLowerCase();
  const cat = (sol.formulario_categoria ?? '').toLowerCase();
  const has = (...needles: string[]) =>
    needles.some((n) => slug.includes(n) || cat.includes(n));
  const esDDJJ = has('ddjj', 'declaracion-jurada') || cat === 'dj';
  const esCurso = has('curso') && !esDDJJ;
  const esWebinar = has('webinar');
  const esGratuito =
    sol.bonificacion_100 === true ||
    sol.precio_final === 0 ||
    sol.voucher_descuento_pct === 100;
  return {
    origen: sol.origen_canal === 'cliente' ? 'portal' : 'landing',
    clienteConocido: !!sol.cliente_id,
    esCurso,
    esWebinar,
    esDDJJ,
    esGratuito,
    yaActivada: sol.estado === 'activada',
    yaTieneTramite: !!sol.tramite_id,
    yaTieneComprobante: !!sol.comprobante_id,
  };
}

// ---------------------------------------------------------------------------
// Estado inicial (pre-fill desde la solicitud)
// ---------------------------------------------------------------------------
const IVA_VALIDAS = ['responsable_inscripto', 'monotributo', 'exento', 'consumidor_final'];

function estadoInicial(sol: SolicitudDetalle, flags: SolicitudFlags): WizardState {
  const nombre = sol.solicitante_nombre ?? '';
  // Pre-fill del cliente desde lo que cargó el solicitante en el formulario
  // (reporte JL): CUIT normalizado a dígitos (el check de la BD exige 11) y
  // condición IVA — si el form no la trae, va Consumidor Final (no Monotributo).
  const payload = (sol.submission_payload ?? {}) as Record<string, unknown>;
  const cuitDigits = String(payload.cuit ?? '').replace(/\D/g, '');
  const cuitPrefill = cuitDigits.length === 11 ? cuitDigits : null;
  const ivaForm = String(payload.condicion_iva ?? '').trim().toLowerCase();
  const ivaPrefill = IVA_VALIDAS.includes(ivaForm) ? ivaForm : 'consumidor_final';
  // Pre-fill comprobante evitando doble descuento: si conocemos precio base +
  // voucher, los mandamos separados (precio base + bonificación %); si sólo hay
  // precio_final, va ese con 0% (el descuento ya viene aplicado).
  const baseCat = sol.servicio_precio_base;
  const voucherPct = sol.voucher_descuento_pct ?? 0;
  let compPrecio = '';
  let compBonif = '0';
  if (flags.esGratuito) {
    compPrecio = String(baseCat ?? sol.precio_aplicado ?? sol.precio_final ?? 0);
    compBonif = '100';
  } else if (baseCat != null && voucherPct > 0) {
    compPrecio = String(baseCat);
    compBonif = String(voucherPct);
  } else {
    const v = sol.precio_final ?? baseCat ?? null;
    compPrecio = v != null ? String(v) : '';
    compBonif = '0';
  }
  return {
    modoCliente: sol.cliente_id ? 'existente' : 'nuevo',
    clienteIdExistente: sol.cliente_id ?? '',
    nuevoCliente: {
      nombre,
      email: sol.solicitante_email ?? null,
      telefono: sol.solicitante_telefono ?? null,
      cuit: cuitPrefill,
      responsable_nombre: nombre.split(' ')[0] ?? null,
      responsable_apellido: nombre.split(' ').slice(1).join(' ') || null,
      condicion_iva: ivaPrefill,
    },
    docChecks: {},
    docOutcome: 'completa',
    docMensajeCliente: '',
    comprobante: {
      omitir: flags.esDDJJ,
      gratuito: flags.esGratuito,
      descripcion: sol.servicio_nombre ?? sol.formulario_titulo ?? 'Servicio',
      precio: compPrecio,
      bonifPorc: compBonif,
      pagoModo: flags.esGratuito ? 'ninguno' : 'total',
      montoCobrado: '',
      cajaId: '',
      fechaPago: new Date().toISOString().slice(0, 10),
      referencia: '',
      categoriaId: '',
      compartePartner: false,
      partnerId: null,
    },
    gestoria: {
      activa: false,
      email: '',
      nombre: '',
      observaciones: '',
      diasValidez: 14,
      montoGestoria: '',
      cajaId: '',
      adjuntos: [],
    },
    periodo: new Date().getFullYear().toString(),
    fechaInicio: new Date().toISOString().slice(0, 10),
    observacionesTracking: '',
    campus: { cursoId: null, webinarId: null },
  };
}

// ---------------------------------------------------------------------------
// Borrador (subset seguro — sin PII del solicitante en el storage del browser)
// ---------------------------------------------------------------------------
interface WizardDraftV2 {
  step: number;
  modoCliente: ModoCliente;
  clienteIdExistente: string;
  periodo: string;
  fechaInicio: string;
  docOutcome: DocOutcome;
  gestoriaActiva: boolean;
}
const DRAFT_KEY = (id: string) => `wizardV2:draft:${id}`;
function leerDraft(id: string): WizardDraftV2 | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY(id));
    return raw ? (JSON.parse(raw) as WizardDraftV2) : null;
  } catch {
    return null;
  }
}
function escribirDraft(id: string, draft: WizardDraftV2) {
  try {
    sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(draft));
  } catch {
    /* quota / private mode → ignorar */
  }
}
export function limpiarDraftV2(id: string) {
  try {
    sessionStorage.removeItem(DRAFT_KEY(id));
  } catch {
    /* ignorar */
  }
}

const PASO_FALLBACK: PasoDef = { key: 'cliente', label: 'Cliente' };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useWizardActivacion(solicitud: SolicitudDetalle, open: boolean) {
  const flags = useMemo(() => clasificar(solicitud), [solicitud]);
  const draftInicial = useMemo(() => leerDraft(solicitud.id), [solicitud.id]);

  const [state, set] = useState<WizardState>(() => {
    const base = estadoInicial(solicitud, flags);
    if (!draftInicial) return base;
    return {
      ...base,
      modoCliente: draftInicial.modoCliente ?? base.modoCliente,
      clienteIdExistente: draftInicial.clienteIdExistente ?? base.clienteIdExistente,
      periodo: draftInicial.periodo ?? base.periodo,
      fechaInicio: draftInicial.fechaInicio ?? base.fechaInicio,
      docOutcome: draftInicial.docOutcome ?? base.docOutcome,
      gestoria: { ...base.gestoria, activa: draftInicial.gestoriaActiva ?? false },
    };
  });
  const [step, setStep] = useState(draftInicial?.step ?? 0);
  const [fase, setFase] = useState<'pasos' | 'procesando'>('pasos');
  const [draftPresente, setDraftPresente] = useState(!!draftInicial);

  const pasos = useMemo<PasoDef[]>(() => {
    const base: PasoDef[] = [
      { key: 'cliente', label: 'Cliente' },
      { key: 'documentacion', label: 'Documentación' },
      { key: 'comprobante', label: 'Comprobante' },
      { key: 'gestoria', label: 'Gestoría' },
      { key: 'tracking', label: 'Tracking' },
    ];
    if (flags.esCurso || flags.esWebinar) base.push({ key: 'campus', label: 'Campus' });
    return base;
  }, [flags]);

  const stepClamp = Math.min(Math.max(0, step), pasos.length - 1);
  const pasoActual = pasos[stepClamp] ?? PASO_FALLBACK;

  // Q2: en el Paso 2 con outcome terminal (revisión/rechazo/descarte) el
  // wizard corta — "Siguiente" se vuelve "Comenzar proceso".
  const esTerminalPaso2 =
    pasoActual.key === 'documentacion' &&
    DOC_OUTCOMES_TERMINALES.includes(state.docOutcome);
  const esPasoFinal = stepClamp === pasos.length - 1 || esTerminalPaso2;

  // Persistir borrador (subset seguro) ante cada cambio relevante.
  useEffect(() => {
    if (!open) return;
    escribirDraft(solicitud.id, {
      step: stepClamp,
      modoCliente: state.modoCliente,
      clienteIdExistente: state.clienteIdExistente,
      periodo: state.periodo,
      fechaInicio: state.fechaInicio,
      docOutcome: state.docOutcome,
      gestoriaActiva: state.gestoria.activa,
    });
  }, [
    open,
    solicitud.id,
    stepClamp,
    state.modoCliente,
    state.clienteIdExistente,
    state.periodo,
    state.fechaInicio,
    state.docOutcome,
    state.gestoria.activa,
  ]);

  const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);
  const goNext = useCallback(() => {
    if (esPasoFinal) setFase('procesando');
    else setStep((s) => Math.min(pasos.length - 1, s + 1));
  }, [esPasoFinal, pasos.length]);

  const reset = useCallback(() => {
    limpiarDraftV2(solicitud.id);
    set(estadoInicial(solicitud, flags));
    setStep(0);
    setFase('pasos');
    setDraftPresente(false);
  }, [solicitud, flags]);

  return {
    flags,
    pasos,
    state,
    set,
    step: stepClamp,
    setStep,
    fase,
    setFase,
    pasoActual,
    esPasoFinal,
    esTerminalPaso2,
    goBack,
    goNext,
    draftPresente,
    setDraftPresente,
    reset,
  };
}
