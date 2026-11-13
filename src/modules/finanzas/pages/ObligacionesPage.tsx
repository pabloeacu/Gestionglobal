import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Tabs, type TabItem, useConfirm, usePrompt } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { hoyISO } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { getCajasConSaldo, type CajaConSaldoRow } from '@/services/api/finanzas';
import {
  listObligaciones, registrarPagoEgreso, anularEgreso, revertirPagosEgreso,
  type ObligacionEgreso,
} from '@/services/api/egresos';
import { formatMoneyExact } from '../components/MoneySup';
import { NuevaObligacionModal } from '../components/NuevaObligacionModal';

// DGG-249 chunk 3 · Obligaciones de pago (egresos-obligación): el pasivo de GG.
// Universo completo traído de una vez; los tabs filtran en memoria (R19).
type TabKey = 'por_pagar' | 'pagadas' | 'todas';

const CHIP: Record<string, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
  parcial: { label: 'Parcial', cls: 'bg-sky-100 text-sky-800' },
  pagado: { label: 'Pagado', cls: 'bg-green-100 text-green-800' },
  anulado: { label: 'Anulada', cls: 'bg-slate-200 text-slate-600' },
};

function fmtFecha(iso: string | null): string {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('es-AR') : '—';
}

export function ObligacionesPage() {
  const [items, setItems] = useState<ObligacionEgreso[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('por_pagar');
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const [pagar, setPagar] = useState<ObligacionEgreso | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listObligaciones(true); // incluye anuladas; el tab filtra
    setLoading(false);
    if (!r.ok) { toast.error('No pudimos cargar las obligaciones', { description: humanizeError(r.error) }); return; }
    setItems(r.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // KPIs sobre el universo completo (R19): pasivo = Σ saldo de las activas.
  const stats = useMemo(() => {
    const activas = items.filter((i) => i.estado === 'activo');
    const pasivo = activas.reduce((s, i) => s + Number(i.saldo_pendiente), 0);
    const porPagar = activas.filter((i) => i.saldo_pendiente > 0).length;
    const vencidas = activas.filter((i) => i.vencido).length;
    return { pasivo, porPagar, vencidas };
  }, [items]);

  const visibles = useMemo(() => {
    if (tab === 'por_pagar') return items.filter((i) => i.estado === 'activo' && i.saldo_pendiente > 0);
    if (tab === 'pagadas') return items.filter((i) => i.estado === 'activo' && i.saldo_pendiente <= 0);
    return items;
  }, [items, tab]);

  const tabs: TabItem[] = [
    { key: 'por_pagar', label: 'Por pagar' },
    { key: 'pagadas', label: 'Pagadas' },
    { key: 'todas', label: 'Todas' },
  ];

  async function onAnular(o: ObligacionEgreso) {
    const okc = await confirm({
      title: 'Anular obligación',
      message: `¿Anular la obligación de ${o.proveedor_nombre} por ${formatMoneyExact(Number(o.total))}? No se puede si ya tiene pagos.`,
      confirmLabel: 'Anular', danger: true,
    });
    if (!okc) return;
    const motivo = await prompt({ title: 'Motivo de la anulación', placeholder: 'Opcional' });
    if (motivo === null) return;
    const r = await anularEgreso(o.id, motivo);
    if (!r.ok) { toast.error('No se pudo anular', { description: humanizeError(r.error) }); return; }
    toast.success('Obligación anulada');
    void load();
  }

  async function onDeshacerPago(o: ObligacionEgreso) {
    const okc = await confirm({
      title: 'Deshacer pago(s)',
      message: `¿Deshacer el/los pago(s) de ${o.proveedor_nombre}? La obligación vuelve a impaga por ${formatMoneyExact(Number(o.total))} y el/los movimiento(s) de caja se anulan.`,
      confirmLabel: 'Deshacer pago(s)', danger: true,
    });
    if (!okc) return;
    const motivo = await prompt({ title: 'Motivo (opcional)', placeholder: 'Ej.: monto equivocado' });
    if (motivo === null) return;
    const r = await revertirPagosEgreso(o.id, motivo);
    if (!r.ok) { toast.error('No se pudo deshacer el pago', { description: humanizeError(r.error) }); return; }
    toast.success(r.data === 1 ? 'Pago deshecho · obligación impaga' : `${r.data} pagos deshechos · obligación impaga`);
    void load();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Finanzas</p>
          <h1 className="text-2xl uppercase tracking-tight text-brand-ink">Obligaciones de pago</h1>
          <p className="mt-0.5 text-sm text-brand-muted">Lo que GG debe pagar: pagado, parcial o impago (pasivo).</p>
        </div>
        <Button onClick={() => setNuevaOpen(true)}><Plus size={16} /> Nueva obligación</Button>
      </header>

      {/* Resumen patrimonial */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={<Wallet size={18} />} label="Pasivo total (por pagar)" value={formatMoneyExact(stats.pasivo)} tone="amber" />
        <StatCard icon={<CheckCircle2 size={18} />} label="Obligaciones por pagar" value={String(stats.porPagar)} tone="sky" />
        <StatCard icon={<AlertTriangle size={18} />} label="Vencidas" value={String(stats.vencidas)} tone={stats.vencidas > 0 ? 'rose' : 'slate'} />
      </div>

      <Tabs items={tabs} activeKey={tab} onChange={(id) => setTab(id as TabKey)} />

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-brand-muted">
              <th className="px-3 py-2 font-semibold">Proveedor / concepto</th>
              <th className="px-3 py-2 font-semibold">Fecha</th>
              <th className="px-3 py-2 font-semibold">Vence</th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              <th className="px-3 py-2 text-right font-semibold">Saldo</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold">Partner</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-brand-muted">Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-brand-muted">Sin obligaciones en esta vista.</td></tr>
            ) : visibles.map((o) => {
              const chip = CHIP[o.estado === 'anulado' ? 'anulado' : o.estado_pago]
                ?? { label: o.estado_pago, cls: 'bg-slate-100 text-slate-600' };
              return (
                <tr key={o.id} className={cn('border-b border-slate-200/60 last:border-0', o.estado === 'anulado' && 'opacity-55')}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-brand-ink">{o.proveedor_nombre}</div>
                    <div className="text-xs text-brand-muted line-clamp-1">{o.concepto}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-brand-muted">{fmtFecha(o.fecha)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn(o.vencido && 'font-semibold text-rose-600')}>{fmtFecha(o.vencimiento)}</span>
                    {o.vencido && <span className="ml-1 text-[10px] font-bold uppercase text-rose-600">vencida</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-brand-ink">{formatMoneyExact(Number(o.total))}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-brand-ink">{formatMoneyExact(Number(o.saldo_pendiente))}</td>
                  <td className="px-3 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', chip.cls)}>{chip.label}</span></td>
                  <td className="px-3 py-2 text-xs text-brand-muted">{o.partner_nombre ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {o.estado === 'activo' && o.saldo_pendiente > 0 && (
                      <button onClick={() => setPagar(o)} className="rounded-md border border-brand-cyan/40 bg-brand-cyan/5 px-2 py-1 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/10">Pagar</button>
                    )}
                    {o.estado === 'activo' && o.saldo_pendiente < o.total && (
                      <button onClick={() => void onDeshacerPago(o)} className="ml-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">Deshacer pago</button>
                    )}
                    {o.estado === 'activo' && o.saldo_pendiente >= o.total && (
                      <button onClick={() => void onAnular(o)} className="ml-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-muted hover:bg-slate-50">Anular</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {nuevaOpen && (
        <NuevaObligacionModal onClose={() => setNuevaOpen(false)} onCreated={() => { setNuevaOpen(false); void load(); }} />
      )}
      {pagar && <PagarObligacionModal obligacion={pagar} onClose={() => setPagar(null)} onPaid={() => { setPagar(null); void load(); }} />}
    </div>
  );
}

function StatCard({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: 'amber' | 'sky' | 'rose' | 'slate' }) {
  const tones = {
    amber: 'text-amber-700 bg-amber-100',
    sky: 'text-sky-700 bg-sky-100',
    rose: 'text-rose-700 bg-rose-100',
    slate: 'text-slate-600 bg-slate-100',
  } as const;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-brand-muted">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-brand-ink">{value}</div>
    </div>
  );
}

// Modal de pago contra una obligación existente.
function PagarObligacionModal({ obligacion, onClose, onPaid }: { obligacion: ObligacionEgreso; onClose: () => void; onPaid: () => void }) {
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);
  const [cajaId, setCajaId] = useState('');
  const [monto, setMonto] = useState(String(obligacion.saldo_pendiente));
  const [fecha, setFecha] = useState(hoyISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await getCajasConSaldo();
      if (r.ok) { setCajas(r.data); setCajaId(r.data[0]?.caja_id ?? ''); }
    })();
  }, []);

  async function onSubmit() {
    const m = Number(monto.replace(',', '.'));
    if (!cajaId) { toast.error('Elegí una caja'); return; }
    if (!m || m <= 0) { toast.error('Monto inválido'); return; }
    if (m > Number(obligacion.saldo_pendiente) + 0.001) { toast.error('El monto supera el saldo pendiente'); return; }
    setSaving(true);
    const r = await registrarPagoEgreso({ egresoId: obligacion.id, cajaId, fecha, monto: m });
    setSaving(false);
    if (!r.ok) { toast.error('No se pudo registrar el pago', { description: humanizeError(r.error) }); return; }
    toast.success('Pago registrado');
    onPaid();
  }

  return (
    <Modal open onClose={onClose} title="Pagar obligación" kicker={obligacion.proveedor_nombre} width={440}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button onClick={onSubmit} loading={saving}>Pagar</Button></>}>
      <div className="space-y-3">
        <p className="rounded-lg bg-slate-50 p-2 text-sm text-brand-muted">
          {obligacion.concepto} · Saldo <b className="text-brand-ink">{formatMoneyExact(Number(obligacion.saldo_pendiente))}</b> de {formatMoneyExact(Number(obligacion.total))}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Caja" required>
            <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {cajas.map((c) => <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Fecha" required><Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
        </div>
        <Field label="Monto" required hint="Default: el saldo pendiente (pago total).">
          <Input type="number" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} min={0} step="0.01" />
        </Field>
      </div>
    </Modal>
  );
}
