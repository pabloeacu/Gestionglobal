// EncuestasCmPage · DGG-240
// Configuración del digest periódico de encuestas de satisfacción al Community
// Manager: destinatario(s), cadencia, on/off, "enviar ahora" y auditoría de
// corridas. Las descargas por curso y rango viven en cada encuesta
// (Campus → curso → Encuesta → Respuestas).

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  RefreshCw,
  Send,
} from 'lucide-react';
import { Button, Field, Input, Switch, Tabs, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { LandingOpinionesManager } from '../components/LandingOpinionesManager';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import { useAuth } from '@/contexts/AuthContext';
import {
  enviarDigestCmAhora,
  getEncuestaCmEstado,
  listEncuestaCmRuns,
  setEncuestaCmConfig,
  type EncuestaCmEstado,
  type EncuestaCmRun,
} from '@/services/api/encuestasCm';

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
function fmtDia(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function cuentaEmails(s: string): number {
  return s.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean).length;
}

export function EncuestasCmPage() {
  const { user } = useAuth();
  const esGerente = user?.role === 'gerente';
  const confirm = useConfirm();

  const [estado, setEstado] = useState<EncuestaCmEstado | null>(null);
  const [emailsInput, setEmailsInput] = useState('');
  const [diasInput, setDiasInput] = useState('');
  const [runs, setRuns] = useState<EncuestaCmRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyEnvio, setBusyEnvio] = useState(false);
  const [subtab, setSubtab] = useState<'cm' | 'landing'>(() => {
    try { return new URLSearchParams(window.location.search).get('tab') === 'landing' ? 'landing' : 'cm'; }
    catch { return 'cm'; }
  });

  async function load(opts?: { keepEmails?: boolean }) {
    const [e, r] = await Promise.all([getEncuestaCmEstado(), listEncuestaCmRuns(10)]);
    if (e.ok) {
      setEstado(e.data);
      // no pisar lo que el gerente esté tipeando (sólo en la carga inicial / tras Guardar emails)
      if (!opts?.keepEmails) setEmailsInput(e.data.emails ?? '');
      setDiasInput(String(e.data.cada_dias ?? 30));
    } else toast.error('No pudimos leer la configuración', { description: humanizeError(e.error) });
    if (r.ok) setRuns(r.data);
    setLoading(false);
  }

  useEffect(() => {
    if (esGerente) void load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emailsCount = useMemo(() => cuentaEmails(emailsInput), [emailsInput]);
  // Los guards miran los emails GUARDADOS (config_global), no el input en pantalla.
  const emailsGuardadosCount = useMemo(() => cuentaEmails(estado?.emails ?? ''), [estado]);
  const activo = estado?.activo ?? false;
  const emailsDirty = (estado?.emails ?? '') !== emailsInput;
  const diasDirty = String(estado?.cada_dias ?? 30) !== diasInput;

  async function onGuardarEmails() {
    const tokens = emailsInput.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
    const invalidos = tokens.filter((t) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t));
    if (tokens.length > 0 && invalidos.length === tokens.length) {
      toast.error('Ningún mail tiene formato válido', { description: invalidos.join(', ') });
      return;
    }
    setBusy(true);
    const res = await setEncuestaCmConfig({ emails: emailsInput.trim() });
    setBusy(false);
    if (res.ok) {
      toast.success('Destinatarios guardados', invalidos.length
        ? { description: `Se ignoran ${invalidos.length} con formato inválido: ${invalidos.join(', ')}` }
        : undefined);
      void load();
    } else toast.error('No pudimos guardar', { description: humanizeError(res.error) });
  }

  async function onGuardarDias() {
    const d = parseInt(diasInput, 10);
    if (!Number.isFinite(d) || d < 1 || d > 365) { toast.error('La cadencia debe estar entre 1 y 365 días'); return; }
    setBusy(true);
    const res = await setEncuestaCmConfig({ cada_dias: d });
    setBusy(false);
    if (res.ok) { toast.success(`Cadencia: cada ${d} días`); void load({ keepEmails: true }); }
    else toast.error('No pudimos guardar', { description: humanizeError(res.error) });
  }

  async function onToggle(next: boolean) {
    // Guard sobre lo GUARDADO, no el input: evita activar con emails tipeados pero sin Guardar.
    if (next && emailsDirty) { toast.error('Guardá los mails del CM antes de activar'); return; }
    if (next && emailsGuardadosCount === 0) { toast.error('Cargá al menos un mail del CM antes de activar'); return; }
    const okc = await confirm({
      title: next ? 'Activar el envío automático' : 'Pausar el envío automático',
      message: next
        ? `El CM va a recibir un resumen cada ${estado?.cada_dias ?? 30} días con los cursos que tengan respuestas nuevas.`
        : 'Se pausa el envío automático. Podés seguir descargando por curso cuando quieras.',
      confirmLabel: next ? 'Activar' : 'Pausar',
      cancelLabel: 'No',
      danger: false,
    });
    if (!okc) return;
    setBusy(true);
    const res = await setEncuestaCmConfig({ activo: next });
    setBusy(false);
    if (res.ok) { toast.success(next ? 'Envío automático activado' : 'Envío automático pausado'); void load({ keepEmails: true }); }
    else toast.error('No pudimos cambiar el estado', { description: humanizeError(res.error) });
  }

  async function onEnviarAhora() {
    if (emailsDirty) { toast.error('Guardá los cambios de mail antes de enviar'); return; }
    if (emailsGuardadosCount === 0) { toast.error('Cargá al menos un mail del CM'); return; }
    const okc = await confirm({
      title: 'Enviar el resumen ahora',
      message: `Se le va a mandar el resumen (PDF + Excel) a ${emailsGuardadosCount} destinatario(s) del CM con las respuestas pendientes. Esto cuenta como el disparo del período y reinicia el reloj.`,
      confirmLabel: 'Enviar ahora',
      cancelLabel: 'Cancelar',
      danger: false,
    });
    if (!okc) return;
    setBusyEnvio(true);
    const res = await enviarDigestCmAhora();
    setBusyEnvio(false);
    if (res.ok) {
      if (res.data.sin_novedad) toast.success('No había respuestas nuevas: no se envió nada.');
      else if (res.data.overall && res.data.overall !== 'ok') toast.error('No se encoló el envío', { description: `Estado: ${res.data.overall}` });
      else toast.success(`Resumen enviado · ${res.data.cursos ?? 0} curso(s), ${res.data.respuestas ?? 0} respuesta(s).`);
      void load({ keepEmails: true });
    } else toast.error('No pudimos enviar', { description: humanizeError(res.error) });
  }

  if (loading) {
    return <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-brand-muted" /></div>;
  }

  if (!esGerente) {
    return (
      <div className="space-y-6">
        <header>
          <p className="kicker">Configuración · Encuestas</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Envío de encuestas al Community Manager</h1>
        </header>
        <IllustratedEmpty
          title="Sección exclusiva de gerencia"
          description="La configuración del envío al CM la administran los gerentes. Las descargas por curso están en cada encuesta (Campus → curso → Encuesta → Respuestas)."
        />
      </div>
    );
  }

  const prev = estado?.preview ?? { cursos: 0, respuestas: 0, publicables: 0 };

  return (
    <div className="space-y-6">
      <Tabs
        items={[{ key: 'cm', label: 'Envío al CM' }, { key: 'landing', label: 'Sección de la landing' }]}
        activeKey={subtab}
        onChange={(k) => setSubtab(k as 'cm' | 'landing')}
      />
      {subtab === 'landing' ? (
        <LandingOpinionesManager />
      ) : (
      <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Configuración · Encuestas</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Envío de encuestas al Community Manager
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cada {estado?.cada_dias ?? 30} días el CM recibe por mail un resumen de los cursos con respuestas
            nuevas: un PDF con gráficos, estrellas y testimonios, y un Excel con los datos por filas. Los casos
            que el alumno autorizó a publicar van identificados; el resto suma como volumen estadístico, sin
            nombrarlos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void load()}>
            <RefreshCw size={14} /> Actualizar
          </Button>
          <Button variant="primary" onClick={() => void onEnviarAhora()} loading={busyEnvio} disabled={!esGerente}>
            <Send size={14} /> Enviar ahora
          </Button>
        </div>
      </header>

      {/* Panel de estado + config */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/20">
              <Mail size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-brand-ink">Resumen periódico al CM</p>
              <p className="text-xs text-brand-muted tabular-nums">
                Cada {estado?.cada_dias ?? 30} días · último envío {fmt(estado?.ultimo_envio_at ?? null)} · próximo{' '}
                {!activo ? '—' : estado?.ultimo_envio_at ? fmtDia(estado?.proximo_envio_at ?? null) : 'en la próxima corrida'}
              </p>
            </div>
            <span
              className={cn(
                'ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1',
                activo ? 'bg-green-50 text-green-700 ring-green-100' : 'bg-amber-50 text-amber-700 ring-amber-100',
              )}
            >
              {activo ? 'Envío automático activo' : 'Desactivado'}
            </span>
          </div>

          {esGerente && (
            <div className="flex flex-wrap items-center gap-3">
              <Switch checked={activo} onChange={(n) => void onToggle(n)} label="Envío automático" size="sm" />
              <div className="flex items-end gap-1.5">
                <Field label="Cada (días)" className="w-24">
                  <Input type="number" value={diasInput} min={1} max={365} onChange={(e) => setDiasInput(e.target.value)} />
                </Field>
                <Button variant="secondary" onClick={() => void onGuardarDias()} loading={busy} disabled={!diasDirty}>
                  Guardar
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Campo del/los mail(s) del CM */}
        <div className="mt-4 rounded-xl border-2 border-brand-cyan/30 bg-brand-cyan/5 p-3.5">
          <label htmlFor="cm-emails" className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Mail(s) del Community Manager
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              id="cm-emails"
              className="min-w-0 flex-1"
              value={emailsInput}
              placeholder="cm@gestionglobal.ar; otro@mail.com"
              onChange={(e) => setEmailsInput(e.target.value)}
              disabled={!esGerente}
            />
            <Button variant="secondary" onClick={() => void onGuardarEmails()} loading={busy} disabled={!esGerente || !emailsDirty}>
              Guardar
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-brand-muted">
            Podés poner varios separados por <strong>;</strong> o coma. {emailsCount > 0 ? `${emailsCount} destinatario(s).` : 'Sin destinatarios cargados.'}
            {emailsDirty && <span className="ml-1 font-semibold text-amber-700">Guardá para aplicar.</span>}
          </p>
        </div>

        {(!activo || emailsCount === 0) && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            {emailsCount === 0
              ? 'Cargá el/los mail(s) del CM y activá el envío para que empiece a recibir el resumen.'
              : 'El envío automático está apagado. Activalo para que el CM reciba el resumen cada ' + (estado?.cada_dias ?? 30) + ' días.'}
          </div>
        )}
      </div>

      {/* Preview de la ventana pendiente */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Qué le llegaría hoy al CM</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Cursos con novedad" value={prev.cursos} hint="Con respuestas pendientes" tone="navy" />
          <Kpi label="Respuestas nuevas" value={prev.respuestas} hint="Desde el último envío" tone="cyan" />
          <Kpi label="Publicables" value={prev.publicables} hint="Autorizan difundir su caso" tone="green" />
        </div>
        <p className="text-xs text-brand-muted">
          Las descargas por curso y rango de fechas están en cada encuesta:{' '}
          <strong>Campus → curso → Encuesta → Respuestas</strong>.
        </p>
      </section>

      {/* Historial */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-brand-ink">Historial de envíos</h2>
        {runs.length === 0 ? (
          <IllustratedEmpty title="Todavía no se envió ningún resumen" description="Cuando se dispare el digest (automático o manual) vas a ver el detalle acá." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Cuándo</Th><Th>Origen</Th><Th>Resultado</Th><Th>Cursos</Th><Th>Respuestas</Th><Th>Destinatarios</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 tabular-nums text-brand-ink">{fmt(run.run_at)}</td>
                    <td className="px-3 py-2 text-brand-muted">{run.origen === 'cron' ? 'Automático' : 'Manual'}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
                        run.overall === 'ok' ? 'bg-green-50 text-green-700 ring-green-100'
                          : run.overall === 'sin_novedad' ? 'bg-slate-100 text-slate-600 ring-slate-200'
                            : 'bg-amber-50 text-amber-700 ring-amber-100',
                      )}>
                        {run.overall === 'ok' ? <><CheckCircle2 size={10} /> Enviado</>
                          : run.overall === 'sin_novedad' ? 'Sin novedad'
                            : run.overall === 'sin_destinatarios' ? 'Sin destinatarios' : run.overall}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-brand-muted">{run.cursos}</td>
                    <td className="px-3 py-2 tabular-nums text-brand-muted">{run.respuestas}</td>
                    <td className="px-3 py-2 text-xs text-brand-muted">{run.destinatarios ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone: 'cyan' | 'green' | 'navy' }) {
  const tones: Record<string, string> = {
    cyan: 'text-brand-cyan',
    green: 'text-green-700',
    navy: 'text-brand-ink',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={cn('mt-2 font-display text-2xl font-bold tabular-nums', tones[tone])}>{value.toLocaleString('es-AR')}</p>
      {hint && <p className="mt-0.5 text-[11px] text-brand-muted">{hint}</p>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">{children}</th>;
}
