// PortalNuevoServicioPage · Catálogo de formularios públicos que el cliente
// puede iniciar desde su portal. Al elegir uno, navega al formulario
// público `/formulario/:slug` que captura los datos.
//
// Citas: regla 4 (queries en services/), regla 13 (sin window.confirm).

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PlusCircle,
  FileText,
  GraduationCap,
  BadgeCheck,
  Sparkles,
  MessageCircle,
  CalendarRange,
  ArrowRight,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { Skeleton } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  fetchClienteCatalogo,
  type ClienteFormularioCatalogItem,
} from '@/services/api/portal-dashboard';
import { humanizeError } from '@/lib/errors';

export function PortalNuevoServicioPage() {
  const [params] = useSearchParams();
  const presetCategoria = params.get('categoria');
  const [items, setItems] = useState<ClienteFormularioCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('todos');

  async function load() {
    setLoading(true);
    const res = await fetchClienteCatalogo();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar el catálogo', { description: humanizeError(res.error) });
      return;
    }
    setItems(res.data);
  }

  useEffect(() => { void load(); }, []);

  // Si vino con preset (ej. desde una oportunidad del dashboard) preseleccionar
  useEffect(() => {
    if (presetCategoria) {
      const found = mapPresetToFilter(presetCategoria);
      if (found) setActiveFilter(found);
    }
  }, [presetCategoria]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.categoria));
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    if (activeFilter === 'todos') return items;
    return items.filter((i) => i.categoria === activeFilter);
  }, [items, activeFilter]);

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={180} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <div className="relative p-5 sm:p-6">
          <p className="kicker text-brand-cyan">PORTAL · CATÁLOGO</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Solicitar nuevo servicio
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Elegí qué necesitás y te guiamos paso a paso. Una vez completado, nuestro equipo lo recibe y arranca con tu gestión.
          </p>
        </div>
      </section>

      {/* Filtros */}
      {!loading && items.length > 0 && (
        <section className="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
          <FilterPill active={activeFilter === 'todos'} onClick={() => setActiveFilter('todos')}>
            Todos
          </FilterPill>
          {categorias.map((cat) => (
            <FilterPill
              key={cat}
              active={activeFilter === cat}
              onClick={() => setActiveFilter(cat)}
            >
              {labelCategoria(cat)}
            </FilterPill>
          ))}
        </section>
      )}

      {/* Grid de formularios */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0,1,2,3].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="No hay formularios disponibles"
          description={
            activeFilter !== 'todos'
              ? 'No hay nada activo en esta categoría por ahora. Probá con otra.'
              : 'Cuando habilitemos nuevos servicios aparecerán acá.'
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((f) => (
            <li key={f.formulario_id}>
              <ServicioCard f={f} />
            </li>
          ))}
        </ul>
      )}

      {/* Footer help */}
      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-5 text-center">
        <MessageCircle size={20} className="mx-auto text-brand-muted" />
        <p className="mt-2 text-sm font-medium text-brand-ink">
          ¿No encontrás lo que buscás?
        </p>
        <p className="text-xs text-brand-muted">
          Escribinos a <a href="mailto:contacto@gestionglobal.ar" className="text-brand-cyan font-semibold">contacto@gestionglobal.ar</a> y vemos cómo ayudarte.
        </p>
      </section>
    </div>
  );
}

// =========================================================================

function FilterPill({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? 'bg-brand-cyan-pale/80 text-brand-cyan'
          : 'text-brand-muted hover:bg-slate-50 hover:text-brand-ink'
      }`}
    >
      {children}
    </button>
  );
}

function ServicioCard({ f }: { f: ClienteFormularioCatalogItem }) {
  const Icon = iconForCategoria(f.categoria);
  const tone = toneForCategoria(f.categoria);
  return (
    <Link
      to={`/formulario/${f.slug}?origen=portal`}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-cyan hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${tone}`}>
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-brand-cyan opacity-80">{labelCategoria(f.categoria)}</p>
          <h3 className="line-clamp-1 font-semibold leading-tight text-brand-ink">{f.titulo}</h3>
          {f.descripcion && <p className="mt-1 line-clamp-2 text-xs text-brand-muted">{f.descripcion}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-end gap-1 text-xs font-semibold text-brand-cyan transition group-hover:gap-1.5">
        Iniciar <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function iconForCategoria(c: string): typeof PlusCircle {
  switch (c) {
    case 'tramite':   return FileText;
    case 'servicio':  return Sparkles;
    case 'consulta':  return MessageCircle;
    case 'curso':     return GraduationCap;
    case 'evento':    return CalendarRange;
    case 'captacion': return BadgeCheck;
    default:          return PlusCircle;
  }
}

function toneForCategoria(c: string): string {
  switch (c) {
    case 'tramite':   return 'bg-brand-cyan-pale text-brand-cyan';
    case 'servicio':  return 'bg-amber-50 text-amber-700';
    case 'consulta':  return 'bg-violet-50 text-violet-700';
    case 'curso':     return 'bg-emerald-50 text-emerald-700';
    case 'evento':    return 'bg-rose-50 text-rose-700';
    case 'captacion': return 'bg-fuchsia-50 text-fuchsia-700';
    default:          return 'bg-slate-100 text-slate-600';
  }
}

function labelCategoria(c: string): string {
  switch (c) {
    case 'tramite':   return 'Trámite';
    case 'servicio':  return 'Servicio';
    case 'consulta':  return 'Consulta';
    case 'curso':     return 'Curso';
    case 'evento':    return 'Evento';
    case 'captacion': return 'Empezar';
    default:          return c;
  }
}

// Si el dashboard manda ?categoria=renovacion-matricula o similar, mapeamos
// al filtro real de la tabla.
function mapPresetToFilter(preset: string): string | null {
  if (preset.startsWith('renovacion')) return 'tramite';
  if (preset.startsWith('ddjj')) return 'tramite';
  if (preset.startsWith('matricula')) return 'tramite';
  if (preset.startsWith('consulta')) return 'consulta';
  if (preset.startsWith('curso')) return 'curso';
  return null;
}
