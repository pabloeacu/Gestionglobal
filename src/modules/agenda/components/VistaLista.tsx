// VistaLista — secciones por urgencia (handoff C1). Agrupa por:
//   Atrasados (rojo suave) · Hoy · Mañana · Esta semana · Más adelante ·
//   Sin fecha (bandeja) · Hechos (colapsable).
//
// Aplica E10: resuelve overrides para que un recurrente postergado se vea
// en su nueva fecha (vía la expansión de ocurrencias del rango amplio).
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Inbox,
  Link2,
  Lock,
  Pencil,
  Repeat,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  actualizarEvento,
  type AgendaCategoria,
  type AgendaEvento,
  type AgendaOverride,
  type OcurrenciaUnificada,
} from '@/services/api/agenda';
import { etiquetaRecurrencia, expandirRango, type Ocurrencia } from '@/lib/agendaRecurrencia';
import { toast } from '@/lib/toast';
import { labelFuente, type ItemCalendario } from '@/lib/agendaRender';
import { colorDeFuente, FUENTE_LABEL } from '../fuenteColor';
import { CirculoHecha } from './CirculoHecha';
import { ChipCategoria } from './ChipCategoria';
import { HoverPreview } from './HoverPreview';

interface Props {
  eventos: AgendaEvento[];
  overrides: AgendaOverride[];
  categorias: AgendaCategoria[];
  proyectadas?: OcurrenciaUnificada[];
  onToggleDone: (oc: Ocurrencia) => void;
  onEditar: (ev: AgendaEvento) => void;
  onEliminar: (oc: Ocurrencia) => void;
  onAbrirAcciones: (oc: Ocurrencia, x: number, y: number) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}

type SeccionKey = 'atras' | 'hoy' | 'manana' | 'semana' | 'masAdelante' | 'bandeja' | 'hechos';

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}
function addDays(d: Date, n: number): Date {
  const o = new Date(d);
  o.setDate(o.getDate() + n);
  return o;
}

export function VistaLista({
  eventos,
  overrides,
  categorias,
  proyectadas = [],
  onToggleDone,
  onEditar,
  onEliminar,
  onAbrirAcciones,
  onAbrirProyectada,
}: Props) {
  const [hechosOpen, setHechosOpen] = useState(false);

  const grupos = useMemo(() => {
    const hoy = startOfDay(new Date());
    const finManana = addDays(hoy, 2);
    const finSemana = addDays(hoy, 7);
    const rangoFrom = addDays(hoy, -120);
    const rangoTo = addDays(hoy, 180);
    const expandidas = expandirRango(eventos, overrides, rangoFrom, rangoTo);

    // Para eventos sin fecha (bandeja), no entran en expandidas (startAt null).
    const bandeja = eventos.filter((e) => !e.startAt);

    const out: Record<SeccionKey, ItemCalendario[]> = {
      atras: [],
      hoy: [],
      manana: [],
      semana: [],
      masAdelante: [],
      bandeja: [],
      hechos: [],
    };
    for (const oc of expandidas) {
      if (!oc.startAt) continue;
      const d = startOfDay(new Date(oc.startAt));
      const it: ItemCalendario = { kind: 'personal', ocurrencia: oc };
      if (oc.isDone) {
        out.hechos.push(it);
        continue;
      }
      if (d < hoy) out.atras.push(it);
      else if (d.getTime() === hoy.getTime()) out.hoy.push(it);
      else if (d < finManana) out.manana.push(it);
      else if (d < finSemana) out.semana.push(it);
      else out.masAdelante.push(it);
    }
    // Proyectadas dentro del rango (atras..masAdelante).
    for (const p of proyectadas) {
      if (!p.startAt) continue;
      const d = startOfDay(new Date(p.startAt));
      const it: ItemCalendario = { kind: 'proyectada', proyeccion: p };
      if (d < hoy) out.atras.push(it);
      else if (d.getTime() === hoy.getTime()) out.hoy.push(it);
      else if (d < finManana) out.manana.push(it);
      else if (d < finSemana) out.semana.push(it);
      else out.masAdelante.push(it);
    }
    out.bandeja = bandeja.map<ItemCalendario>((e) => ({
      kind: 'personal',
      ocurrencia: {
        key: `${e.id}__bandeja`,
        evento: e,
        fechaOriginal: '',
        startAt: null,
        endAt: null,
        allDay: false,
        isDone: e.isDone,
        esRecurrente: false,
        overrideId: null,
      },
    }));
    // Orden cronológico ascendente — all_day primero dentro del mismo día.
    const startOf = (it: ItemCalendario) =>
      it.kind === 'personal' ? it.ocurrencia.startAt ?? '' : it.proyeccion.startAt;
    const allDayOf = (it: ItemCalendario) =>
      it.kind === 'personal' ? it.ocurrencia.allDay : it.proyeccion.allDay;
    for (const k of ['atras', 'hoy', 'manana', 'semana', 'masAdelante'] as SeccionKey[]) {
      out[k].sort((a, b) => {
        const aDay = (startOf(a) || '').slice(0, 10);
        const bDay = (startOf(b) || '').slice(0, 10);
        if (aDay !== bDay) return aDay.localeCompare(bDay);
        const aAll = allDayOf(a);
        const bAll = allDayOf(b);
        if (aAll !== bAll) return aAll ? -1 : 1;
        return startOf(a).localeCompare(startOf(b));
      });
    }
    out.hechos.sort((a, b) => startOf(b).localeCompare(startOf(a)));
    return out;
  }, [eventos, overrides, proyectadas]);

  const total =
    grupos.atras.length +
    grupos.hoy.length +
    grupos.manana.length +
    grupos.semana.length +
    grupos.masAdelante.length +
    grupos.bandeja.length;

  if (total === 0 && grupos.hechos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <Sparkles className="mx-auto mb-3 text-slate-300" size={36} />
        <p className="font-medium text-brand-ink">Todo limpio por acá.</p>
        <p className="mt-1 text-sm text-brand-muted">Tirá algo en la barra de arriba.</p>
      </div>
    );
  }

  const seccionProps = {
    categorias,
    onToggleDone,
    onEditar,
    onEliminar,
    onAbrirAcciones,
    onAbrirProyectada,
  };
  return (
    <div className="space-y-4">
      <Seccion
        keyName="atras"
        titulo="Atrasados"
        icon={<AlertCircle size={14} className="text-rose-500" />}
        tone="rose"
        items={grupos.atras}
        {...seccionProps}
      />
      <Seccion
        keyName="hoy"
        titulo="Hoy"
        icon={<CalendarDays size={14} className="text-brand-cyan" />}
        tone="cyan"
        items={grupos.hoy}
        {...seccionProps}
      />
      <Seccion
        keyName="manana"
        titulo="Mañana"
        icon={<CalendarClock size={14} className="text-brand-teal" />}
        items={grupos.manana}
        {...seccionProps}
      />
      <Seccion
        keyName="semana"
        titulo="Esta semana"
        icon={<CalendarClock size={14} className="text-brand-muted" />}
        items={grupos.semana}
        {...seccionProps}
      />
      <Seccion
        keyName="masAdelante"
        titulo="Más adelante"
        icon={<CalendarClock size={14} className="text-brand-muted" />}
        items={grupos.masAdelante}
        {...seccionProps}
      />
      <Seccion
        keyName="bandeja"
        titulo="Sin fecha (bandeja)"
        icon={<Inbox size={14} className="text-brand-muted" />}
        items={grupos.bandeja}
        {...seccionProps}
      />
      {grupos.hechos.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setHechosOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-brand-muted hover:bg-slate-50"
          >
            {hechosOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Hechos · {grupos.hechos.length}
          </button>
          {hechosOpen && (
            <div className="border-t border-slate-100">
              {grupos.hechos.slice(0, 50).map((it, idx) => {
                if (it.kind === 'personal') {
                  return (
                    <ItemFila
                      key={it.ocurrencia.key}
                      oc={it.ocurrencia}
                      categorias={categorias}
                      onToggleDone={onToggleDone}
                      onEditar={onEditar}
                      onEliminar={onEliminar}
                      onAbrirAcciones={onAbrirAcciones}
                      dim
                    />
                  );
                }
                return (
                  <ItemProyFila
                    key={`${it.proyeccion.fuente}-${it.proyeccion.origenId}-${idx}`}
                    p={it.proyeccion}
                    onAbrir={onAbrirProyectada}
                    dim
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Seccion({
  titulo,
  icon,
  items,
  categorias,
  tone,
  onToggleDone,
  onEditar,
  onEliminar,
  onAbrirAcciones,
  onAbrirProyectada,
}: {
  keyName: SeccionKey;
  titulo: string;
  icon: React.ReactNode;
  items: ItemCalendario[];
  categorias: AgendaCategoria[];
  tone?: 'cyan' | 'rose';
  onToggleDone: (o: Ocurrencia) => void;
  onEditar: (e: AgendaEvento) => void;
  onEliminar: (o: Ocurrencia) => void;
  onAbrirAcciones: (o: Ocurrencia, x: number, y: number) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}) {
  if (items.length === 0) return null;
  const tint =
    tone === 'rose'
      ? 'border-rose-100 bg-rose-50/30'
      : tone === 'cyan'
        ? 'border-brand-cyan-pale/60 bg-brand-cyan-pale/15'
        : 'border-slate-200 bg-white';
  return (
    <section className={`rounded-2xl border ${tint}`}>
      <header className="flex items-center justify-between px-4 py-2 text-xs uppercase tracking-wider text-brand-muted">
        <span className="flex items-center gap-1.5 font-semibold">
          {icon}
          {titulo}
        </span>
        <span className="text-[10px]">{items.length}</span>
      </header>
      <div className="divide-y divide-slate-100 border-t border-slate-100 bg-white/70">
        {items.map((it, idx) => {
          if (it.kind === 'personal') {
            return (
              <ItemFila
                key={it.ocurrencia.key}
                oc={it.ocurrencia}
                categorias={categorias}
                onToggleDone={onToggleDone}
                onEditar={onEditar}
                onEliminar={onEliminar}
                onAbrirAcciones={onAbrirAcciones}
              />
            );
          }
          return (
            <ItemProyFila
              key={`${it.proyeccion.fuente}-${it.proyeccion.origenId}-${idx}`}
              p={it.proyeccion}
              onAbrir={onAbrirProyectada}
            />
          );
        })}
      </div>
    </section>
  );
}

function ItemProyFila({
  p,
  onAbrir,
  dim,
}: {
  p: OcurrenciaUnificada;
  onAbrir?: (p: OcurrenciaUnificada) => void;
  dim?: boolean;
}) {
  const fechaLabel = p.startAt
    ? new Date(p.startAt).toLocaleString('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        ...(!p.allDay && { hour: '2-digit', minute: '2-digit' }),
      })
    : null;
  // 3.D · borde izquierdo 3px con el color de la fuente para lectura
  // instantánea por categoría (vencimiento ambar, comprobante rojo, …).
  // 3.B · HoverPreview en lugar de `title=` HTML.
  return (
    <HoverPreview proyectada={p}>
      <button
        type="button"
        onClick={() => onAbrir?.(p)}
        aria-label={`${p.title} · ${FUENTE_LABEL[p.fuente]} (sólo lectura)`}
        className={`group flex w-full items-center gap-3 border-l-[3px] px-4 py-3 text-left transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan ${
          dim ? 'opacity-60' : 'opacity-90'
        }`}
        style={{ borderLeftColor: colorDeFuente(p.fuente) }}
      >
        <Lock size={14} className="shrink-0 text-brand-muted" />
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: p.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-brand-ink">{p.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-brand-muted">
            {fechaLabel && (
              <span className="inline-flex items-center gap-1">
                <Clock size={11} />
                {fechaLabel}
              </span>
            )}
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
              style={{ background: `${p.color}1A`, color: p.color }}
            >
              {labelFuente(p.fuente)}
            </span>
          </div>
        </div>
      </button>
    </HoverPreview>
  );
}

function ItemFila({
  oc,
  categorias,
  dim,
  onToggleDone,
  onEditar,
  onEliminar,
  onAbrirAcciones,
}: {
  oc: Ocurrencia;
  categorias: AgendaCategoria[];
  dim?: boolean;
  onToggleDone: (o: Ocurrencia) => void;
  onEditar: (e: AgendaEvento) => void;
  onEliminar: (o: Ocurrencia) => void;
  onAbrirAcciones: (o: Ocurrencia, x: number, y: number) => void;
}) {
  const ev = oc.evento;
  const cat = categorias.find((c) => c.id === ev.categoryId) ?? null;
  const recur = etiquetaRecurrencia(ev);
  const prioColor = ev.priority === 'alta' ? 'bg-rose-500' : ev.priority === 'media' ? 'bg-amber-400' : 'bg-slate-300';
  const fechaLabel = oc.startAt
    ? new Date(oc.startAt).toLocaleString('es-AR', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        ...(!oc.allDay && { hour: '2-digit', minute: '2-digit' }),
      })
    : null;
  const vinculosCount =
    (ev.linkedConsorcioIds?.length ?? 0) +
    (ev.linkedAdministracionId ? 1 : 0) +
    (ev.linkedComprobanteId ? 1 : 0) +
    (ev.linkedTramiteId ? 1 : 0);

  // 3.G · Quick-edit inline. Doble-click activa input editable; Enter guarda,
  // Esc cancela, blur también guarda si cambió.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ev.title);
  const [savingTitle, setSavingTitle] = useState(false);
  async function saveTitle() {
    const t = editTitle.trim();
    if (!t || t === ev.title) {
      setEditing(false);
      setEditTitle(ev.title);
      return;
    }
    setSavingTitle(true);
    const res = await actualizarEvento(ev.id, { title: t });
    setSavingTitle(false);
    if (!res.ok) {
      toast.error('No pudimos cambiar el título');
      setEditTitle(ev.title);
    } else {
      toast.success('Título actualizado');
      ev.title = t; // optimista, el load() del padre lo refresca real
    }
    setEditing(false);
  }
  return (
    <div className={`group flex items-center gap-3 px-4 py-3 hover:bg-slate-50 ${dim ? 'opacity-65' : ''}`}>
      <CirculoHecha isDone={oc.isDone} onToggle={() => onToggleDone(oc)} size={18} />
      <span className={`h-2 w-2 shrink-0 rounded-full ${prioColor}`} aria-hidden />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            type="text"
            autoFocus
            value={editTitle}
            disabled={savingTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveTitle();
              } else if (e.key === 'Escape') {
                setEditTitle(ev.title);
                setEditing(false);
              }
            }}
            className="w-full rounded-md border border-brand-cyan/40 bg-white px-1.5 py-0.5 text-sm text-brand-ink outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/30"
          />
        ) : (
          <div
            onDoubleClick={() => {
              setEditTitle(ev.title);
              setEditing(true);
            }}
            title="Doble click para renombrar"
            className={`cursor-text truncate rounded-md px-1 -mx-1 text-sm hover:bg-slate-100/50 ${
              oc.isDone ? 'text-brand-muted line-through' : 'text-brand-ink'
            }`}
          >
            {ev.title}
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-brand-muted">
          {fechaLabel && (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} />
              {fechaLabel}
            </span>
          )}
          {cat && <ChipCategoria categoria={cat} />}
          {recur && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
              <Repeat size={10} /> {recur}
            </span>
          )}
          {vinculosCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-1.5 py-0.5 text-[10px] text-brand-cyan">
              <Link2 size={10} /> {vinculosCount}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => onAbrirAcciones(oc, e.clientX, e.clientY)}
          aria-label="Acciones"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <CalendarClock size={14} />
        </button>
        <button
          type="button"
          onClick={() => onEditar(ev)}
          aria-label="Editar"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => onEliminar(oc)}
          aria-label="Eliminar"
          className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
