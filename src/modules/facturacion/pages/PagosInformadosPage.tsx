// #1/#2 (reporte JL) · Gerencia: cola de pagos informados por clientes.
// El cliente informa un pago (no mueve saldo); acá el gerente lo CONCILIA
// (→ registrar_cobranza_comprobante, única escritora) o lo RECHAZA.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Check, X, Loader2, Inbox, Paperclip } from 'lucide-react';
import { Modal, Field, Input, Select, Button, usePrompt } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort } from '@/lib/dates';
import {
  listPagosReportadosGerencia,
  conciliarPago,
  rechazarPago,
  getComprobantePagoUrl,
  type PagoReportadoGerencia,
} from '@/services/api/pagosReportados';
import { getCajasConSaldo, type CajaConSaldoRow } from '@/services/api/finanzas';
import { listCategoriasIngreso } from '@/services/api/cobranzas';
import { listComprobantes, type ComprobanteListItem } from '@/services/api/comprobantes';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';

const MEDIO_LABEL: Record<string, string> = {
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago: 'Mercado Pago',
  efectivo: 'Efectivo',
  otro: 'Otro',
};

function money(n: number): string {
  return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Parseo de importe en formato argentino (mismo criterio que InformarPagoModal):
// "205.000" → 205000, "205.000,50" → 205000.50, "50000" → 50000.
function parseMontoAR(s: string): number {
  const t = (s || '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  if (t.includes(',')) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return parseFloat(t.replace(/\./g, ''));
  return parseFloat(t);
}

export function PagosInformadosPage() {
  const [pagos, setPagos] = useState<PagoReportadoGerencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([]);
  const [conciliando, setConciliando] = useState<PagoReportadoGerencia | null>(null);
  const prompt = usePrompt();

  const load = useCallback(async () => {
    const res = await listPagosReportadosGerencia('reportado');
    setLoading(false);
    if (res.ok) setPagos(res.data);
  }, []);

  useEffect(() => {
    void load();
    void getCajasConSaldo().then((r) => r.ok && setCajas(r.data));
    void listCategoriasIngreso().then((r) => {
      if (r.ok) setCategorias(r.data.map((c) => ({ id: c.id, nombre: c.nombre })));
    });
  }, [load]);

  useRealtimeRefresh(['pagos_reportados'], load);

  // Doc JL: ver el comprobante de transferencia que adjuntó el cliente
  // (clave para verificar pagos a la cuenta de la Fundación).
  async function verComprobante(p: PagoReportadoGerencia) {
    if (!p.archivo_path) return;
    const res = await getComprobantePagoUrl(p.archivo_path);
    if (!res.ok) {
      toast.error('No pudimos abrir el comprobante', { description: humanizeError(res.error) });
      return;
    }
    window.open(res.data, '_blank', 'noopener,noreferrer');
  }

  async function onRechazar(p: PagoReportadoGerencia) {
    const motivo = await prompt({
      title: 'Rechazar el pago informado',
      message: `${p.administracion_nombre ?? 'El cliente'} informó ${money(p.monto)}. Contale por qué no lo pudimos confirmar (se lo avisamos).`,
      placeholder: 'Ej. no encontramos la transferencia',
      confirmLabel: 'Rechazar',
    });
    if (!motivo || !motivo.trim()) return;
    const res = await rechazarPago(p.id, motivo.trim());
    if (!res.ok) {
      toast.error('No pudimos rechazar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Pago rechazado. Avisamos al cliente.');
    void load();
  }

  if (loading) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando pagos informados" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <p className="kicker text-brand-cyan">Facturación</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink">Pagos informados</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Pagos que los clientes dijeron haber hecho, esperando conciliación. El
          saldo se mueve recién cuando conciliás (registra la cobranza real).
        </p>
      </header>

      {pagos.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-16 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Inbox size={26} />
          </span>
          <p className="text-sm font-medium text-brand-ink">No hay pagos pendientes de conciliar.</p>
          <p className="text-xs text-brand-muted">Cuando un cliente informe un pago, aparece acá.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pagos.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
                    <Wallet size={16} />
                  </span>
                  <span className="font-display text-lg font-bold text-brand-ink">{money(p.monto)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-brand-muted">
                    {MEDIO_LABEL[p.medio] ?? p.medio}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-brand-ink">
                  {p.administracion_nombre ?? 'Cliente'}
                  <span className="text-brand-muted"> · pagó el {formatDateShort(p.fecha_pago)}</span>
                </p>
                <p className="truncate text-xs text-brand-muted">
                  {p.referencia ? `Ref: ${p.referencia}` : 'Sin referencia'}
                  {p.nota ? ` · ${p.nota}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.archivo_path && (
                  <Button variant="tonal" onClick={() => void verComprobante(p)}>
                    <Paperclip size={14} /> Ver comprobante
                  </Button>
                )}
                <Button variant="secondary" onClick={() => void onRechazar(p)}>
                  <X size={14} /> Rechazar
                </Button>
                <Button onClick={() => setConciliando(p)}>
                  <Check size={14} /> Conciliar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {conciliando && (
        <ConciliarModal
          pago={conciliando}
          cajas={cajas}
          categorias={categorias}
          onClose={() => setConciliando(null)}
          onDone={() => {
            setConciliando(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ── Modal de conciliación ────────────────────────────────────────────────────
function ConciliarModal({
  pago,
  cajas,
  categorias,
  onClose,
  onDone,
}: {
  pago: PagoReportadoGerencia;
  cajas: CajaConSaldoRow[];
  categorias: { id: string; nombre: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [comprobantes, setComprobantes] = useState<ComprobanteListItem[]>([]);
  const [compId, setCompId] = useState<string>(pago.comprobante_id ?? '');
  const [cajaId, setCajaId] = useState<string>('');
  const [catId, setCatId] = useState<string>('');
  // E-GG-109 (doc JL): monto editable (pago parcial) + atribución al partner,
  // en paridad con el flujo Cta.Cte. Default = lo que informó el cliente.
  const [monto, setMonto] = useState<string>(String(pago.monto));
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // E-GG-128 (pág.4 JL): el cliente informó más que el saldo del comprobante →
  // dejar el excedente como saldo a favor (paridad con el flujo Cobrar, E-GG-113).
  const [permitirExcedente, setPermitirExcedente] = useState(false);

  useEffect(() => {
    // Comprobantes del cliente con saldo pendiente, para elegir a cuál imputar.
    void listComprobantes({ administracionId: pago.administracion_id, limit: 100 }).then((r) => {
      if (!r.ok) return;
      const pend = r.data.rows.filter((c) => Number(c.saldo_pendiente ?? 0) > 0);
      setComprobantes(pend);
      if (!pago.comprobante_id && pend.length === 1) setCompId(pend[0]!.id);
    });
    void listPartnersActivos().then((r) => r.ok && setPartners(r.data));
    const def = cajas.find((c) => (c as unknown as { es_default?: boolean }).es_default);
    if (def) setCajaId(def.caja_id);
  }, [pago.administracion_id, pago.comprobante_id, cajas]);

  const compSel = comprobantes.find((c) => c.id === compId);
  const saldoComp = Number(compSel?.saldo_pendiente ?? 0);
  const montoNum = parseMontoAR(monto);
  const montoValido = !Number.isNaN(montoNum) && montoNum > 0;
  const excedeSaldo = montoValido && saldoComp > 0 && montoNum > saldoComp;
  // E-GG-128: sólo bloquea el sobrepago si el gerente NO optó por dejarlo a favor.
  const bloqueaExcedente = excedeSaldo && !permitirExcedente;
  const excedente = excedeSaldo ? montoNum - saldoComp : 0;
  const saldoDespues = saldoComp - (montoValido ? montoNum : 0);
  // Gateamos en compSel (no compId): si el comprobante preseleccionado ya no
  // tiene saldo (no entra en la lista filtrada), compSel es undefined → botón
  // deshabilitado, en vez de habilitarse con saldoComp=0 (auditoría §6 A#4).
  const puede = useMemo(
    () => Boolean(compSel && cajaId && catId && montoValido && !bloqueaExcedente && !saving),
    [compSel, cajaId, catId, montoValido, bloqueaExcedente, saving],
  );

  async function confirmar() {
    if (!puede) return;
    setSaving(true);
    const res = await conciliarPago({
      pagoId: pago.id,
      cajaId,
      categoriaId: catId,
      comprobanteId: compId,
      monto: montoNum,
      partnerId: partnerId || null,
      permitirExcedente, // E-GG-128: sobrepago → saldo a favor
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos conciliar', { description: humanizeError(res.error) });
      return;
    }
    toast.success(
      permitirExcedente && excedeSaldo
        ? `Pago conciliado: ${money(saldoComp)} imputados + ${money(excedente)} a favor. Cliente avisado.`
        : 'Pago conciliado. Cobranza registrada y cliente avisado.',
    );
    onDone();
  }

  return (
    <Modal
      open
      onClose={onClose}
      kicker="Conciliar pago"
      title={`${pago.administracion_nombre ?? 'Cliente'} · ${money(pago.monto)}`}
      icon={<Wallet size={18} />}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={!puede}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Registrar la cobranza
          </Button>
        </>
      }
    >
      <Field label="Comprobante a imputar" required>
        <Select value={compId} onChange={(e) => setCompId(e.target.value)}>
          <option value="">— Elegí el comprobante —</option>
          {comprobantes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.tipo?.toUpperCase() ?? 'COMP'} #{String(c.numero ?? '').padStart(8, '0')} · saldo{' '}
              {money(Number(c.saldo_pendiente ?? 0))}
            </option>
          ))}
        </Select>
        {comprobantes.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            Este cliente no tiene comprobantes con saldo pendiente. Emití el comprobante primero.
          </p>
        )}
      </Field>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Caja / cuenta" required>
          <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            <option value="">— Elegí —</option>
            {cajas.map((c) => (
              <option key={c.caja_id} value={c.caja_id}>
                {(c as unknown as { nombre?: string }).nombre ?? c.caja_id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoría" required>
          <Select value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">— Elegí —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Importe a conciliar" required className="mt-3">
        <Input
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="0,00"
        />
        {/* E-GG-128 (pág.4 JL): sobrepago → opt-in "dejar el excedente como saldo
            a favor", en vez de sólo bloquear con "ajustá el monto". */}
        {excedeSaldo && (
          <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <input
              type="checkbox"
              checked={permitirExcedente}
              onChange={(e) => setPermitirExcedente(e.target.checked)}
              className="mt-0.5 shrink-0"
            />
            <span>
              El importe supera el saldo del comprobante ({money(saldoComp)}).{' '}
              {permitirExcedente ? (
                <>
                  Se imputan {money(saldoComp)} y quedan{' '}
                  <strong>{money(excedente)}</strong> como saldo a favor del cliente.
                </>
              ) : (
                <>
                  Marcá acá para <strong>dejar el excedente como saldo a favor</strong>, o
                  ajustá el monto / elegí otro comprobante.
                </>
              )}
            </span>
          </label>
        )}
        {!excedeSaldo && Number(pago.monto) !== montoNum && montoValido && (
          <p className="mt-1 text-xs text-brand-muted">
            El cliente informó {money(Number(pago.monto))}. Vas a registrar {money(montoNum)}.
          </p>
        )}
      </Field>

      {/* Preview del saldo — misma lectura que el flujo de Cta. Cte. */}
      {compId && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-brand-muted">Saldo actual</p>
            <p className="text-sm font-semibold text-brand-ink">{money(saldoComp)}</p>
          </div>
          <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 p-2">
            <p className="text-[10px] uppercase tracking-wide text-brand-cyan">Este pago</p>
            <p className="text-sm font-semibold text-brand-ink">{money(montoValido ? montoNum : 0)}</p>
          </div>
          <div
            className={`rounded-lg border p-2 ${
              permitirExcedente && excedeSaldo
                ? 'border-violet-200 bg-violet-50'
                : saldoDespues <= 0
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wide text-brand-muted">
              {permitirExcedente && excedeSaldo ? 'A favor' : 'Saldo después'}
            </p>
            <p className="text-sm font-semibold text-brand-ink">
              {money(permitirExcedente && excedeSaldo ? excedente : saldoDespues)}
            </p>
          </div>
        </div>
      )}

      {partners.length > 0 && (
        <Field
          label="Participa partner"
          className="mt-3"
          hint="Si lo marcás, este pago entra en la rendición del partner."
        >
          <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">— No participa —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
        Al confirmar registramos la cobranza real contra el comprobante (baja el
        saldo por el importe indicado) y le avisamos al cliente que confirmamos su pago.
      </p>
    </Modal>
  );
}
