// ============================================================================
// tramitesFilter.ts · F8 (DGG-64) · Lógica compartida de filtros de Trámites.
//
// Reusada por la lista y el kanban: define los segmentos inteligentes (las
// "cards filtro"), el estado del filtro (efímero), y las funciones puras de
// filtrado/conteo en memoria (R19: conteos sobre el universo, filtros UI en
// memoria). El universo se trae por backend según "Solo activos" (activos por
// default; todo al apagar el switch) y todo lo demás se resuelve acá.
// ============================================================================

import { AlertTriangle, CalendarClock, Hourglass, DollarSign, Receipt } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FilterTone } from '@/components/common';
import {
  computeSla,
  type TramiteListItem,
  type TramiteEstado,
  type TramitePrioridad,
  type TramiteCategoria,
} from '@/services/api/tramites';

// "Activo" = en flujo (no terminal). resuelto cuenta como activo (decisión de
// Pablo: suele faltarle el cierre formal / cobro). Cerrado y cancelado = ocultos
// con "Solo activos" ON.
export const ACTIVE_ESTADOS: TramiteEstado[] = [
  'abierto',
  'en_progreso',
  'esperando_cliente',
  'resuelto',
];
export const CLOSED_ESTADOS: TramiteEstado[] = ['cerrado', 'cancelado'];

export type SegmentKey =
  | 'vencidos'
  | 'vence_7d'
  | 'esperando_cliente'
  | 'por_cobrar'
  | 'sin_comprobante';

export interface SegmentDef {
  key: SegmentKey;
  label: string;
  icon: LucideIcon;
  tone: FilterTone;
  match: (t: TramiteListItem) => boolean;
}

// Las preguntas reales del gerente al triagear (no atributos crudos).
export const TRAMITE_SEGMENTOS: SegmentDef[] = [
  {
    key: 'vencidos',
    label: 'Vencidos',
    icon: AlertTriangle,
    tone: 'red',
    match: (t) => computeSla(t).vencido,
  },
  {
    key: 'vence_7d',
    label: 'Vence ≤7d',
    icon: CalendarClock,
    tone: 'amber',
    match: (t) => {
      const s = computeSla(t);
      return s.diasRestantes != null && s.diasRestantes >= 0 && s.diasRestantes <= 7;
    },
  },
  {
    key: 'esperando_cliente',
    label: 'Esperando cliente',
    icon: Hourglass,
    tone: 'cyan',
    match: (t) => t.estado === 'esperando_cliente',
  },
  {
    key: 'por_cobrar',
    label: 'Por cobrar',
    icon: DollarSign,
    tone: 'violet',
    match: (t) => t.cobro_pendiente,
  },
  {
    key: 'sin_comprobante',
    label: 'Sin comprobante',
    icon: Receipt,
    tone: 'slate',
    match: (t) => t.comprobante_pendiente,
  },
];

export interface TramitesFilterState {
  soloActivos: boolean;
  segment: SegmentKey | null;
  estados: TramiteEstado[];
  prioridades: TramitePrioridad[];
  categorias: TramiteCategoria[];
  servicios: string[]; // servicio_id
  search: string;
}

export const INITIAL_TRAMITES_FILTER: TramitesFilterState = {
  soloActivos: true,
  segment: null,
  estados: [],
  prioridades: [],
  categorias: [],
  servicios: [],
  search: '',
};

// Conteo de segmentos sobre el UNIVERSO (R19) — no se ve afectado por los otros
// filtros, así el gerente siempre ve "hay 12 vencidos" de forma estable.
export function countSegments(universe: TramiteListItem[]): Record<SegmentKey, number> {
  const out = { vencidos: 0, vence_7d: 0, esperando_cliente: 0, por_cobrar: 0, sin_comprobante: 0 } as Record<SegmentKey, number>;
  for (const seg of TRAMITE_SEGMENTOS) {
    out[seg.key] = universe.filter(seg.match).length;
  }
  return out;
}

// Filtra el universo por todos los controles (segmento + chips + multiselect +
// búsqueda). NO re-filtra por "Solo activos" (eso lo decide el fetch del universo).
export function applyTramitesFilters(
  universe: TramiteListItem[],
  f: TramitesFilterState,
): TramiteListItem[] {
  const seg = f.segment ? TRAMITE_SEGMENTOS.find((s) => s.key === f.segment) : null;
  const needle = f.search.trim().toLowerCase();
  return universe.filter((t) => {
    if (seg && !seg.match(t)) return false;
    if (f.estados.length && !f.estados.includes(t.estado as TramiteEstado)) return false;
    if (f.prioridades.length && !f.prioridades.includes(t.prioridad as TramitePrioridad)) return false;
    if (f.categorias.length && !f.categorias.includes(t.categoria as TramiteCategoria)) return false;
    if (f.servicios.length && !f.servicios.includes(t.servicio_id ?? '')) return false;
    if (needle) {
      const hay = `${t.codigo} ${t.titulo} ${t.administracion_nombre ?? ''} ${t.solicitante_nombre ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// ¿hay algún filtro activo (más allá del default "Solo activos")?
export function hasActiveTramitesFilters(f: TramitesFilterState): boolean {
  return (
    f.segment !== null ||
    f.estados.length > 0 ||
    f.prioridades.length > 0 ||
    f.categorias.length > 0 ||
    f.servicios.length > 0 ||
    f.search.trim().length > 0
  );
}

// Opciones de servicio presentes en el universo (para el multiselect), con conteo.
export function servicioOptions(
  universe: TramiteListItem[],
): { value: string; label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const t of universe) {
    if (!t.servicio_id) continue;
    const prev = map.get(t.servicio_id);
    if (prev) prev.count += 1;
    else map.set(t.servicio_id, { label: t.servicio_nombre ?? 'Servicio', count: 1 });
  }
  return [...map.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
