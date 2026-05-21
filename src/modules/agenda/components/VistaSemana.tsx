// VistaSemana — timeline 06:00–23:00 con bloques posicionados. Gestos:
// - Click vacío para crear en franja
// - Drag de un bloque para mover (snap 15min) — E5 distingue tap (<6px) de drag
// - Resize de la manija inferior (E9: snap consistente para que el preview = lo
//   guardado; usamos fmtHM sin decimales sueltos)
import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Lock } from 'lucide-react';
import { colorDeFuente } from '../fuenteColor';
import {
  type AgendaCategoria,
  type AgendaEvento,
  type AgendaOverride,
  type OcurrenciaUnificada,
} from '@/services/api/agenda';
import { expandirRango, type Ocurrencia } from '@/lib/agendaRecurrencia';
import { CirculoHecha } from './CirculoHecha';

const HINT_LS_KEY = 'gg.agenda.hintShown';

interface Props {
  anchor: Date;
  eventos: AgendaEvento[];
  overrides: AgendaOverride[];
  categorias: AgendaCategoria[];
  modo?: 'semana' | 'dia';
  proyectadas?: OcurrenciaUnificada[];
  onAbrirAcciones: (oc: Ocurrencia, x: number, y: number) => void;
  onToggleDone: (oc: Ocurrencia) => void;
  onMover: (oc: Ocurrencia, newStart: Date, newEnd: Date | null) => void;
  onCrearEnFranja: (startISO: string, endISO: string) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}

const HORA_INI = 6;
const HORA_FIN = 23;
const PX_HORA = 48;
const TOTAL_PX = (HORA_FIN - HORA_INI + 1) * PX_HORA;

function startOfWeekMon(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function snap15(m: number) {
  return Math.round(m / 15) * 15;
}
function fmtHM(m: number) {
  const t = Math.round(m);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Gesto {
  tipo: 'move' | 'resize' | 'paint';
  oc?: Ocurrencia;
  colInicial: number;
  colActual: number;
  startY: number;
  startX: number;
  offsetMin?: number; // para move: distancia del top del bloque
  durMin?: number; // duración inicial del bloque
  minIni?: number; // para paint: minuto inicial
  minActual?: number;
  startMin?: number; // para resize
  movido?: boolean;
}

export function VistaSemana({
  anchor,
  eventos,
  overrides,
  categorias,
  modo = 'semana',
  proyectadas = [],
  onAbrirAcciones,
  onToggleDone,
  onMover,
  onCrearEnFranja,
  onAbrirProyectada,
}: Props) {
  const dias = useMemo(() => {
    if (modo === 'dia') return [startOfDay(anchor)];
    const ini = startOfWeekMon(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(ini, i));
  }, [anchor, modo]);

  const rangoFrom = dias[0] ?? startOfDay(anchor);
  const rangoTo = addDays(dias[dias.length - 1] ?? rangoFrom, 1);
  const ocurrencias = useMemo(
    () => expandirRango(eventos, overrides, rangoFrom, rangoTo),
    [eventos, overrides, rangoFrom, rangoTo],
  );

  const porDia = useMemo(() => {
    const map = new Map<string, Ocurrencia[]>();
    for (const o of ocurrencias) {
      if (!o.startAt) continue;
      const k = ymd(new Date(o.startAt));
      const arr = map.get(k) ?? [];
      arr.push(o);
      map.set(k, arr);
    }
    return map;
  }, [ocurrencias]);

  // Proyectadas filtradas al rango visible y agrupadas por día.
  const proyectadasPorDia = useMemo(() => {
    const map = new Map<string, OcurrenciaUnificada[]>();
    for (const p of proyectadas) {
      if (!p.startAt) continue;
      const d = new Date(p.startAt);
      if (d < rangoFrom || d >= rangoTo) continue;
      const k = ymd(d);
      const arr = map.get(k) ?? [];
      arr.push(p);
      map.set(k, arr);
    }
    return map;
  }, [proyectadas, rangoFrom, rangoTo]);

  // ¿Hay algún proyectado all-day en CUALQUIER día visible? → render del strip.
  const hayAllDayProy = useMemo(() => {
    for (const arr of proyectadasPorDia.values()) {
      if (arr.some((p) => p.allDay)) return true;
    }
    return false;
  }, [proyectadasPorDia]);

  const colRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const hintShownRef = useRef(false);

  function maybeMostrarHint() {
    if (hintShownRef.current) return;
    try {
      if (window.localStorage.getItem(HINT_LS_KEY) === '1') {
        hintShownRef.current = true;
        return;
      }
    } catch {
      /* noop */
    }
    hintShownRef.current = true;
    setHintVisible(true);
  }

  useEffect(() => {
    if (!hintVisible) return;
    const t = window.setTimeout(() => {
      setHintVisible(false);
      try {
        window.localStorage.setItem(HINT_LS_KEY, '1');
      } catch {
        /* noop */
      }
    }, 4000);
    return () => window.clearTimeout(t);
  }, [hintVisible]);

  function colIdxDesdeX(clientX: number): number {
    for (let i = 0; i < colRefs.current.length; i++) {
      const el = colRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return i;
    }
    return -1;
  }

  function minutosDesdeY(clientY: number, colIdx: number): number {
    const el = colRefs.current[colIdx];
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const dy = clientY - r.top;
    const minutos = (dy / PX_HORA) * 60 + HORA_INI * 60;
    return Math.max(HORA_INI * 60, Math.min((HORA_FIN + 1) * 60, snap15(minutos)));
  }

  function onPointerDownCol(e: React.PointerEvent, colIdx: number) {
    const target = e.target as HTMLElement;
    if (target.closest('[data-evt]')) return; // que el gesto del bloque lo maneje su propio handler
    if (target.closest('[data-proy]')) return; // proyectados son read-only — no iniciar paint
    e.currentTarget.setPointerCapture(e.pointerId);
    const minIni = minutosDesdeY(e.clientY, colIdx);
    setGesto({
      tipo: 'paint',
      colInicial: colIdx,
      colActual: colIdx,
      startX: e.clientX,
      startY: e.clientY,
      minIni,
      minActual: minIni + 60,
      movido: false,
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!gesto) return;
    if (gesto.tipo === 'paint') {
      const colActual = colIdxDesdeX(e.clientX);
      const minActual = minutosDesdeY(e.clientY, colActual >= 0 ? colActual : gesto.colInicial);
      setGesto({ ...gesto, colActual: colActual >= 0 ? colActual : gesto.colInicial, minActual, movido: true });
    } else if (gesto.tipo === 'move' && gesto.oc) {
      const colActual = colIdxDesdeX(e.clientX);
      const minActual = minutosDesdeY(e.clientY, colActual >= 0 ? colActual : gesto.colInicial);
      const dist = Math.hypot(e.clientX - gesto.startX, e.clientY - gesto.startY);
      setGesto({
        ...gesto,
        colActual: colActual >= 0 ? colActual : gesto.colInicial,
        minActual,
        movido: gesto.movido || dist >= 6,
      });
    } else if (gesto.tipo === 'resize' && gesto.oc) {
      const minActual = minutosDesdeY(e.clientY, gesto.colInicial);
      setGesto({ ...gesto, minActual, movido: true });
    }
  }

  function onPointerUp() {
    if (!gesto) return;
    const g = gesto;
    setGesto(null);
    if (g.tipo === 'paint' && g.movido && g.minIni !== undefined && g.minActual !== undefined) {
      const d = dias[g.colActual];
      if (!d) return;
      const mIni = Math.min(g.minIni, g.minActual);
      const mFin = Math.max(g.minIni, g.minActual);
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      s.setMinutes(mIni);
      const f = new Date(d);
      f.setHours(0, 0, 0, 0);
      f.setMinutes(Math.max(mFin, mIni + 15));
      onCrearEnFranja(s.toISOString(), f.toISOString());
    } else if (g.tipo === 'move' && g.oc && g.movido && g.minActual !== undefined && g.offsetMin !== undefined && g.durMin !== undefined) {
      const d = dias[g.colActual];
      if (!d) return;
      const startMin = g.minActual - g.offsetMin;
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      s.setMinutes(startMin);
      const f = new Date(s);
      f.setMinutes(f.getMinutes() + g.durMin);
      onMover(g.oc, s, f);
    } else if (g.tipo === 'move' && g.oc && !g.movido) {
      onAbrirAcciones(g.oc, g.startX, g.startY);
    } else if (g.tipo === 'resize' && g.oc && g.startMin !== undefined && g.minActual !== undefined) {
      const startMin = g.startMin;
      const endMin = Math.max(startMin + 15, g.minActual);
      const d = dias[g.colInicial];
      if (!d) return;
      const s = new Date(d);
      s.setHours(0, 0, 0, 0);
      s.setMinutes(startMin);
      const f = new Date(d);
      f.setHours(0, 0, 0, 0);
      f.setMinutes(endMin);
      onMover(g.oc, s, f);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[60px_repeat(var(--cols),1fr)]" style={{ ['--cols' as never]: dias.length }}>
        <div />
        {dias.map((d) => {
          const esHoy = ymd(d) === ymd(new Date());
          return (
            <div
              key={ymd(d)}
              className="border-b border-slate-100 px-2 py-2 text-center text-xs"
            >
              <div className="text-[10px] uppercase tracking-wider text-brand-muted">
                {d.toLocaleDateString('es-AR', { weekday: 'short' })}
              </div>
              <div
                className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${
                  esHoy ? 'bg-brand-cyan text-white' : 'text-brand-ink'
                }`}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* Strip de proyectados all-day (vencimientos / comprobantes) — read-only. */}
      {hayAllDayProy && (
        <div
          className="grid grid-cols-[60px_repeat(var(--cols),1fr)] border-b border-slate-100 bg-slate-50/40"
          style={{ ['--cols' as never]: dias.length }}
        >
          <div className="flex items-center justify-end px-2 py-1 text-[9px] uppercase tracking-wider text-brand-muted/80">
            todo el día
          </div>
          {dias.map((d) => {
            const k = ymd(d);
            const proyDia = (proyectadasPorDia.get(k) ?? []).filter((p) => p.allDay);
            return (
              <div key={`hd-${k}`} className="space-y-0.5 border-l border-slate-100 px-1 py-1">
                {proyDia.map((p, idx) => (
                  <button
                    key={`${p.fuente}-${p.origenId}-${idx}`}
                    type="button"
                    data-proy
                    onClick={(e) => {
                      e.stopPropagation();
                      onAbrirProyectada?.(p);
                    }}
                    className="flex h-6 w-full items-center gap-1 truncate rounded px-1 text-left text-[10px] text-white"
                    style={{
                      background: p.color,
                      opacity: 0.6,
                      borderLeft: `3px solid ${colorDeFuente(p.fuente)}`,
                    }}
                    title={`${p.title} · sólo lectura`}
                  >
                    <Lock size={9} className="shrink-0 text-white/95" />
                    <span className="truncate">{p.title}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <div
        className="relative grid grid-cols-[60px_repeat(var(--cols),1fr)]"
        style={{ ['--cols' as never]: dias.length }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Eje horario */}
        <div className="relative" style={{ height: TOTAL_PX }}>
          {Array.from({ length: HORA_FIN - HORA_INI + 1 }, (_, i) => (
            <div
              key={i}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-brand-muted"
              style={{ top: i * PX_HORA }}
            >
              {String(HORA_INI + i).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Columnas día */}
        {dias.map((d, colIdx) => {
          const k = ymd(d);
          const items = porDia.get(k) ?? [];
          return (
            <div
              key={k}
              ref={(el) => {
                colRefs.current[colIdx] = el;
              }}
              onPointerDown={(e) => onPointerDownCol(e, colIdx)}
              onPointerEnter={() => maybeMostrarHint()}
              className="group/col relative cursor-crosshair border-l border-slate-100"
              style={{ height: TOTAL_PX }}
            >
              {Array.from({ length: HORA_FIN - HORA_INI + 1 }, (_, i) => (
                <div key={i} className="absolute left-0 right-0 border-t border-slate-100/70" style={{ top: i * PX_HORA }} />
              ))}

              {/* Ghost de gesto */}
              {gesto && gesto.colActual === colIdx && (
                <Ghost gesto={gesto} />
              )}

              {/* Bloques */}
              {items.map((oc) => {
                if (oc.allDay || !oc.startAt) return null;
                const s = new Date(oc.startAt);
                const e = oc.endAt ? new Date(oc.endAt) : new Date(s.getTime() + 60 * 60 * 1000);
                const mIni = s.getHours() * 60 + s.getMinutes();
                const mFin = e.getHours() * 60 + e.getMinutes();
                const top = ((mIni - HORA_INI * 60) / 60) * PX_HORA;
                const height = ((mFin - mIni) / 60) * PX_HORA;
                if (top + height < 0 || top > TOTAL_PX) return null;
                const cat = categorias.find((c) => c.id === oc.evento.categoryId);
                const color = oc.evento.colorOverride ?? cat?.color ?? '#06b6d4';
                return (
                  <div
                    key={oc.key}
                    data-evt
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                      setGesto({
                        tipo: 'move',
                        oc,
                        colInicial: colIdx,
                        colActual: colIdx,
                        startX: e.clientX,
                        startY: e.clientY,
                        offsetMin: minutosDesdeY(e.clientY, colIdx) - mIni,
                        durMin: mFin - mIni,
                        minActual: minutosDesdeY(e.clientY, colIdx),
                        movido: false,
                      });
                    }}
                    className={`group/evt absolute left-1 right-1 cursor-grab overflow-hidden rounded-md px-1.5 py-1 text-[10px] text-white shadow-sm transition active:cursor-grabbing ${
                      oc.isDone ? 'opacity-50' : ''
                    }`}
                    style={{ top, height, background: color }}
                    title="Arrastrá para mover · borde inferior para redimensionar"
                  >
                    {/* Grip dots visible al hover (esquina superior izquierda) */}
                    <span
                      className="pointer-events-none absolute left-0.5 top-0.5 opacity-0 transition-opacity group-hover/evt:opacity-90"
                      aria-hidden="true"
                    >
                      <GripVertical size={10} className="text-white/90 drop-shadow" />
                    </span>
                    <div className="flex items-center gap-1 pl-3">
                      <CirculoHecha
                        isDone={oc.isDone}
                        onToggle={() => onToggleDone(oc)}
                        size={11}
                        variant="sobreColor"
                      />
                      <span className={`truncate ${oc.isDone ? 'line-through' : ''}`}>{oc.evento.title}</span>
                    </div>
                    <div className="pl-3 opacity-80">
                      {fmtHM(mIni)} a {fmtHM(mFin)}
                    </div>
                    {/* Manija resize — visible al hover */}
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                        setGesto({
                          tipo: 'resize',
                          oc,
                          colInicial: colIdx,
                          colActual: colIdx,
                          startX: e.clientX,
                          startY: e.clientY,
                          startMin: mIni,
                          minActual: mFin,
                          movido: false,
                        });
                      }}
                      className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                      title="Arrastrá para redimensionar"
                    >
                      <div className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-white/0 transition-colors group-hover/evt:bg-white/85" />
                    </div>
                  </div>
                );
              })}

              {/* Proyectados timed (raro: la mayoría son all_day y van al
                  strip de arriba). Render read-only con Lock + cursor not-allowed. */}
              {(proyectadasPorDia.get(k) ?? [])
                .filter((p) => !p.allDay)
                .map((p, idx) => {
                  if (!p.startAt) return null;
                  const s = new Date(p.startAt);
                  const e = p.endAt ? new Date(p.endAt) : new Date(s.getTime() + 30 * 60 * 1000);
                  const mIni = s.getHours() * 60 + s.getMinutes();
                  const mFin = Math.max(mIni + 15, e.getHours() * 60 + e.getMinutes());
                  const top = ((mIni - HORA_INI * 60) / 60) * PX_HORA;
                  const height = ((mFin - mIni) / 60) * PX_HORA;
                  if (top + height < 0 || top > TOTAL_PX) return null;
                  return (
                    <button
                      key={`proy-${p.fuente}-${p.origenId}-${idx}`}
                      type="button"
                      data-proy
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onAbrirProyectada?.(p);
                      }}
                      className="absolute left-1 right-1 cursor-not-allowed overflow-hidden rounded-md px-1.5 py-1 text-left text-[10px] text-white shadow-sm"
                      style={{
                        top,
                        height,
                        background: p.color,
                        opacity: 0.6,
                        borderLeft: `3px solid ${colorDeFuente(p.fuente)}`,
                      }}
                      title={`${p.title} · sólo lectura`}
                    >
                      <div className="flex items-center gap-1">
                        <Lock size={10} className="shrink-0 text-white/95" />
                        <span className="truncate font-medium">{p.title}</span>
                      </div>
                      <div className="opacity-90">{fmtHM(mIni)}</div>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
      {/* Hint flotante: aparece en el primer hover y se desvanece a los 4s. */}
      {hintVisible && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 motion-safe:animate-fade-up">
          <div className="rounded-full bg-brand-ink/90 px-4 py-2 text-[11px] font-medium text-white shadow-xl backdrop-blur">
            Arrastrá un bloque para mover · tirá del borde inferior para la duración · pintá una franja vacía para crear.
          </div>
        </div>
      )}
    </div>
  );
}

function Ghost({ gesto }: { gesto: Gesto }) {
  if (gesto.tipo === 'paint' && gesto.minIni !== undefined && gesto.minActual !== undefined) {
    const mIni = Math.min(gesto.minIni, gesto.minActual);
    const mFin = Math.max(gesto.minIni, gesto.minActual);
    const top = ((mIni - HORA_INI * 60) / 60) * PX_HORA;
    const height = Math.max(((mFin - mIni) / 60) * PX_HORA, 8);
    return (
      <div
        className="pointer-events-none absolute left-1 right-1 rounded-md border border-brand-cyan bg-brand-cyan/20 px-1.5 py-1 text-[10px] text-brand-cyan"
        style={{ top, height }}
      >
        <div className="font-semibold">
          {fmtHM(mIni)} a {fmtHM(mFin)}
        </div>
        <div className="opacity-80">Nueva incidencia</div>
      </div>
    );
  }
  if (gesto.tipo === 'move' && gesto.oc && gesto.offsetMin !== undefined && gesto.durMin !== undefined && gesto.minActual !== undefined && gesto.movido) {
    const mIni = gesto.minActual - gesto.offsetMin;
    const mFin = mIni + gesto.durMin;
    const top = ((mIni - HORA_INI * 60) / 60) * PX_HORA;
    const height = ((mFin - mIni) / 60) * PX_HORA;
    return (
      <div
        className="pointer-events-none absolute left-1 right-1 rounded-md border-2 border-dashed border-brand-cyan bg-brand-cyan/20 px-1.5 py-1 text-[10px] text-brand-cyan"
        style={{ top, height }}
      >
        <div className="font-semibold">
          {fmtHM(mIni)} a {fmtHM(mFin)}
        </div>
        <div className="opacity-80 truncate">{gesto.oc.evento.title}</div>
      </div>
    );
  }
  if (gesto.tipo === 'resize' && gesto.startMin !== undefined && gesto.minActual !== undefined) {
    const mIni = gesto.startMin;
    const mFin = Math.max(mIni + 15, gesto.minActual);
    const top = ((mIni - HORA_INI * 60) / 60) * PX_HORA;
    const height = ((mFin - mIni) / 60) * PX_HORA;
    return (
      <div
        className="pointer-events-none absolute left-1 right-1 rounded-md border-2 border-dashed border-brand-cyan bg-brand-cyan/10"
        style={{ top, height }}
      >
        <div className="text-[10px] font-semibold text-brand-cyan">
          {fmtHM(mIni)} a {fmtHM(mFin)}
        </div>
      </div>
    );
  }
  return null;
}
