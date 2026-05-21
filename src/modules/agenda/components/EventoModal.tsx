// EventoModal — Crear / Editar evento. Capa 1 (campos básicos) + Capa 2
// opcional (vínculos) que se abre como PANEL LATERAL (E8 del handoff:
// nunca crecer hacia abajo).
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Repeat, X } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  type AgendaCategoria,
  type AgendaEvento,
  type AgendaPrioridad,
  type AgendaRecurrencia,
  type VinculoOpcion,
  actualizarEvento,
  crearEvento,
  listVinculosCatalogo,
} from '@/services/api/agenda';

export interface EventoDraft {
  id?: string;
  title: string;
  notes: string;
  categoryId: string | null;
  fecha: string; // YYYY-MM-DD
  desde: string; // HH:MM
  hasta: string; // HH:MM
  allDay: boolean;
  priority: AgendaPrioridad;
  recurrence: AgendaRecurrencia;
  recurrenceWeekdays: number[];
  recurrenceMonthday: number | null;
  recurrenceUntil: string | null;
  linkedConsorcioIds: string[];
  linkedAdministracionId: string | null;
  linkedComprobanteId: string | null;
  linkedTramiteId: string | null;
}

const DOWS = [
  { v: 1, label: 'L' },
  { v: 2, label: 'M' },
  { v: 3, label: 'M' },
  { v: 4, label: 'J' },
  { v: 5, label: 'V' },
  { v: 6, label: 'S' },
  { v: 0, label: 'D' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categorias: AgendaCategoria[];
  draft?: Partial<EventoDraft>;
  evento?: AgendaEvento | null; // si está, es edit
}

function eventoADraft(ev: AgendaEvento): EventoDraft {
  const start = ev.startAt ? new Date(ev.startAt) : null;
  const end = ev.endAt ? new Date(ev.endAt) : null;
  const fecha = start
    ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    : '';
  const desde = start
    ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
    : '09:00';
  const hasta = end
    ? `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
    : '10:00';
  return {
    id: ev.id,
    title: ev.title,
    notes: ev.notes ?? '',
    categoryId: ev.categoryId,
    fecha,
    desde,
    hasta,
    allDay: ev.allDay,
    priority: ev.priority,
    recurrence: ev.recurrence,
    recurrenceWeekdays: ev.recurrenceWeekdays ?? [],
    recurrenceMonthday: ev.recurrenceMonthday,
    recurrenceUntil: ev.recurrenceUntil,
    linkedConsorcioIds: ev.linkedConsorcioIds,
    linkedAdministracionId: ev.linkedAdministracionId,
    linkedComprobanteId: ev.linkedComprobanteId,
    linkedTramiteId: ev.linkedTramiteId,
  };
}

function defaultDraft(d?: Partial<EventoDraft>): EventoDraft {
  const hoy = new Date();
  const fecha = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  return {
    title: '',
    notes: '',
    categoryId: null,
    fecha,
    desde: '09:00',
    hasta: '10:00',
    allDay: false,
    priority: 'media',
    recurrence: 'none',
    recurrenceWeekdays: [],
    recurrenceMonthday: null,
    recurrenceUntil: null,
    linkedConsorcioIds: [],
    linkedAdministracionId: null,
    linkedComprobanteId: null,
    linkedTramiteId: null,
    ...d,
  };
}

export function EventoModal({ open, onClose, onSaved, categorias, draft, evento }: Props) {
  const [d, setD] = useState<EventoDraft>(() =>
    evento ? eventoADraft(evento) : defaultDraft(draft),
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [vinculos, setVinculos] = useState<VinculoOpcion[]>([]);
  const [saving, setSaving] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    if (!open) return;
    setD(evento ? eventoADraft(evento) : defaultDraft(draft));
    setPanelOpen(false);
    setBusqueda('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, evento?.id]);

  useEffect(() => {
    if (panelOpen && vinculos.length === 0) {
      void (async () => {
        const res = await listVinculosCatalogo();
        if (res.ok) setVinculos(res.data);
      })();
    }
  }, [panelOpen, vinculos.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const consorcios = useMemo(() => vinculos.filter((v) => v.tipo === 'consorcio'), [vinculos]);
  const administraciones = useMemo(
    () => vinculos.filter((v) => v.tipo === 'administracion'),
    [vinculos],
  );
  const comprobantes = useMemo(() => vinculos.filter((v) => v.tipo === 'comprobante'), [vinculos]);
  const tramites = useMemo(() => vinculos.filter((v) => v.tipo === 'tramite'), [vinculos]);

  function buildIsos(): { startAt: string | null; endAt: string | null } {
    if (!d.fecha) return { startAt: null, endAt: null };
    if (d.allDay) {
      const s = new Date(`${d.fecha}T00:00:00`);
      return { startAt: s.toISOString(), endAt: null };
    }
    const partsD = (d.desde || '09:00').split(':');
    const hh = parseInt(partsD[0] ?? '9', 10);
    const mm = parseInt(partsD[1] ?? '0', 10);
    const s = new Date(`${d.fecha}T00:00:00`);
    s.setHours(hh, mm || 0, 0, 0);
    let e: Date;
    if (d.hasta && /^\d{2}:\d{2}$/.test(d.hasta)) {
      const partsH = d.hasta.split(':');
      const eh = parseInt(partsH[0] ?? '10', 10);
      const em = parseInt(partsH[1] ?? '0', 10);
      e = new Date(s);
      e.setHours(eh, em || 0, 0, 0);
      if (e <= s) e = new Date(s.getTime() + 60 * 60 * 1000); // E3: default +1h
    } else {
      e = new Date(s.getTime() + 60 * 60 * 1000);
    }
    return { startAt: s.toISOString(), endAt: e.toISOString() };
  }

  async function guardar() {
    if (!d.title.trim()) {
      toast.error('Falta el título.');
      return;
    }
    setSaving(true);
    const { startAt, endAt } = buildIsos();
    const payload = {
      title: d.title.trim(),
      notes: d.notes.trim() || null,
      categoryId: d.categoryId,
      startAt,
      endAt,
      allDay: d.allDay,
      priority: d.priority,
      recurrence: d.recurrence,
      recurrenceWeekdays: d.recurrence === 'weekly' ? d.recurrenceWeekdays : null,
      recurrenceMonthday: d.recurrence === 'monthly' ? d.recurrenceMonthday : null,
      recurrenceUntil: d.recurrenceUntil,
      linkedConsorcioIds: d.linkedConsorcioIds,
      linkedAdministracionId: d.linkedAdministracionId,
      linkedComprobanteId: d.linkedComprobanteId,
      linkedTramiteId: d.linkedTramiteId,
    };
    const res = d.id ? await actualizarEvento(d.id, payload) : await crearEvento(payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(d.id ? 'Actualizado' : '¡Anotado! 📌');
    onSaved();
  }

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/40 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`flex max-h-[90vh] w-full flex-row overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 motion-safe:animate-spring-in ${panelOpen ? 'max-w-3xl' : 'max-w-md'}`}
      >
        {/* Capa 1 */}
        <div className="flex w-full flex-col sm:w-[440px] sm:shrink-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-brand-muted">
                {d.id ? 'Editar' : 'Nueva incidencia'}
              </p>
              <h2 className="font-display text-lg font-semibold text-brand-ink">
                {d.id ? d.title : 'Anotá algo nuevo'}
              </h2>
            </div>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            <Field label="Título">
              <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoría">
                <Select
                  value={d.categoryId ?? ''}
                  onChange={(e) => setD({ ...d, categoryId: e.target.value || null })}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Prioridad">
                <Select
                  value={d.priority}
                  onChange={(e) => setD({ ...d, priority: e.target.value as AgendaPrioridad })}
                >
                  <option value="baja">Baja</option>
                  <option value="media">Media</option>
                  <option value="alta">Alta</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Fecha">
                <Input
                  type="date"
                  value={d.fecha}
                  onChange={(e) => setD({ ...d, fecha: e.target.value })}
                />
              </Field>
              <Field label="Desde">
                <Input
                  type="time"
                  value={d.desde}
                  disabled={d.allDay}
                  onChange={(e) => setD({ ...d, desde: e.target.value })}
                />
              </Field>
              <Field label="Hasta">
                <Input
                  type="time"
                  value={d.hasta}
                  disabled={d.allDay}
                  onChange={(e) => setD({ ...d, hasta: e.target.value })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-brand-ink">
              <input
                type="checkbox"
                checked={d.allDay}
                onChange={(e) => setD({ ...d, allDay: e.target.checked })}
                className="rounded border-slate-300"
              />
              Todo el día
            </label>

            <Field label="Recurrencia">
              <Select
                value={d.recurrence}
                onChange={(e) =>
                  setD({ ...d, recurrence: e.target.value as AgendaRecurrencia })
                }
              >
                <option value="none">No se repite</option>
                <option value="daily">Todos los días</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </Select>
            </Field>
            {d.recurrence === 'weekly' && (
              <div className="flex gap-1.5">
                {DOWS.map((dw) => {
                  const active = d.recurrenceWeekdays.includes(dw.v);
                  return (
                    <button
                      key={dw.v}
                      type="button"
                      onClick={() =>
                        setD({
                          ...d,
                          recurrenceWeekdays: active
                            ? d.recurrenceWeekdays.filter((x) => x !== dw.v)
                            : [...d.recurrenceWeekdays, dw.v].sort(),
                        })
                      }
                      className={`h-8 w-8 rounded-full border text-xs font-semibold transition ${
                        active
                          ? 'border-brand-cyan bg-brand-cyan text-white'
                          : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40'
                      }`}
                    >
                      {dw.label}
                    </button>
                  );
                })}
              </div>
            )}
            {d.recurrence === 'monthly' && (
              <Field label="Día del mes">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={d.recurrenceMonthday ?? ''}
                  onChange={(e) =>
                    setD({
                      ...d,
                      recurrenceMonthday: e.target.value ? parseInt(e.target.value, 10) : null,
                    })
                  }
                />
              </Field>
            )}
            {d.recurrence !== 'none' && (
              <Field label="Hasta (opcional)">
                <Input
                  type="date"
                  value={d.recurrenceUntil ?? ''}
                  onChange={(e) =>
                    setD({ ...d, recurrenceUntil: e.target.value || null })
                  }
                />
              </Field>
            )}

            <Field label="Notas">
              <Textarea
                rows={3}
                value={d.notes}
                onChange={(e) => setD({ ...d, notes: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-brand-cyan hover:bg-brand-cyan-pale/40"
            >
              <Link2 size={14} />
              {panelOpen ? 'Cerrar vínculos' : 'Agregar vínculos'}
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={() => void guardar()} disabled={saving}>
                {saving ? 'Guardando...' : d.id ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </div>
        </div>

        {/* Capa 2 — panel lateral animado (E8) */}
        {panelOpen && (
          <div className="hidden w-[420px] shrink-0 flex-col border-l border-slate-100 bg-brand-zebra sm:flex">
            <div className="border-b border-slate-100 px-5 py-3">
              <p className="text-[10px] uppercase tracking-wider text-brand-muted">Capa 2</p>
              <h3 className="font-display text-base font-semibold text-brand-ink">Vínculos</h3>
              <p className="mt-0.5 text-xs text-brand-muted">
                Conectá este evento con entidades del negocio. No es obligatorio.
              </p>
              <Input
                placeholder="Filtrar..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="mt-2"
              />
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
              <BloqueVinculos
                titulo="Administraciones"
                tipo="administracion"
                items={administraciones}
                busqueda={busqueda}
                seleccionados={d.linkedAdministracionId ? [d.linkedAdministracionId] : []}
                onToggle={(id) =>
                  setD({
                    ...d,
                    linkedAdministracionId: d.linkedAdministracionId === id ? null : id,
                  })
                }
                single
              />
              <BloqueVinculos
                titulo="Consorcios"
                tipo="consorcio"
                items={consorcios}
                busqueda={busqueda}
                seleccionados={d.linkedConsorcioIds}
                onToggle={(id) =>
                  setD({
                    ...d,
                    linkedConsorcioIds: d.linkedConsorcioIds.includes(id)
                      ? d.linkedConsorcioIds.filter((x) => x !== id)
                      : [...d.linkedConsorcioIds, id],
                  })
                }
              />
              <BloqueVinculos
                titulo="Trámites"
                tipo="tramite"
                items={tramites}
                busqueda={busqueda}
                seleccionados={d.linkedTramiteId ? [d.linkedTramiteId] : []}
                onToggle={(id) =>
                  setD({
                    ...d,
                    linkedTramiteId: d.linkedTramiteId === id ? null : id,
                  })
                }
                single
              />
              <BloqueVinculos
                titulo="Comprobantes"
                tipo="comprobante"
                items={comprobantes}
                busqueda={busqueda}
                seleccionados={d.linkedComprobanteId ? [d.linkedComprobanteId] : []}
                onToggle={(id) =>
                  setD({
                    ...d,
                    linkedComprobanteId: d.linkedComprobanteId === id ? null : id,
                  })
                }
                single
              />
              {d.recurrence !== 'none' && (
                <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50/60 p-2 text-xs text-violet-700">
                  <Repeat size={12} className="mr-1 inline" />
                  Este evento es recurrente.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function BloqueVinculos({
  titulo,
  items,
  busqueda,
  seleccionados,
  onToggle,
  single,
}: {
  titulo: string;
  tipo: string;
  items: VinculoOpcion[];
  busqueda: string;
  seleccionados: string[];
  onToggle: (id: string) => void;
  single?: boolean;
}) {
  const filtrados = useMemo(() => {
    if (!busqueda) return items;
    const q = busqueda.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q) || (i.hint ?? '').toLowerCase().includes(q));
  }, [items, busqueda]);
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-brand-muted">
        {titulo} {single ? '(elegí uno)' : ''}{' '}
        <span className="text-slate-300">· {filtrados.length}</span>
      </div>
      <div className="max-h-44 overflow-y-auto">
        {filtrados.length === 0 ? (
          <div className="px-3 py-4 text-xs text-slate-400">Sin resultados.</div>
        ) : (
          filtrados.slice(0, 100).map((it) => {
            const sel = seleccionados.includes(it.id);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onToggle(it.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition ${
                  sel ? 'bg-brand-cyan-pale/40' : 'hover:bg-slate-50'
                }`}
              >
                <span className="line-clamp-1">{it.label}</span>
                {it.hint && <span className="text-[10px] text-brand-muted">{it.hint}</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
