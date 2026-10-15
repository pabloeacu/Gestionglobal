// CorreosSuprimidosPage (DGG-224) · Vista de gerencia de los correos que NO
// reciben envíos: bajas de marketing (opt-out), rebotes y descartes de gerencia.
// Distingue "casilla muerta" (hard → bloquea TODO envío) de "baja de marketing"
// (soft → sólo marketing). Permite REACTIVAR (deshace la supresión + re-habilita
// el marketing del cliente dueño + revierte el prospecto, en una sola operación).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailX, Loader2, RotateCcw, Search, ShieldOff, BellOff } from 'lucide-react';
import { useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import { listarSuprimidos, reactivarEmail, type Suprimido } from '@/services/api/emails';

const MOTIVO_LABEL: Record<string, string> = {
  descartado_gerencia: 'Descartada por gerencia',
  bounce: 'Rebote',
  queja: 'Queja de spam',
  baja_usuario: 'Baja de marketing',
};

export function CorreosSuprimidosPage() {
  const [rows, setRows] = useState<Suprimido[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const res = await listarSuprimidos();
    setLoading(false);
    if (res.ok) setRows(res.data);
    else toast.error('No pudimos cargar las supresiones', { description: humanizeError(res.error) });
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.email.toLowerCase().includes(term) || (r.administracion_nombre ?? '').toLowerCase().includes(term),
    );
  }, [rows, q]);

  const hard = rows.filter((r) => r.es_hard).length;
  const soft = rows.length - hard;

  async function handleReactivar(email: string) {
    const okc = await confirm({
      title: 'Reactivar casilla',
      message: `¿Volver a enviarle correos a ${email}? Se quita de la lista de suprimidos y, si es un cliente, se le vuelve a habilitar el marketing.`,
      confirmLabel: 'Reactivar',
    });
    if (!okc) return;
    const res = await reactivarEmail(email);
    if (!res.ok) { toast.error('No pudimos reactivar', { description: humanizeError(res.error) }); return; }
    toast.success('Casilla reactivada · vuelve a recibir correos');
    void load();
  }

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      <header>
        <p className="kicker text-brand-cyan">Configuración · Emails</p>
        <h1 className="font-display text-2xl font-bold text-brand-ink">Correos suprimidos</h1>
        <p className="mt-1 text-sm text-brand-muted">
          Casillas que <strong>no reciben envíos</strong>. <span className="text-rose-700">Casilla muerta</span>{' '}
          (rebote/queja/descarte) = no se le manda <strong>nada</strong> (ni de servicio ni de novedades).{' '}
          <span className="text-amber-700">Baja de marketing</span> = sólo deja de recibir novedades/ofertas; el
          correo de servicio sigue. Podés <strong>reactivar</strong> cualquiera.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <MiniKpi label="Suprimidas" value={rows.length} icon={MailX} tone="slate" />
        <MiniKpi label="Casilla muerta" value={hard} icon={ShieldOff} tone="rose" />
        <MiniKpi label="Baja de marketing" value={soft} icon={BellOff} tone="amber" />
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Search size={15} className="text-brand-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por email o cliente…"
          className="w-full bg-transparent text-sm outline-none placeholder:text-brand-muted"
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-zebra/40 text-left text-xs uppercase tracking-wider text-brand-muted">
              <tr>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Motivo</th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Fecha</th>
                <th className="px-4 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="py-10 text-center text-brand-muted">
                  <Loader2 className="mx-auto animate-spin" size={18} />
                </td></tr>
              )}
              {!loading && visibles.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-brand-muted">
                  {rows.length === 0 ? 'No hay casillas suprimidas.' : 'Sin resultados para la búsqueda.'}
                </td></tr>
              )}
              {visibles.map((r) => (
                <tr key={r.email} className="border-t border-slate-100 hover:bg-brand-zebra/30">
                  <td className="px-4 py-2 font-medium text-brand-ink">
                    <p className="max-w-[260px] truncate" title={r.email}>{r.email}</p>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        r.es_hard ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700',
                      )}
                    >
                      {r.es_hard ? <ShieldOff size={11} /> : <BellOff size={11} />}
                      {r.es_hard ? 'Casilla muerta' : 'Baja de marketing'}
                    </span>
                    <p className="mt-0.5 text-[11px] text-brand-muted">
                      {MOTIVO_LABEL[r.motivo] ?? r.motivo}{r.origen ? ` · ${r.origen}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.administracion_id ? (
                      <Link to={`/gerencia/clientes/${r.administracion_id}`} className="text-brand-cyan hover:underline">
                        {r.administracion_nombre ?? 'Ver ficha'}
                      </Link>
                    ) : r.prospecto_id ? (
                      <span className="text-brand-muted">Prospecto</span>
                    ) : (
                      <span className="text-brand-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px] text-brand-muted">
                    {new Date(r.created_at).toLocaleDateString('es-AR')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void handleReactivar(r.email)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
                    >
                      <RotateCcw size={12} /> Reactivar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniKpi({
  label, value, icon: Icon, tone,
}: {
  label: string; value: number; icon: typeof MailX; tone: 'slate' | 'rose' | 'amber';
}) {
  const tones = {
    slate: 'border-slate-300/60 text-slate-600',
    rose: 'border-rose-300/60 text-rose-600',
    amber: 'border-amber-300/60 text-amber-600',
  }[tone];
  return (
    <div className="card-premium flex flex-col items-start gap-1 p-4">
      <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', tones)}>
        <Icon size={13} />
        {label}
      </div>
      <p className="font-display text-2xl font-bold tabular text-brand-ink">{value}</p>
    </div>
  );
}
