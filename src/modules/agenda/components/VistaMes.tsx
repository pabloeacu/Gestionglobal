// VistaMes — grilla 6x7. Por cada día hasta 3 chips con color de categoría;
// los demás se cuentan como "+N más" (handoff C2). Drag&drop día↔día con
// snap a la misma hora — actualiza vía onMover.
//
// Ronda 6 / DGG-06: además de eventos personales, intercala proyecciones
// (vencimientos/trámites/comprobantes/solicitudes) read-only con ícono Lock.
import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  type AgendaCategoria,
  type AgendaEvento,
  type AgendaOverride,
  type OcurrenciaUnificada,
} from '@/services/api/agenda';
import { expandirRango, type Ocurrencia } from '@/lib/agendaRecurrencia';
import { agruparPorDia, type ItemCalendario } from '@/lib/agendaRender';
import { toast } from '@/lib/toast';
import { CirculoHecha } from './CirculoHecha';
import { colorDeFuente } from '../fuenteColor';

const MES_HINT_LS_KEY = 'gg.agenda.mesHint';

interface Props {
  anchor: Date;
  eventos: AgendaEvento[];
  overrides: AgendaOverride[];
  categorias: AgendaCategoria[];
  proyectadas?: OcurrenciaUnificada[];
  onPickDay: (d: Date) => void;
  onAbrirAcciones: (oc: Ocurrencia, x: number, y: number) => void;
  onToggleDone: (oc: Ocurrencia) => void;
  onMover: (oc: Ocurrencia, nuevaFecha: Date) => void;
  onCrearEnFecha: (d: Date) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfWeekMon(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // lunes=0
  x.setDate(x.getDate() - dow);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DOW_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function VistaMes({
  anchor,
  eventos,
  overrides,
  categorias,
  proyectadas = [],
  onPickDay,
  onAbrirAcciones,
  onToggleDone,
  onMover,
  onCrearEnFecha,
  onAbrirProyectada,
}: Props) {
  const inicioMes = startOfMonth(anchor);
  const gridStart = startOfWeekMon(inicioMes);
  const gridEnd = addDays(gridStart, 42);

  const dias = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) out.push(addDays(gridStart, i));
    return out;
  }, [gridStart]);

  const porDia = useMemo(() => {
    const oc = expandirRango(eventos, overrides, gridStart, gridEnd);
    // Solo proyectadas que caen dentro del rango visible.
    const proyEnRango = proyectadas.filter((p) => {
      if (!p.startAt) return false;
      const d = new Date(p.startAt);
      return d >= gridStart && d < gridEnd;
    });
    return agruparPorDia(oc, proyEnRango);
  }, [eventos, overrides, gridStart, gridEnd, proyectadas]);

  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ ocKey: string; title: string } | null>(null);
  const hoy = ymd(new Date());

  // Toast one-time como reemplazo del tip pasivo (regla 13: usamos sonner).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MES_HINT_LS_KEY) === '1') return;
      toast.info('Tip · arrastrá un evento a otro día para reprogramarlo · doble click en un día para crear.');
      window.localStorage.setItem(MES_HINT_LS_KEY, '1');
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-wider text-brand-muted">
        {DOW_HEADERS.map((h) => (
          <div key={h}>{h}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dias.map((d) => {
          const key = ymd(d);
          const enMes = d.getMonth() === anchor.getMonth();
          const items: ItemCalendario[] = porDia.get(key) ?? [];
          const esHoy = key === hoy;
          // Para el "+N más" se usa el total de items (personal + proyectada).
          const visibles = items.slice(0, 3);
          const ocultos = items.length - visibles.length;
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(key);
              }}
              onDragLeave={() => setDragOverKey(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverKey(null);
                setDrag(null);
                const data = e.dataTransfer.getData('text/agenda');
                if (!data) return;
                // Buscamos sobre TODAS las ocurrencias personales del rango.
                const todasPersonales: Ocurrencia[] = [];
                for (const arr of porDia.values()) {
                  for (const it of arr) {
                    if (it.kind === 'personal') todasPersonales.push(it.ocurrencia);
                  }
                }
                const origen = todasPersonales.find((o) => o.key === data);
                if (origen) onMover(origen, d);
              }}
              onDoubleClick={() => onCrearEnFecha(d)}
              className={`relative h-28 rounded-lg border p-1.5 text-left transition ${
                enMes ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50/40 text-slate-400'
              } ${dragOverKey === key ? 'ring-2 ring-brand-cyan/40 bg-brand-cyan/5' : ''}`}
            >
              {dragOverKey === key && drag && (
                <div className="pointer-events-none absolute inset-x-1 bottom-1 z-10 rounded-md border-2 border-dashed border-brand-cyan bg-white/95 px-1.5 py-1 text-[10px] text-brand-cyan shadow-md">
                  <div className="truncate font-semibold">{drag.title}</div>
                  <div className="text-[9px] opacity-80">
                    → {d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' })}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onPickDay(d)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                    esHoy ? 'bg-brand-cyan text-white' : 'text-brand-ink hover:bg-slate-100'
                  }`}
                >
                  {d.getDate()}
                </button>
              </div>
              <div className="mt-1 space-y-0.5">
                {visibles.map((it, idx) => {
                  if (it.kind === 'personal') {
                    const oc = it.ocurrencia;
                    const cat = categorias.find((c) => c.id === oc.evento.categoryId);
                    const color = oc.evento.colorOverride ?? cat?.color ?? '#06b6d4';
                    return (
                      <div
                        key={oc.key}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/agenda', oc.key);
                          e.dataTransfer.effectAllowed = 'move';
                          setDrag({ ocKey: oc.key, title: oc.evento.title });
                        }}
                        onDragEnd={() => setDrag(null)}
                        onClick={(e) => onAbrirAcciones(oc, e.clientX, e.clientY)}
                        className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] text-white ${
                          oc.isDone ? 'opacity-40' : ''
                        }`}
                        style={{ background: color }}
                        title={oc.evento.title}
                      >
                        <CirculoHecha
                          isDone={oc.isDone}
                          onToggle={() => onToggleDone(oc)}
                          size={11}
                          variant="sobreColor"
                        />
                        <span className={`truncate ${oc.isDone ? 'line-through' : ''}`}>
                          {oc.evento.title}
                        </span>
                      </div>
                    );
                  }
                  // Proyectada (read-only, Lock, color tenue). 3.D · borde
                  // izquierdo 3px con el color de la fuente para lectura
                  // instantánea por categoría.
                  const p = it.proyeccion;
                  const cf = colorDeFuente(p.fuente);
                  return (
                    <button
                      key={`${p.fuente}-${p.origenId}-${idx}`}
                      type="button"
                      data-proy
                      onClick={(e) => {
                        e.stopPropagation();
                        onAbrirProyectada?.(p);
                      }}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] text-white"
                      style={{
                        background: p.color,
                        opacity: 0.6,
                        borderLeft: `3px solid ${cf}`,
                      }}
                      title={`${p.title} · sólo lectura`}
                    >
                      <Lock size={9} className="shrink-0 text-white/95" />
                      <span className="truncate">{p.title}</span>
                    </button>
                  );
                })}
                {ocultos > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      // Abre el primero de los ocultos. Si es proyectado o
                      // personal, decide en el handler correspondiente.
                      const it = items[3];
                      if (!it) return;
                      if (it.kind === 'personal') {
                        onAbrirAcciones(it.ocurrencia, e.clientX, e.clientY);
                      } else {
                        onAbrirProyectada?.(it.proyeccion);
                      }
                    }}
                    className="block text-[10px] text-brand-cyan hover:underline"
                  >
                    +{ocultos} más
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
