import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Lock,
  Ban,
  FileText,
  FileDown,
  Check,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Button,
  Skeleton,
  useConfirm,
  usePrompt,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateLong } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { RendicionResumenCard } from '../components/RendicionResumenCard';
import { RendicionDevengado } from '../components/RendicionDevengado';
import {
  getRendicion,
  getRendicionResumenPago,
  cerrarRendicion,
  anularRendicion,
  marcarRendicionPagada,
  fmtMoneda,
  fmtPct,
  RENDICION_ESTADO_BADGE,
  RENDICION_ESTADO_LABEL,
  type RendicionConDetalle,
  type RendicionEstado,
  type RendicionResumenPago,
  type AtribucionListItem,
} from '@/services/api/partners';
import { generateReportPdf } from '@/lib/reportPdf';
import { humanizeError } from '@/lib/errors';

// DGG-250 · chip de estado de pago de una obligación de egreso atribuida.
const EGRESO_PAGO_CHIP: Record<string, { label: string; cls: string }> = {
  pagado: { label: 'Pagado', cls: 'bg-emerald-100 text-emerald-700' },
  parcial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-700' },
  pendiente: { label: 'Impago', cls: 'bg-rose-100 text-rose-700' },
  anulado: { label: 'Anulada', cls: 'bg-slate-200 text-slate-600' },
};

// Texto de detalle para el PDF (plano): comprobante, obligación (con estado de pago) o movimiento.
function atribDetalle(a: AtribucionListItem): string {
  if (a.egreso_resumen) {
    const est = a.egreso_estado_pago;
    const saldo = fmtMoneda(a.egreso_saldo ?? 0);
    const suf =
      est === 'pagado' ? 'pagado'
        : est === 'parcial' ? `parcial (saldo ${saldo})`
          : est === 'pendiente' ? `impago (saldo ${saldo})`
            : est === 'anulado' ? 'anulada'
              : '';
    return suf ? `${a.egreso_resumen} · ${suf}` : a.egreso_resumen;
  }
  return a.comprobante_resumen ?? a.movimiento_resumen ?? '—';
}

export function RendicionDetailPage() {
  const { id, partnerId } = useParams<{ id: string; partnerId: string }>();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [data, setData] = useState<RendicionConDetalle | null>(null);
  const [resumenPago, setResumenPago] = useState<RendicionResumenPago | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await getRendicion(id);
    setLoading(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setData(res.data);
    // DGG-250 · resumen devengado vs pagado (no bloquea la vista si falla)
    const rp = await getRendicionResumenPago(id);
    setResumenPago(rp.ok ? rp.data : null);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtimeRefresh(
    ['partner_rendiciones', 'partner_atribuciones'],
    () => void load(),
  );

  const grouped = useMemo(() => {
    const ingresos: AtribucionListItem[] = [];
    const costos: AtribucionListItem[] = [];
    for (const a of data?.atribuciones ?? []) {
      (a.tipo === 'ingreso' ? ingresos : costos).push(a);
    }
    return { ingresos, costos };
  }, [data]);

  async function onCerrar() {
    if (!data) return;
    const okConf = await confirm({
      title: 'Cerrar rendición',
      message:
        '¿Cerrar la rendición? Quedará bloqueada para edición y sólo podrá pasar a pagada o cancelada.',
      confirmLabel: 'Cerrar',
      cancelLabel: 'Volver',
    });
    if (!okConf) return;
    setBusy(true);
    const res = await cerrarRendicion(data.rendicion.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Rendición cerrada');
    void load();
  }

  async function onAnular() {
    if (!data) return;
    const motivo = await prompt({
      title: 'Anular rendición',
      message:
        'Sólo se pueden anular rendiciones en borrador. Indicá el motivo (queda registrado).',
      placeholder: 'Ej: cálculo erróneo, periodo equivocado…',
      confirmLabel: 'Anular',
    });
    if (!motivo) return;
    setBusy(true);
    const res = await anularRendicion(data.rendicion.id, motivo);
    setBusy(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Rendición anulada');
    void load();
  }

  async function onMarcarPagada() {
    if (!data) return;
    const okConf = await confirm({
      title: 'Marcar como pagada',
      message:
        '¿Confirmar el pago de esta rendición? La marcaremos como pagada. Si querés vincular un comprobante, editá luego el campo.',
      confirmLabel: 'Marcar pagada',
      cancelLabel: 'Volver',
    });
    if (!okConf) return;
    setBusy(true);
    const res = await marcarRendicionPagada(data.rendicion.id, null);
    setBusy(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Rendición marcada como pagada');
    void load();
  }

  // DGG-250 · PDF premium de la rendición (resumen devengado-vs-pagado + gráficos + detalle)
  async function onExportPdf() {
    if (!data || !resumenPago) return;
    setExporting(true);
    try {
      const { rendicion, partner } = data;
      const est = rendicion.estado as RendicionEstado;
      const periodo = `${formatDateLong(rendicion.periodo_desde)} → ${formatDateLong(rendicion.periodo_hasta)}`;
      const rows = [...grouped.ingresos, ...grouped.costos];
      await generateReportPdf<AtribucionListItem>({
        filename: `rendicion-${partner?.slug ?? 'partner'}-${rendicion.periodo_desde}`,
        titulo: `Rendición · ${partner?.nombre_legal ?? ''}`.trim(),
        subtitulo: periodo,
        filtros: [{ label: 'Estado', value: RENDICION_ESTADO_LABEL[est] }],
        kpis: [
          { label: 'Ingresos atribuidos', value: fmtMoneda(resumenPago.ingresos_atribuidos), tone: 'cyan' },
          { label: 'Costos atribuidos', value: fmtMoneda(resumenPago.costos_atribuidos), tone: 'amber' },
          { label: 'GG ya pagó', value: fmtMoneda(resumenPago.costo_pagado_atribuido), tone: 'emerald' },
          { label: 'Neto a rendir', value: fmtMoneda(resumenPago.neto), tone: resumenPago.neto >= 0 ? 'emerald' : 'rose' },
        ],
        headerExtra: <RendicionDevengado resumen={resumenPago} variant="pdf" />,
        firstPageRows: 9,
        columns: [
          { key: 'tipo', label: 'Tipo', format: (a) => (a.tipo === 'ingreso' ? 'Ingreso' : 'Costo') },
          { key: 'detalle', label: 'Detalle', format: (a) => atribDetalle(a) },
          { key: 'monto_base', label: 'Base', align: 'right', format: (a) => fmtMoneda(a.monto_base) },
          { key: 'porcentaje', label: '%', align: 'right', format: (a) => fmtPct(a.porcentaje) },
          { key: 'monto_atribuido', label: 'Atribuido', align: 'right', format: (a) => fmtMoneda(a.monto_atribuido) },
        ],
        rows,
      });
    } catch {
      toast.error('No pudimos generar el PDF');
    } finally {
      setExporting(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-brand-muted">
        Rendición no encontrada.
      </div>
    );
  }

  const { rendicion, partner, atribuciones } = data;
  const estado = rendicion.estado as RendicionEstado;
  const partnerHref = partnerId
    ? `/gerencia/partners/${partnerId}`
    : `/gerencia/partners/${partner?.id ?? ''}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to={partnerHref}
        className="inline-flex items-center gap-1 text-sm text-brand-muted transition hover:text-brand-cyan"
      >
        <ArrowLeft size={14} /> {partner?.nombre_legal ?? 'Partner'}
      </Link>

      {/* Header */}
      <section className="card-premium relative overflow-hidden p-6">
        <TrianglesAccent
          position="top-right"
          size={180}
          tone="cyan"
          density="soft"
          className="opacity-25"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="kicker text-brand-cyan">Rendición</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
              {formatDateLong(rendicion.periodo_desde)} →{' '}
              {formatDateLong(rendicion.periodo_hasta)}
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              {partner?.nombre_legal ?? '—'} · creada{' '}
              {rendicion.created_at
                ? new Date(rendicion.created_at).toLocaleDateString('es-AR')
                : ''}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                  RENDICION_ESTADO_BADGE[estado],
                )}
              >
                {RENDICION_ESTADO_LABEL[estado]}
              </span>
              {rendicion.comprobante_id && (
                <Link
                  to={`/gerencia/facturacion/${rendicion.comprobante_id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/30 bg-brand-cyan/5 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan hover:bg-brand-cyan/10"
                >
                  <FileText size={11} /> Comprobante asociado
                </Link>
              )}
              {rendicion.motivo_cancelacion && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                  <AlertTriangle size={11} /> {rendicion.motivo_cancelacion}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void onExportPdf()} disabled={exporting || !resumenPago}>
              <FileDown size={14} /> {exporting ? 'Generando…' : 'PDF'}
            </Button>
            {estado === 'borrador' && (
              <>
                <Button variant="ghost" onClick={() => void onAnular()} disabled={busy}>
                  <Ban size={14} /> Anular
                </Button>
                <Button onClick={() => void onCerrar()} disabled={busy}>
                  <Lock size={14} /> Cerrar
                </Button>
              </>
            )}
            {estado === 'cerrada' && (
              <Button onClick={() => void onMarcarPagada()} disabled={busy}>
                <Check size={14} /> Marcar pagada
              </Button>
            )}
          </div>
        </div>
      </section>

      <RendicionResumenCard rendicion={rendicion} />

      {/* DGG-250 · exposición devengado vs pagado + gráficos (sólo si hay costos) */}
      {resumenPago && resumenPago.costos_atribuidos > 0 && (
        <RendicionDevengado resumen={resumenPago} />
      )}

      {/* Detalle de atribuciones agrupado */}
      <section className="space-y-4">
        <AtribGroup
          title="Ingresos"
          icon={null}
          tone="emerald"
          items={grouped.ingresos}
        />
        <AtribGroup
          title="Costos"
          icon={null}
          tone="amber"
          items={grouped.costos}
        />
        {atribuciones.length === 0 && (
          <div className="card-premium p-8 text-center text-sm text-brand-muted">
            La rendición no tiene atribuciones. Probablemente no había
            comprobantes ni movimientos en el periodo. Podés anularla.
          </div>
        )}
      </section>
    </div>
  );
}

interface GroupProps {
  title: string;
  icon: LucideIcon | null;
  tone: 'emerald' | 'amber';
  items: AtribucionListItem[];
}

const GROUP_TONE: Record<GroupProps['tone'], string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
};

function AtribGroup({ title, tone, items }: GroupProps) {
  if (items.length === 0) return null;
  const total = items.reduce((acc, a) => acc + Number(a.monto_atribuido ?? 0), 0);
  return (
    <div className="card-premium overflow-hidden p-0">
      <header
        className={cn(
          'flex items-center justify-between border-b px-4 py-3 text-sm font-semibold',
          GROUP_TONE[tone],
        )}
      >
        <span>
          {title} <span className="opacity-70">({items.length})</span>
        </span>
        <span className="font-display text-lg">{fmtMoneda(total)}</span>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-brand-zebra text-left text-[11px] uppercase tracking-wider text-brand-muted">
          <tr>
            <th className="px-4 py-2">Detalle</th>
            <th className="px-4 py-2 text-right">Base</th>
            <th className="px-4 py-2 text-right">%</th>
            <th className="px-4 py-2 text-right">Atribuido</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-t border-slate-100">
              <td className="px-4 py-3 text-brand-ink">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{a.comprobante_resumen ?? a.egreso_resumen ?? a.movimiento_resumen ?? '—'}</span>
                  {a.egreso_estado_pago && EGRESO_PAGO_CHIP[a.egreso_estado_pago] && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        EGRESO_PAGO_CHIP[a.egreso_estado_pago]!.cls,
                      )}
                    >
                      {EGRESO_PAGO_CHIP[a.egreso_estado_pago]!.label}
                    </span>
                  )}
                </div>
                {a.egreso_estado_pago &&
                  a.egreso_estado_pago !== 'pagado' &&
                  (a.egreso_saldo ?? 0) > 0 && (
                    <div className="mt-0.5 text-[11px] text-amber-700">
                      Pendiente de pago por GG: {fmtMoneda(a.egreso_saldo ?? 0)} · ya rendido (servicio prestado)
                    </div>
                  )}
              </td>
              <td className="px-4 py-3 text-right">{fmtMoneda(a.monto_base)}</td>
              <td className="px-4 py-3 text-right">{fmtPct(a.porcentaje)}</td>
              <td className="px-4 py-3 text-right font-semibold">
                {fmtMoneda(a.monto_atribuido)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
