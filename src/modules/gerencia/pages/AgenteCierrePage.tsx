import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Briefcase,
  CheckCircle2,
  Eye,
  Gavel,
  GraduationCap,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Button, Field, Input, Switch, Paginador, PAGE_SIZE_DEFAULT, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import {
  correrAgenteCierre,
  getAgenteCierreConfig,
  listAgenteCierreRuns,
  previewAgenteCierre,
  setAgenteCierreActivo,
  setAgenteCierreCap,
  type AgenteCierreConfig,
  type AgenteCierreRun,
  type CierreDecision,
  type CierreItem,
  type CierreResumen,
  type CierreTrack,
} from '@/services/api/agenteCierre';

const TRACK_META: Record<CierreTrack, { label: string; icon: typeof Briefcase }> = {
  principal: { label: 'Matrícula · renovación · certificado', icon: Briefcase },
  juridica: { label: 'Consultas jurídicas', icon: Gavel },
  curso: { label: 'Cursos (RPAC/PBA)', icon: GraduationCap },
};

const DECISION_META: Record<CierreDecision, { label: string; cls: string }> = {
  cerrar_limpio: { label: 'Cerraría', cls: 'bg-green-50 text-green-700 ring-green-100' },
  reportar_revision: { label: 'A revisar', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  reportar_bloqueo: { label: 'Bloqueado', cls: 'bg-amber-50 text-amber-700 ring-amber-100' },
};

function fmtFechaHora(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function emptyTrack() {
  return { total: 0, limpios: 0, revision: 0, bloqueos: 0 };
}

export function AgenteCierrePage() {
  const { user } = useAuth();
  const esGerente = user?.role === 'gerente';
  const confirm = useConfirm();

  const [config, setConfig] = useState<AgenteCierreConfig | null>(null);
  const [capInput, setCapInput] = useState('');
  const [preview, setPreview] = useState<CierreItem[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [runs, setRuns] = useState<AgenteCierreRun[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(true);
  const [busyCorrer, setBusyCorrer] = useState(false);
  const [busyFlag, setBusyFlag] = useState(false);
  const pageSize = PAGE_SIZE_DEFAULT;

  async function loadConfig() {
    const r = await getAgenteCierreConfig();
    if (r.ok) { setConfig(r.data); setCapInput(String(r.data.cap)); }
    else toast.error('No pudimos leer la configuración', { description: humanizeError(r.error) });
  }
  async function loadPreview() {
    setPreviewLoading(true);
    const r = await previewAgenteCierre();
    setPreviewLoading(false);
    if (r.ok) setPreview(r.data);
    else toast.error('No pudimos calcular la vista previa', { description: humanizeError(r.error) });
  }
  async function loadRuns() {
    setRunsLoading(true);
    const r = await listAgenteCierreRuns(page, pageSize);
    setRunsLoading(false);
    if (r.ok) { setRuns(r.data.rows); setRunsTotal(r.data.total); }
    else toast.error('No pudimos cargar el historial', { description: humanizeError(r.error) });
  }

  useEffect(() => { void loadConfig(); void loadPreview(); }, []);
  useEffect(() => { void loadRuns(); }, [page]);

  const counts = useMemo(() => {
    const items = preview ?? [];
    const perTrack = (t: CierreTrack) => {
      const ti = items.filter((i) => i.track === t);
      return {
        total: ti.length,
        limpios: ti.filter((i) => i.decision === 'cerrar_limpio').length,
        revision: ti.filter((i) => i.decision === 'reportar_revision').length,
        bloqueos: ti.filter((i) => i.decision === 'reportar_bloqueo').length,
      };
    };
    return {
      total: items.length,
      limpios: items.filter((i) => i.decision === 'cerrar_limpio').length,
      revision: items.filter((i) => i.decision === 'reportar_revision').length,
      bloqueos: items.filter((i) => i.decision === 'reportar_bloqueo').length,
      tracks: {
        principal: items.length ? perTrack('principal') : emptyTrack(),
        juridica: items.length ? perTrack('juridica') : emptyTrack(),
        curso: items.length ? perTrack('curso') : emptyTrack(),
      } as Record<CierreTrack, ReturnType<typeof perTrack>>,
    };
  }, [preview]);

  const accionables = useMemo(
    () => (preview ?? []).filter((i) => i.decision === 'cerrar_limpio' || i.decision === 'reportar_bloqueo'),
    [preview],
  );

  async function onCorrer() {
    const real = config?.activo ?? false;
    const n = counts.limpios;
    const msg = real
      ? `Vas a cerrar AHORA ${n} trámite(s) 100% verificado(s) y avisarles a sus clientes por mail. Los bloqueados y los "a revisar" NO se tocan.`
      : 'El equipo está en modo simulación (cierre automático apagado): no cierra nada, sólo genera el reporte y te lo manda por mail.';
    const okc = await confirm({
      title: real ? 'Correr el equipo de cierre' : 'Correr simulación',
      message: msg,
      confirmLabel: real ? 'Cerrar ahora' : 'Simular',
      cancelLabel: 'Cancelar',
      danger: real,
    });
    if (!okc) return;
    setBusyCorrer(true);
    const res = await correrAgenteCierre();
    setBusyCorrer(false);
    if (res.ok) {
      const r = res.data.resumen;
      toast.success(
        r.modo === 'real' ? `Cerré ${r.cerrados} trámite(s)` : `Simulación lista · cerraría ${r.cerrar_limpio}`,
        { description: `Detectados ${r.total} · a revisar ${r.reportar_revision} · bloqueados ${r.reportar_bloqueo}. Te mandé el reporte por mail.` },
      );
      void loadPreview(); void loadRuns(); void loadConfig();
    } else toast.error('No pudimos correr el equipo', { description: humanizeError(res.error) });
  }

  async function onToggleActivo(next: boolean) {
    const okc = await confirm({
      title: next ? 'Activar el cierre automático' : 'Pausar el cierre automático',
      message: next
        ? 'El equipo volverá a cerrar automáticamente los trámites verificados en cada corrida (el comando manual y la corrida diaria de las 10:00).'
        : 'El equipo deja de cerrar: sólo va a reportar (modo simulación) hasta que lo vuelvas a activar.',
      confirmLabel: next ? 'Activar' : 'Pausar',
      cancelLabel: 'No',
      danger: next,
    });
    if (!okc) return;
    setBusyFlag(true);
    const res = await setAgenteCierreActivo(next);
    setBusyFlag(false);
    if (res.ok) { setConfig(res.data); toast.success(next ? 'Cierre automático activado' : 'Cierre automático pausado'); }
    else toast.error('No pudimos cambiar el estado', { description: humanizeError(res.error) });
  }

  async function onSaveCap() {
    const cap = parseInt(capInput, 10);
    if (!Number.isFinite(cap) || cap < 1 || cap > 500) { toast.error('El tope debe ser un número entre 1 y 500'); return; }
    if (cap === config?.cap) return;
    setBusyFlag(true);
    const res = await setAgenteCierreCap(cap);
    setBusyFlag(false);
    if (res.ok) { setConfig(res.data); toast.success(`Tope actualizado: ${cap} por corrida`); }
    else toast.error('No pudimos actualizar el tope', { description: humanizeError(res.error) });
  }

  const activo = config?.activo ?? false;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Operación</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Cierre automático de trámites</h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Un equipo que corre solo todos los días a las 10:00 y cierra los trámites resueltos hace más de 25 días
            que están 100% verificados, avisándole al cliente. Lo que no está limpio, te lo reporta. Anda con la
            computadora apagada.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void loadPreview()} loading={previewLoading}>
            <RefreshCw size={14} /> Actualizar
          </Button>
          <Button variant="primary" onClick={() => void onCorrer()} loading={busyCorrer} disabled={previewLoading}>
            <Play size={14} /> Correr ahora
          </Button>
        </div>
      </header>

      {/* Panel de estado */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/20">
              <Bot size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-ink">Equipo de cierre</p>
              <p className="text-xs text-brand-muted">Corrida diaria 10:00 (hora Argentina) · tope {config?.cap ?? '—'} por corrida</p>
            </div>
            <span
              className={cn(
                'ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1',
                activo ? 'bg-green-50 text-green-700 ring-green-100' : 'bg-amber-50 text-amber-700 ring-amber-100',
              )}
            >
              {activo ? 'Cierre automático activo' : 'En simulación (no cierra)'}
            </span>
          </div>

          {esGerente && config && (
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                checked={activo}
                onChange={(next) => void onToggleActivo(next)}
                label="Cierre automático"
                size="sm"
              />
              <div className="flex items-end gap-1.5">
                <Field label="Tope / corrida" className="w-24">
                  <Input
                    type="number"
                    value={capInput}
                    onChange={(e) => setCapInput(e.target.value)}
                    min={1}
                    max={500}
                  />
                </Field>
                <Button variant="secondary" onClick={() => void onSaveCap()} loading={busyFlag} disabled={capInput === String(config.cap)}>
                  Guardar
                </Button>
              </div>
            </div>
          )}
        </div>

        {!activo && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            El cierre automático está apagado. El equipo detecta y reporta, pero no cierra ningún trámite hasta que lo actives.
          </div>
        )}
      </div>

      {/* Vista previa: qué haría ahora */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Qué haría ahora mismo</h2>
          {previewLoading && <Loader2 size={14} className="animate-spin text-brand-muted" />}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Detectados" value={counts.total} icon={Briefcase} tone="navy" hint="Resueltos +25 días" />
          <KpiCard label={activo ? 'Cerraría ahora' : 'Cerraría al activar'} value={counts.limpios} icon={CheckCircle2} tone="green" hint="100% verificados" />
          <KpiCard label="A revisar" value={counts.revision} icon={Eye} tone="navy" hint="Quedan para vos" />
          <KpiCard label="Bloqueados" value={counts.bloqueos} icon={ShieldAlert} tone="amber" hint="Amortiguador" />
        </div>

        {/* Desglose por track */}
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TRACK_META) as CierreTrack[]).map((t) => {
            const meta = TRACK_META[t];
            const tc = counts.tracks[t];
            const Icon = meta.icon;
            return (
              <div key={t} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <Icon size={14} className="text-brand-cyan" />
                  <p className="text-xs font-semibold text-brand-ink">{meta.label}</p>
                </div>
                <p className="mt-1.5 text-[11px] text-brand-muted tabular-nums">
                  {tc.total} detectados · <span className="font-semibold text-green-700">{tc.limpios} cerraría</span> · {tc.revision} a revisar · {tc.bloqueos} bloqueados
                </p>
              </div>
            );
          })}
        </div>

        {/* Lista accionable (cerraría + bloqueados). Los "a revisar" quedan fuera para no hacer ruido. */}
        {!previewLoading && accionables.length === 0 && (
          <IllustratedEmpty
            title="Nada para cerrar ahora"
            description="No hay trámites verificados listos para cerrar ni bloqueos pendientes. El equipo seguirá mirando en cada corrida."
          />
        )}
        {accionables.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Decisión</Th>
                  <Th>Cliente</Th>
                  <Th>Trámite</Th>
                  <Th>Motivo</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {accionables.map((it) => (
                  <tr key={it.tramite_id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', DECISION_META[it.decision].cls)}>
                        {DECISION_META[it.decision].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-brand-ink">{it.cliente}</td>
                    <td className="px-3 py-2 text-brand-muted">{it.servicio ?? it.categoria}</td>
                    <td className="px-3 py-2 text-xs text-brand-muted">{it.cierre?.motivo ?? it.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {counts.tracks.curso.revision > 0 && (
          <p className="text-xs text-brand-muted">
            + {counts.tracks.curso.revision} cursos en marcha (sin acción: egresados esperando los 30 días del certificado, o todavía cursando).
          </p>
        )}
      </section>

      {/* Historial de corridas */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-brand-ink">Historial de corridas</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Cuándo</Th>
                <Th>Origen</Th>
                <Th>Modo</Th>
                <Th>Detectados</Th>
                <Th>Cerrados</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {runsLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-brand-muted"><Loader2 size={16} className="mx-auto animate-spin" /></td></tr>
              )}
              {!runsLoading && runs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-brand-muted">Todavía no corrió ninguna vez.</td></tr>
              )}
              {!runsLoading && runs.map((run) => {
                const r = (run.resumen ?? null) as unknown as CierreResumen | null;
                return (
                  <tr key={run.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 tabular-nums text-brand-ink">{fmtFechaHora(run.run_at)}</td>
                    <td className="px-3 py-2 text-brand-muted">{run.origen === 'cron' ? 'Automático' : 'Manual'}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1', run.modo === 'real' ? 'bg-green-50 text-green-700 ring-green-100' : 'bg-slate-100 text-slate-600 ring-slate-200')}>
                        {run.modo === 'real' ? 'Real' : 'Simulación'}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-brand-muted">{r?.total ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-brand-ink">{r?.cerrados ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-brand-muted">{run.overall === 'sin_candidatos' ? 'Sin candidatos' : 'OK'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {runsTotal > pageSize && (
          <Paginador page={page} pageSize={pageSize} total={runsTotal} onPage={setPage} />
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tone, hint }: {
  label: string; value: number | string; icon: typeof Briefcase; tone: 'cyan' | 'green' | 'navy' | 'amber'; hint?: string;
}) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-brand-ink">
        {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-brand-muted">{hint}</p>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
      {children}
    </th>
  );
}
