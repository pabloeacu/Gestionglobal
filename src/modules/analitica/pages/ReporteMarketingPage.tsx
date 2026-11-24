// ReporteMarketingPage · /gerencia/analitica/marketing (DGG-266)
// Reporte integral de automatización + marketing: TODOS los correos automáticos de la
// plataforma con sus datos de interés (envíos, entregabilidad, y engagement medido por
// CLICKS→VISITAS vía UTM — NO aperturas: mandamos por Gmail sin píxel, por entregabilidad).
// Fuente única: RPC reporte_semanal_data (la misma que consume el email semanal).
import { useEffect, useState } from 'react';
import {
  Send, MousePointerClick, AlertTriangle, Users, Megaphone, Newspaper, Target,
  Rocket, Bell, Wrench, Globe, Monitor, Loader2, Info,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import {
  getReporteSemanal, type ReporteSemanal, type ReporteCategoria, type ReporteCampana,
} from '@/services/api/reporteSemanal';

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}%`;

const CAT_LABEL: Record<string, string> = {
  newsletter: 'Newsletter LexPH',
  captacion: 'Captación PBA',
  ofrecimiento: 'Ofrecimientos a clientes',
  engagement: 'Engagement / onboarding',
  avisos_clientes: 'Avisos automáticos a clientes',
  transaccional: 'Transaccional / operativo',
};
const CAT_ICON: Record<string, typeof Newspaper> = {
  newsletter: Newspaper, captacion: Target, ofrecimiento: Megaphone,
  engagement: Rocket, avisos_clientes: Bell, transaccional: Wrench,
};
const esMarketing = (c: string) => ['newsletter', 'captacion', 'ofrecimiento', 'engagement'].includes(c);

export function ReporteMarketingPage() {
  const [dias, setDias] = useState(7);
  const [rep, setRep] = useState<ReporteSemanal | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    void getReporteSemanal(dias).then((r) => {
      if (cancelled) return;
      if (r.ok) setRep(r.data);
      else setErr(r.error.message);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [dias]);

  const t = rep?.totales;
  const traf = rep?.trafico;
  // Figura autoritativa (utm_medium=email, nivel proyecto). No usamos la suma por-campaña
  // (parcial) para no mostrar dos números distintos. 'n/d' honesto si no es medible.
  const visitasEmail = traf && traf.medicion_estado === 'ok' ? traf.desde_email : null;
  const medNoDisponible = !!rep && (!traf || traf.medicion_estado !== 'ok');

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-brand-cyan-pale/15 to-white p-6">
        <TrianglesAccent position="top-right" tone="cyan" density="rich" />
        <div className="relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="kicker text-brand-cyan">Automatización &amp; marketing</p>
              <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
                Reporte de correos automáticos
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-brand-muted">
                Todos los envíos automáticos de la plataforma, su entregabilidad y el
                engagement real (clicks&nbsp;→&nbsp;visitas por campaña).
              </p>
            </div>
            <div className="inline-flex shrink-0 overflow-hidden rounded-xl border border-slate-200">
              {[7, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDias(d)}
                  className={cn(
                    'px-3.5 py-1.5 text-xs font-semibold transition',
                    dias === d ? 'bg-brand-cyan text-white' : 'bg-white text-brand-muted hover:bg-slate-50',
                  )}
                >
                  {d === 7 ? '7 días' : '30 días'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Correos enviados" value={t ? fmt(t.enviados) : '—'} icon={Send} tone="cyan" sub={`últimos ${dias} días`} />
            <Kpi label="Tasa de rebote" value={t ? pct(t.rebote_pct) : '—'} icon={AlertTriangle} tone={(t?.rebote_pct ?? 0) > 2 ? 'rose' : 'emerald'} sub={t ? `${fmt(t.rebotes)} rebotes` : undefined} />
            <Kpi label="Visitas desde emails" value={loading ? '—' : visitasEmail == null ? 'n/d' : fmt(visitasEmail)} icon={MousePointerClick} tone="amber" sub="engagement (UTM)" />
            <Kpi label="Conversiones captación" value={rep ? fmt(rep.captacion.conversiones_semana) : '—'} icon={Users} tone="ink" sub={rep ? `${fmt(rep.captacion.conversiones_total)} en total` : undefined} />
          </div>
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-xs text-brand-muted">
        <Info size={14} className="mt-0.5 shrink-0 text-brand-cyan" />
        <span>
          El <strong>engagement se mide por clicks&nbsp;→&nbsp;visitas al sitio</strong> (vía UTM, lo que paga Vercel),
          no por aperturas: enviamos por Gmail sin píxel de tracking a propósito, para cuidar la entregabilidad.
          Los rebotes sí se trackean. {medNoDisponible && (
            <strong className="text-amber-700">Atención: la medición por campaña no está disponible ahora
            ({traf?.medicion_estado === 'sin_addon' ? 'add-on de Vercel' : traf?.medicion_estado === 'error' ? 'error de medición' : 'snapshot sin datos'}).</strong>
          )}
        </span>
      </p>

      {err ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{err}</div>
      ) : loading || !rep ? (
        <div className="flex items-center justify-center gap-2 py-12 text-brand-muted">
          <Loader2 size={16} className="animate-spin" /> Calculando el reporte…
        </div>
      ) : (
        <>
          {/* Marketing por categoría */}
          <Card title="Marketing por categoría" subtitle="Volumen y entregabilidad por tipo de campaña" icon={Megaphone} tone="cyan">
            <CategoriaTabla categorias={rep.categorias} />
          </Card>

          {/* Campañas (engagement) */}
          <Card title="Campañas · engagement" subtitle="Cada campaña: enviados, visitas que generó (UTM) y rebote" icon={Target} tone="amber">
            <CampanaTabla campanas={rep.campanas.filter((c) => esMarketing(c.categoria))} />
          </Card>

          {/* Tráfico + fuentes */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Tráfico del sitio" subtitle={`Visitas a /lexph · últimos ${dias} días`} icon={Newspaper} tone="emerald">
              {traf ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Visitantes" value={fmt(traf.visitantes)} />
                    <MiniStat label="Vistas" value={fmt(traf.vistas)} />
                    <MiniStat label="Desde el newsletter" value={traf.desde_newsletter == null ? 'n/d' : fmt(traf.desde_newsletter)} accent />
                    <MiniStat label="Desde emails (todo)" value={traf.desde_email == null ? 'n/d' : fmt(traf.desde_email)} accent />
                  </div>
                </div>
              ) : <Empty />}
            </Card>
            <Card title="De dónde llegan" subtitle="Referrers principales" icon={Globe} tone="violet">
              {rep.referrers.length === 0 ? <Empty /> : (
                <Barras data={rep.referrers.map((r) => ({ label: r.valor, value: r.visitantes }))} color="#8b5cf6" />
              )}
            </Card>
          </div>

          {/* Dispositivos + países */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Dispositivos" subtitle="Cómo nos visitan" icon={Monitor} tone="cyan">
              {Object.keys(rep.dispositivos).length === 0 ? <Empty /> : (
                <Barras data={Object.entries(rep.dispositivos).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => b.value - a.value)} color="#0e9bc8" />
              )}
            </Card>
            <Card title="Países" subtitle="Origen de las visitas" icon={Globe} tone="emerald">
              {rep.paises.length === 0 ? <Empty /> : (
                <Barras data={rep.paises.map((p) => ({ label: p.valor, value: p.visitantes }))} color="#10b981" />
              )}
            </Card>
          </div>

          {/* Avisos automáticos a clientes */}
          <Card title="Avisos automáticos a clientes" subtitle="Vencimientos, agenda/campus, tracking y servicio" icon={Bell} tone="rose">
            {rep.avisos_clientes.length === 0 ? <Empty /> : <TemplateTabla filas={rep.avisos_clientes} />}
          </Card>

          {/* Transaccional (plegable) */}
          <Card title="Transaccional / operativo" subtitle="Comprobantes, trámites, notificaciones internas…" icon={Wrench} tone="ink">
            {rep.transaccional.length === 0 ? <Empty /> : <TemplateTabla filas={rep.transaccional} />}
          </Card>

          <p className="text-center text-[11px] text-brand-muted">
            Generado {new Date(rep.generado_at).toLocaleString('es-AR')} · ventana {rep.ventana} ·
            {' '}{fmt(rep.totales.supresiones_nuevas)} supresiones nuevas en el período
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Kpi({ label, value, icon: Icon, tone, sub }: {
  label: string; value: string; icon: typeof Send; tone: 'cyan' | 'emerald' | 'amber' | 'ink' | 'rose'; sub?: string;
}) {
  const colors = {
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan', emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700', ink: 'bg-slate-100 text-slate-700', rose: 'bg-rose-50 text-rose-700',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', colors)}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="truncate text-lg font-bold tabular-nums text-brand-ink">{value}</p>
        {sub && <p className="truncate text-[10px] text-brand-muted">{sub}</p>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, icon: Icon, tone, children }: {
  title: string; subtitle: string; icon: typeof Send; tone: 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose' | 'ink'; children: React.ReactNode;
}) {
  const colors = {
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan', emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700', violet: 'bg-violet-50 text-violet-700',
    rose: 'bg-rose-50 text-rose-700', ink: 'bg-slate-100 text-slate-700',
  }[tone];
  return (
    <section className="card-premium relative overflow-hidden p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className={cn('grid h-9 w-9 place-items-center rounded-xl', colors)}><Icon size={15} /></span>
        <div>
          <h2 className="font-display text-base font-bold text-brand-ink">{title}</h2>
          <p className="text-[11.5px] text-brand-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="grid h-24 place-items-center text-xs text-brand-muted">Sin datos en el período</p>;
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={cn('mt-0.5 font-display text-lg font-bold tabular-nums', accent ? 'text-brand-cyan' : 'text-brand-ink')}>{value}</p>
    </div>
  );
}

function CategoriaTabla({ categorias }: { categorias: ReporteCategoria[] }) {
  const max = Math.max(1, ...categorias.map((c) => c.enviados));
  return (
    <ul className="space-y-2.5">
      {categorias.map((c) => {
        const Icon = CAT_ICON[c.categoria] ?? Wrench;
        return (
          <li key={c.categoria} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 font-medium text-brand-ink">
                <Icon size={13} className="shrink-0 text-brand-muted" />
                <span className="truncate">{CAT_LABEL[c.categoria] ?? c.categoria}</span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap tabular-nums text-brand-ink">
                <span className="font-semibold">{fmt(c.enviados)}</span>
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', c.rebote_pct > 2 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{pct(c.rebote_pct)} reb.</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-cyan transition-all" style={{ width: `${(c.enviados / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CampanaTabla({ campanas }: { campanas: ReporteCampana[] }) {
  if (campanas.length === 0) return <Empty />;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[480px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-brand-muted">
            <th className="px-2 py-2 font-semibold">Campaña</th>
            <th className="px-2 py-2 text-right font-semibold">Enviados</th>
            <th className="px-2 py-2 text-right font-semibold">Visitas</th>
            <th className="px-2 py-2 text-right font-semibold">CTR*</th>
            <th className="px-2 py-2 text-right font-semibold">Rebote</th>
          </tr>
        </thead>
        <tbody>
          {campanas.map((c) => {
            const ctr = c.enviados > 0 ? (c.visitas / c.enviados) * 100 : 0;
            return (
              <tr key={c.campana} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2">
                  <span className="font-medium text-brand-ink">{c.campana}</span>
                  <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] uppercase text-brand-muted">{CAT_LABEL[c.categoria]?.split(' ')[0] ?? c.categoria}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-brand-ink">{fmt(c.enviados)}</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold text-brand-cyan">{c.visitas > 0 ? fmt(c.visitas) : '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums text-brand-muted">{c.visitas > 0 ? pct(ctr) : '—'}</td>
                <td className="px-2 py-2 text-right tabular-nums text-brand-muted">{c.rebotes > 0 ? pct(c.rebote_pct) : '0%'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 px-2 text-[10px] text-brand-muted">* CTR estimado = visitas al sitio ÷ enviados. El UTM recién arranca, así que las campañas sin clicks aún muestran “—”.</p>
    </div>
  );
}

function TemplateTabla({ filas }: { filas: Array<{ template: string; enviados: number; rebotes: number }> }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[360px] text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wide text-brand-muted">
            <th className="px-2 py-2 font-semibold">Correo</th>
            <th className="px-2 py-2 text-right font-semibold">Enviados</th>
            <th className="px-2 py-2 text-right font-semibold">Rebotes</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.template} className="border-b border-slate-100 last:border-0">
              <td className="px-2 py-2 font-medium text-brand-ink">{f.template}</td>
              <td className="px-2 py-2 text-right tabular-nums text-brand-ink">{fmt(f.enviados)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-brand-muted">{f.rebotes > 0 ? fmt(f.rebotes) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Barras({ data, color }: { data: Array<{ label: string; value: number }>; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-2">
      {data.map((d, i) => (
        <li key={i} className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium text-brand-ink">{d.label}</span>
            <span className="whitespace-nowrap tabular-nums text-brand-ink">{fmt(d.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full transition-all" style={{ width: `${(d.value / max) * 100}%`, backgroundColor: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
