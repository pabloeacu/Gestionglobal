import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  ArrowLeft,
  FileText,
  AlertCircle,
  Building2,
  CalendarClock,
  Receipt,
  Hash,
  Download,
  Send,
  Wallet,
  CreditCard,
} from 'lucide-react';
import { generateComprobantePdf } from '@/modules/facturacion/lib/generateComprobantePdf';
import { EnviarComprobanteModal } from '@/modules/facturacion/components/EnviarComprobanteModal';
import { listarPagosComprobante } from '@/services/api/portal';
import { formatDateShort, parseLocalDate } from '@/lib/dates';
import {
  Button,
  AnimatedNumber,
  CopyButton,
} from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  getComprobante,
  type ComprobanteRow,
  type ComprobanteItemRow,
  type ComprobanteEstado,
  type CobranzaEstado,
} from '@/services/api/comprobantes';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

// Detalle de comprobante en el portal del administrador. READ-ONLY: el
// administrador puede ver el comprobante, descargar el PDF y reenviarlo a
// otra dirección, pero no puede emitir, anular ni registrar pagos.

const ESTADO_BADGES: Record<ComprobanteEstado, { label: string; cls: string }> = {
  borrador:   { label: 'Borrador',   cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  procesando: { label: 'Procesando', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  autorizado: { label: 'Autorizado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  observado:  { label: 'Observado',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  rechazado:  { label: 'Rechazado',  cls: 'bg-red-50 text-red-700 border-red-200' },
  anulado:    { label: 'Anulado',    cls: 'bg-red-50 text-red-700 border-red-200' },
  compensado: { label: 'Compensado', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  error:      { label: 'Error',      cls: 'bg-red-50 text-red-700 border-red-200' },
};

const COBRANZA_BADGES: Record<CobranzaEstado, { label: string; cls: string }> = {
  pendiente:   { label: 'Pendiente cobro', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  parcial:     { label: 'Cobro parcial',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  pagado:      { label: 'Cobrado',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vencido:     { label: 'Vencido',         cls: 'bg-red-50 text-red-700 border-red-200' },
  en_recupero: { label: 'En recupero',     cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  anulado:     { label: 'Anulado',         cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

// Fila de pago devuelta por la RPC cliente_listar_pagos_comprobante (mig 0113).
// La RPC bypassa RLS de movimientos (que exige is_staff) para que el cliente
// pueda ver sus propios pagos imputados al comprobante.
type PagoRow = {
  imputacion_id: string;
  movimiento_id: string;
  fecha: string;
  caja_nombre: string | null;
  referencia: string | null;
  monto_imputado: number;
  created_at: string;
};

export function PortalComprobanteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [comp, setComp] = useState<ComprobanteRow | null>(null);
  const [items, setItems] = useState<ComprobanteItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enviarOpen, setEnviarOpen] = useState(false);
  const [pagos, setPagos] = useState<PagoRow[]>([]);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [res, pagosRes] = await Promise.all([
      getComprobante(id),
      listarPagosComprobante(id),
    ]);
    setLoading(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setComp(res.data.comprobante);
    setItems(res.data.items);
    if (pagosRes.ok) {
      setPagos(pagosRes.data as unknown as PagoRow[]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onDescargarPdf() {
    if (!comp) return;
    const compExt = comp as unknown as {
      partner_facturado_at: string | null;
      partner_numero_externo: string | null;
      partner_factura_pdf_url: string | null;
    };
    // Bloque G / obs 11: si el partner subió el PDF de su factura, descargamos
    // ese archivo real en vez de generar el prototipo desde el comprobante
    // simple. El cliente recibe LA FACTURA, no una réplica.
    if (compExt.partner_factura_pdf_url) {
      try {
        const res = await fetch(compExt.partner_factura_pdf_url);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const safeNum = (compExt.partner_numero_externo ?? 'factura').replace(
          /[^A-Za-z0-9-]/g,
          '-',
        );
        a.href = url;
        a.download = `factura-${safeNum}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast.error('No pudimos descargar la factura', {
          description: humanizeError(e),
        });
      }
      return;
    }
    try {
      const doc = await generateComprobantePdf({ comprobante: comp, items });
      let fileName: string;
      if (compExt.partner_facturado_at && compExt.partner_numero_externo) {
        const safeNum = compExt.partner_numero_externo.replace(/[^A-Za-z0-9-]/g, '-');
        fileName = `factura-${safeNum}.pdf`;
      } else {
        const numStr = comp.numero
          ? `${String(comp.punto_venta).padStart(5, '0')}-${String(comp.numero).padStart(8, '0')}`
          : 'sin-numero';
        fileName = `comprobante-${comp.tipo}-${numStr}.pdf`;
      }
      doc.save(fileName);
    } catch (e) {
      toast.error('No pudimos generar el PDF', {
        description: humanizeError(e),
      });
    }
  }

  if (loading && !comp) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Abriendo comprobante" />
      </div>
    );
  }
  if (!comp) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-12 text-center">
        <AlertCircle className="mx-auto text-brand-muted" />
        <p className="text-sm text-brand-muted">No encontramos este comprobante.</p>
        <Button variant="secondary" onClick={() => navigate('/portal/comprobantes')}>
          <ArrowLeft size={15} /> Volver al listado
        </Button>
      </div>
    );
  }

  const estado = ESTADO_BADGES[comp.estado as ComprobanteEstado];
  const cobranza = COBRANZA_BADGES[comp.estado_cobranza as CobranzaEstado];
  const numeroStr = comp.numero
    ? `${String(comp.punto_venta).padStart(5, '0')}-${String(comp.numero).padStart(8, '0')}`
    : '—';
  const venceEnDias = comp.vencimiento
    ? Math.ceil(
        (parseLocalDate(comp.vencimiento).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/portal/comprobantes"
        className="inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
      >
        <ArrowLeft size={14} /> Mis comprobantes
      </Link>

      {/* Cover header */}
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm motion-safe:animate-fade-up">
        <div className="relative h-28 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal sm:h-32">
          <TrianglesAccent
            position="top-right"
            size={220}
            tone="cyan"
            density="rich"
            className="opacity-60"
          />
          <TrianglesAccent
            position="bottom-left"
            size={160}
            tone="teal"
            density="soft"
            className="opacity-40"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.35),transparent_55%)]"
          />
        </div>
        <div className="relative px-6 pb-5 pt-0 sm:px-8">
          <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-brand-cyan to-brand-teal text-white shadow-lg sm:h-24 sm:w-24">
                <FileText size={32} />
              </span>
              <div className="min-w-0 pb-1">
                <p className="kicker text-brand-cyan">Comprobante</p>
                <h1 className="break-words font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
                  <span className="rounded-lg bg-slate-100 px-2 py-0.5 font-mono text-base uppercase tracking-wider">
                    {comp.tipo}
                  </span>{' '}
                  <span className="tabular">{numeroStr}</span>
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-block rounded-full border px-2.5 py-0.5 font-semibold ${estado.cls}`}
                  >
                    {estado.label}
                  </span>
                  {comp.estado !== 'anulado' && (
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 font-semibold ${cobranza.cls}`}
                    >
                      {cobranza.label}
                    </span>
                  )}
                  {comp.cae && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                      CAE <span className="tabular">{comp.cae}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void onDescargarPdf()}>
                <Download size={14} />
                {(comp as unknown as { partner_facturado_at: string | null })
                  .partner_facturado_at
                  ? 'Descargar factura'
                  : 'Descargar PDF'}
              </Button>
              {comp.estado !== 'anulado' && (
                <Button variant="secondary" onClick={() => setEnviarOpen(true)}>
                  <Send size={14} /> Enviar
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          icon={Receipt}
          label="Total"
          value={
            <span className="tabular">
              $<AnimatedNumber value={Math.round(Number(comp.total ?? 0))} />
            </span>
          }
          hint={comp.moneda}
          tone="cyan"
          delay={0}
        />
        <Kpi
          icon={Hash}
          label="Saldo pendiente"
          value={
            <span className="tabular">
              $
              <AnimatedNumber
                value={Math.round(Number(comp.saldo_pendiente ?? 0))}
              />
            </span>
          }
          hint={
            Number(comp.saldo_pendiente) === 0
              ? 'cobrado'
              : Number(comp.saldo_pendiente) < Number(comp.total)
                ? 'parcial'
                : 'sin pagos'
          }
          tone={Number(comp.saldo_pendiente) === 0 ? 'teal' : 'amber'}
          delay={60}
        />
        <Kpi
          icon={CalendarClock}
          label="Vencimiento"
          value={
            venceEnDias === null ? (
              <span className="text-brand-muted">—</span>
            ) : venceEnDias < 0 ? (
              <span className="text-red-600">vencido</span>
            ) : (
              <span>
                <AnimatedNumber value={venceEnDias} /> d
              </span>
            )
          }
          hint={comp.vencimiento ?? '—'}
          tone={venceEnDias !== null && venceEnDias < 0 ? 'amber' : 'teal'}
          delay={120}
        />
        <Kpi
          icon={Building2}
          label="IVA total"
          value={
            <span className="tabular">
              $<AnimatedNumber value={Math.round(Number(comp.total_iva ?? 0))} />
            </span>
          }
          hint="neto + iva"
          tone="cyan"
          delay={180}
        />
      </section>

      {/* Receptor + meta */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card-premium relative overflow-hidden p-5 lg:col-span-2">
          <TrianglesAccent
            position="top-right"
            size={140}
            tone="cyan"
            density="soft"
            className="opacity-25"
          />
          <div className="relative">
            <p className="kicker text-brand-cyan">Receptor</p>
            <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">
              {comp.receptor_razon_social}
            </h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <Row
                label={comp.receptor_tipo_documento.toUpperCase()}
                value={
                  <CopyButton
                    value={comp.receptor_numero_documento}
                    label={comp.receptor_tipo_documento}
                    tabular
                  />
                }
              />
              <Row
                label="Condición IVA"
                value={comp.receptor_condicion_iva.replaceAll('_', ' ')}
              />
              {comp.receptor_domicilio && (
                <Row label="Domicilio" value={comp.receptor_domicilio} />
              )}
              <Row label="Concepto" value={comp.concepto.replaceAll('_', ' y ')} />
            </dl>
          </div>
        </div>

        <div className="card-premium relative overflow-hidden p-5">
          <TrianglesAccent
            position="bottom-left"
            size={120}
            tone="teal"
            density="soft"
            className="opacity-25"
          />
          <div className="relative space-y-2 text-sm">
            <p className="kicker text-brand-cyan">Emisión</p>
            <Row label="Fecha" value={comp.fecha} />
            <Row label="Periodo" value={comp.periodo} />
            <Row label="Vencimiento" value={comp.vencimiento ?? '—'} />
          </div>
        </div>
      </section>

      {/* Items */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={150}
          tone="cyan"
          density="soft"
          className="opacity-25"
        />
        <div className="relative">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="kicker text-brand-cyan">Detalle</p>
            <h3 className="mt-0.5 font-display text-lg font-bold text-brand-ink">
              {items.length} {items.length === 1 ? 'línea' : 'líneas'}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <th className="px-4 py-2.5 w-12">#</th>
                  <th className="px-4 py-2.5">Descripción</th>
                  <th className="px-4 py-2.5 text-right">Cant.</th>
                  <th className="px-4 py-2.5 text-right">P. unit.</th>
                  <th className="px-4 py-2.5 text-right">Bonif.</th>
                  <th className="px-4 py-2.5 text-right">IVA</th>
                  <th className="px-4 py-2.5 text-right">Subtotal</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr
                    key={it.id}
                    className="border-b border-slate-100 motion-safe:animate-fade-up"
                    style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
                  >
                    <td className="px-4 py-3 tabular text-brand-muted">{it.orden}</td>
                    <td className="px-4 py-3 text-brand-ink">{it.descripcion}</td>
                    <td className="px-4 py-3 text-right tabular">{it.cantidad}</td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatMoney(Number(it.precio_unitario))}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-brand-muted">
                      {Number(it.bonificacion_porc) > 0
                        ? `${it.bonificacion_porc}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-brand-muted">
                      {it.alicuota_iva}
                    </td>
                    <td className="px-4 py-3 text-right tabular">
                      {formatMoney(Number(it.subtotal))}
                    </td>
                    <td className="px-4 py-3 text-right tabular font-medium text-brand-ink">
                      {formatMoney(Number(it.total))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-zebra/40 text-sm">
                <tr>
                  <td colSpan={6} className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right text-brand-muted">Neto</td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatMoney(Number(comp.neto ?? 0))}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} className="px-4 py-1"></td>
                  <td className="px-4 py-1 text-right text-brand-muted">IVA</td>
                  <td className="px-4 py-1 text-right tabular">
                    {formatMoney(Number(comp.total_iva ?? 0))}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right font-display font-bold uppercase tracking-wider text-brand-ink">
                    Total
                  </td>
                  <td className="px-4 py-2.5 text-right tabular font-display text-base font-bold text-brand-cyan">
                    {formatMoney(Number(comp.total ?? 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* Cobranzas (read-only) */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="teal"
          density="soft"
          className="opacity-25"
        />
        <div className="relative">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
                <Wallet size={18} />
              </span>
              <div>
                <p className="kicker text-brand-cyan">Pagos registrados</p>
                <h3 className="font-display text-lg font-bold text-brand-ink">
                  {pagos.length === 0
                    ? 'Sin pagos'
                    : `${pagos.length} ${pagos.length === 1 ? 'pago' : 'pagos'}`}
                </h3>
              </div>
            </div>
          </div>
          {pagos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
                <CreditCard size={20} />
              </span>
              <p className="text-sm text-brand-muted">
                Aún no se registró ningún pago para este comprobante.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-4 py-2.5">Caja</th>
                    <th className="px-4 py-2.5">Referencia</th>
                    <th className="px-4 py-2.5 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((p, idx) => (
                    <tr
                      key={p.imputacion_id}
                      className="border-b border-slate-100 motion-safe:animate-fade-up"
                      style={{ animationDelay: `${Math.min(idx, 6) * 30}ms` }}
                    >
                      <td className="px-4 py-3 tabular text-brand-muted">
                        {formatDateShort(p.fecha)}
                      </td>
                      <td className="px-4 py-3 text-brand-ink">
                        {p.caja_nombre ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {p.referencia ? (
                          <CopyButton value={p.referencia} label="Referencia" />
                        ) : (
                          <span className="text-brand-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular font-medium text-emerald-700">
                        {formatMoney(Number(p.monto_imputado))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <EnviarComprobanteModal
        open={enviarOpen}
        onClose={() => setEnviarOpen(false)}
        comprobante={comp}
        items={items}
        onSent={() => void load()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="kicker">{label}</dt>
      <dd className="text-sm text-brand-ink">{value}</dd>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  delay = 0,
}: {
  icon: typeof Receipt;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: 'cyan' | 'teal' | 'amber';
  delay?: number;
}) {
  const ring =
    tone === 'cyan'
      ? 'border-brand-cyan/30 hover:border-brand-cyan/60'
      : tone === 'teal'
        ? 'border-brand-teal/30 hover:border-brand-teal/60'
        : 'border-amber-300/50 hover:border-amber-400/70';
  const iconCls =
    tone === 'cyan'
      ? 'bg-brand-cyan-pale/50 text-brand-cyan'
      : tone === 'teal'
        ? 'bg-brand-teal/10 text-brand-teal'
        : 'bg-amber-100 text-amber-700';
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-white p-4 transition motion-safe:animate-fade-up hover:-translate-y-0.5',
        ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={110}
        tone={tone === 'amber' ? 'cyan' : tone}
        density="soft"
        className="opacity-35"
      />
      <div className="relative flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', iconCls)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-muted">{label}</p>
          <p className="mt-0.5 font-display text-xl font-bold leading-none text-brand-ink">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-brand-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
