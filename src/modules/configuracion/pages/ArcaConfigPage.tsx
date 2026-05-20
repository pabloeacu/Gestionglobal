// ArcaConfigPage · wizard self-service 4 pasos (CSR → AFIP → Cert → Test).
// Cita doc 02 §6.1 Drawer/Stepper, P-ARCA-04, regla 13 (no window.confirm).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  Sparkles,
  Download,
  ExternalLink,
  Upload,
  PlugZap,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCcw,
  FileText,
  Copy,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Stepper,
  StepPanel,
  type Step,
} from '@/components/common';
import { useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  getArcaConfig,
  generarCsr,
  inspeccionarYGuardarCert,
  testConexion,
  updateArcaConfig,
  arcaWizardStage,
  type ArcaConfig,
} from '@/services/api/arca';

const STEP_DEFS: { key: string; label: string }[] = [
  { key: 'csr', label: 'Generar CSR' },
  { key: 'afip', label: 'Subir a AFIP' },
  { key: 'cert', label: 'Subir cert' },
  { key: 'test', label: 'Probar' },
];

export function ArcaConfigPage() {
  const [cfg, setCfg] = useState<ArcaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [csrPem, setCsrPem] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'csr' | 'cert' | 'test' | 'ambiente'>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [certText, setCertText] = useState('');
  const [aliasOverride, setAliasOverride] = useState('');
  const certInputRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    const res = await getArcaConfig();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos leer la configuración ARCA', { description: res.error.message });
      return;
    }
    setCfg(res.data);
    setActiveStep(arcaWizardStage(res.data).step - 1);
  }

  const stage = useMemo(() => arcaWizardStage(cfg), [cfg]);

  const stepsWithStatus: Step[] = STEP_DEFS.map((s, i) => ({
    ...s,
    complete:
      (i === 0 && stage.csrGenerado) ||
      (i === 1 && stage.certSubido) ||
      (i === 2 && stage.certSubido) ||
      (i === 3 && stage.testOk),
  }));

  async function handleGenerarCsr() {
    if (cfg?.csr_b64) {
      const ok = await confirm({
        title: 'Regenerar CSR',
        message:
          'Si regenerás un CSR nuevo, la key anterior se reemplaza y el certificado que hayas subido quedará inservible.',
        confirmLabel: 'Sí, regenerar',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('csr');
    const res = await generarCsr(aliasOverride.trim() || undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos generar el CSR', { description: res.error.message });
      return;
    }
    setCsrPem(res.data.csr_pem);
    toast.success('CSR generado', {
      description: `Alias: ${res.data.alias_sugerido}. Descargalo y subilo al portal AFIP.`,
    });
    await refresh();
    setActiveStep(1);
  }

  function descargarCsr() {
    const pem = csrPem ?? (cfg?.csr_b64 ? atob(cfg.csr_b64) : null);
    if (!pem) {
      toast.error('No hay CSR disponible. Generalo primero.');
      return;
    }
    const alias = cfg?.cert_alias ?? 'gestion-global';
    const blob = new Blob([pem], { type: 'application/pkcs10' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${alias}.csr`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copiarCsr() {
    const pem = csrPem ?? (cfg?.csr_b64 ? atob(cfg.csr_b64) : null);
    if (!pem) {
      toast.error('No hay CSR disponible');
      return;
    }
    await navigator.clipboard.writeText(pem);
    toast.success('CSR copiado al portapapeles');
  }

  async function handleCertFile(file: File) {
    const text = await file.text();
    setCertText(text);
    await handleSubirCert(text);
  }

  async function handleSubirCert(textOverride?: string) {
    const text = (textOverride ?? certText).trim();
    if (!text) {
      toast.error('Pegá el cert o subí el archivo .crt/.cer');
      return;
    }
    setBusy('cert');
    const res = await inspeccionarYGuardarCert(text);
    setBusy(null);
    if (!res.ok) {
      toast.error('Certificado inválido', { description: res.error.message });
      return;
    }
    toast.success('Certificado instalado', {
      description: `Válido hasta ${res.data.valido_hasta ?? '?'}`,
    });
    setCertText('');
    await refresh();
    setActiveStep(3);
  }

  async function handleTest() {
    setBusy('test');
    const res = await testConexion();
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos probar la conexión', { description: res.error.message });
      await refresh();
      return;
    }
    if (res.data.ok) {
      toast.success('Conexión a ARCA OK', {
        description: `${res.data.mensaje} · ${res.data.latencia_ms}ms`,
      });
    } else {
      toast.error('Conexión a ARCA falló', { description: res.data.mensaje });
    }
    await refresh();
  }

  async function cambiarAmbiente(nuevo: 'homologacion' | 'produccion') {
    if (nuevo === cfg?.ambiente) return;
    if (nuevo === 'produccion') {
      const ok = await confirm({
        title: 'Activar producción',
        message:
          'Vas a emitir CAE reales contra AFIP producción. Asegurate de que los certs son de producción (homologación no sirve acá).',
        confirmLabel: 'Activar producción',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('ambiente');
    const res = await updateArcaConfig({ ambiente: nuevo });
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos cambiar ambiente', { description: res.error.message });
      return;
    }
    toast.success(`Ambiente ${nuevo}`);
    await refresh();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-brand-muted">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const certDiasRestantes = (() => {
    if (!cfg?.cert_valido_hasta) return null;
    const diff = (new Date(cfg.cert_valido_hasta).getTime() - Date.now()) / 86400000;
    return Math.floor(diff);
  })();

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={220} tone="cyan" density="soft" className="opacity-40" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker text-brand-cyan">Configuración</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            ARCA · Facturación electrónica
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cuatro pasos self-service para conectar Gestión Global con AFIP. Una vez activado,
            vas a poder emitir comprobantes fiscales A/B/C con CAE.
          </p>
        </div>
        <AmbienteBadge
          ambiente={cfg?.ambiente ?? 'homologacion'}
          listo={stage.testOk}
          onChange={cambiarAmbiente}
          busy={busy === 'ambiente'}
        />
      </header>

      {/* Banner cert proximo a vencer */}
      {certDiasRestantes !== null && certDiasRestantes <= 30 && (
        <div
          className={cn(
            'rounded-xl border-2 px-4 py-3 text-sm',
            certDiasRestantes < 0
              ? 'border-red-300 bg-red-50 text-red-900'
              : certDiasRestantes <= 7
                ? 'border-red-200 bg-red-50/60 text-red-800'
                : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            {certDiasRestantes < 0
              ? `El certificado ARCA vencido hace ${Math.abs(certDiasRestantes)} días.`
              : certDiasRestantes === 0
                ? 'El certificado ARCA vence hoy.'
                : `El certificado ARCA vence en ${certDiasRestantes} días (${cfg?.cert_valido_hasta}).`}
            {' '}Renová antes para no cortar facturación.
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Stepper steps={stepsWithStatus} current={activeStep} onJump={setActiveStep} />
      </div>

      {/* PASO 1: CSR */}
      {activeStep === 0 && (
        <StepPanel
          stepKey="csr"
          title="Paso 1 · Generar el CSR"
          subtitle="Creamos un par de claves RSA 2048 y firmamos un CSR PKCS#10 con tus datos. La key privada nunca sale del backend."
        >
          <div className="card-premium relative space-y-4 p-5">
            <TrianglesAccent position="bottom-left" size={140} tone="teal" density="soft" className="opacity-40" />
            <Field label="Alias (opcional)" hint="Por defecto usamos gestion-global-{CUIT}. Ese alias se usará al subir el CSR a AFIP.">
              <Input
                value={aliasOverride}
                onChange={(e) => setAliasOverride(e.target.value)}
                placeholder="gestion-global-prod"
              />
            </Field>

            {!csrPem && !cfg?.csr_b64 ? (
              <Button onClick={handleGenerarCsr} loading={busy === 'csr'}>
                <Sparkles size={15} /> Generar CSR
              </Button>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="kicker text-brand-cyan flex items-center gap-1">
                      <FileText size={11} /> CSR PEM
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={copiarCsr}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                      >
                        <Copy size={11} /> Copiar
                      </button>
                      <button
                        type="button"
                        onClick={descargarCsr}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-2 py-1 text-xs font-medium text-white hover:bg-brand-cyan-700"
                      >
                        <Download size={11} /> Descargar .csr
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md bg-white p-3 font-mono text-[10px] leading-relaxed text-brand-muted">
                    {csrPem ?? (cfg?.csr_b64 ? atob(cfg.csr_b64) : '')}
                  </pre>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={handleGenerarCsr} loading={busy === 'csr'}>
                    <RefreshCcw size={14} /> Regenerar
                  </Button>
                  <Button onClick={() => setActiveStep(1)}>
                    Siguiente · subir a AFIP
                  </Button>
                </div>
              </>
            )}
          </div>
        </StepPanel>
      )}

      {/* PASO 2: Subir a AFIP */}
      {activeStep === 1 && (
        <StepPanel
          stepKey="afip"
          title="Paso 2 · Subir el CSR al portal AFIP"
          subtitle="Tenés que tener clave fiscal nivel 3 y el servicio 'Administración de Certificados Digitales' habilitado."
        >
          <div className="card-premium relative space-y-3 p-5">
            <TrianglesAccent position="top-right" size={120} tone="teal" density="soft" className="opacity-30" />
            <ol className="ml-5 list-decimal space-y-2 text-sm text-brand-ink">
              <li>
                <a
                  href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-brand-cyan hover:underline"
                >
                  Abrí el portal AFIP <ExternalLink size={11} />
                </a>
                {' '}con tu clave fiscal nivel 3.
              </li>
              <li>Buscá <strong>Administración de Certificados Digitales</strong>.</li>
              <li>
                Creá un nuevo certificado con alias{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  {cfg?.cert_alias ?? 'gestion-global'}
                </code>
                {' '}y subí el .csr que descargaste.
              </li>
              <li>
                AFIP te devolverá un <strong>.crt</strong> (o .cer). Bajalo a tu compu.
              </li>
              <li>
                En <strong>Administrador de Relaciones</strong> autorizá el WS Negocio{' '}
                <em>"Facturación Electrónica"</em> (servicio <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">wsfe</code>) con ese alias.
              </li>
            </ol>
            <div className="flex items-center gap-2 pt-2">
              <Button variant="secondary" onClick={() => setActiveStep(0)}>
                Atrás
              </Button>
              <Button onClick={() => setActiveStep(2)}>
                Ya lo subí · siguiente
              </Button>
            </div>
          </div>
        </StepPanel>
      )}

      {/* PASO 3: Subir cert */}
      {activeStep === 2 && (
        <StepPanel
          stepKey="cert"
          title="Paso 3 · Subir el certificado firmado por AFIP"
          subtitle="Aceptamos .crt, .cer o pegar el contenido PEM. Validamos que matchee con la key generada antes y que el CUIT sea el tuyo."
        >
          <div className="card-premium relative space-y-3 p-5">
            <input
              ref={certInputRef}
              type="file"
              accept=".crt,.cer,.pem,application/x-x509-ca-cert"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleCertFile(f);
              }}
            />
            <div
              onClick={() => certInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) void handleCertFile(f);
              }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-brand-zebra/30 p-8 text-center transition hover:border-brand-cyan hover:bg-brand-cyan-pale/20"
            >
              <Upload size={28} className="text-brand-cyan" />
              <p className="text-sm font-medium text-brand-ink">
                Soltá acá el .crt / .cer, o hacé click para elegir
              </p>
              <p className="text-xs text-brand-muted">
                También podés pegar el contenido PEM en el textarea de abajo.
              </p>
            </div>

            <Field label="O pegá el cert PEM acá">
              <textarea
                value={certText}
                onChange={(e) => setCertText(e.target.value)}
                rows={6}
                placeholder="-----BEGIN CERTIFICATE-----&#10;MIIDxxx...&#10;-----END CERTIFICATE-----"
                className="w-full rounded-lg border border-slate-200 bg-white p-3 font-mono text-[10px] leading-relaxed text-brand-ink focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan"
              />
            </Field>

            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setActiveStep(1)}>
                Atrás
              </Button>
              <Button
                onClick={() => handleSubirCert()}
                disabled={!certText.trim()}
                loading={busy === 'cert'}
              >
                <CheckCircle2 size={14} /> Validar e instalar
              </Button>
            </div>

            {cfg?.cert_subido_at && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={14} /> Cert instalado · {cfg.cert_alias}
                </div>
                <p className="mt-1 text-xs text-emerald-800/80">
                  Válido desde {cfg.cert_valido_desde ?? '?'} hasta {cfg.cert_valido_hasta ?? '?'}.
                </p>
              </div>
            )}
          </div>
        </StepPanel>
      )}

      {/* PASO 4: Test */}
      {activeStep === 3 && (
        <StepPanel
          stepKey="test"
          title="Paso 4 · Probar conexión"
          subtitle="Hacemos un WSAA login y un FEDummy contra ARCA. Si responde OK, ya podés emitir comprobantes fiscales."
        >
          <div className="card-premium relative space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium text-brand-ink">
                  Ambiente: {cfg?.ambiente === 'produccion' ? 'Producción (REAL)' : 'Homologación (test)'}
                </p>
                <p className="text-brand-muted">
                  WSAA + WSFE FEDummy. El TA queda cacheado 12h para no llamar de más.
                </p>
              </div>
              <Button onClick={handleTest} loading={busy === 'test'} disabled={!stage.certSubido}>
                <PlugZap size={15} /> Probar conexión
              </Button>
            </div>

            <TestResultCard cfg={cfg} />

            {stage.testOk && cfg?.ambiente === 'homologacion' && (
              <div className="rounded-xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan-pale/30 to-brand-teal/10 p-4">
                <p className="kicker text-brand-cyan">Listo para producción</p>
                <p className="mt-1 text-sm text-brand-ink">
                  Si ya probaste en homologación y todo OK, cambiá a producción con un cert distinto.
                  Vas a tener que repetir el flujo desde el paso 1 con un nuevo CSR de producción.
                </p>
                <div className="mt-3">
                  <Button onClick={() => cambiarAmbiente('produccion')} loading={busy === 'ambiente'}>
                    Activar producción
                  </Button>
                </div>
              </div>
            )}
          </div>
        </StepPanel>
      )}
    </div>
  );
}

function AmbienteBadge({
  ambiente,
  listo,
  onChange,
  busy,
}: {
  ambiente: 'homologacion' | 'produccion';
  listo: boolean;
  onChange: (next: 'homologacion' | 'produccion') => void;
  busy: boolean;
}) {
  const isProd = ambiente === 'produccion';
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider',
          isProd ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700',
        )}
      >
        <ShieldCheck size={12} />
        {isProd ? 'Producción' : 'Homologación'}
        {listo && <CheckCircle2 size={12} />}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(isProd ? 'homologacion' : 'produccion')}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-muted hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : isProd ? 'Volver a homologación' : 'Cambiar...'}
      </button>
    </div>
  );
}

function TestResultCard({ cfg }: { cfg: ArcaConfig | null }) {
  if (!cfg?.ultimo_test_at) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-brand-muted">
        Sin pruebas todavía.
      </div>
    );
  }
  const ok = cfg.ultimo_test_ok;
  return (
    <div
      className={cn(
        'rounded-xl border-2 p-4 text-sm',
        ok
          ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900'
          : 'border-red-300 bg-red-50/60 text-red-900',
      )}
    >
      <div className="flex items-center gap-2 font-semibold">
        {ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        {ok ? 'Conexión OK' : 'Conexión con problemas'}
        {cfg.ultimo_test_latencia_ms != null && (
          <span className="ml-auto text-xs font-normal opacity-70">
            {cfg.ultimo_test_latencia_ms}ms
          </span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-80">{cfg.ultimo_test_msg ?? '—'}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider opacity-60">
        {new Date(cfg.ultimo_test_at).toLocaleString('es-AR')}
      </p>
    </div>
  );
}
