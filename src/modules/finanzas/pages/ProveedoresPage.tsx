import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Trash2, Power, Search } from 'lucide-react';
import { Input, useConfirm, usePrompt } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { cn } from '@/lib/cn';
import {
  listProveedoresFrecuentesAll,
  proveedorFrecuenteUso,
  renombrarProveedorFrecuente,
  setProveedorFrecuenteActivo,
  eliminarProveedorFrecuente,
  type ProveedorFrecuenteFullRow,
} from '@/services/api/finanzas';

// DGG-251 · Gestión del catálogo de proveedores frecuentes (editar/activar/eliminar).
// El nombre vive denormalizado (mig 0394): editar es RETROACTIVO (obligaciones + caja),
// eliminar sólo si no tiene uso, desactivar es el soft-delete reversible.
export function ProveedoresPage() {
  const [items, setItems] = useState<ProveedorFrecuenteFullRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listProveedoresFrecuentesAll();
    setLoading(false);
    if (!r.ok) {
      toast.error('No pudimos cargar los proveedores', { description: humanizeError(r.error) });
      return;
    }
    setItems(r.data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? items.filter((p) => p.nombre.toLowerCase().includes(t)) : items;
  }, [items, q]);

  const stats = useMemo(() => ({
    total: items.length,
    activos: items.filter((p) => p.activo).length,
  }), [items]);

  async function onEditar(p: ProveedorFrecuenteFullRow) {
    const nuevo = await prompt({
      title: 'Editar proveedor',
      message: 'Nuevo nombre. Se corrige el catálogo y, retroactivamente, el nombre en las obligaciones y en la caja (para que la cuenta corriente quede coherente).',
      defaultValue: p.nombre,
      confirmLabel: 'Continuar',
    });
    if (nuevo === null) return;
    const limpio = nuevo.trim();
    if (!limpio || limpio === p.nombre) return;
    setBusy(p.id);
    const u = await proveedorFrecuenteUso(p.id);
    const c = u.ok ? u.data : { egresos: 0, caja: 0, total: 0 };
    setBusy(null);
    const okc = await confirm({
      title: 'Confirmar renombre',
      message:
        `Renombrar "${p.nombre}" → "${limpio}". ` +
        (c.total > 0
          ? `Esto actualizará ${c.egresos} obligación(es) y ${c.caja} movimiento(s) de caja.`
          : 'No tiene movimientos cargados.'),
      confirmLabel: 'Renombrar',
    });
    if (!okc) return;
    setBusy(p.id);
    const r = await renombrarProveedorFrecuente(p.id, limpio, true);
    setBusy(null);
    if (!r.ok) { toast.error('No se pudo renombrar', { description: humanizeError(r.error) }); return; }
    const tot = r.data.egresos_renombrados + r.data.caja_renombrados;
    toast.success(tot > 0
      ? `Renombrado · ${r.data.egresos_renombrados} obligaciones + ${r.data.caja_renombrados} caja actualizados`
      : 'Proveedor renombrado');
    void load();
  }

  async function onToggle(p: ProveedorFrecuenteFullRow) {
    setBusy(p.id);
    const r = await setProveedorFrecuenteActivo(p.id, !p.activo);
    setBusy(null);
    if (!r.ok) { toast.error('No se pudo cambiar el estado', { description: humanizeError(r.error) }); return; }
    toast.success(p.activo ? 'Proveedor desactivado' : 'Proveedor activado');
    void load();
  }

  async function onEliminar(p: ProveedorFrecuenteFullRow) {
    setBusy(p.id);
    const u = await proveedorFrecuenteUso(p.id);
    setBusy(null);
    if (u.ok && u.data.total > 0) {
      toast.error('No se puede eliminar', {
        description: `Tiene ${u.data.total} movimiento(s) asociado(s). Desactivalo en su lugar (reversible).`,
      });
      return;
    }
    const okc = await confirm({
      title: 'Eliminar proveedor',
      message: `¿Eliminar "${p.nombre}"? No tiene movimientos cargados. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!okc) return;
    setBusy(p.id);
    const r = await eliminarProveedorFrecuente(p.id);
    setBusy(null);
    if (!r.ok) { toast.error('No se pudo eliminar', { description: humanizeError(r.error) }); return; }
    toast.success('Proveedor eliminado');
    void load();
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Finanzas</p>
        <h1 className="text-2xl uppercase tracking-tight text-brand-ink">Proveedores frecuentes</h1>
        <p className="mt-0.5 text-sm text-brand-muted">
          Catálogo de nombres para autocompletar al cargar egresos. Editar corrige también los registros ya cargados; eliminar sólo si no tiene movimientos.
        </p>
      </header>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar proveedor…" className="pl-8" />
        </div>
        <span className="whitespace-nowrap text-xs text-brand-muted">{stats.activos} activos · {stats.total} en total</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-brand-muted">
              <th className="px-3 py-2 font-semibold">Proveedor</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-10 text-center text-brand-muted">Cargando…</td></tr>
            ) : visibles.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-10 text-center text-brand-muted">
                {q ? 'Sin coincidencias.' : 'No hay proveedores cargados.'}
              </td></tr>
            ) : visibles.map((p) => (
              <tr key={p.id} className={cn('border-b border-slate-200/60 last:border-0', !p.activo && 'opacity-55')}>
                <td className="px-3 py-2 font-medium text-brand-ink">{p.nombre}</td>
                <td className="px-3 py-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    p.activo ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600')}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    onClick={() => void onEditar(p)} disabled={busy === p.id}
                    className="rounded-md border border-brand-cyan/40 bg-brand-cyan/5 px-2 py-1 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/10 disabled:opacity-50"
                    title="Editar nombre (retroactivo)">
                    <Pencil size={13} className="inline" /> Editar
                  </button>
                  <button
                    onClick={() => void onToggle(p)} disabled={busy === p.id}
                    className="ml-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-brand-muted hover:bg-slate-50 disabled:opacity-50"
                    title={p.activo ? 'Desactivar (reversible)' : 'Activar'}>
                    <Power size={13} className="inline" /> {p.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => void onEliminar(p)} disabled={busy === p.id}
                    className="ml-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    title="Eliminar (sólo si no tiene movimientos)">
                    <Trash2 size={13} className="inline" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
