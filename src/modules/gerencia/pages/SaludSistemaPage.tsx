// SaludSistemaPage · Panel de salud de la BD + storage.
// Muestra al gerente cómo viene el consumo del plan Pro de Supabase, alertas
// si algo se acerca al límite, y permite tomar decisiones (subir plan,
// limpiar adjuntos viejos).
//
// Acceso: solo staff. La RPC tira 42501 si no.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  HardDrive,
  Activity,
  Gauge,
  RefreshCw,
  ChevronRight,
  Info,
} from 'lucide-react';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import {
  getDbHealthMetrics,
  type DbHealthPayload,
  type AlertSeverity,
} from '@/services/api/dbHealth';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function colorByPct(pct: number, invert = false) {
  // pct: % uso si invert=false; o % salud si invert=true (>95 es bueno)
  const eff = invert ? 100 - pct : pct;
  if (eff >= 90) return 'rose';
  if (eff >= 80) return 'amber';
  return 'emerald';
}

export function SaludSistemaPage() {
  const [data, setData] = useState<DbHealthPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getDbHealthMetrics();
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const capturedAt = useMemo(() => {
    if (!data) return '';
    try {
      return new Date(data.captured_at).toLocaleString('es-AR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return data.captured_at;
    }
  }, [data]);

  if (loading && !data) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Diagnosticando la base" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8 text-center">
        <p className="kicker text-rose-500">No se pudo cargar el diagnóstico</p>
        <p className="text-sm text-brand-muted">{error}</p>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white"
        >
          <RefreshCw size={14} /> Reintentar
        </button>
      </div>
    );
  }

  if (!data) return null;

  const dbColor = colorByPct(data.db.usage_pct);
  const storageColor = colorByPct(data.storage_total.usage_pct);
  const cacheColor = colorByPct(data.db.cache_hit_pct ?? 100, true);
  const connColor = colorByPct(data.db.connections_pct);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Diagnóstico técnico</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Salud del sistema
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Estado de la base de datos y storage frente a los límites del plan
            {' '}<span className="font-semibold text-brand-ink">{data.pro_plan.plan_name}</span>.
            Capturado el {capturedAt}.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan/40 hover:bg-brand-cyan/5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </header>

      {/* ALERTAS */}
      {data.alerts.length > 0 && (
        <section className="space-y-2">
          {data.alerts.map((a, i) => (
            <AlertBanner key={i} severity={a.severity} message={a.message} />
          ))}
        </section>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Database size={18} />}
          label="Base de datos"
          value={data.db.size_pretty}
          subtitle={`${data.db.usage_pct.toFixed(2)}% del límite (${formatBytes(data.pro_plan.db_limit_bytes)})`}
          progressPct={data.db.usage_pct}
          tone={dbColor}
        />
        <KpiCard
          icon={<HardDrive size={18} />}
          label="Storage"
          value={data.storage_total.pretty}
          subtitle={`${data.storage_total.usage_pct.toFixed(2)}% del límite (${formatBytes(data.pro_plan.storage_limit_bytes)})`}
          progressPct={data.storage_total.usage_pct}
          tone={storageColor}
        />
        <KpiCard
          icon={<Gauge size={18} />}
          label="Cache hit"
          value={`${data.db.cache_hit_pct?.toFixed(1) ?? '—'}%`}
          subtitle={`Index hit ${data.db.index_hit_pct?.toFixed(1) ?? '—'}%`}
          progressPct={data.db.cache_hit_pct ?? 0}
          tone={cacheColor}
          invertProgress
        />
        <KpiCard
          icon={<Activity size={18} />}
          label="Conexiones"
          value={`${data.db.connections_active} / ${data.db.connections_max}`}
          subtitle={`${data.db.connections_pct.toFixed(1)}% del máximo`}
          progressPct={data.db.connections_pct}
          tone={connColor}
        />
      </section>

      {/* TOP 10 TABLAS */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative space-y-3 p-5">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold text-brand-ink">
              Tablas más pesadas
            </h2>
            <span className="text-xs text-brand-muted">
              · ordenadas por tamaño total (incluye índices)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <th className="px-3 py-2">Tabla</th>
                  <th className="px-3 py-2 text-right">Filas</th>
                  <th className="px-3 py-2 text-right">Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {data.tables_top10.map((t) => (
                  <tr key={t.tabla} className="border-b border-slate-100 hover:bg-brand-zebra/30">
                    <td className="px-3 py-2 font-mono text-xs text-brand-ink">{t.tabla}</td>
                    <td className="px-3 py-2 text-right tabular text-brand-muted">
                      {t.filas_estimadas.toLocaleString('es-AR')}
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium text-brand-ink">
                      {t.pretty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* STORAGE BUCKETS */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-20"
        />
        <div className="relative space-y-3 p-5">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold text-brand-ink">
              Buckets de storage
            </h2>
            <span className="text-xs text-brand-muted">
              · adjuntos de formularios, trámites, campus, certificados
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <th className="px-3 py-2">Bucket</th>
                  <th className="px-3 py-2 text-center">Visibilidad</th>
                  <th className="px-3 py-2 text-right">Archivos</th>
                  <th className="px-3 py-2 text-right">Tamaño</th>
                </tr>
              </thead>
              <tbody>
                {data.storage_buckets.map((b) => (
                  <tr key={b.bucket} className="border-b border-slate-100 hover:bg-brand-zebra/30">
                    <td className="px-3 py-2 font-mono text-xs text-brand-ink">{b.bucket}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        b.public
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700',
                      )}>
                        {b.public ? 'pública' : 'privada'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular text-brand-muted">
                      {b.file_count.toLocaleString('es-AR')}
                    </td>
                    <td className="px-3 py-2 text-right tabular font-medium text-brand-ink">
                      {b.pretty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* AYUDA: cuándo subir el plan */}
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
            <Info size={18} />
          </span>
          <div className="space-y-2 text-sm text-brand-ink">
            <p className="font-semibold">¿Cuándo conviene subir de plan?</p>
            <ul className="list-disc space-y-1 pl-5 text-brand-muted">
              <li>
                Si la <strong>base de datos</strong> supera el 80% del límite. El siguiente paso
                ($25 → $599 mes para Team) te lleva a 32 GB.
              </li>
              <li>
                Si el <strong>storage</strong> de adjuntos supera el 80%, considerá primero
                limpiar archivos viejos o pasar PDFs históricos a un bucket externo (R2/S3).
              </li>
              <li>
                Si las <strong>conexiones activas</strong> pasan el 80% sostenido, el problema
                suele ser un leak — revisar que el front cierre subscriptions de realtime.
              </li>
              <li>
                Si <strong>cache hit</strong> o <strong>index hit</strong> bajan de 95%, hay falta
                de RAM o índices faltantes — antes de subir el plan, revisar las advisor
                recommendations.
              </li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// Components
// ============================================================================

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  progressPct: number;
  tone: 'emerald' | 'amber' | 'rose';
  invertProgress?: boolean;
}

function KpiCard({ icon, label, value, subtitle, progressPct, tone, invertProgress }: KpiCardProps) {
  const toneClasses = {
    emerald: { bar: 'bg-emerald-500', icon: 'bg-emerald-50 text-emerald-600' },
    amber: { bar: 'bg-amber-500', icon: 'bg-amber-50 text-amber-600' },
    rose: { bar: 'bg-rose-500', icon: 'bg-rose-50 text-rose-600' },
  }[tone];

  const visiblePct = invertProgress ? progressPct : Math.min(progressPct, 100);

  return (
    <div className="card-premium relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="kicker text-brand-muted">{label}</p>
          <p className="font-display text-2xl font-bold text-brand-ink">{value}</p>
        </div>
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', toneClasses.icon)}>
          {icon}
        </span>
      </div>
      <p className="mt-1 text-xs text-brand-muted">{subtitle}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full transition-all', toneClasses.bar)}
          style={{ width: `${visiblePct}%` }}
        />
      </div>
    </div>
  );
}

interface AlertBannerProps {
  severity: AlertSeverity;
  message: string;
}

function AlertBanner({ severity, message }: AlertBannerProps) {
  const styles = severity === 'critical'
    ? { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800', icon: 'text-rose-600' }
    : { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-800', icon: 'text-amber-600' };

  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border p-3', styles.bg, styles.border)}>
      <AlertTriangle size={18} className={cn('shrink-0 mt-0.5', styles.icon)} />
      <div className={cn('flex-1 text-sm font-medium', styles.text)}>{message}</div>
      <ChevronRight size={16} className={styles.icon} />
    </div>
  );
}
