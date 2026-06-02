// ============================================================================
// ErroresRuntimePage · centro de errores capturados (DGG-38 / P2-#31)
//
// Equivalente al "issues feed" de Sentry, hospedado en la propia plataforma.
// Cada error agrupado por fingerprint (msg + top stack frame) con contador
// de ocurrencias. Botón "Marcar resuelto" oculta hasta que reaparezca.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  User2,
  Globe,
} from 'lucide-react';
import { Button, Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import {
  listErrores,
  marcarErrorResuelto,
  type ErrorRuntimeRow,
} from '@/services/api/errores';
import { humanizeError } from '@/lib/errors';

function relTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `hace ${d} d`;
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

export function ErroresRuntimePage() {
  const [items, setItems] = useState<ErrorRuntimeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    const r = await listErrores(!showResolved);
    if (r.ok) setItems(r.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [showResolved]);

  function toggle(id: string) {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function marcar(id: string) {
    const r = await marcarErrorResuelto(id);
    if (!r.ok) {
      toast.error('No pudimos marcar como resuelto', { description: humanizeError(r.error) });
      return;
    }
    toast.success('Error marcado como resuelto');
    void load();
  }

  const noResueltos = items.filter((e) => !e.resuelto_at).length;
  const ultimas24h = items.filter(
    (e) => Date.now() - new Date(e.last_seen).getTime() < 24 * 3600 * 1000,
  ).length;
  const usuariosAfectados = new Set(items.map((e) => e.user_id).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-rose-50/20 to-white p-6">
        <TrianglesAccent position="top-right" tone="cyan" density="soft" />
        <div className="relative">
          <p className="kicker text-rose-600">Salud técnica</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Errores en runtime
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Excepciones JS capturadas en el navegador de los usuarios. Cada
            uno se agrupa por <span className="font-mono text-[12px]">fingerprint</span>{' '}
            (mensaje + top stack) y se UPSERT con contador de ocurrencias.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="Sin resolver" value={noResueltos} icon={Bug} tone="rose" />
            <KpiTile label="Últimas 24 h" value={ultimas24h} icon={RefreshCcw} tone="amber" />
            <KpiTile label="Usuarios afectados" value={usuariosAfectados} icon={User2} tone="cyan" />
            <KpiTile label="Total tracked" value={items.length} icon={Globe} tone="ink" />
          </div>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-brand-muted">
          Vista
        </span>
        <button
          type="button"
          onClick={() => setShowResolved(false)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition',
            !showResolved
              ? 'bg-brand-cyan text-white shadow-sm'
              : 'border border-slate-200 bg-white text-brand-muted hover:text-brand-ink',
          )}
        >
          Sin resolver
        </button>
        <button
          type="button"
          onClick={() => setShowResolved(true)}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-semibold transition',
            showResolved
              ? 'bg-brand-cyan text-white shadow-sm'
              : 'border border-slate-200 bg-white text-brand-muted hover:text-brand-ink',
          )}
        >
          Todos (incluye resueltos)
        </button>
        <Button variant="ghost" onClick={load} className="ml-auto">
          <RefreshCcw size={13} /> Refrescar
        </Button>
      </section>

      <section className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <IllustratedEmpty
            illustration="lista"
            title="Sin errores capturados"
            description="Cuando algo se rompa en el navegador de un usuario, va a aparecer acá agrupado."
          />
        ) : (
          items.map((e) => {
            const isExp = expanded.has(e.id);
            const isRes = !!e.resuelto_at;
            return (
              <article
                key={e.id}
                className={cn(
                  'overflow-hidden rounded-xl border bg-white',
                  isRes ? 'border-slate-200 opacity-70' : 'border-rose-200',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(e.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                      isRes ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                    )}
                  >
                    {isRes ? <Check size={14} /> : <Bug size={14} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-brand-ink">
                      {e.message}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-brand-muted">
                      <span className="rounded-full bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700">
                        ×{e.count}
                      </span>
                      <span>·</span>
                      <span>último {relTime(e.last_seen)}</span>
                      {e.user_email && (
                        <>
                          <span>·</span>
                          <span>{e.user_email}</span>
                        </>
                      )}
                      {e.url && (
                        <>
                          <span>·</span>
                          <code className="font-mono text-[10.5px] text-slate-600">{e.url}</code>
                        </>
                      )}
                      <span>·</span>
                      <code className="font-mono text-[10px] text-slate-500">{e.fingerprint}</code>
                    </p>
                  </div>
                  {isExp ? <ChevronDown size={14} className="mt-1 text-brand-muted" /> :
                          <ChevronRight size={14} className="mt-1 text-brand-muted" />}
                </button>

                {isExp && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-4 text-xs">
                    {e.stack ? (
                      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
{e.stack}
                      </pre>
                    ) : (
                      <p className="italic text-brand-muted">Sin stack trace.</p>
                    )}
                    {e.user_agent && (
                      <p className="mt-2 text-[10.5px] text-brand-muted">
                        UA: <code className="font-mono">{e.user_agent}</code>
                      </p>
                    )}
                    {!isRes && (
                      <div className="mt-3 flex justify-end">
                        <Button onClick={() => void marcar(e.id)} variant="secondary">
                          <Check size={13} /> Marcar como resuelto
                        </Button>
                      </div>
                    )}
                    {isRes && (
                      <p className="mt-3 text-[11px] text-emerald-700">
                        ✓ Resuelto {relTime(e.resuelto_at!)}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Bug;
  tone: 'rose' | 'amber' | 'cyan' | 'ink';
}) {
  const colors = {
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-700',
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
    ink: 'bg-slate-100 text-slate-700',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3">
      <span className={cn('grid h-9 w-9 place-items-center rounded-xl', colors)}>
        <Icon size={15} />
      </span>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="text-xl font-bold tabular-nums text-brand-ink">{value}</p>
      </div>
    </div>
  );
}
