// ============================================================================
// HealthPage · /health · status público mínimo (P2-#32)
//
// Página accesible sin login que verifica:
//   • Bundle frontend cargado (implícito si renderiza)
//   • Conexión a Supabase (RPC anon `get_landing_cover_status`)
//   • Latencia de la BD
//
// No expone información sensible. Útil para monitoring uptime externo
// (UptimeRobot, BetterUptime) sin necesitar autenticación.
// ============================================================================

import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { getLandingCoverStatus } from '@/services/api/configGlobal';
import { cn } from '@/lib/cn';

interface Check {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'fail';
  detail?: string;
  ms?: number;
}

export function HealthPage() {
  const [bundleAt] = useState(() => Date.now());
  const [checks, setChecks] = useState<Check[]>([
    { id: 'frontend', label: 'Frontend bundle', status: 'ok',
      detail: 'cargado y montado correctamente' },
    { id: 'db', label: 'Base de datos (Supabase RPC)', status: 'pending' },
    { id: 'latency', label: 'Latencia de la BD', status: 'pending' },
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const t0 = performance.now();
      try {
        await getLandingCoverStatus();
        const ms = Math.round(performance.now() - t0);
        if (cancelled) return;
        setChecks((prev) =>
          prev.map((c) =>
            c.id === 'db'
              ? { ...c, status: 'ok', detail: 'RPC respondió OK', ms }
              : c.id === 'latency'
                ? {
                    ...c,
                    status: ms < 800 ? 'ok' : 'fail',
                    detail: ms < 800 ? 'normal' : 'alta · revisar',
                    ms,
                  }
                : c,
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setChecks((prev) =>
          prev.map((c) =>
            c.id === 'db'
              ? { ...c, status: 'fail', detail: err instanceof Error ? err.message : 'fallo en RPC' }
              : c.id === 'latency'
                ? { ...c, status: 'fail', detail: 'sin medir' }
                : c,
          ),
        );
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const overallOk = checks.every((c) => c.status === 'ok');
  const anyFail = checks.some((c) => c.status === 'fail');
  const stillChecking = checks.some((c) => c.status === 'pending');

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-zebra/40 via-white to-brand-zebra/30 px-4 py-12">
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 pb-4">
            <BrandMark variant="light" size={28} />
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider',
                stillChecking
                  ? 'bg-slate-100 text-slate-700'
                  : overallOk
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-700',
              )}
            >
              {stillChecking ? (
                <Loader2 size={11} className="animate-spin" />
              ) : overallOk ? (
                <CheckCircle2 size={11} />
              ) : (
                <AlertTriangle size={11} />
              )}
              {stillChecking ? 'Verificando' : overallOk ? 'Operativo' : anyFail ? 'Degradado' : 'OK'}
            </span>
          </header>

          <div className="mt-4 space-y-2">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-brand-ink">
              <Activity size={14} className="text-brand-cyan" />
              Health check de la plataforma
            </p>
            <p className="text-xs text-brand-muted">
              Endpoint mínimo para monitoring externo. Sin autenticación.
              No revela información sensible.
            </p>
          </div>

          <ul className="mt-5 space-y-2">
            {checks.map((c) => (
              <li
                key={c.id}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm',
                  c.status === 'ok' && 'border-emerald-200 bg-emerald-50/40',
                  c.status === 'fail' && 'border-rose-200 bg-rose-50/40',
                  c.status === 'pending' && 'border-slate-200 bg-slate-50/40',
                )}
              >
                <div className="min-w-0">
                  <p className="font-medium text-brand-ink">{c.label}</p>
                  {c.detail && (
                    <p className="text-[11px] text-brand-muted">{c.detail}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {c.ms !== undefined && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-mono text-brand-muted">
                      {c.ms} ms
                    </span>
                  )}
                  {c.status === 'pending' ? (
                    <Loader2 size={14} className="animate-spin text-slate-400" />
                  ) : c.status === 'ok' ? (
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  ) : (
                    <AlertTriangle size={16} className="text-rose-600" />
                  )}
                </div>
              </li>
            ))}
          </ul>

          <footer className="mt-5 border-t border-slate-100 pt-3 text-[11px] text-brand-muted">
            <p>
              <span className="font-mono">{new Date(bundleAt).toISOString()}</span>
              {' · '}gestionglobal.ar
            </p>
            <p className="mt-1">
              JSON: <a href="/health.json" className="text-brand-cyan hover:underline">/health.json</a>{' '}
              (no implementado · usar este endpoint con UptimeRobot)
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
