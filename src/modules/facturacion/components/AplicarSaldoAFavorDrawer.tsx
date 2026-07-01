import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Sparkles, Check, PiggyBank, ArrowRight } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  AnimatedNumber,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  listarCreditosAdministracion,
  imputarCreditoAComprobante,
  type CreditoDisponible,
} from '@/services/api/cobranzas';
import type { ComprobanteRow } from '@/services/api/comprobantes';
import { humanizeError } from '@/lib/errors';
import { formatDateShort } from '@/lib/dates';

interface Props {
  open: boolean;
  onClose: () => void;
  comprobante: ComprobanteRow;
  onSaved?: () => void;
}

/**
 * Aplicar saldo a favor (JL #3 · DGG-91). Cuando un comprobante ya pagado se
 * anula (p. ej. inscripción duplicada), su pago queda como crédito del cliente.
 * Este drawer lista esos créditos disponibles de la administración y permite
 * imputarlos a ESTE comprobante pendiente. Backend: mig 0265 (RPCs
 * listar_creditos_administracion + imputar_credito_a_comprobante).
 */
export function AplicarSaldoAFavorDrawer({
  open,
  onClose,
  comprobante,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creditos, setCreditos] = useState<CreditoDisponible[]>([]);
  const [selId, setSelId] = useState<string>('');
  const [monto, setMonto] = useState<number>(0);
  const [errorMonto, setErrorMonto] = useState<string>('');

  const saldoComp = Number(comprobante.saldo_pendiente ?? 0);
  const sel = useMemo(
    () => creditos.find((c) => c.movimiento_id === selId) ?? null,
    [creditos, selId],
  );
  const maxAplicable = useMemo(
    () => (sel ? Math.min(sel.saldo_disponible, saldoComp) : 0),
    [sel, saldoComp],
  );

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelId('');
    setMonto(0);
    setErrorMonto('');
    void (async () => {
      const r = await listarCreditosAdministracion(comprobante.administracion_id);
      setLoading(false);
      if (!r.ok) {
        toast.error('No pudimos cargar los saldos a favor', {
          description: humanizeError(r.error),
        });
        return;
      }
      setCreditos(r.data);
      // Si hay un único crédito, pre-seleccionarlo por comodidad.
      if (r.data.length === 1) {
        setSelId(r.data[0]!.movimiento_id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comprobante.id]);

  // Al elegir un crédito, sugerir el máximo aplicable (min(crédito, saldo comp)).
  useEffect(() => {
    if (sel) setMonto(Math.min(sel.saldo_disponible, saldoComp));
    else setMonto(0);
    setErrorMonto('');
  }, [sel, saldoComp]);

  const restante = saldoComp - monto;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sel) {
      toast.error('Elegí un saldo a favor para aplicar');
      return;
    }
    if (!(monto > 0)) {
      setErrorMonto('El monto debe ser mayor a 0');
      return;
    }
    if (monto > maxAplicable + 0.009) {
      setErrorMonto(`No puede superar ${formatMoney(maxAplicable)}`);
      return;
    }
    setSaving(true);
    const res = await imputarCreditoAComprobante(sel.movimiento_id, comprobante.id, monto);
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos aplicar el saldo a favor', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success(`Saldo a favor aplicado: ${formatMoney(monto)}`, {
      description:
        res.data.comprobante_saldo <= 0
          ? 'El comprobante quedó pagado.'
          : `Saldo restante del comprobante: ${formatMoney(res.data.comprobante_saldo)}`,
    });
    onSaved?.();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      kicker="Aplicar saldo a favor"
      title={`Crédito → ${formatNumStr(comprobante)}`}
      description={`Saldo pendiente: ${formatMoney(saldoComp)}`}
      icon={<PiggyBank size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
              <Sparkles size={11} /> Saldo {formatMoney(saldoComp)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              form="saldo-favor-form"
              loading={saving}
              disabled={!sel || loading || !(monto > 0) || monto > maxAplicable + 0.009}
            >
              <Check size={15} /> Aplicar {sel ? formatMoney(monto) : ''}
            </Button>
          </div>
        </div>
      }
    >
      <form id="saldo-favor-form" onSubmit={onSubmit} className="relative">
        <TrianglesAccent
          position="top-right" size={170} tone="teal" density="soft"
          className="opacity-50"
        />
        <div className="relative space-y-5">
          <p className="text-sm text-brand-muted">
            Los saldos a favor surgen cuando un comprobante <strong>ya pagado</strong> se anula
            (por ejemplo, una inscripción duplicada). El pago queda como crédito del cliente y
            podés aplicarlo a este comprobante.
          </p>

          {loading ? (
            <div className="grid place-items-center py-10 text-sm text-brand-muted">
              Cargando saldos a favor…
            </div>
          ) : creditos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-5 py-10 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-brand-muted">
                <PiggyBank size={20} />
              </span>
              <p className="text-sm font-medium text-brand-ink">
                No hay saldos a favor disponibles
              </p>
              <p className="max-w-sm text-xs text-brand-muted">
                Este cliente no tiene créditos sin aplicar. Aparecen acá cuando se anula un
                comprobante que estaba pagado.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="kicker text-brand-cyan">Saldos a favor disponibles</p>
                {creditos.map((c) => {
                  const activo = c.movimiento_id === selId;
                  return (
                    <button
                      key={c.movimiento_id}
                      type="button"
                      onClick={() => setSelId(c.movimiento_id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                        activo
                          ? 'border-brand-cyan bg-brand-cyan-pale/30 ring-1 ring-brand-cyan/40'
                          : 'border-slate-200 bg-white hover:border-brand-cyan/40 hover:bg-slate-50'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                          <span
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                              activo
                                ? 'border-brand-cyan bg-brand-cyan text-white'
                                : 'border-slate-300 bg-white'
                            }`}
                          >
                            {activo && <Check size={12} />}
                          </span>
                          Crédito del {formatDateShort(c.fecha)}
                        </p>
                        <p className="mt-0.5 pl-7 text-xs text-brand-muted">
                          {c.comprobante_origen
                            ? `Origen: ${c.comprobante_origen}`
                            : c.descripcion ?? 'Pago sin imputar'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-display text-base font-bold tabular text-emerald-700">
                          {formatMoney(c.saldo_disponible)}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-brand-muted">
                          disponible
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {sel && (
                <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field
                      label="Monto a aplicar"
                      required
                      error={errorMonto}
                      className="sm:col-span-2"
                    >
                      <Input
                        type="number"
                        step="0.01"
                        min={0.01}
                        max={maxAplicable}
                        value={monto}
                        onChange={(e) => {
                          setMonto(Number(e.target.value));
                          setErrorMonto('');
                        }}
                        required
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => setMonto(maxAplicable)}
                        className="rounded-lg border border-brand-cyan/40 bg-brand-cyan-pale/30 px-3 py-2 text-sm font-medium text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
                      >
                        Aplicar {formatMoney(maxAplicable)}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
                    <MiniBox label="Saldo actual" value={saldoComp} tone="muted" />
                    <div className="flex items-center justify-center text-brand-muted">
                      <ArrowRight size={18} />
                    </div>
                    <MiniBox
                      label="Saldo después"
                      value={restante < 0 ? 0 : restante}
                      tone={restante <= 0.009 ? 'green' : 'amber'}
                    />
                  </div>

                  {restante <= 0.009 && (
                    <p className="flex items-center justify-center gap-1 text-xs font-semibold text-emerald-700">
                      <Check size={13} /> Con este importe el comprobante queda pagado.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function MiniBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'muted' | 'amber' | 'green';
}) {
  const cls =
    tone === 'green'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-white text-brand-ink';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="kicker text-brand-muted">{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold tabular">
        $<AnimatedNumber value={Math.round(value)} />
      </p>
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

function formatNumStr(c: ComprobanteRow): string {
  if (!c.numero) return c.tipo;
  return `${c.tipo} ${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;
}
