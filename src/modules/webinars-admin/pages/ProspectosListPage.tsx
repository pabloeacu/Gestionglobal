import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  Flame,
  History,
  Mail,
  Pencil,
  Phone,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button, Drawer, Field, Input, Modal, Select } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  convertirProspecto,
  getProspectoEventos,
  getWebinarCaptacionResumen,
  listProspectosCapitalizacion,
  listWebinars,
  type ProspectoCapitalizacionItem,
  type ProspectoEventoItem,
  type ProspectoRow,
  type WebinarCaptacionResumen,
  type WebinarRow,
} from '@/services/api/webinars';
import { listAdministraciones, type AdministracionListItem } from '@/services/api/administraciones';
import { cn } from '@/lib/cn';
import { rowsToCsv } from '@/lib/csvCopy';
import { downloadBlob } from '@/modules/reportes/lib/_helpers';
import { FormulariosWebinarsTabs } from '../components/FormulariosWebinarsTabs';
import { ProspectoEditDrawer } from '../components/ProspectoEditDrawer';
import { humanizeError } from '@/lib/errors';

function fmtFecha(iso: string): string {
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

function fmtFechaHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// El modal de conversión y el drawer de edición esperan un `ProspectoRow`.
// La grilla ahora usa `ProspectoCapitalizacionItem` (superset con engagement),
// así que adaptamos de vuelta al shape que esos componentes consumen.
function toProspectoRow(p: ProspectoCapitalizacionItem): ProspectoRow {
  return {
    id: p.id,
    nombre: p.nombre,
    email: p.email,
    telefono: p.telefono,
    origen: p.origen,
    observaciones: p.observaciones,
    convertido_a_administracion_id: p.convertido_a_administracion_id,
    convertido_at: p.convertido_at,
    creado_por: null,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

const CANAL_LABEL: Record<string, string> = {
  zoom: 'Zoom',
  youtube: 'YouTube',
  presencial: 'Presencial',
};

type Filtro = 'todos' | 'sin_convertir' | 'convertidos';

export function ProspectosListPage() {
  const [items, setItems] = useState<ProspectoCapitalizacionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('sin_convertir');
  const [search, setSearch] = useState('');
  const [convertirOpen, setConvertirOpen] = useState<ProspectoRow | null>(null);
  const [editing, setEditing] = useState<ProspectoRow | null>(null);

  // Filtro por evento
  const [eventos, setEventos] = useState<WebinarRow[]>([]);
  const [eventoId, setEventoId] = useState<string>(''); // '' = todos los eventos

  // Historial de eventos del prospecto (drawer)
  const [historialDe, setHistorialDe] = useState<ProspectoCapitalizacionItem | null>(null);

  // Resumen de captación del evento seleccionado
  const [resumen, setResumen] = useState<WebinarCaptacionResumen | null>(null);
  const [resumenLoading, setResumenLoading] = useState(false);

  async function recargar(webinarId: string) {
    setLoading(true);
    const res = await listProspectosCapitalizacion(webinarId || undefined);
    setLoading(false);
    if (res.ok) setItems(res.data);
    else toast.error('No pudimos cargar los prospectos', { description: humanizeError(res.error) });
  }

  // Lista de eventos para el filtro (una sola vez)
  useEffect(() => {
    void (async () => {
      const res = await listWebinars();
      if (res.ok) setEventos(res.data);
    })();
  }, []);

  // Recarga cuando cambia el evento seleccionado
  useEffect(() => { void recargar(eventoId); }, [eventoId]);

  // Resumen del evento (sólo cuando hay uno elegido)
  useEffect(() => {
    if (!eventoId) { setResumen(null); return; }
    let cancel = false;
    setResumenLoading(true);
    void (async () => {
      const res = await getWebinarCaptacionResumen(eventoId);
      if (cancel) return;
      setResumenLoading(false);
      setResumen(res.ok ? res.data : null);
    })();
    return () => { cancel = true; };
  }, [eventoId]);

  // R19: el dataset viene por evento del backend, pero estado + búsqueda se
  // filtran EN MEMORIA. Los KPIs se calculan sobre `items` (el universo del
  // evento elegido, o global si no hay evento) — no sobre la lista ya buscada.
  const visibles = useMemo(() => {
    return items.filter((p) => {
      if (filtro === 'sin_convertir' && p.convertido) return false;
      if (filtro === 'convertidos' && !p.convertido) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!p.nombre.toLowerCase().includes(s) && !p.email.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, filtro, search]);

  const total = items.length;
  const convertidos = items.filter((p) => p.convertido).length;
  const tasa = total ? Math.round((convertidos / total) * 100) : 0;

  const eventoSel = eventos.find((e) => e.id === eventoId) ?? null;

  function exportarCsv() {
    if (visibles.length === 0) {
      toast.error('No hay prospectos para exportar');
      return;
    }
    const csv = rowsToCsv(visibles, [
      { key: 'nombre', label: 'Nombre' },
      { key: 'email', label: 'Email' },
      { key: 'telefono', label: 'Teléfono', format: (r) => r.telefono ?? '' },
      { key: 'origen', label: 'Origen' },
      { key: 'eventos_total', label: 'Eventos' },
      { key: 'eventos_asistidos', label: 'Asistió' },
      { key: 'ultimo_evento_at', label: 'Último evento', format: (r) => (r.ultimo_evento_at ? fmtFecha(r.ultimo_evento_at) : '') },
      { key: 'convertido', label: 'Convertido', format: (r) => (r.convertido ? 'Sí' : 'No') },
      { key: 'created_at', label: 'Capturado', format: (r) => fmtFecha(r.created_at) },
    ]);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const hoy = new Date().toISOString().slice(0, 10);
    const sufijo = eventoSel ? '-' + eventoSel.titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
    downloadBlob(blob, `prospectos${sufijo}-${hoy}.csv`);
    toast.success('CSV exportado');
  }

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Prospectos</h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Leads capturados por eventos y formularios. Priorizá los que vinieron a varios eventos y convertí a cliente con un click.
          </p>
        </div>
        <Button variant="secondary" onClick={exportarCsv} title="Exportar la lista filtrada a CSV">
          <Download size={14} /> Exportar
        </Button>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total prospectos" value={total} icon={Users} tone="cyan" />
        <KpiCard label="Convertidos" value={convertidos} icon={CheckCircle2} tone="green" />
        <KpiCard label="Tasa conversión" value={`${tasa}%`} icon={UserPlus} tone="navy" />
      </div>

      {/* Mini-panel de captación del evento seleccionado */}
      {eventoId && (
        <CaptacionResumenPanel
          titulo={eventoSel?.titulo ?? 'Evento'}
          resumen={resumen}
          loading={resumenLoading}
        />
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select
          value={eventoId}
          onChange={(e) => setEventoId(e.target.value)}
          className="max-w-xs"
          title="Filtrar por evento"
        >
          <option value="">Todos los eventos</option>
          {eventos.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.titulo}</option>
          ))}
        </Select>
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="max-w-xs">
          <option value="todos">Todos</option>
          <option value="sin_convertir">Sin convertir</option>
          <option value="convertidos">Convertidos</option>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email"
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
          Cargando prospectos…
        </div>
      ) : visibles.length === 0 ? (
        <IllustratedEmpty
          title={items.length === 0 ? 'Todavía no hay prospectos' : 'Sin prospectos con ese filtro'}
          description={items.length === 0
            ? 'Cuando alguien se inscriba a un evento y no sea cliente, aparecerá acá como prospecto.'
            : 'Probá cambiar el filtro, el evento o limpiar la búsqueda.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Nombre</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Contacto</th>
                <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-brand-muted">Eventos</th>
                <th className="px-4 py-2 text-center text-xs font-semibold uppercase tracking-wider text-brand-muted">Asistió</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Último evento</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Estado</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-brand-muted">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((p) => {
                const caliente = p.eventos_total >= 2;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-brand-ink">
                      <div className="flex items-center gap-2">
                        <span>{p.nombre}</span>
                        {caliente && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-orange-100"
                            title={`Lead caliente: se anotó a ${p.eventos_total} eventos`}
                          >
                            <Flame size={10} /> Caliente
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      <div className="flex items-center gap-1"><Mail size={11} /> {p.email}</div>
                      {p.telefono && <div className="flex items-center gap-1"><Phone size={11} /> {p.telefono}</div>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={cn(
                          'inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
                          caliente
                            ? 'bg-orange-50 text-orange-700 ring-1 ring-orange-100'
                            : p.eventos_total > 0
                              ? 'bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/20'
                              : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {p.eventos_total}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center text-sm text-brand-ink">
                      {p.eventos_asistidos}
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      {p.ultimo_evento_at ? fmtFecha(p.ultimo_evento_at) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {p.convertido ? (
                        // E-GG-46 · Si el cliente al que se convirtió este
                        // prospecto está dado de baja, mostramos un badge
                        // adicional para que el gerente no asuma "Convertido"
                        // como cliente activo.
                        <div className="flex flex-col items-start gap-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                            <CheckCircle2 size={10} /> Convertido
                          </span>
                          {p.cliente_activo === false && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                              title={`Estado del cliente: ${p.cliente_estado ?? 'inactivo'}`}
                            >
                              Cliente de baja
                            </span>
                          )}
                          {p.cliente_estado === 'suspendido' && p.cliente_activo !== false && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Cliente suspendido
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Lead</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => setHistorialDe(p)}
                          title="Ver eventos del prospecto"
                          disabled={p.eventos_total === 0}
                        >
                          <History size={12} /> Ver eventos
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(toProspectoRow(p))} title="Editar prospecto">
                          <Pencil size={12} /> Editar
                        </Button>
                        {!p.convertido && (
                          <Button variant="tonal" onClick={() => setConvertirOpen(toProspectoRow(p))}>
                            <UserPlus size={12} /> Convertir
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {convertirOpen && (
        <ConvertirModal
          prospecto={convertirOpen}
          onClose={() => setConvertirOpen(null)}
          onConverted={() => { setConvertirOpen(null); void recargar(eventoId); }}
        />
      )}

      <ProspectoEditDrawer
        open={!!editing}
        prospecto={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void recargar(eventoId); }}
      />

      <HistorialEventosDrawer
        prospecto={historialDe}
        onClose={() => setHistorialDe(null)}
      />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof Users; tone: 'cyan' | 'green' | 'navy' }) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-brand-ink">{value}</p>
    </div>
  );
}

// Mini-panel del embudo de captación de un evento: inscriptos → asistieron →
// convertidos + tasa de asistencia.
function CaptacionResumenPanel({
  titulo,
  resumen,
  loading,
}: {
  titulo: string;
  resumen: WebinarCaptacionResumen | null;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.03] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={15} className="text-brand-cyan" />
        <p className="text-sm font-semibold text-brand-ink">Captación · {titulo}</p>
      </div>
      {loading ? (
        <p className="text-sm text-brand-muted">Calculando…</p>
      ) : !resumen ? (
        <p className="text-sm text-brand-muted">Sin datos de captación.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <ResumenStat label="Inscriptos" value={resumen.inscriptos} />
          <ResumenStat label="Asistieron" value={resumen.asistieron} />
          <ResumenStat label="Prospectos" value={resumen.prospectos} />
          <ResumenStat label="Clientes" value={resumen.clientes} />
          <ResumenStat label="Convertidos" value={resumen.convertidos} tone="green" />
          <ResumenStat label="Tasa asist." value={`${resumen.tasa_asistencia}%`} tone="cyan" />
        </div>
      )}
    </div>
  );
}

function ResumenStat({ label, value, tone }: { label: string; value: number | string; tone?: 'green' | 'cyan' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={cn(
        'font-display text-lg font-bold',
        tone === 'green' ? 'text-green-700' : tone === 'cyan' ? 'text-brand-cyan' : 'text-brand-ink',
      )}>
        {value}
      </p>
    </div>
  );
}

// Drawer con el historial de eventos del prospecto (título + fecha + canal +
// si asistió). Carga on-open vía getProspectoEventos.
function HistorialEventosDrawer({
  prospecto,
  onClose,
}: {
  prospecto: ProspectoCapitalizacionItem | null;
  onClose: () => void;
}) {
  const [eventos, setEventos] = useState<ProspectoEventoItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!prospecto) return;
    let cancel = false;
    setLoading(true);
    setEventos([]);
    void (async () => {
      const res = await getProspectoEventos(prospecto.id);
      if (cancel) return;
      setLoading(false);
      if (res.ok) setEventos(res.data);
      else toast.error('No pudimos cargar el historial', { description: humanizeError(res.error) });
    })();
    return () => { cancel = true; };
  }, [prospecto?.id]);

  return (
    <Drawer
      open={!!prospecto}
      onClose={onClose}
      width={520}
      kicker="Historial"
      title={prospecto?.nombre ?? 'Prospecto'}
      description="Eventos a los que se anotó este prospecto."
      icon={<History size={20} />}
    >
      {loading ? (
        <p className="text-sm text-brand-muted">Cargando eventos…</p>
      ) : eventos.length === 0 ? (
        <p className="text-sm text-brand-muted">Este prospecto todavía no se anotó a ningún evento.</p>
      ) : (
        <ul className="space-y-2">
          {eventos.map((ev) => (
            <li
              key={ev.webinar_id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-brand-ink">{ev.titulo}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-brand-muted">
                  <span className="inline-flex items-center gap-1"><CalendarClock size={11} /> {fmtFechaHora(ev.fecha_hora)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                    {CANAL_LABEL[ev.canal] ?? ev.canal}
                  </span>
                </p>
              </div>
              {ev.asistio ? (
                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  <CheckCircle2 size={10} /> Asistió
                </span>
              ) : (
                <span className="inline-flex flex-shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                  No asistió
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function ConvertirModal({ prospecto, onClose, onConverted }: {
  prospecto: ProspectoRow;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [administraciones, setAdministraciones] = useState<AdministracionListItem[]>([]);
  const [search, setSearch] = useState('');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) {
        setAdministraciones([]);
        return;
      }
      setSearching(true);
      const res = await listAdministraciones({ search: search.trim(), limit: 10 });
      setSearching(false);
      if (res.ok) setAdministraciones(res.data.rows);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function onConvertir() {
    if (!seleccionada) {
      toast.error('Seleccioná una administración');
      return;
    }
    setLoading(true);
    const res = await convertirProspecto(prospecto.id, seleccionada);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos convertir', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Prospecto convertido a cliente');
    onConverted();
  }

  return (
    <Modal open onClose={onClose} title="Convertir prospecto a cliente" width={520}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-brand-ink">{prospecto.nombre}</p>
          <p className="text-xs text-brand-muted">{prospecto.email}</p>
          {prospecto.telefono && <p className="text-xs text-brand-muted">{prospecto.telefono}</p>}
        </div>

        <Field
          label="Buscar administración existente"
          hint="Si todavía no creaste la administración, andá a /gerencia/clientes y creala primero."
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código o CUIT"
          />
        </Field>

        {searching && <p className="text-xs text-brand-muted">Buscando…</p>}

        {administraciones.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-xl border border-slate-200">
            {administraciones.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSeleccionada(a.id)}
                  className={cn(
                    'flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50',
                    seleccionada === a.id && 'bg-brand-cyan/5 ring-1 ring-inset ring-brand-cyan/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">{a.nombre}</p>
                    <p className="text-xs text-brand-muted">
                      {a.codigo ?? '—'} · {a.estado} · {a.consorcios_count} consorcios
                    </p>
                  </div>
                  {seleccionada === a.id && <CheckCircle2 size={16} className="text-brand-cyan flex-shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        )}

        {seleccionada && (
          <div className="rounded-xl bg-brand-cyan/5 p-3 text-xs text-brand-ink">
            ✓ Al confirmar: el prospecto queda marcado como convertido y sus inscripciones a eventos se relinkean a esta administración.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConvertir} loading={loading} disabled={!seleccionada}>
            Convertir a cliente
          </Button>
        </div>
      </div>
    </Modal>
  );
}
