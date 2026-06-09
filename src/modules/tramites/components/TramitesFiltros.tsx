// ============================================================================
// TramitesFiltros.tsx · F8 (DGG-64) · UI compartida de filtros de Trámites.
//   · TramitesSegmentos: las 5 "cards filtro" (segmentos inteligentes).
//   · TramitesFilterBar: barra premium con controles mixtos (search + switch
//     "Solo activos" + chips Estado/Prioridad + multiselect Categoría/Servicio).
// Controlados: el estado vive en la página (efímero). Lista y kanban los reusan.
// ============================================================================

import { Search } from 'lucide-react';
import {
  Input,
  Switch,
  FilterChips,
  FilterMultiSelect,
  SegmentCard,
  ResultCount,
} from '@/components/common';
import {
  TRAMITE_ESTADOS,
  TRAMITE_ESTADO_LABEL,
  TRAMITE_PRIORIDADES,
  TRAMITE_PRIORIDAD_LABEL,
  TRAMITE_CATEGORIAS,
  TRAMITE_CATEGORIA_LABEL,
  type TramiteEstado,
  type TramitePrioridad,
  type TramiteCategoria,
} from '@/services/api/tramites';
import {
  TRAMITE_SEGMENTOS,
  ACTIVE_ESTADOS,
  hasActiveTramitesFilters,
  type SegmentKey,
  type TramitesFilterState,
} from './tramitesFilter';

const ESTADO_TONE: Record<TramiteEstado, 'cyan' | 'amber' | 'emerald' | 'slate' | 'red'> = {
  abierto: 'cyan',
  en_progreso: 'cyan',
  esperando_cliente: 'amber',
  resuelto: 'emerald',
  cerrado: 'slate',
  cancelado: 'red',
};
const PRIORIDAD_TONE: Record<TramitePrioridad, 'red' | 'amber' | 'cyan' | 'slate'> = {
  urgente: 'red',
  alta: 'amber',
  normal: 'cyan',
  baja: 'slate',
};

export function TramitesSegmentos({
  counts,
  active,
  onToggle,
}: {
  counts: Record<SegmentKey, number>;
  active: SegmentKey | null;
  onToggle: (key: SegmentKey) => void;
}) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TRAMITE_SEGMENTOS.map((s) => (
        <SegmentCard
          key={s.key}
          label={s.label}
          count={counts[s.key]}
          icon={s.icon}
          tone={s.tone}
          active={active === s.key}
          onClick={() => onToggle(s.key)}
        />
      ))}
    </section>
  );
}

export function TramitesFilterBar({
  f,
  update,
  servicioOpts,
  shown,
  total,
  onClear,
  showEstadoChips = true,
}: {
  f: TramitesFilterState;
  update: (patch: Partial<TramitesFilterState>) => void;
  servicioOpts: { value: string; label: string; count: number }[];
  shown: number;
  total: number;
  onClear: () => void;
  showEstadoChips?: boolean;
}) {
  // Estado: con "Solo activos" ON sólo ofrecemos los activos; al apagarlo, todos.
  const estadoValues = f.soloActivos ? ACTIVE_ESTADOS : [...TRAMITE_ESTADOS];
  const estadoOpts = estadoValues.map((e) => ({
    value: e,
    label: TRAMITE_ESTADO_LABEL[e],
    tone: ESTADO_TONE[e],
  }));
  const prioridadOpts = TRAMITE_PRIORIDADES.map((p) => ({
    value: p,
    label: TRAMITE_PRIORIDAD_LABEL[p],
    tone: PRIORIDAD_TONE[p],
  }));
  const categoriaOpts = TRAMITE_CATEGORIAS.map((c) => ({
    value: c,
    label: TRAMITE_CATEGORIA_LABEL[c],
  }));

  return (
    <section className="card-premium space-y-3 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input
            value={f.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Código, título, cliente…"
            className="pl-9"
          />
        </div>
        <Switch
          checked={f.soloActivos}
          onChange={(v) => update({ soloActivos: v, estados: [] })}
          label="Solo activos"
          hint={f.soloActivos ? '(oculta cerrados)' : '(mostrando todo)'}
        />
        <ResultCount shown={shown} total={total} hasFilters={hasActiveTramitesFilters(f)} onClear={onClear} noun="trámites" />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        {showEstadoChips && (
          <div className="flex items-center gap-2">
            <span className="kicker text-brand-muted">Estado</span>
            <FilterChips<TramiteEstado>
              options={estadoOpts}
              selected={f.estados}
              onChange={(v) => update({ estados: v })}
              ariaLabel="Filtrar por estado"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="kicker text-brand-muted">Prioridad</span>
          <FilterChips<TramitePrioridad>
            options={prioridadOpts}
            selected={f.prioridades}
            onChange={(v) => update({ prioridades: v })}
            ariaLabel="Filtrar por prioridad"
          />
        </div>
        <FilterMultiSelect
          label="Categoría"
          options={categoriaOpts}
          selected={f.categorias}
          onChange={(v) => update({ categorias: v as TramiteCategoria[] })}
        />
        {servicioOpts.length > 0 && (
          <FilterMultiSelect
            label="Servicio"
            options={servicioOpts}
            selected={f.servicios}
            onChange={(v) => update({ servicios: v })}
            searchable
          />
        )}
      </div>
    </section>
  );
}
