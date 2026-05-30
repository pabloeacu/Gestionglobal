// Pestaña Vouchers del detalle del servicio.
// Permite crear, editar (activar/desactivar) y eliminar vouchers.
// Mig 0134: cada voucher pertenece a UN servicio (no globales).

import { useEffect, useState } from 'react';
import {
  Plus,
  Ticket,
  Trash2,
  Power,
  Calendar,
  Users,
  Pencil,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateShort } from '@/lib/dates';
import {
  listVouchersDeServicio,
  actualizarVoucher,
  eliminarVoucher,
  estadoVoucher,
  type ServicioVoucherRow,
} from '@/services/api/vouchers';
import { VoucherDrawer } from './VoucherDrawer';
import { cn } from '@/lib/cn';

interface VouchersTabProps {
  servicio_id: string;
}

const ALCANCE_LABEL: Record<string, { label: string; tone: string }> = {
  publico: { label: 'Sólo público', tone: 'bg-sky-50 text-sky-700' },
  cliente: { label: 'Sólo clientes', tone: 'bg-violet-50 text-violet-700' },
  ambos: { label: 'Todos', tone: 'bg-slate-100 text-brand-ink/80' },
};

const TONE_CHIP: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  muted: 'bg-slate-100 text-brand-muted',
};

export function VouchersTab({ servicio_id }: VouchersTabProps) {
  const [vouchers, setVouchers] = useState<ServicioVoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ServicioVoucherRow | null>(null);
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    const r = await listVouchersDeServicio(servicio_id);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    setVouchers(r.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicio_id]);

  useRealtimeRefresh(['servicio_vouchers'], () => void load());

  async function onToggleActivo(v: ServicioVoucherRow) {
    const r = await actualizarVoucher(v.id, { activo: !v.activo });
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success(v.activo ? 'Voucher desactivado.' : 'Voucher activado.');
    void load();
  }

  async function onEliminar(v: ServicioVoucherRow) {
    const ok = await confirm({
      title: 'Eliminar voucher',
      message: `Vamos a eliminar el código “${v.codigo}”. ${
        v.usos_count > 0
          ? `Ya fue usado ${v.usos_count} vez(es) — esos usos quedan registrados en las solicitudes correspondientes.`
          : 'Todavía no fue usado.'
      } Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const r = await eliminarVoucher(v.id);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Voucher eliminado.');
    void load();
  }

  return (
    <section className="card-premium overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <p className="kicker flex items-center gap-1">
            <Ticket size={12} /> Vouchers
          </p>
          <h2 className="font-display text-lg font-bold text-brand-ink">
            Códigos de descuento
          </h2>
          <p className="text-xs text-brand-muted">
            Cuando hay vouchers activos, los formularios de este servicio
            ofrecen el campo “Tengo un voucher”.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          <Plus size={16} /> Nuevo voucher
        </Button>
      </header>

      {loading ? (
        <div className="p-6 text-sm text-brand-muted">Cargando…</div>
      ) : vouchers.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Sin vouchers"
          description="Creá el primer código de descuento para este servicio."
          action={
            <Button onClick={() => setDrawerOpen(true)} type="button">
              <Plus size={16} /> Nuevo voucher
            </Button>
          }
        />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-brand-zebra text-left text-xs uppercase tracking-wide text-brand-muted">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3 text-right">Descuento</th>
              <th className="px-4 py-3">Alcance</th>
              <th className="px-4 py-3">Vence</th>
              <th className="px-4 py-3 text-right">Usos</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vouchers.map((v) => {
              const estado = estadoVoucher(v);
              const alcance =
                ALCANCE_LABEL[v.alcance] ?? ALCANCE_LABEL.ambos!;
              return (
                <tr
                  key={v.id}
                  className={cn(
                    'motion-safe:animate-fade-up',
                    !v.activo && 'opacity-60',
                  )}
                >
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-brand-ink">
                    {v.codigo}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {Number(v.descuento_pct) === 100 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        100% · Gratis
                      </span>
                    ) : (
                      <span>{Number(v.descuento_pct)}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        alcance.tone,
                      )}
                    >
                      <Users size={11} />
                      {alcance.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-muted">
                    {v.expira_at ? (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDateShort(v.expira_at)}
                      </span>
                    ) : (
                      'Nunca'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-ink/80">
                    {v.usos_count}
                    {v.max_usos != null && (
                      <span className="text-xs text-brand-muted">
                        {' '}/ {v.max_usos}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        TONE_CHIP[estado.tone] ?? TONE_CHIP.muted,
                      )}
                    >
                      {estado.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(v);
                          setDrawerOpen(true);
                        }}
                        title="Editar"
                        aria-label="Editar voucher"
                        className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onToggleActivo(v)}
                        title={v.activo ? 'Desactivar' : 'Activar'}
                        aria-label={v.activo ? 'Desactivar voucher' : 'Activar voucher'}
                        className="rounded-md p-1.5 hover:bg-slate-100"
                      >
                        <Power size={14} className={v.activo ? 'text-emerald-600' : 'text-brand-muted'} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onEliminar(v)}
                        title="Eliminar"
                        aria-label="Eliminar voucher"
                        className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {drawerOpen && (
        <VoucherDrawer
          servicio_id={servicio_id}
          voucher={editing}
          onClose={() => {
            setDrawerOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setDrawerOpen(false);
            setEditing(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
