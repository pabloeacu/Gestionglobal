import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCcw,
  Filter,
} from 'lucide-react';
import {
  Button,
  Field,
  Select,
  Skeleton,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  listarEventos,
  completarEvento,
  cancelarEvento,
  eventosDelDia,
  eventosDeLaSemana,
  eventosDelMes,
  AGENDA_CATEGORIAS,
  AGENDA_CATEGORIA_LABEL,
  AGENDA_PRIORIDADES,
  AGENDA_PRIORIDAD_LABEL,
  type EventoAgenda,
  type AgendaCategoria,
  type AgendaPrioridad,
} from '@/services/api/agenda';
import { CrearEventoDrawer } from '../components/CrearEventoDrawer';
import { EventoDetailModal } from '../components/EventoDetailModal';
import { CalendarioMes } from '../components/CalendarioMes';
import { CalendarioSemana } from '../components/CalendarioSemana';
import { TimelineDia } from '../components/TimelineDia';

type Vista = 'dia' | 'semana' | 'mes';

export function AgendaPage() {
  const [vista, setVista] = useState<Vista>('semana');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<EventoAgenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<EventoAgenda | null>(null);
  const confirm = useConfirm();

  const [filtroCategoria, setFiltroCategoria] = useState<AgendaCategoria | 'todas'>('todas');
  const [filtroPrioridad, setFiltroPrioridad] = useState<AgendaPrioridad | 'todas'>('todas');

  const rango = useMemo(() => {
    if (vista === 'dia') return eventosDelDia(anchor);
    if (vista === 'semana') return eventosDeLaSemana(anchor);
    return eventosDelMes(anchor.getFullYear(), anchor.getMonth());
  }, [vista, anchor]);

  async function load() {
    setLoading(true);
    const res = await listarEventos({
      desde: rango.desde,
      hasta: rango.hasta,
      categoria: filtroCategoria === 'todas' ? null : filtroCategoria,
      prioridad: filtroPrioridad === 'todas' ? null : filtroPrioridad,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, anchor, filtroCategoria, filtroPrioridad]);

  function navigateAnchor(dir: -1 | 1) {
    const d = new Date(anchor);
    if (vista === 'dia') d.setDate(d.getDate() + dir);
    else if (vista === 'semana') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  }

  async function onCompletar(ev: EventoAgenda) {
    const okConfirm = await confirm({
      title: '¿Completar evento?',
      message: `Marcar "${ev.titulo}" como completado.`,
      confirmLabel: 'Completar',
      cancelLabel: 'Cancelar',
    });
    if (!okConfirm) return;
    const res = await completarEvento(ev.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Evento completado');
    setSelected(null);
    void load();
  }

  async function onCancelar(ev: EventoAgenda) {
    const okConfirm = await confirm({
      title: '¿Cancelar evento?',
      message: `"${ev.titulo}" se va a marcar como cancelado.`,
      confirmLabel: 'Cancelar evento',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!okConfirm) return;
    const res = await cancelarEvento(ev.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Evento cancelado');
    setSelected(null);
    void load();
  }

  return (
    <div className="space-y-6">
      {/* Header premium */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal p-6 text-white shadow-sm motion-safe:animate-fade-up">
        <TrianglesAccent position="top-right" size={220} tone="cyan" density="rich" className="opacity-60" />
        <TrianglesAccent position="bottom-left" size={160} tone="teal" density="soft" className="opacity-40" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker text-white/80">Agenda operativa</p>
            <h1 className="font-display text-3xl font-bold leading-tight">
              {tituloRango(vista, anchor)}
            </h1>
            <p className="mt-1 text-sm text-white/85">
              Vencimientos, seguimientos, recordatorios y reuniones en un solo lugar.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setAnchor(new Date())}>
              Hoy
            </Button>
            <Button variant="ghost" onClick={() => navigateAnchor(-1)} aria-label="Anterior">
              <ChevronLeft size={14} />
            </Button>
            <Button variant="ghost" onClick={() => navigateAnchor(1)} aria-label="Siguiente">
              <ChevronRight size={14} />
            </Button>
            <Button onClick={() => setDrawerOpen(true)}>
              <Plus size={14} /> Nuevo evento
            </Button>
          </div>
        </div>

        {/* Toggle vistas */}
        <div className="relative mt-5 inline-flex rounded-lg bg-white/15 p-1 backdrop-blur-sm">
          {(['dia', 'semana', 'mes'] as Vista[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm font-semibold transition',
                vista === v ? 'bg-white text-brand-cyan shadow-sm' : 'text-white/85 hover:text-white',
              )}
            >
              {v === 'dia' ? 'Día' : v === 'semana' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      </section>

      {/* Filtros */}
      <section className="card-premium p-4 motion-safe:animate-fade-up">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Categoría">
            <Select
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value as AgendaCategoria | 'todas')}
            >
              <option value="todas">Todas</option>
              {AGENDA_CATEGORIAS.map((c) => (
                <option key={c} value={c}>{AGENDA_CATEGORIA_LABEL[c]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select
              value={filtroPrioridad}
              onChange={(e) => setFiltroPrioridad(e.target.value as AgendaPrioridad | 'todas')}
            >
              <option value="todas">Todas</option>
              {AGENDA_PRIORIDADES.map((p) => (
                <option key={p} value={p}>{AGENDA_PRIORIDAD_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
          <div className="ml-auto flex items-center gap-2 text-xs text-brand-muted">
            <Filter size={12} /> {rows.length} eventos
            <Button variant="ghost" onClick={() => void load()} aria-label="Recargar">
              <RefreshCcw size={12} />
            </Button>
          </div>
        </div>
      </section>

      {/* Vista activa */}
      <section className="motion-safe:animate-fade-up">
        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : vista === 'dia' ? (
          <TimelineDia anchor={anchor} eventos={rows} onSelect={setSelected} />
        ) : vista === 'semana' ? (
          <CalendarioSemana anchor={anchor} eventos={rows} onSelect={setSelected} />
        ) : (
          <CalendarioMes
            anchor={anchor}
            eventos={rows}
            onSelect={setSelected}
            onPickDay={(d) => {
              setAnchor(d);
              setVista('dia');
            }}
          />
        )}
      </section>

      <CrearEventoDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        defaultDate={anchor}
        onCreated={() => {
          setDrawerOpen(false);
          void load();
        }}
      />

      <EventoDetailModal
        evento={selected}
        onClose={() => setSelected(null)}
        onCompletar={onCompletar}
        onCancelar={onCancelar}
      />
    </div>
  );
}

function tituloRango(vista: Vista, anchor: Date): string {
  if (vista === 'dia') {
    return anchor.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  if (vista === 'semana') {
    const r = eventosDeLaSemana(anchor);
    const ini = r.desde.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    const finDate = new Date(r.hasta.getTime() - 1);
    const fin = finDate.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `Semana del ${ini} al ${fin}`;
  }
  return anchor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
}

export default AgendaPage;
