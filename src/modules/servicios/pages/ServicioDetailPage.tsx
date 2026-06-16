import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  ArrowLeft,
  Plus,
  Briefcase,
  History,
  Building2,
  Pencil,
  X,
  Globe,
  Users,
} from 'lucide-react';
import {
  Button,
  Skeleton,
  SkeletonText,
  AnimatedNumber,
  useConfirm,
  Tabs,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort, formatTimestampDate } from '@/lib/dates';
import {
  getServicio,
  cerrarPrecio,
  listAuditServicio,
  listCategorias,
  PRECIO_MODO_LABEL,
  ORIGEN_PRECIO_LABEL,
  type ServicioDetail,
  type AuditRow,
  type CategoriaServicioRow,
  type PrecioModo,
} from '@/services/api/servicios';
import { PrecioDrawer } from '../components/PrecioDrawer';
import { ServicioFormDrawer } from '../components/ServicioFormDrawer';
import { VouchersTab } from '../components/VouchersTab';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

export function ServicioDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [data, setData] = useState<ServicioDetail | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [categorias, setCategorias] = useState<CategoriaServicioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [precioOpen, setPrecioOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<'precios' | 'historial' | 'vouchers'>('precios');
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    setError(null);
    const r = await getServicio(id);
    setLoading(false);
    if (!r.ok) {
      setError(humanizeError(r.error));
      return;
    }
    setData(r.data);
    const a = await listAuditServicio(id);
    if (a.ok) setAudit(a.data);
  }

  useEffect(() => {
    if (!id) return;
    void load();
    void (async () => {
      const r = await listCategorias();
      if (r.ok) setCategorias(r.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtimeRefresh(['servicios', 'tabulador_precios', 'precio_audit'], () =>
    void load(),
  );

  async function onCerrarPrecio(precioId: string, label: string) {
    const ok = await confirm({
      title: 'Cerrar precio vigente',
      message: `Vamos a marcar el precio “${label}” como cerrado hoy. Si era la regla base abierta, va a quedar sin regla base — cargá una nueva.`,
      confirmLabel: 'Cerrar precio',
      danger: true,
    });
    if (!ok) return;
    const r = await cerrarPrecio(precioId);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    toast.success('Precio cerrado.');
    void load();
  }

  const tabs: TabItem[] = [
    { key: 'precios', label: 'Precios' },
    { key: 'historial', label: 'Historial' },
    { key: 'vouchers', label: 'Vouchers' },
  ];

  return (
    <div className="space-y-6">
      <Link
        to="/gerencia/servicios"
        className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-ink"
      >
        <ArrowLeft size={14} /> Volver al catálogo
      </Link>

      {/* Header */}
      <section className="card-premium relative overflow-hidden p-6 motion-safe:animate-fade-up">
        <TrianglesAccent position="top-right" size={180} tone="teal" />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="kicker flex items-center gap-1">
              <Briefcase size={12} /> Catálogo
            </p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-72" />
            ) : data ? (
              <>
                <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
                  {data.servicio.nombre}
                </h1>
                <p className="text-sm text-brand-muted">
                  {data.servicio.categoria_nombre} · {data.servicio.codigo} ·{' '}
                  {PRECIO_MODO_LABEL[
                    data.servicio.precio_modo as PrecioModo
                  ] ?? data.servicio.precio_modo}
                </p>
                {data.servicio.descripcion && (
                  <p className="mt-2 max-w-2xl text-sm text-brand-ink/80">
                    {data.servicio.descripcion}
                  </p>
                )}
              </>
            ) : null}
            {error && (
              <p className="mt-2 text-sm text-red-600">{error}</p>
            )}
          </div>
          {data && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setEditOpen(true)}
              >
                <Pencil size={16} /> Editar
              </Button>
              <Button onClick={() => setPrecioOpen(true)} type="button">
                <Plus size={16} /> Nuevo precio
              </Button>
            </div>
          )}
        </div>
        {data && (
          <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetaPill
              icon={<Globe size={14} />}
              label="Precio público"
              value={
                <PrecioTotal value={data.servicio.precio_publico} />
              }
              hint="Solicitudes desde landing"
            />
            <MetaPill
              icon={<Users size={14} />}
              label="Precio cliente"
              value={
                <PrecioTotal value={data.servicio.precio_cliente} />
              }
              hint="Solicitudes desde portal"
            />
            <MetaPill
              icon={<Building2 size={14} />}
              label="Reglas especiales"
              value={countSpeciales(data)}
            />
            <MetaPill
              icon={<History size={14} />}
              label="Auditoría"
              value={audit.length}
            />
          </div>
        )}
      </section>

      <Tabs items={tabs} activeKey={tab} onChange={(k) => setTab(k as 'precios' | 'historial' | 'vouchers')} />

      {tab === 'precios' && (
        <section className="card-premium overflow-hidden">
          {loading ? (
            <div className="p-6">
              <SkeletonText lines={4} />
            </div>
          ) : !data || data.precios.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title="Sin precios cargados"
              description="Agregá la primera regla base del tabulador."
              action={
                <Button onClick={() => setPrecioOpen(true)}>
                  <Plus size={16} /> Nuevo precio
                </Button>
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-brand-zebra text-left text-xs uppercase tracking-wide text-brand-muted">
                <tr>
                  <th className="px-4 py-3">Alcance</th>
                  <th className="px-4 py-3 text-right">Precio</th>
                  <th className="px-4 py-3">Origen</th>
                  <th className="px-4 py-3">Desde</th>
                  <th className="px-4 py-3">Hasta</th>
                  <th className="px-4 py-3">Motivo</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.precios.map((p) => {
                  const abierto = !p.vigente_hasta;
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        'motion-safe:animate-fade-up',
                        abierto && 'bg-brand-cyan-pale/20',
                      )}
                    >
                      <td className="px-4 py-3">
                        {p.administracion_nombre ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                            Preferencial · {p.administracion_nombre}
                          </span>
                        ) : p.consorcio_nombre ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Consorcio · {p.consorcio_nombre}
                          </span>
                        ) : p.convenio ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Convenio · {p.convenio}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            Regla base
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-brand-ink">
                        <AnimatedNumber
                          value={Number(p.precio)}
                          format={(n) =>
                            n.toLocaleString('es-AR', {
                              style: 'currency',
                              currency: 'ARS',
                              maximumFractionDigits: 0,
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-brand-muted">
                        {ORIGEN_PRECIO_LABEL[p.origen] ?? p.origen}
                        {p.porcentaje_aplicado != null && (
                          <span className="ml-1 text-xs">
                            ({Number(p.porcentaje_aplicado) > 0 ? '+' : ''}
                            {p.porcentaje_aplicado}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {formatDateShort(p.vigente_desde)}
                      </td>
                      <td className="px-4 py-3">
                        {p.vigente_hasta ? (
                          formatDateShort(p.vigente_hasta)
                        ) : (
                          <span className="text-emerald-700">vigente</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-brand-muted">
                        {p.motivo ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {abierto && (
                          <button
                            type="button"
                            onClick={() =>
                              void onCerrarPrecio(
                                p.id,
                                p.administracion_nombre ??
                                  p.consorcio_nombre ??
                                  p.convenio ??
                                  'Regla base',
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                          >
                            <X size={12} /> Cerrar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'vouchers' && data && (
        <VouchersTab servicio_id={data.servicio.id} />
      )}

      {tab === 'historial' && (
        <section className="card-premium overflow-hidden">
          {audit.length === 0 ? (
            <IllustratedEmpty
              illustration="busqueda"
              title="Sin eventos auditados"
              description="Los ajustes masivos y cierres aparecerán acá con su autor y fecha."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.map((a) => (
                <li
                  key={a.id}
                  className="flex items-start gap-3 px-4 py-3 text-sm motion-safe:animate-fade-up"
                >
                  <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
                    <History size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">
                      {a.accion === 'ajuste_masivo'
                        ? 'Ajuste masivo'
                        : a.accion === 'alta'
                          ? 'Alta'
                          : a.accion === 'cierre'
                            ? 'Cierre'
                            : 'Baja'}{' '}
                      {a.monto_anterior != null && a.monto_nuevo != null && (
                        <span className="text-brand-muted">
                          · {fmtMoney(Number(a.monto_anterior))} →{' '}
                          {fmtMoney(Number(a.monto_nuevo))}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-brand-muted">
                      {formatTimestampDate(a.created_at)} ·{' '}
                      {a.autor_nombre ?? 'sistema'}
                      {a.motivo ? ` · ${a.motivo}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data && (
        <PrecioDrawer
          open={precioOpen}
          onClose={() => setPrecioOpen(false)}
          onSaved={() => void load()}
          servicio={data.servicio}
        />
      )}
      {data && (
        <ServicioFormDrawer
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => void load()}
          categorias={categorias}
          servicio={data.servicio}
        />
      )}
    </div>
  );
}

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

function countSpeciales(d: ServicioDetail): number {
  return d.precios.filter(
    (p) =>
      (p.administracion_id || p.consorcio_id || p.convenio) &&
      !p.vigente_hasta,
  ).length;
}

/**
 * Mostrador del precio TOTAL (público o cliente). Si el valor es null el
 * servicio NO se ofrece por ese canal — se muestra con un chip discreto.
 */
function PrecioTotal({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return (
      <span className="text-sm text-brand-muted/80 italic">no se ofrece</span>
    );
  }
  return (
    <AnimatedNumber
      value={Number(value)}
      format={(n) => fmtMoney(n)}
    />
  );
}

function MetaPill({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white/80 p-3 backdrop-blur">
      <p className="kicker flex items-center gap-1 text-brand-muted">
        {icon} {label}
      </p>
      <div className="font-display text-xl font-bold text-brand-ink">
        {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </div>
      {hint && <p className="mt-0.5 text-[10px] text-brand-muted">{hint}</p>}
    </div>
  );
}
