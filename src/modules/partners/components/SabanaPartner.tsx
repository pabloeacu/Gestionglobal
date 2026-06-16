// SabanaPartner (DGG-85) · Resumen de cuenta / sábana del partner. Componente
// COMPARTIDO entre gerencia (ficha del partner) y el portal del partner → paridad
// total: ambos ven exactamente lo mismo (misma RPC partner_sabana + mismo render).
//
// Base COBRADO: una línea por cobranza atribuida (participación = % vigente × lo
// cobrado); egresos = operación completa. La suma/resta de la cuenta es siempre por
// la PARTICIPACIÓN; el total de la operación + total/saldo del comprobante son
// informativos. Chip total/parcial = relación saldo del comprobante ↔ operación.
import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Download, Loader2 } from 'lucide-react';
import { Field, Input, Skeleton } from '@/components/common';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { formatDateShort } from '@/lib/dates';
import {
  fetchPartnerSabana,
  fetchAdjuntosMovimiento,
  urlAdjuntoMovimientoPartner,
  fmtMoneda,
  fmtPct,
  type SabanaLinea,
  type SabanaAdjunto,
} from '@/services/api/partners';
import { humanizeError } from '@/lib/errors';

function signed(l: SabanaLinea): number {
  return l.tipo === 'ingreso' ? Number(l.participacion_monto) : -Number(l.participacion_monto);
}

export function SabanaPartner({
  partnerId,
  partnerNombre,
}: {
  partnerId?: string;
  partnerNombre?: string;
}) {
  const [lineas, setLineas] = useState<SabanaLinea[]>([]);
  const [loading, setLoading] = useState(true);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  async function load() {
    setLoading(true);
    const r = await fetchPartnerSabana({
      partnerId,
      desde: desde || null,
      hasta: hasta || null,
    });
    setLoading(false);
    if (!r.ok) {
      toast.error('No pudimos cargar el resumen de cuenta', {
        description: humanizeError(r.error),
      });
      return;
    }
    setLineas(r.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, desde, hasta]);

  const kpis = useMemo(() => {
    let ing = 0;
    let egr = 0;
    for (const l of lineas) {
      if (l.tipo === 'ingreso') ing += Number(l.participacion_monto);
      else egr += Number(l.participacion_monto);
    }
    const saldo = lineas.length
      ? Number(lineas[lineas.length - 1]!.saldo_participacion)
      : 0;
    return { ing, egr, saldo };
  }, [lineas]);

  const periodoLabel = useMemo(() => {
    if (desde && hasta) return `${formatDateShort(desde)} a ${formatDateShort(hasta)}`;
    if (desde) return `desde ${formatDateShort(desde)}`;
    if (hasta) return `hasta ${formatDateShort(hasta)}`;
    return 'Todo el historial';
  }, [desde, hasta]);

  const exportFiltros = [
    { label: 'Partner', value: partnerNombre ?? 'Mi cuenta' },
    { label: 'Período', value: periodoLabel },
  ];

  async function onExportPdf() {
    await generateReportPdf<SabanaLinea>({
      filename: `sabana-partner-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Resumen de cuenta · Partner',
      subtitulo: (partnerNombre ?? '') + ' · Gestión Global',
      filtros: exportFiltros,
      kpis: [
        { label: 'Participación ingresos', value: fmtMoneda(kpis.ing), tone: 'emerald' },
        { label: 'Participación egresos', value: fmtMoneda(kpis.egr), tone: 'amber' },
        { label: 'Saldo', value: fmtMoneda(kpis.saldo), tone: 'cyan' },
      ],
      columns: [
        { key: 'fecha', label: 'Fecha', width: '9%', format: (r) => formatDateShort(r.fecha) },
        { key: 'descripcion', label: 'Detalle', width: '24%',
          format: (r) => r.descripcion + (r.cliente_nombre ? ` · ${r.cliente_nombre}` : '') },
        { key: 'comprobante_label', label: 'Comprobante', width: '15%',
          format: (r) => r.comprobante_label ?? '—' },
        { key: 'operacion_monto', label: 'Operación', align: 'right', width: '13%',
          format: (r) => fmtMoneda(r.operacion_monto) },
        { key: 'chip', label: 'Estado', width: '9%',
          format: (r) => (r.chip === 'total' ? 'Total' : 'Parcial') },
        { key: 'porcentaje', label: '%', align: 'right', width: '7%',
          format: (r) => fmtPct(r.porcentaje) },
        { key: 'participacion_monto', label: 'Participación', align: 'right', width: '12%',
          format: (r) => (r.tipo === 'egreso' ? '-' : '') + fmtMoneda(r.participacion_monto) },
        { key: 'saldo_participacion', label: 'Saldo', align: 'right', width: '11%',
          format: (r) => fmtMoneda(r.saldo_participacion) },
      ],
      rows: lineas,
    });
  }

  async function onExportXls() {
    generateReportXls<SabanaLinea>({
      filename: `sabana-partner-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Resumen de cuenta',
      titulo: `Resumen de cuenta · ${partnerNombre ?? 'Partner'} · Gestión Global`,
      filtros: exportFiltros,
      columns: [
        { key: 'fecha', label: 'Fecha', width: 12 },
        { key: 'tipo', label: 'Tipo', width: 10 },
        { key: 'descripcion', label: 'Detalle', width: 30 },
        { key: 'cliente_nombre', label: 'Cliente', width: 24, value: (r) => r.cliente_nombre ?? '' },
        { key: 'comprobante_label', label: 'Comprobante', width: 18, value: (r) => r.comprobante_label ?? '' },
        { key: 'comprobante_total', label: 'Total comprob.', width: 15, value: (r) => Number(r.comprobante_total ?? 0) },
        { key: 'comprobante_saldo', label: 'Saldo comprob.', width: 15, value: (r) => Number(r.comprobante_saldo ?? 0) },
        { key: 'operacion_monto', label: 'Operación', width: 15, value: (r) => Number(r.operacion_monto) },
        { key: 'chip', label: 'Estado', width: 10, value: (r) => (r.chip === 'total' ? 'Total' : 'Parcial') },
        { key: 'porcentaje', label: '%', width: 8, value: (r) => Number(r.porcentaje) },
        { key: 'participacion_monto', label: 'Participación', width: 15, value: (r) => signed(r) },
        { key: 'saldo_participacion', label: 'Saldo', width: 15, value: (r) => Number(r.saldo_participacion) },
      ],
      rows: lineas,
    });
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard label="Participación · ingresos" value={fmtMoneda(kpis.ing)} tone="emerald" />
        <KpiCard label="Participación · egresos" value={fmtMoneda(kpis.egr)} tone="amber" />
        <KpiCard
          label={kpis.saldo >= 0 ? 'Saldo a favor del partner' : 'Saldo a favor de GG'}
          value={fmtMoneda(Math.abs(kpis.saldo))}
          tone="cyan"
        />
      </div>

      {/* Filtros + export */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Desde" className="w-40">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta" className="w-40">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          {(desde || hasta) && (
            <button
              type="button"
              onClick={() => { setDesde(''); setHasta(''); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
            >
              Limpiar
            </button>
          )}
        </div>
        <ExportButtons onExportPdf={onExportPdf} onExportXls={onExportXls} disabled={lineas.length === 0} />
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
          </div>
        ) : lineas.length === 0 ? (
          <div className="p-10 text-center text-sm text-brand-muted">
            Sin movimientos de participación en este período.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Detalle</th>
                <th className="px-3 py-2.5 text-center">Adj.</th>
                <th className="px-3 py-2.5">Comprobante</th>
                <th className="px-3 py-2.5 text-right">Operación</th>
                <th className="px-3 py-2.5 text-center">Estado</th>
                <th className="px-3 py-2.5 text-right">Participación</th>
                <th className="px-3 py-2.5 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, idx) => (
                <tr key={idx} className="border-b border-slate-50 hover:bg-brand-zebra/30">
                  <td className="px-3 py-2.5 tabular text-xs text-brand-muted whitespace-nowrap">
                    {formatDateShort(l.fecha)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-brand-ink">{l.descripcion}</span>
                    {l.cliente_nombre && (
                      <span className="block text-[11px] text-brand-muted">{l.cliente_nombre}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {l.adjuntos_count > 0 && l.movimiento_id ? (
                      <AdjuntoClip movimientoId={l.movimiento_id} count={l.adjuntos_count} />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {l.comprobante_label ? (
                      <>
                        <span className="font-mono text-xs text-brand-ink">{l.comprobante_label}</span>
                        <span className="block text-[11px] text-brand-muted">
                          Total {fmtMoneda(l.comprobante_total)} · Saldo {fmtMoneda(l.comprobante_saldo)}
                        </span>
                      </>
                    ) : (
                      <span className="text-brand-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{fmtMoneda(l.operacion_monto)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        l.chip === 'total'
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
                          : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
                      )}
                    >
                      {l.chip === 'total' ? 'Total' : 'Parcial'}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2.5 text-right tabular font-semibold',
                      l.tipo === 'ingreso' ? 'text-emerald-700' : 'text-rose-700',
                    )}
                  >
                    {l.tipo === 'egreso' ? '-' : '+'}
                    {fmtMoneda(l.participacion_monto)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular font-semibold text-brand-ink">
                    {fmtMoneda(l.saldo_participacion)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-brand-muted">
        La suma y resta de la cuenta es por la <strong>participación</strong>. El total de la
        operación y el total/saldo del comprobante son informativos. “Parcial” = el comprobante
        aún no está saldado por completo.
      </p>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: 'emerald' | 'amber' | 'cyan' }) {
  const cls =
    tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-brand-cyan';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="kicker text-brand-muted">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-bold tabular', cls)}>{value}</p>
    </div>
  );
}

function AdjuntoClip({ movimientoId, count }: { movimientoId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SabanaAdjunto[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (items === null) {
      const r = await fetchAdjuntosMovimiento(movimientoId);
      if (r.ok) setItems(r.data);
      else { toast.error('No pudimos cargar los adjuntos'); setItems([]); }
    }
  }

  async function descargar(adj: SabanaAdjunto) {
    setBusy(true);
    const r = await urlAdjuntoMovimientoPartner(adj.storage_path);
    setBusy(false);
    if (r.ok) window.open(r.data, '_blank', 'noopener');
    else toast.error('No pudimos abrir el adjunto');
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={toggle}
        title={`${count} adjunto${count > 1 ? 's' : ''}`}
        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-brand-cyan transition hover:bg-brand-cyan-pale/40"
      >
        <Paperclip size={14} />
        <span className="text-[10px] font-semibold">{count}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-lg">
          {items === null ? (
            <div className="flex items-center gap-2 px-2 py-2 text-xs text-brand-muted">
              <Loader2 size={13} className="animate-spin" /> Cargando…
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-2 text-xs text-brand-muted">Sin adjuntos.</p>
          ) : (
            items.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => void descargar(a)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-brand-ink transition hover:bg-brand-zebra"
              >
                <Download size={13} className="flex-none text-brand-cyan" />
                <span className="truncate">{a.filename_original}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
