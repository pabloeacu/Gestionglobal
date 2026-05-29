// Agenda — organizador ejecutivo personal del staff (handoff sección A1).
// Subtítulo permanente: "Tirá lo que tengas en la cabeza — yo lo ordeno."
//
// Lecciones aplicadas (E1..E14): drag de paint NO persiste antes de Guardar,
// posponer es relativo al evento (E11), CírculoHecha con stopPropagation (E12),
// resolución de overrides en la Lista (E10), modal con panel LATERAL (E8),
// AccionesMenu con clamp robusto (E7), bloque con HH:MM redondeado (E9).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Focus,
  HelpCircle,
  List,
  Plus,
} from 'lucide-react';
import { FUENTE_DESCRIPCION, FUENTE_LABEL } from '../fuenteColor';
import type { AgendaFuente as AgendaFuenteTipo } from '@/services/api/agenda';
import { Button, useConfirm, usePrompt } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  ensureSeedCategorias,
  listCategorias,
  listEventos,
  listEventosUnificados,
  marcarHecha,
  moverOcurrencia,
  eliminarEvento,
  saltearOcurrencia,
  posponerEvento,
  actualizarEvento,
  calcularPosponer,
  type AgendaCategoria,
  type AgendaEvento,
  type AgendaFuente,
  type AgendaOverride,
  type OcurrenciaUnificada,
} from '@/services/api/agenda';
import { VencimientosListPage } from '@/modules/vencimientos';
import type { Ocurrencia } from '@/lib/agendaRecurrencia';
import { BarraMagica } from '../components/BarraMagica';
import { VistaLista } from '../components/VistaLista';
import { VistaMes } from '../components/VistaMes';
import { VistaSemana } from '../components/VistaSemana';
import { VistaDia } from '../components/VistaDia';
import { AccionesMenu, type PostergarDest } from '../components/AccionesMenu';
import { EventoModal, type EventoDraft } from '../components/EventoModal';

type Vista = 'lista' | 'mes' | 'semana' | 'dia';
type AgendaTab = 'mi-agenda' | 'vencimientos';

const VISTA_LS_KEY = 'gg.agenda.vista';
const FUENTES_LS_KEY = 'gg.agenda.fuentes';
// 3.A · clave del toggle "Modo enfoque" (solo personal · oculta proyecciones).
const MODO_ENFOQUE_LS_KEY = 'gg.agenda.modoEnfoque';

const FUENTES_FILTROS: ReadonlyArray<{ key: 'todo' | AgendaFuente; label: string; color: string }> = [
  { key: 'todo', label: 'Todo', color: '#0f172a' },
  { key: 'personal', label: 'Personal', color: '#06b6d4' },
  { key: 'vencimiento', label: 'Vencimientos', color: '#f59e0b' },
  { key: 'tramite', label: 'Trámites', color: '#8b5cf6' },
  { key: 'comprobante', label: 'Cobranzas', color: '#ef4444' },
  { key: 'solicitud', label: 'Solicitudes', color: '#06b6d4' },
  { key: 'tracking_alarma', label: 'Alarmas tracking', color: '#dc2626' },
];

function getFuentesIniciales(): Array<'todo' | AgendaFuente> {
  if (typeof window === 'undefined') return ['personal'];
  try {
    const raw = window.localStorage.getItem(FUENTES_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<'todo' | AgendaFuente>;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* noop */
  }
  return ['personal'];
}

function getModoEnfoqueInicial(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MODO_ENFOQUE_LS_KEY) === '1';
  } catch {
    return false;
  }
}

function getVistaInicial(): Vista {
  if (typeof window === 'undefined') return 'semana';
  try {
    const v = window.localStorage.getItem(VISTA_LS_KEY);
    if (v === 'lista' || v === 'mes' || v === 'semana' || v === 'dia') return v;
  } catch {
    /* noop */
  }
  return 'semana';
}

interface AgendaPageProps {
  initialTab?: AgendaTab;
}

export function AgendaPage({ initialTab }: AgendaPageProps = {}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AgendaTab>(initialTab ?? 'mi-agenda');
  const [vista, setVistaState] = useState<Vista>(getVistaInicial);
  const setVista = (v: Vista) => {
    setVistaState(v);
    try {
      window.localStorage.setItem(VISTA_LS_KEY, v);
    } catch {
      /* noop */
    }
  };
  const [fuentesSeleccionadas, setFuentesSeleccionadasState] = useState<Array<'todo' | AgendaFuente>>(getFuentesIniciales);
  const setFuentesSeleccionadas = (next: Array<'todo' | AgendaFuente>) => {
    setFuentesSeleccionadasState(next);
    try {
      window.localStorage.setItem(FUENTES_LS_KEY, JSON.stringify(next));
    } catch {
      /* noop */
    }
  };
  // 3.A · modo enfoque: si está activo, las fuentes externas se ocultan y
  // se renderiza únicamente la agenda personal. Cita DGG-06.
  const [modoEnfoque, setModoEnfoqueState] = useState<boolean>(getModoEnfoqueInicial);
  const setModoEnfoque = (v: boolean) => {
    setModoEnfoqueState(v);
    try {
      window.localStorage.setItem(MODO_ENFOQUE_LS_KEY, v ? '1' : '0');
    } catch {
      /* noop */
    }
  };
  // 3.E · leyenda colapsable de fuentes (qué significa cada chip).
  const [leyendaOpen, setLeyendaOpen] = useState(false);
  const [proyectadas, setProyectadas] = useState<OcurrenciaUnificada[]>([]);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [categorias, setCategorias] = useState<AgendaCategoria[]>([]);
  const [eventos, setEventos] = useState<AgendaEvento[]>([]);
  const [overrides, setOverrides] = useState<AgendaOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState<Partial<EventoDraft> | undefined>(undefined);
  const [modalEvento, setModalEvento] = useState<AgendaEvento | null>(null);
  const [menu, setMenu] = useState<{ oc: Ocurrencia; x: number; y: number } | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  async function load() {
    setLoading(true);
    await ensureSeedCategorias();
    const [c, e] = await Promise.all([listCategorias(), listEventos({ includeDone: true })]);
    if (c.ok) setCategorias(c.data);
    if (e.ok) {
      setEventos(e.data.eventos);
      setOverrides(e.data.overrides);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  // Cargar fuentes proyectadas (vencimientos, trámites, cobranzas, solicitudes)
  // cuando hay filtros no-personales activos.
  // 3.A · si está activo "Modo enfoque", saltamos el fetch y vaciamos
  // las proyectadas → la agenda se muestra "limpia".
  useEffect(() => {
    let cancelado = false;
    async function cargarProyectadas() {
      if (modoEnfoque) {
        if (!cancelado) setProyectadas([]);
        return;
      }
      const fuentesAUsar = fuentesSeleccionadas.includes('todo')
        ? (['vencimiento', 'tramite', 'comprobante', 'solicitud'] as AgendaFuente[])
        : (fuentesSeleccionadas.filter((f) => f !== 'personal' && f !== 'todo') as AgendaFuente[]);
      if (fuentesAUsar.length === 0) {
        if (!cancelado) setProyectadas([]);
        return;
      }
      // Rango: 30 días atrás, 120 adelante (cubre vistas mes / semana / lista).
      const from = new Date();
      from.setDate(from.getDate() - 30);
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      to.setDate(to.getDate() + 120);
      to.setHours(23, 59, 59, 999);
      const res = await listEventosUnificados({ from, to, fuentes: fuentesAUsar });
      if (cancelado) return;
      if (res.ok) setProyectadas(res.data);
      else setProyectadas([]);
    }
    void cargarProyectadas();
    return () => {
      cancelado = true;
    };
  }, [fuentesSeleccionadas, modoEnfoque]);

  const mostrarPersonal =
    modoEnfoque ||
    fuentesSeleccionadas.includes('todo') ||
    fuentesSeleccionadas.includes('personal');

  function toggleFuente(key: 'todo' | AgendaFuente) {
    if (key === 'todo') {
      setFuentesSeleccionadas(['todo']);
      return;
    }
    let next = fuentesSeleccionadas.filter((f) => f !== 'todo');
    if (next.includes(key)) next = next.filter((f) => f !== key);
    else next = [...next, key];
    if (next.length === 0) next = ['personal'];
    setFuentesSeleccionadas(next);
  }

  function abrirProyectado(item: OcurrenciaUnificada) {
    // Rutas verificadas contra App.tsx (rev. 2026-05-21). Si alguna ruta
    // específica no existe, caemos al listado del módulo y dejamos warning.
    switch (item.fuente) {
      case 'vencimiento':
        // Tab dentro de Agenda (DGG-08).
        navigate(`/gerencia/agenda/vencimientos`);
        return;
      case 'tramite':
        // Ruta verificada: /gerencia/trackings/:id
        navigate(`/gerencia/trackings/${item.origenId}`);
        return;
      case 'comprobante':
        // Ruta verificada: /gerencia/facturacion/:id
        navigate(`/gerencia/facturacion/${item.origenId}`);
        return;
      case 'solicitud':
        // Ruta verificada: /gerencia/solicitudes/:id
        navigate(`/gerencia/solicitudes/${item.origenId}`);
        return;
      case 'tracking_alarma':
        // Bloque A · Fase 2 (mig 0122): origenId = tramite_id (vw_agenda_unificada
        // ahora expone t.id en vez de tl.id), por lo que la alarma navega
        // directo al tracking del trámite específico que la disparó.
        navigate(`/gerencia/trackings/${item.origenId}`);
        return;
      default:
        // eslint-disable-next-line no-console
        console.warn('[Agenda] Fuente proyectada desconocida:', item);
        return;
    }
  }

  const tituloPeriodo = useMemo(() => {
    if (vista === 'lista') return 'Tu agenda';
    if (vista === 'dia')
      return anchor.toLocaleDateString('es-AR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    if (vista === 'semana') return tituloSemana(anchor);
    return anchor.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }, [vista, anchor]);

  function navegar(dir: -1 | 1) {
    const d = new Date(anchor);
    if (vista === 'dia') d.setDate(d.getDate() + dir);
    else if (vista === 'semana') d.setDate(d.getDate() + dir * 7);
    else if (vista === 'mes') d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  }

  async function onToggleDone(oc: Ocurrencia) {
    const nuevo = !oc.isDone;
    const res = await marcarHecha(oc.evento.id, nuevo, {
      recurrente: oc.esRecurrente,
      occurrenceDate: oc.fechaOriginal || undefined,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    // 3.C · red de seguridad: undo de 5 s para revertir el toggle.
    toast.success(nuevo ? '¡Listo!' : 'Reabierta', {
      action: {
        label: 'Deshacer',
        onClick: () => {
          void (async () => {
            const undo = await marcarHecha(oc.evento.id, !nuevo, {
              recurrente: oc.esRecurrente,
              occurrenceDate: oc.fechaOriginal || undefined,
            });
            if (undo.ok) {
              toast.success('Deshecho');
              void load();
            }
          })();
        },
      },
      duration: 5000,
    });
    void load();
  }

  async function onEliminarOc(oc: Ocurrencia) {
    if (oc.esRecurrente) {
      const ok = await confirm({
        title: 'Saltear esta ocurrencia',
        message: `«${oc.evento.title}» se va a omitir solo en esta fecha. La serie sigue activa.`,
        confirmLabel: 'Saltear',
        cancelLabel: 'Volver',
      });
      if (!ok) return;
      const res = await saltearOcurrencia(oc.evento.id, oc.fechaOriginal);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Movido (solo esta vez)');
    } else {
      const ok = await confirm({
        title: '¿Eliminar evento?',
        message: `Vamos a eliminar «${oc.evento.title}». No se puede deshacer.`,
        confirmLabel: 'Eliminar',
        cancelLabel: 'Volver',
        danger: true,
      });
      if (!ok) return;
      const res = await eliminarEvento(oc.evento.id);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Eliminado');
    }
    void load();
  }

  async function onPosponer(oc: Ocurrencia, dest: PostergarDest) {
    let delta = 1;
    if (dest === 'manana') delta = 1;
    else if (dest === 'semana') delta = 7;
    else if (dest === 'mes') delta = 30;
    else {
      // Personalizado — pedimos cantidad de días.
      const v = await prompt({
        title: 'Posponer',
        message: '¿Cuántos días?',
        defaultValue: '1',
        confirmLabel: 'Posponer',
      });
      const n = v ? parseInt(v, 10) : NaN;
      if (!Number.isFinite(n) || n === 0) return;
      delta = n;
    }
    if (oc.esRecurrente) {
      if (!oc.startAt) return;
      // E11 aplicado: ancla = fecha del evento (no hoy)
      const { startAt, endAt } = calcularPosponer(oc.startAt, oc.endAt, delta);
      const res = await moverOcurrencia(oc.evento.id, oc.fechaOriginal, startAt, endAt);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Reprogramado');
    } else {
      const res = await posponerEvento(oc.evento.id, delta);
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Reprogramado');
    }
    void load();
  }

  async function onMoverCalendario(oc: Ocurrencia, newStart: Date, newEnd: Date | null) {
    if (oc.esRecurrente) {
      const res = await moverOcurrencia(
        oc.evento.id,
        oc.fechaOriginal,
        newStart.toISOString(),
        newEnd ? newEnd.toISOString() : null,
      );
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Movido (solo esta vez)');
    } else {
      const res = await actualizarEvento(oc.evento.id, {
        startAt: newStart.toISOString(),
        endAt: newEnd ? newEnd.toISOString() : null,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      toast.success('Reprogramado');
    }
    void load();
  }

  function onMoverMes(oc: Ocurrencia, nuevaFecha: Date) {
    if (!oc.startAt) return;
    const s = new Date(oc.startAt);
    const dest = new Date(nuevaFecha);
    dest.setHours(s.getHours(), s.getMinutes(), 0, 0);
    let endDest: Date | null = null;
    if (oc.endAt) {
      const e = new Date(oc.endAt);
      endDest = new Date(dest);
      endDest.setHours(e.getHours(), e.getMinutes(), 0, 0);
      if (endDest <= dest) endDest = new Date(dest.getTime() + 60 * 60 * 1000);
    }
    void onMoverCalendario(oc, dest, endDest);
  }

  function abrirCrearEnFecha(d: Date) {
    setModalDraft({
      fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      allDay: true,
    });
    setModalEvento(null);
    setModalOpen(true);
  }

  function abrirCrearEnFranja(startISO: string, endISO: string) {
    const s = new Date(startISO);
    const f = new Date(endISO);
    setModalDraft({
      fecha: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`,
      desde: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
      hasta: `${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`,
      allDay: false,
    });
    setModalEvento(null);
    setModalOpen(true);
  }

  function abrirEditar(ev: AgendaEvento) {
    setModalEvento(ev);
    setModalDraft(undefined);
    setModalOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal p-6 text-white shadow-sm motion-safe:animate-fade-up">
        <TrianglesAccent position="top-right" size={220} tone="cyan" density="rich" className="opacity-60" />
        <TrianglesAccent position="bottom-left" size={160} tone="teal" density="soft" className="opacity-40" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="kicker text-white/80">Agenda</p>
            <h1 className="font-display text-3xl font-bold leading-tight">{tituloPeriodo}</h1>
            <p className="mt-1 text-sm text-white/85">
              Tirá lo que tengas en la cabeza — yo lo ordeno.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setAnchor(new Date())}>
              Hoy
            </Button>
            <Button variant="ghost" onClick={() => navegar(-1)} aria-label="Anterior">
              <ChevronLeft size={14} />
            </Button>
            <Button variant="ghost" onClick={() => navegar(1)} aria-label="Siguiente">
              <ChevronRight size={14} />
            </Button>
            <Button
              onClick={() => {
                setModalDraft(undefined);
                setModalEvento(null);
                setModalOpen(true);
              }}
            >
              <Plus size={14} /> Nuevo
            </Button>
          </div>
        </div>

        {/* Toggle vistas */}
        <div className="relative mt-5 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg bg-white/15 p-1 backdrop-blur-sm">
            {(
              [
                { v: 'lista', label: 'Lista', icon: List },
                { v: 'dia', label: 'Día', icon: Clock },
                { v: 'semana', label: 'Semana', icon: CalendarRange },
                { v: 'mes', label: 'Mes', icon: CalendarDays },
              ] as const
            ).map(({ v, label, icon: Icon }) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition',
                  vista === v ? 'bg-white text-brand-cyan shadow-sm' : 'text-white/85 hover:text-white',
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tabs Mi agenda / Vencimientos (Unificación temporal · mig 0040) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        {(
          [
            { k: 'mi-agenda', label: 'Mi agenda' },
            { k: 'vencimientos', label: 'Vencimientos' },
          ] as const
        ).map(({ k, label }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition',
              tab === k
                ? 'border-brand-cyan text-brand-ink'
                : 'border-transparent text-brand-muted hover:text-brand-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'vencimientos' ? (
        <VencimientosListPage />
      ) : (
        <>
      {/* Filtros de fuente (chips) + Modo enfoque + Leyenda. */}
      <div className="flex flex-wrap items-center gap-2">
        {FUENTES_FILTROS.map((f) => {
          const activo = !modoEnfoque && fuentesSeleccionadas.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleFuente(f.key)}
              disabled={modoEnfoque}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
                activo
                  ? 'border-brand-ink/20 bg-brand-ink text-white shadow-sm'
                  : 'border-slate-200 bg-white text-brand-muted hover:border-slate-300 hover:text-brand-ink',
                modoEnfoque && 'opacity-40',
              )}
            >
              {f.key !== 'todo' && (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: f.color }}
                />
              )}
              {f.label}
            </button>
          );
        })}

        {/* 3.E · ayuda contextual con la leyenda colapsable. */}
        <button
          type="button"
          onClick={() => setLeyendaOpen((v) => !v)}
          aria-label="¿Qué significa cada chip?"
          title="¿Qué significa cada chip?"
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition',
            leyendaOpen
              ? 'border-brand-cyan/40 bg-brand-cyan-pale/40 text-brand-cyan'
              : 'border-slate-200 bg-white text-brand-muted hover:text-brand-ink',
          )}
        >
          <HelpCircle size={12} /> Qué es cada uno
        </button>

        {/* 3.A · toggle "Modo enfoque" — oculta proyecciones, solo eventos personales. */}
        <button
          type="button"
          onClick={() => setModoEnfoque(!modoEnfoque)}
          aria-pressed={modoEnfoque}
          title={
            modoEnfoque
              ? 'Modo enfoque activo · sólo tus eventos. Click para desactivar.'
              : 'Modo enfoque · ocultá vencimientos, trámites y cobranzas para concentrarte.'
          }
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition',
            modoEnfoque
              ? 'border-brand-cyan bg-brand-cyan text-white shadow-sm'
              : 'border-slate-200 bg-white text-brand-muted hover:text-brand-ink',
          )}
        >
          <Focus size={12} />
          {modoEnfoque ? 'Modo enfoque' : 'Solo lo mío'}
        </button>
      </div>

      {/* 3.E · panel colapsable con descripción de cada fuente proyectada. */}
      {leyendaOpen && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 motion-safe:animate-fade-up">
          <p className="kicker mb-3 text-brand-cyan">Qué significa cada chip</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['personal', 'vencimiento', 'tramite', 'comprobante', 'solicitud'] as AgendaFuenteTipo[]).map(
              (f) => {
                const color = FUENTES_FILTROS.find((x) => x.key === f)?.color ?? '#06b6d4';
                return (
                  <li key={f} className="flex items-start gap-2 text-xs">
                    <span
                      className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div>
                      <p className="font-semibold text-brand-ink">
                        {FUENTE_LABEL[f]}
                      </p>
                      <p className="text-brand-muted">{FUENTE_DESCRIPCION[f]}</p>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        </div>
      )}

      {/* Barra mágica */}
      <BarraMagica categorias={categorias} onCreated={() => void load()} />

      {/* Vista */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-brand-muted">
          Cargando agenda...
        </div>
      ) : !mostrarPersonal ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-brand-muted">
          Vista calendario oculta · sólo se proyectan fuentes externas debajo.
        </div>
      ) : vista === 'lista' ? (
        <VistaLista
          eventos={eventos}
          overrides={overrides}
          categorias={categorias}
          proyectadas={proyectadas}
          onToggleDone={onToggleDone}
          onEditar={abrirEditar}
          onEliminar={onEliminarOc}
          onAbrirAcciones={(oc, x, y) => setMenu({ oc, x, y })}
          onAbrirProyectada={abrirProyectado}
        />
      ) : vista === 'mes' ? (
        <VistaMes
          anchor={anchor}
          eventos={eventos}
          overrides={overrides}
          categorias={categorias}
          proyectadas={proyectadas}
          onPickDay={(d) => {
            setAnchor(d);
            setVista('dia');
          }}
          onAbrirAcciones={(oc, x, y) => setMenu({ oc, x, y })}
          onToggleDone={onToggleDone}
          onMover={onMoverMes}
          onCrearEnFecha={abrirCrearEnFecha}
          onAbrirProyectada={abrirProyectado}
        />
      ) : vista === 'semana' ? (
        <VistaSemana
          anchor={anchor}
          eventos={eventos}
          overrides={overrides}
          categorias={categorias}
          proyectadas={proyectadas}
          onAbrirAcciones={(oc, x, y) => setMenu({ oc, x, y })}
          onToggleDone={onToggleDone}
          onMover={onMoverCalendario}
          onCrearEnFranja={abrirCrearEnFranja}
          onAbrirProyectada={abrirProyectado}
        />
      ) : (
        <VistaDia
          anchor={anchor}
          eventos={eventos}
          overrides={overrides}
          categorias={categorias}
          proyectadas={proyectadas}
          onAbrirAcciones={(oc, x, y) => setMenu({ oc, x, y })}
          onToggleDone={onToggleDone}
          onMover={onMoverCalendario}
          onCrearEnFranja={abrirCrearEnFranja}
          onAbrirProyectada={abrirProyectado}
        />
      )}

      {/* Menú flotante */}
      {menu && (
        <AccionesMenu
          x={menu.x}
          y={menu.y}
          titulo={menu.oc.evento.title}
          fechaLabel={
            menu.oc.startAt
              ? new Date(menu.oc.startAt).toLocaleString('es-AR', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : null
          }
          isDone={menu.oc.isDone}
          esRecurrente={menu.oc.esRecurrente}
          onClose={() => setMenu(null)}
          onToggleDone={() => onToggleDone(menu.oc)}
          onEditar={() => abrirEditar(menu.oc.evento)}
          onPosponer={(dest) => void onPosponer(menu.oc, dest)}
          onEliminar={() => void onEliminarOc(menu.oc)}
        />
      )}

        </>
      )}

      {/* Modal */}
      <EventoModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          void load();
        }}
        categorias={categorias}
        draft={modalDraft}
        evento={modalEvento}
      />
    </div>
  );
}

function tituloSemana(anchor: Date): string {
  const x = new Date(anchor);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  const ini = new Date(x);
  ini.setDate(ini.getDate() - dow);
  const fin = new Date(ini);
  fin.setDate(fin.getDate() + 6);
  const a = ini.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  const b = fin.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  return `Semana del ${a} al ${b}`;
}

export default AgendaPage;
