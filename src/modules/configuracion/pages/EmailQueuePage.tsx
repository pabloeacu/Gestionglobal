// EmailQueuePage · cola de emails workflow + envíos recientes. Realtime sobre
// email_queue. Tabla con: timestamp, template, to, estado, casilla, intento.
// Cita: D01 (cola persistida + Realtime), regla 13 (useConfirm).
// DGG-124 (pedido Pablo 31/07): grilla paginada server-side (50 por defecto),
// rango de fechas en un solo calendario y encabezados que ordenan/filtran/
// buscan. KPIs por counts sobre el universo COMPLETO (espíritu R19), no sobre
// la página visible.

import { useEffect, useState } from 'react';
import {
  Mail, Clock, CheckCircle2, AlertCircle, Loader2,
  RotateCcw, X, Layers, Eye,
} from 'lucide-react';
import {
  AnimatedNumber, useConfirm,
  Paginador, PAGE_SIZE_DEFAULT,
  FiltroRangoFechas, type RangoFechas,
  ThInteractivo, type OrdenGrilla, type OpcionFiltro,
} from '@/components/common';
import { EmailPreviewModal } from '@/components/common/EmailPreviewModal';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  listEnvios,
  contarEnviosKpis,
  listTemplates,
  reintentar,
  cancelar,
  CASILLAS,
  type EnvioListItem,
  type EstadoEmail,
  type FromCasilla,
  type ListEnviosFilters,
} from '@/services/api/emails';
import { humanizeError } from '@/lib/errors';

type EstadoFilter = EstadoEmail | 'todos';
type CasillaFilter = FromCasilla | 'todas';

const OPCIONES_ESTADO: OpcionFiltro[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'fallido', label: 'Fallido' },
];

export function EmailQueuePage() {
  const [rows, setRows] = useState<EnvioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [casilla, setCasilla] = useState<CasillaFilter>('todas');
  const [search, setSearch] = useState('');
  const [plantillas, setPlantillas] = useState<string[]>([]);
  const [rango, setRango] = useState<RangoFechas>({ desde: null, hasta: null });
  const [orden, setOrden] = useState<OrdenGrilla>({ campo: 'programado_para', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [total, setTotal] = useState(0);
  const [kpis, setKpis] = useState({ total: 0, pendientes: 0, enviados: 0, fallidos: 0 });
  const [opcionesPlantilla, setOpcionesPlantilla] = useState<OpcionFiltro[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const confirm = useConfirm();

  async function refresh() {
    const res = await listEnvios({
      estado,
      casilla,
      search: search || undefined,
      plantillas: plantillas.length > 0 ? plantillas : undefined,
      desde: rango.desde ?? undefined,
      hasta: rango.hasta ?? undefined,
      orden: orden.campo as ListEnviosFilters['orden'],
      dir: orden.dir,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    if (res.ok) { setRows(res.data.rows); setTotal(res.data.total); }
    else toast.error('No pudimos cargar la cola', { description: humanizeError(res.error) });
    setLoading(false);
  }

  async function refreshKpis() {
    const res = await contarEnviosKpis();
    if (res.ok) setKpis(res.data);
  }

  useEffect(() => { void refresh(); void refreshKpis(); /* eslint-disable-next-line */ },
    [estado, casilla, search, plantillas, rango, orden, page, pageSize]);

  // Opciones del filtro de encabezado "Plantilla" (catálogo chico, una vez).
  useEffect(() => {
    void listTemplates().then((r) => {
      if (r.ok) {
        setOpcionesPlantilla(r.data.map((t) => ({ value: t.slug, label: t.nombre ?? t.slug })));
      }
    });
  }, []);

  // Realtime: email_queue + sent_emails
  useEffect(() => {
    const ch = supabase
      .channel('email-queue-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_queue' }, () => { void refresh(); void refreshKpis(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sent_emails' },  () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [estado, casilla, search, plantillas, rango, orden, page, pageSize]);

  // Cualquier cambio de filtro u orden vuelve a la página 1.
  function conReset<T>(setter: (v: T) => void) {
    return (v: T) => { setPage(1); setter(v); };
  }

  async function handleReintentar(id: string) {
    const r = await reintentar(id);
    if (!r.ok) { toast.error('No pudimos reintentar', { description: humanizeError(r.error) }); return; }
    toast.success('Re-encolado · el dispatcher lo va a tomar (~1 min)');
    void refresh();
  }

  async function handleCancelar(id: string) {
    const okConfirm = await confirm({
      title: 'Cancelar envío',
      message: '¿Cancelás este email? No se va a enviar.',
      danger: true,
      confirmLabel: 'Cancelar envío',
    });
    if (!okConfirm) return;
    const r = await cancelar(id);
    if (!r.ok) { toast.error('No pudimos cancelar', { description: humanizeError(r.error) }); return; }
    toast.success('Email cancelado');
    void refresh();
  }

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      <header>
        <p className="kicker text-brand-cyan">Configuración · Emails</p>
        <h1 className="font-display text-2xl font-bold text-brand-ink">
          Cola de envíos
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Throttle global hard <strong>5 min</strong> entre envíos (E42/D05). El cron procesa cada minuto.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total" value={kpis.total} icon={Layers} tone="cyan" active={estado === 'todos'} onClick={() => conReset(setEstado)('todos')} />
        <KpiCard label="Pendientes" value={kpis.pendientes} icon={Clock} tone="amber" active={estado === 'pendiente'} onClick={() => conReset(setEstado)('pendiente')} />
        <KpiCard label="Enviados" value={kpis.enviados} icon={CheckCircle2} tone="emerald" active={estado === 'enviado'} onClick={() => conReset(setEstado)('enviado')} />
        <KpiCard label="Fallidos" value={kpis.fallidos} icon={AlertCircle} tone="red" active={estado === 'fallido'} onClick={() => conReset(setEstado)('fallido')} />
      </div>

      {/* DGG-124 · El rango vive acá (un solo calendario); búsqueda, filtros y
          orden viven en los encabezados de la grilla. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <FiltroRangoFechas valor={rango} onChange={conReset(setRango)} />
        <p className="text-xs text-brand-muted">
          Filtrá, buscá y ordená desde los encabezados de la tabla.
        </p>
      </div>

      <EmailPreviewModal
        open={previewId !== null}
        envioId={previewId}
        onClose={() => setPreviewId(null)}
      />

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-zebra/40 text-left text-xs uppercase tracking-wider text-brand-muted">
            <tr>
              <ThInteractivo
                label="Fecha"
                sortKey="programado_para"
                orden={orden}
                onOrden={conReset(setOrden)}
              />
              <ThInteractivo
                label="Plantilla"
                sortKey="template_slug"
                orden={orden}
                onOrden={conReset(setOrden)}
                filtroOpciones={opcionesPlantilla}
                filtroValores={plantillas}
                onFiltroValores={conReset(setPlantillas)}
              />
              <ThInteractivo
                label="Destinatario"
                sortKey="to_email"
                orden={orden}
                onOrden={conReset(setOrden)}
                busquedaValor={search}
                onBusqueda={conReset(setSearch)}
                busquedaPlaceholder="Email o asunto…"
              />
              <ThInteractivo
                label="Estado"
                filtroOpciones={OPCIONES_ESTADO}
                filtroValores={estado === 'todos' ? [] : [estado]}
                onFiltroValores={(vs) => {
                  // Single-select sincronizado con las cards KPI: gana el último.
                  const nuevo = vs.filter((v) => v !== estado)[0] as EstadoFilter | undefined;
                  conReset(setEstado)(nuevo ?? 'todos');
                }}
              />
              <ThInteractivo
                label="Casilla"
                filtroOpciones={CASILLAS.map((c) => ({ value: c.value, label: c.label }))}
                filtroValores={casilla === 'todas' ? [] : [casilla]}
                onFiltroValores={(vs) => {
                  const nuevo = vs.filter((v) => v !== casilla)[0] as CasillaFilter | undefined;
                  conReset(setCasilla)(nuevo ?? 'todas');
                }}
              />
              <ThInteractivo
                label="Intento"
                align="right"
                sortKey="intento"
                orden={orden}
                onOrden={conReset(setOrden)}
              />
              <th className="px-4 py-2">Error</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-10 text-center text-brand-muted">
                <Loader2 className="mx-auto animate-spin" size={18} />
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-brand-muted">
                Sin envíos en este filtro.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-zebra/30">
                <td className="px-4 py-2 font-mono text-[11px] text-brand-muted">
                  {r.enviado_at
                    ? new Date(r.enviado_at).toLocaleString('es-AR')
                    : r.programado_para
                      ? `prog: ${new Date(r.programado_para).toLocaleString('es-AR')}`
                      : '—'}
                </td>
                <td className="px-4 py-2">
                  <p className="font-medium text-brand-ink">{r.template_nombre ?? r.template_slug ?? '—'}</p>
                  <p className="font-mono text-[10px] text-brand-muted">{r.template_slug}</p>
                </td>
                <td className="px-4 py-2">
                  <p className="text-brand-ink">{r.to_email}</p>
                  {r.administracion_nombre && (
                    <p className="text-[11px] text-brand-muted">{r.administracion_nombre}</p>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1">
                    <EstadoBadge estado={r.estado} />
                    {/* D2-bis · delivery status del harvester (bounced/complained/...) */}
                    {r.delivery_estado && r.delivery_estado !== 'sent' && (
                      <DeliveryBadge estado={r.delivery_estado} error={r.delivery_error} />
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">
                  {r.casilla ? (CASILLAS.find(c => c.value === r.casilla)?.label ?? r.casilla) : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular text-xs">
                  {r.intento}/{r.max_intentos}
                </td>
                <td className="px-4 py-2 max-w-xs">
                  <p className="truncate text-xs text-red-700">{r.ultimo_error ?? '—'}</p>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setPreviewId(r.id)}
                      title="Ver lo que se envió"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                    >
                      <Eye size={11} /> Ver
                    </button>
                    {r.estado !== 'enviado' && (
                      <button
                        type="button"
                        onClick={() => void handleReintentar(r.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                      >
                        <RotateCcw size={11} /> Reintentar
                      </button>
                    )}
                    {r.estado === 'pendiente' && (
                      <button
                        type="button"
                        onClick={() => void handleCancelar(r.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <X size={11} /> Cancelar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <Paginador
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={(s) => { setPage(1); setPageSize(s); }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tone, active, onClick,
}: {
  label: string; value: number; icon: typeof Mail;
  tone: 'cyan' | 'amber' | 'emerald' | 'red';
  active: boolean; onClick: () => void;
}) {
  const tones = {
    cyan: 'border-brand-cyan/40 text-brand-cyan',
    amber: 'border-amber-300/60 text-amber-600',
    emerald: 'border-emerald-300/60 text-emerald-600',
    red: 'border-red-300/60 text-red-600',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'card-premium flex flex-col items-start gap-1 p-4 text-left transition',
        active ? `ring-2 ${tones.replace('text-', 'ring-')}` : 'hover:border-brand-cyan/40',
      )}
    >
      <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', tones)}>
        <Icon size={13} />
        {label}
      </div>
      <p className="font-display text-2xl font-bold tabular text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
    </button>
  );
}

function EstadoBadge({ estado }: { estado: EstadoEmail }) {
  const map: Record<EstadoEmail, { label: string; cls: string; icon: typeof Mail }> = {
    pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700', icon: Clock },
    enviado:   { label: 'Enviado',   cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    fallido:   { label: 'Fallido',   cls: 'bg-red-100 text-red-700', icon: AlertCircle },
  };
  const m = map[estado];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>
      <Icon size={10} />
      {m.label}
    </span>
  );
}

// D2-bis · Badge para el estado post-envío detectado por el bounce harvester.
// Solo se renderiza si delivery_estado != 'sent' (rebote, queja, retraso).
function DeliveryBadge({
  estado,
  error,
}: {
  estado: NonNullable<EnvioListItem['delivery_estado']>;
  error: string | null;
}) {
  const map = {
    sent: { label: 'Entregado al SMTP', cls: 'bg-slate-100 text-slate-600', icon: CheckCircle2 },
    delivered: { label: 'Entregado', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
    delivery_delayed: { label: 'Retrasado', cls: 'bg-amber-100 text-amber-700', icon: Clock },
    bounced: { label: 'Rebotado', cls: 'bg-red-100 text-red-700', icon: AlertCircle },
    complained: { label: 'Marcó spam', cls: 'bg-rose-100 text-rose-700', icon: AlertCircle },
    failed: { label: 'Falló', cls: 'bg-red-100 text-red-700', icon: AlertCircle },
  } as const;
  const m = map[estado];
  if (!m) return null;
  const Icon = m.icon;
  const title = error ? `${m.label} · ${error.slice(0, 200)}` : m.label;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        m.cls,
      )}
      title={title}
    >
      <Icon size={9} />
      {m.label}
    </span>
  );
}
