import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Wallet,
  AlertCircle,
  FileText,
  Calendar,
  TrendingUp,
  TrendingDown,
  Filter,
  Eye,
  Plus,
} from 'lucide-react';
import {
  Field,
  Input,
  Tabs,
  Skeleton,
  Button,
  useConfirm,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { toast } from '@/lib/toast';
import { formatDateShort, daysBetween } from '@/lib/dates';
import { cn } from '@/lib/cn';
import {
  getResumenAdministracion,
  getExtracto,
  type CtaCteResumen,
  type ExtractoRow,
} from '@/services/api/ctaCte';
import {
  getAdministracion,
  type AdministracionRow,
} from '@/services/api/administraciones';
import {
  listComprobantes,
  type ComprobanteListItem,
} from '@/services/api/comprobantes';
import {
  desimputarCobranza,
  listCobranzasDeComprobante,
  type CobranzaListItem,
} from '@/services/api/cobranzas';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { RegistrarCobranzaDrawer } from '@/modules/facturacion/components/RegistrarCobranzaDrawer';
import { KpiStripCtaCte } from '../components/KpiStripCtaCte';
import { ExtractoTable } from '../components/ExtractoTable';
import { formatMoney, defaultDesde, defaultHasta } from '../lib/format';
import { humanizeError } from '@/lib/errors';

type TabKey = 'extracto' | 'pendientes' | 'cobranzas';

export function CtaCteDetailPage() {
  const { adminId = '' } = useParams<{ adminId: string }>();
  const confirm = useConfirm();

  const [admin, setAdmin] = useState<AdministracionRow | null>(null);
  const [resumen, setResumen] = useState<CtaCteResumen | null>(null);
  const [extracto, setExtracto] = useState<ExtractoRow[]>([]);
  const [pendientes, setPendientes] = useState<ComprobanteListItem[]>([]);
  const [cobranzas, setCobranzas] = useState<CobranzaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [desde, setDesde] = useState(defaultDesde());
  const [hasta, setHasta] = useState(defaultHasta());

  const [tab, setTab] = useState<TabKey>('extracto');
  const [cobranzaTarget, setCobranzaTarget] =
    useState<ComprobanteListItem | null>(null);

  async function load() {
    if (!adminId) return;
    setLoading(true);
    setError(null);
    const [aR, rR, eR, pR] = await Promise.all([
      getAdministracion(adminId),
      getResumenAdministracion(adminId, desde, hasta),
      getExtracto(adminId, desde, hasta),
      // Comprobantes con saldo pendiente para esta admin.
      listComprobantes({
        administracionId: adminId,
        limit: 200,
      }),
    ]);
    setLoading(false);
    if (!aR.ok) {
      setError(humanizeError(aR.error));
      return;
    }
    setAdmin(aR.data);
    if (rR.ok) setResumen(rR.data);
    if (eR.ok) setExtracto(eR.data);
    if (pR.ok) {
      // Sólo los que tienen saldo > 0 y no están anulados.
      setPendientes(
        pR.data.rows.filter(
          (c) =>
            Number(c.saldo_pendiente ?? 0) > 0 &&
            c.estado !== 'anulado' &&
            c.estado !== 'borrador',
        ),
      );
    }
  }

  // Cobranzas: para todos los pendientes y los que sí están cubiertos.
  // Como `listCobranzasDeComprobante` es por comprobante, evitamos N+1
  // armando una vista derivada del extracto (las filas de `abono` ya
  // tienen comprobante_id/movimiento_id/imputacion_id).
  async function refreshCobranzas() {
    if (!adminId) return;
    // Tomamos las imputaciones del extracto del período.
    const imputacionesIds = extracto
      .filter((r) => r.tipo === 'abono' && r.comprobante_id)
      .map((r) => r.comprobante_id as string);
    if (imputacionesIds.length === 0) {
      setCobranzas([]);
      return;
    }
    // Cargamos detalle por comprobante. Sólo para visualizar, no es crítico.
    const uniqueCompIds = Array.from(new Set(imputacionesIds));
    const results = await Promise.all(
      uniqueCompIds.map((id) => listCobranzasDeComprobante(id)),
    );
    const all: CobranzaListItem[] = [];
    for (const r of results) {
      if (r.ok) all.push(...r.data);
    }
    // Ordenar por fecha desc
    all.sort((a, b) =>
      (b.movimiento.fecha ?? '').localeCompare(a.movimiento.fecha ?? ''),
    );
    setCobranzas(all);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, desde, hasta]);

  useEffect(() => {
    if (tab === 'cobranzas') void refreshCobranzas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, extracto]);

  useRealtimeRefresh(
    ['comprobantes', 'movimientos', 'movimiento_imputaciones'],
    () => void load(),
  );

  const proximoVencimientoDias = useMemo(() => {
    if (!resumen?.proximo_vencimiento) return null;
    return daysBetween(resumen.proximo_vencimiento);
  }, [resumen]);

  async function onDesimputar(imp: CobranzaListItem) {
    const okConfirm = await confirm({
      title: 'Desimputar cobranza',
      message: `Vas a desimputar ${formatMoney(
        Number(imp.monto_imputado),
      )}. El saldo pendiente del comprobante se recalcula automáticamente. ¿Continuar?`,
      danger: true,
      confirmLabel: 'Desimputar',
    });
    if (!okConfirm) return;
    const res = await desimputarCobranza(imp.id);
    if (!res.ok) {
      toast.error('No pudimos desimputar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Cobranza desimputada');
    void load();
  }

  if (loading && !admin) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando cuenta corriente" />
      </div>
    );
  }

  if (error || !admin) {
    return (
      <div className="mx-auto max-w-2xl p-12 text-center">
        <p className="text-sm text-red-600">
          {error ?? 'No se encontró la administración'}
        </p>
        <Link
          to="/gerencia/cuenta-corriente"
          className="mt-4 inline-flex items-center gap-1 text-sm text-brand-cyan hover:underline"
        >
          <ArrowLeft size={14} /> Volver
        </Link>
      </div>
    );
  }

  const tabs: TabItem[] = [
    { key: 'extracto', label: 'Extracto', icon: <FileText size={14} /> },
    {
      key: 'pendientes',
      label: 'Pendientes',
      icon: <AlertCircle size={14} />,
      badge: pendientes.length,
    },
    {
      key: 'cobranzas',
      label: 'Cobranzas',
      icon: <Wallet size={14} />,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <Link
        to="/gerencia/cuenta-corriente"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted transition hover:text-brand-cyan"
      >
        <ArrowLeft size={12} /> Volver a cuenta corriente
      </Link>

      {/* Header premium */}
      <section className="card-premium relative overflow-hidden p-6">
        <TrianglesAccent
          position="top-right"
          size={220}
          tone="cyan"
          density="rich"
          className="opacity-30"
        />
        <TrianglesAccent
          position="bottom-left"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-20"
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="kicker text-brand-cyan">Cuenta corriente</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
              {admin.nombre}
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              {admin.cuit ? `CUIT ${admin.cuit} · ` : ''}
              {admin.codigo ?? 'sin código'}
              {admin.email ? ` · ${admin.email}` : ''}
            </p>
          </div>
          <Link
            to={`/gerencia/clientes/${admin.id}`}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            Ficha cliente <Eye size={12} />
          </Link>
        </div>
      </section>

      <KpiStripCtaCte
        items={[
          {
            label: 'Saldo actual',
            value: resumen?.saldo_actual ?? 0,
            icon: <Wallet size={18} />,
            tone:
              (resumen?.saldo_actual ?? 0) > 0
                ? 'amber'
                : (resumen?.saldo_actual ?? 0) < 0
                  ? 'emerald'
                  : 'slate',
            hint:
              (resumen?.saldo_actual ?? 0) > 0
                ? 'saldo deudor'
                : (resumen?.saldo_actual ?? 0) < 0
                  ? 'saldo acreedor'
                  : 'cuenta saldada',
          },
          {
            label: 'Facturado en período',
            value: resumen?.total_facturado ?? 0,
            icon: <TrendingUp size={18} />,
            tone: 'cyan',
          },
          {
            label: 'Cobrado en período',
            value: resumen?.total_cobrado ?? 0,
            icon: <TrendingDown size={18} />,
            tone: 'emerald',
          },
          {
            label:
              proximoVencimientoDias !== null
                ? proximoVencimientoDias >= 0
                  ? `Próx. vto · ${proximoVencimientoDias}d`
                  : `Vencido ${Math.abs(proximoVencimientoDias)}d`
                : 'Próx. vencimiento',
            value: resumen?.deuda_total ?? 0,
            icon: <Calendar size={18} />,
            tone:
              proximoVencimientoDias !== null && proximoVencimientoDias < 0
                ? 'rose'
                : 'amber',
            hint: resumen?.proximo_vencimiento
              ? formatDateShort(resumen.proximo_vencimiento)
              : 'sin vencimientos próximos',
          },
        ]}
      />

      {/* Filtros */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Desde" className="flex-1 sm:max-w-[180px]">
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </Field>
        <Field label="Hasta" className="flex-1 sm:max-w-[180px]">
          <Input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </Field>
        <div className="text-xs text-brand-muted sm:ml-2 sm:self-center">
          {extracto.length > 0 && (
            <>
              {extracto.length} movimientos en el período
            </>
          )}
        </div>
      </section>

      {/* Tabs */}
      <section className="card-premium relative overflow-hidden">
        <div className="px-4 pt-2">
          <Tabs
            items={tabs}
            activeKey={tab}
            onChange={(k) => setTab(k as TabKey)}
          />
        </div>

        <div className="relative">
          {tab === 'extracto' && (
            <div className="max-h-[640px] overflow-auto">
              {loading && extracto.length === 0 ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded" />
                  ))}
                </div>
              ) : (
                <ExtractoTable rows={extracto} />
              )}
            </div>
          )}

          {tab === 'pendientes' && (
            <div className="p-4">
              {pendientes.length === 0 ? (
                <div className="py-12 text-center">
                  <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Wallet size={20} />
                  </span>
                  <p className="mt-3 font-display text-lg font-bold">
                    Sin comprobantes pendientes
                  </p>
                  <p className="text-sm text-brand-muted">
                    Esta administración está al día.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                        <th className="px-4 py-2.5">Comprobante</th>
                        <th className="px-4 py-2.5">Emisión</th>
                        <th className="px-4 py-2.5">Vencimiento</th>
                        <th className="px-4 py-2.5 text-right">Total</th>
                        <th className="px-4 py-2.5 text-right">Saldo</th>
                        <th className="px-4 py-2.5 text-center">Estado</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendientes.map((c) => {
                        const dias = daysBetween(c.vencimiento);
                        const vencido = dias !== null && dias < 0;
                        return (
                          <tr
                            key={c.id}
                            className="border-b border-slate-100 hover:bg-brand-zebra/30"
                          >
                            <td className="px-4 py-3">
                              <Link
                                to={`/gerencia/facturacion/${c.id}`}
                                className="font-medium text-brand-ink transition hover:text-brand-cyan"
                              >
                                {c.tipo}
                                {c.numero
                                  ? ` ${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`
                                  : ''}
                              </Link>
                              {c.consorcio_nombre && (
                                <span className="block text-xs text-brand-muted">
                                  · {c.consorcio_nombre}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 tabular text-xs">
                              {formatDateShort(c.fecha)}
                            </td>
                            <td className="px-4 py-3 tabular text-xs">
                              {formatDateShort(c.vencimiento)}
                              {dias !== null && (
                                <span
                                  className={cn(
                                    'ml-2 text-[10px]',
                                    vencido ? 'text-rose-700' : 'text-brand-muted',
                                  )}
                                >
                                  {vencido
                                    ? `${Math.abs(dias)}d vencido`
                                    : `en ${dias}d`}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular">
                              {formatMoney(Number(c.total), 0)}
                            </td>
                            <td className="px-4 py-3 text-right tabular font-semibold text-amber-700">
                              {formatMoney(Number(c.saldo_pendiente ?? 0), 0)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <EstadoCobranzaPill
                                estado={c.estado_cobranza ?? 'pendiente'}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="secondary"
                                onClick={() => setCobranzaTarget(c)}
                              >
                                <Plus size={12} /> Cobrar
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {tab === 'cobranzas' && (
            <div className="p-4">
              {cobranzas.length === 0 ? (
                <div className="py-12 text-center">
                  <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
                    <Filter size={20} />
                  </span>
                  <p className="mt-3 font-display text-lg font-bold">
                    Sin cobranzas en el período
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {cobranzas.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-brand-ink">
                          {formatDateShort(c.movimiento.fecha)} ·{' '}
                          {c.movimiento.caja_nombre ?? 'Caja'}
                        </p>
                        <p className="text-xs text-brand-muted">
                          {c.movimiento.descripcion ?? 'Cobranza'}
                          {c.movimiento.referencia
                            ? ` · ref ${c.movimiento.referencia}`
                            : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-sm font-bold tabular text-emerald-700">
                          {formatMoney(Number(c.monto_imputado), 0)}
                        </p>
                        <button
                          type="button"
                          onClick={() => void onDesimputar(c)}
                          className="text-[11px] text-brand-muted underline-offset-2 transition hover:text-rose-600 hover:underline"
                        >
                          desimputar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Drawer de cobranza (reusa el de facturación) */}
      {cobranzaTarget && (
        <RegistrarCobranzaDrawer
          open={!!cobranzaTarget}
          onClose={() => setCobranzaTarget(null)}
          comprobante={cobranzaTarget}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}

function EstadoCobranzaPill({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    pendiente: 'bg-slate-100 text-slate-700',
    parcial: 'bg-amber-50 text-amber-700',
    vencido: 'bg-rose-50 text-rose-700',
    pagado: 'bg-emerald-50 text-emerald-700',
    en_recupero: 'bg-purple-50 text-purple-700',
    anulado: 'bg-slate-200 text-slate-600',
    compensado: 'bg-blue-50 text-blue-700',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        map[estado] ?? 'bg-slate-100 text-slate-700',
      )}
    >
      {estado}
    </span>
  );
}
