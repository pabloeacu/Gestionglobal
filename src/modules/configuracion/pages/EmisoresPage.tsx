// EmisoresPage · CRUD multi-emisor + wizard ARCA por emisor (DGG-31).
// Reemplaza ArcaConfigPage (singleton legacy) por una lista de emisores
// con drawer lateral para editar datos fiscales y completar el wizard
// de homologación → producción.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  PlugZap,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  Button,
  Drawer,
  Field,
  Input,
  Modal,
  Stepper,
  StepPanel,
  useConfirm,
  type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { descargarTutorialArca } from '../lib/generateArcaTutorialPdf';
import {
  actualizarEmisor,
  archivarEmisor,
  arcaWizardStage,
  crearEmisor,
  generarCsr,
  getEmisor,
  inspeccionarYGuardarCert,
  listEmisores,
  marcarDefault,
  reactivarEmisor,
  testConexion,
  type ArcaAmbiente,
  type ArcaEmisor,
} from '@/services/api/arca';

// ============================================================================
// Page · lista + alta + drawer de configuración
// ============================================================================

export function EmisoresPage() {
  const [emisores, setEmisores] = useState<ArcaEmisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [showAlta, setShowAlta] = useState(false);
  const [verArchivados, setVerArchivados] = useState(false);
  const confirm = useConfirm();

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await listEmisores();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos leer los emisores', { description: res.error.message });
      return;
    }
    setEmisores(res.data);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const visibles = useMemo(
    () => emisores.filter((e) => verArchivados || e.activo),
    [emisores, verArchivados],
  );

  async function onMarcarDefault(em: ArcaEmisor) {
    if (em.es_default) return;
    if (!em.activo) {
      toast.error('Reactivá el emisor antes de marcarlo como default');
      return;
    }
    const r = await marcarDefault(em.id);
    if (!r.ok) {
      toast.error('No pudimos cambiar el default', { description: r.error.message });
      return;
    }
    toast.success(`"${em.nombre}" es ahora el emisor default`);
    await refresh();
  }

  async function onArchivar(em: ArcaEmisor) {
    if (em.es_default) {
      toast.error('No podés archivar el emisor default. Marca otro como default antes.');
      return;
    }
    const ok = await confirm({
      title: 'Archivar emisor',
      message: `¿Archivar "${em.nombre}"? Los comprobantes existentes que lo usan no se modifican, pero no podrá emitir nuevos hasta que lo reactives.`,
      confirmLabel: 'Archivar',
      danger: true,
    });
    if (!ok) return;
    const r = await archivarEmisor(em.id);
    if (!r.ok) {
      toast.error('No pudimos archivar', { description: r.error.message });
      return;
    }
    toast.success('Emisor archivado');
    await refresh();
  }

  async function onReactivar(em: ArcaEmisor) {
    const r = await reactivarEmisor(em.id);
    if (!r.ok) {
      toast.error('No pudimos reactivar', { description: r.error.message });
      return;
    }
    toast.success('Emisor reactivado');
    await refresh();
  }

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={220} tone="cyan" density="soft" className="opacity-40" />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker text-brand-cyan">Configuración</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Emisores fiscales (ARCA)
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cada emisor representa una identidad fiscal con su propio CUIT y certificado AFIP.
            El emisor marcado como <strong>default</strong> es el que usan los comprobantes
            si no se asigna otro explícitamente.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadTutorialButton />
          <Button onClick={() => setShowAlta(true)}>
            <Plus size={15} /> Nuevo emisor
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-brand-muted">
          <input
            type="checkbox"
            checked={verArchivados}
            onChange={(e) => setVerArchivados(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Mostrar archivados
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-muted hover:border-brand-cyan hover:text-brand-cyan"
        >
          <RefreshCcw size={12} /> Refrescar
        </button>
      </div>

      {loading && emisores.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-brand-muted">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : visibles.length === 0 ? (
        <div className="card-premium p-8 text-center text-brand-muted">
          <p className="font-medium text-brand-ink">Sin emisores cargados.</p>
          <p className="mt-1 text-sm">Creá tu primer emisor con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((em) => (
            <EmisorCard
              key={em.id}
              emisor={em}
              onConfigurar={() => setDrawerId(em.id)}
              onMarcarDefault={() => void onMarcarDefault(em)}
              onArchivar={() => void onArchivar(em)}
              onReactivar={() => void onReactivar(em)}
            />
          ))}
        </div>
      )}

      {showAlta && (
        <AltaEmisorModal
          onClose={() => setShowAlta(false)}
          onCreated={(em) => {
            setShowAlta(false);
            void refresh();
            setDrawerId(em.id);
          }}
        />
      )}

      {drawerId && (
        <EmisorEditDrawer
          emisorId={drawerId}
          onClose={() => setDrawerId(null)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-componentes
// ============================================================================

function DownloadTutorialButton() {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await descargarTutorialArca();
      toast.success('Tutorial descargado', { description: 'Gestion-Global-Tutorial-ARCA.pdf' });
    } catch (e) {
      toast.error('No pudimos generar el PDF', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-brand-cyan/30 bg-brand-cyan-pale/40 px-2.5 py-1.5 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan-pale/70 disabled:opacity-50"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <BookOpen size={12} />}
      Tutorial PDF
    </button>
  );
}

function EmisorCard({
  emisor,
  onConfigurar,
  onMarcarDefault,
  onArchivar,
  onReactivar,
}: {
  emisor: ArcaEmisor;
  onConfigurar: () => void;
  onMarcarDefault: () => void;
  onArchivar: () => void;
  onReactivar: () => void;
}) {
  const stage = arcaWizardStage(emisor);
  const archivado = !emisor.activo;
  const diasRestantes = (() => {
    if (!emisor.cert_valido_hasta) return null;
    return Math.floor((new Date(emisor.cert_valido_hasta).getTime() - Date.now()) / 86400000);
  })();
  return (
    <div className={cn('card-premium relative space-y-3 p-5', archivado && 'opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base font-bold text-brand-ink">{emisor.nombre}</h3>
            {emisor.es_default && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-cyan">
                <Star size={9} fill="currentColor" /> Default
              </span>
            )}
            {archivado && (
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                Archivado
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-brand-muted">{emisor.razon_social}</p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            emisor.ambiente === 'produccion'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700',
          )}
        >
          <ShieldCheck size={9} />
          {emisor.ambiente === 'produccion' ? 'Producción' : 'Homologación'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-brand-muted">CUIT</dt>
          <dd className="font-mono font-medium text-brand-ink">{emisor.cuit ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-brand-muted">Pto. venta</dt>
          <dd className="font-mono font-medium text-brand-ink">{emisor.punto_venta_default}</dd>
        </div>
      </dl>

      <StepBadge stage={stage} />

      {diasRestantes !== null && diasRestantes <= 30 && (
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]',
            diasRestantes < 0
              ? 'border-red-200 bg-red-50 text-red-800'
              : diasRestantes <= 7
                ? 'border-red-200 bg-red-50/60 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          <AlertCircle size={11} />
          {diasRestantes < 0
            ? `Cert vencido hace ${Math.abs(diasRestantes)} días`
            : diasRestantes === 0
              ? 'Cert vence hoy'
              : `Cert vence en ${diasRestantes} días`}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button onClick={onConfigurar} disabled={archivado}>
          Configurar
        </Button>
        {!archivado && !emisor.es_default && (
          <button
            type="button"
            onClick={onMarcarDefault}
            className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-muted hover:border-brand-cyan hover:text-brand-cyan"
          >
            Marcar default
          </button>
        )}
        {!archivado ? (
          <button
            type="button"
            onClick={onArchivar}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            title="Archivar"
          >
            <Trash2 size={11} /> Archivar
          </button>
        ) : (
          <button
            type="button"
            onClick={onReactivar}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Reactivar
          </button>
        )}
      </div>
    </div>
  );
}

function StepBadge({ stage }: { stage: ReturnType<typeof arcaWizardStage> }) {
  const labels = ['Datos fiscales', 'Generar CSR', 'Subir cert', 'Probar conexión'];
  const text =
    !stage.cuitCargado
      ? labels[0]
      : !stage.csrGenerado
        ? labels[1]
        : !stage.certSubido
          ? labels[2]
          : !stage.testOk
            ? labels[3]
            : 'Listo para emitir';
  const listo = stage.testOk && stage.cuitCargado;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium',
        listo ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800',
      )}
    >
      {listo ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
      {listo ? text : `Paso ${stage.step}/4 · ${text}`}
    </div>
  );
}

// ============================================================================
// Alta · modal
// ============================================================================

function AltaEmisorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (em: ArcaEmisor) => void;
}) {
  const [nombre, setNombre] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [cuit, setCuit] = useState('');
  const [condicionIva, setCondicionIva] = useState('responsable_inscripto');
  const [ambiente, setAmbiente] = useState<ArcaAmbiente>('homologacion');
  const [puntoVenta, setPuntoVenta] = useState(1);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !razonSocial.trim()) {
      toast.error('Nombre y razón social son obligatorios');
      return;
    }
    setBusy(true);
    const res = await crearEmisor({
      nombre: nombre.trim(),
      razon_social: razonSocial.trim(),
      cuit: cuit.trim() || null,
      condicion_iva: condicionIva,
      ambiente,
      punto_venta_default: puntoVenta,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error('No pudimos crear el emisor', { description: res.error.message });
      return;
    }
    toast.success(`Emisor "${res.data.nombre}" creado`);
    onCreated(res.data);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo emisor fiscal"
      kicker="ARCA · Multi-emisor"
      icon={<Plus size={18} className="text-brand-cyan" />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-brand-muted hover:border-slate-300">
            Cancelar
          </button>
          <Button onClick={(e) => void onSubmit(e as unknown as FormEvent)} loading={busy}>
            Crear emisor
          </Button>
        </div>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Nombre interno" hint="Cómo lo identificás internamente (ej. Gestión Global, Fundplata).">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Gestión Global" autoFocus />
        </Field>
        <Field label="Razón social" hint="Tal como figura en AFIP.">
          <Input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} placeholder="Gestión Global S.A." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CUIT" hint="11 dígitos sin guiones (opcional al alta, requerido para generar CSR).">
            <Input
              value={cuit}
              onChange={(e) => setCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="20123456789"
              inputMode="numeric"
            />
          </Field>
          <Field label="Punto de venta" hint="Número de PV asignado por AFIP.">
            <Input
              type="number"
              value={puntoVenta}
              onChange={(e) => setPuntoVenta(Math.max(1, Number(e.target.value) || 1))}
              min={1}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Condición IVA">
            <select
              value={condicionIva}
              onChange={(e) => setCondicionIva(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan"
            >
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="monotributo">Monotributo</option>
              <option value="exento">Exento</option>
            </select>
          </Field>
          <Field label="Ambiente inicial">
            <select
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value as ArcaAmbiente)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan"
            >
              <option value="homologacion">Homologación</option>
              <option value="produccion">Producción</option>
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================================
// Edit / Wizard · drawer
// ============================================================================

type DrawerTab = 'datos' | 'wizard';

function EmisorEditDrawer({
  emisorId,
  onClose,
  onSaved,
}: {
  emisorId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [emisor, setEmisor] = useState<ArcaEmisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DrawerTab>('datos');

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await getEmisor(emisorId);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos leer el emisor', { description: res.error.message });
      onClose();
      return;
    }
    setEmisor(res.data);
  }, [emisorId, onClose]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Pasamos a la tab "wizard" automáticamente si ya tiene CUIT y aún falta algo.
  useEffect(() => {
    if (!emisor) return;
    const stage = arcaWizardStage(emisor);
    if (stage.cuitCargado && !stage.testOk) setTab('wizard');
    else if (!stage.cuitCargado) setTab('datos');
  }, [emisor]);

  return (
    <Drawer
      open
      onClose={onClose}
      title={emisor?.nombre ?? 'Emisor'}
      kicker="ARCA · Configuración"
      icon={<ShieldCheck size={18} className="text-brand-cyan" />}
      width={760}
    >
      {loading || !emisor ? (
        <div className="flex h-48 items-center justify-center text-brand-muted">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            <TabBtn active={tab === 'datos'} onClick={() => setTab('datos')}>Datos fiscales</TabBtn>
            <TabBtn active={tab === 'wizard'} onClick={() => setTab('wizard')}>Wizard ARCA</TabBtn>
          </div>
          {tab === 'datos' ? (
            <DatosFiscalesForm
              emisor={emisor}
              onSaved={() => { void refresh(); onSaved(); }}
            />
          ) : (
            <WizardArca
              emisor={emisor}
              onRefresh={() => { void refresh(); onSaved(); }}
            />
          )}
        </div>
      )}
    </Drawer>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-white text-brand-ink shadow-sm' : 'text-brand-muted hover:text-brand-ink',
      )}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Tab "Datos fiscales"
// ============================================================================

function DatosFiscalesForm({ emisor, onSaved }: { emisor: ArcaEmisor; onSaved: () => void }) {
  const [nombre, setNombre] = useState(emisor.nombre);
  const [razonSocial, setRazonSocial] = useState(emisor.razon_social);
  const [cuit, setCuit] = useState(emisor.cuit ?? '');
  const [condicionIva, setCondicionIva] = useState(emisor.condicion_iva);
  const [domicilioFiscal, setDomicilioFiscal] = useState(emisor.domicilio_fiscal ?? '');
  const [puntoVenta, setPuntoVenta] = useState(emisor.punto_venta_default);
  const [busy, setBusy] = useState(false);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (cuit && !/^\d{11}$/.test(cuit)) {
      toast.error('El CUIT debe tener 11 dígitos');
      return;
    }
    setBusy(true);
    const res = await actualizarEmisor(emisor.id, {
      nombre: nombre.trim(),
      razon_social: razonSocial.trim(),
      cuit: cuit.trim() || null,
      condicion_iva: condicionIva,
      domicilio_fiscal: domicilioFiscal.trim() || null,
      punto_venta_default: puntoVenta,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: res.error.message });
      return;
    }
    toast.success('Datos fiscales guardados');
    onSaved();
  }

  return (
    <form onSubmit={onSave} className="space-y-3">
      <Field label="Nombre interno">
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </Field>
      <Field label="Razón social">
        <Input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CUIT" hint="11 dígitos. Requerido para generar el CSR.">
          <Input
            value={cuit}
            onChange={(e) => setCuit(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="20123456789"
            inputMode="numeric"
          />
        </Field>
        <Field label="Punto de venta">
          <Input
            type="number"
            value={puntoVenta}
            onChange={(e) => setPuntoVenta(Math.max(1, Number(e.target.value) || 1))}
            min={1}
          />
        </Field>
      </div>
      <Field label="Condición IVA">
        <select
          value={condicionIva}
          onChange={(e) => setCondicionIva(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-1 focus:ring-brand-cyan"
        >
          <option value="responsable_inscripto">Responsable Inscripto</option>
          <option value="monotributo">Monotributo</option>
          <option value="exento">Exento</option>
        </select>
      </Field>
      <Field label="Domicilio fiscal" hint="Opcional. Se incluye en los comprobantes PDF.">
        <Input value={domicilioFiscal} onChange={(e) => setDomicilioFiscal(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button onClick={(e) => void onSave(e as unknown as FormEvent)} loading={busy}>
          Guardar
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// Tab "Wizard ARCA" — los 4 pasos clásicos, por emisor
// ============================================================================

const STEP_DEFS: { key: string; label: string }[] = [
  { key: 'csr', label: 'Generar CSR' },
  { key: 'afip', label: 'Subir a AFIP' },
  { key: 'cert', label: 'Subir cert' },
  { key: 'test', label: 'Probar' },
];

function WizardArca({ emisor, onRefresh }: { emisor: ArcaEmisor; onRefresh: () => void }) {
  const stage = useMemo(() => arcaWizardStage(emisor), [emisor]);
  const [activeStep, setActiveStep] = useState(stage.step - 1);
  const [csrPem, setCsrPem] = useState<string | null>(null);
  const [certText, setCertText] = useState('');
  const [aliasOverride, setAliasOverride] = useState('');
  const [busy, setBusy] = useState<null | 'csr' | 'cert' | 'test' | 'ambiente'>(null);
  const certInputRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();

  // Sync step cuando cambia el emisor.
  useEffect(() => { setActiveStep(arcaWizardStage(emisor).step - 1); }, [emisor]);

  const stepsWithStatus: Step[] = STEP_DEFS.map((s, i) => ({
    ...s,
    complete:
      (i === 0 && stage.csrGenerado) ||
      (i === 1 && stage.certSubido) ||
      (i === 2 && stage.certSubido) ||
      (i === 3 && stage.testOk),
  }));

  async function handleGenerarCsr() {
    if (!emisor.cuit) {
      toast.error('Cargá el CUIT primero en la tab "Datos fiscales"');
      return;
    }
    if (emisor.csr_b64) {
      const ok = await confirm({
        title: 'Regenerar CSR',
        message: 'Si regenerás un CSR nuevo, la key anterior se reemplaza y el certificado que hayas subido quedará inservible.',
        confirmLabel: 'Sí, regenerar',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('csr');
    const res = await generarCsr(emisor.id, aliasOverride.trim() || undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos generar el CSR', { description: res.error.message });
      return;
    }
    setCsrPem(res.data.csr_pem);
    toast.success('CSR generado · descargalo abajo', { description: `Alias: ${res.data.alias_sugerido}` });
    onRefresh();
    // No avanzamos automáticamente al paso 2 — el usuario tiene que descargar
    // o copiar el CSR primero. El botón "Siguiente · subir a AFIP" lo lleva
    // al paso 2 cuando ya tiene el .csr en mano.
  }

  function descargarCsr() {
    const pem = csrPem ?? (emisor.csr_b64 ? atob(emisor.csr_b64) : null);
    if (!pem) {
      toast.error('No hay CSR disponible. Generalo primero.');
      return;
    }
    const alias = emisor.cert_alias ?? `gestion-global-${emisor.cuit ?? 'emisor'}`;
    const blob = new Blob([pem], { type: 'application/pkcs10' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${alias}.csr`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copiarCsr() {
    const pem = csrPem ?? (emisor.csr_b64 ? atob(emisor.csr_b64) : null);
    if (!pem) {
      toast.error('No hay CSR disponible');
      return;
    }
    await navigator.clipboard.writeText(pem);
    toast.success('CSR copiado');
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
    const res = await inspeccionarYGuardarCert(text, emisor.id);
    setBusy(null);
    if (!res.ok) {
      toast.error('Certificado inválido', { description: res.error.message });
      return;
    }
    toast.success('Certificado instalado', { description: `Válido hasta ${res.data.valido_hasta ?? '?'}` });
    setCertText('');
    onRefresh();
    setActiveStep(3);
  }

  async function handleTest() {
    setBusy('test');
    const res = await testConexion(emisor.id);
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos probar la conexión', { description: res.error.message });
      onRefresh();
      return;
    }
    if (res.data.ok) {
      toast.success('Conexión a ARCA OK', { description: `${res.data.mensaje} · ${res.data.latencia_ms}ms` });
    } else {
      toast.error('Conexión a ARCA falló', { description: res.data.mensaje });
    }
    onRefresh();
  }

  async function cambiarAmbiente(nuevo: ArcaAmbiente) {
    if (nuevo === emisor.ambiente) return;
    if (nuevo === 'produccion') {
      const ok = await confirm({
        title: 'Activar producción',
        message: 'Vas a emitir CAE reales contra AFIP producción. Asegurate de que los certs son de producción (homologación no sirve acá).',
        confirmLabel: 'Activar producción',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('ambiente');
    const res = await actualizarEmisor(emisor.id, { ambiente: nuevo });
    setBusy(null);
    if (!res.ok) {
      toast.error('No pudimos cambiar ambiente', { description: res.error.message });
      return;
    }
    toast.success(`Ambiente: ${nuevo === 'produccion' ? 'Producción' : 'Homologación'}`);
    onRefresh();
  }

  if (!emisor.cuit) {
    return (
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-medium">
          <AlertCircle size={14} /> Falta cargar el CUIT
        </div>
        <p className="mt-1 text-xs text-amber-800/80">
          Andá a la tab <strong>Datos fiscales</strong> y cargá el CUIT del emisor.
          Sin CUIT no se puede generar el CSR ni emitir comprobantes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AmbienteToggle
          ambiente={emisor.ambiente}
          listo={stage.testOk}
          onChange={cambiarAmbiente}
          busy={busy === 'ambiente'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Stepper steps={stepsWithStatus} current={activeStep} onJump={setActiveStep} />
      </div>

      {activeStep === 0 && (
        <StepPanel stepKey="csr" title="Paso 1 · Generar el CSR" subtitle="Creamos par RSA 2048 + CSR PKCS#10. La key privada nunca sale del backend.">
          <div className="card-premium space-y-4 p-5">
            <Field label="Alias (opcional)" hint={`Por defecto: gestion-global-${emisor.cuit}`}>
              <Input value={aliasOverride} onChange={(e) => setAliasOverride(e.target.value)} placeholder={`gestion-global-${emisor.cuit}`} />
            </Field>
            {!csrPem && !emisor.csr_b64 ? (
              <Button onClick={handleGenerarCsr} loading={busy === 'csr'}>
                <Sparkles size={15} /> Generar CSR
              </Button>
            ) : (
              <>
                <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="kicker flex items-center gap-1 text-brand-cyan">
                      <FileText size={11} /> CSR PEM
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={copiarCsr} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium hover:border-brand-cyan hover:text-brand-cyan">
                        <Copy size={11} /> Copiar
                      </button>
                      <button type="button" onClick={descargarCsr} className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-2 py-1 text-xs font-medium text-white hover:bg-brand-cyan-700">
                        <Download size={11} /> Descargar .csr
                      </button>
                    </div>
                  </div>
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-md bg-white p-3 font-mono text-[10px] leading-relaxed text-brand-muted">
                    {csrPem ?? (emisor.csr_b64 ? atob(emisor.csr_b64) : '')}
                  </pre>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={handleGenerarCsr} loading={busy === 'csr'}>
                    <RefreshCcw size={14} /> Regenerar
                  </Button>
                  <Button onClick={() => setActiveStep(1)}>Siguiente · subir a AFIP</Button>
                </div>
              </>
            )}
          </div>
        </StepPanel>
      )}

      {activeStep === 1 && (
        <StepPanel stepKey="afip" title="Paso 2 · Subir el CSR a AFIP" subtitle="Necesitás clave fiscal nivel 3 y el servicio 'Administración de Certificados Digitales' habilitado.">
          <div className="card-premium space-y-3 p-5">
            {/* Recordatorio del CSR + botones siempre a mano (E-GG-25.c). */}
            {(csrPem || emisor.csr_b64) && (
              <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan-pale/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-brand-cyan">
                    Tu CSR está listo · alias <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px]">{emisor.cert_alias ?? `gestion-global-${emisor.cuit}`}</code>
                  </p>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={copiarCsr} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium hover:border-brand-cyan hover:text-brand-cyan">
                      <Copy size={11} /> Copiar
                    </button>
                    <button type="button" onClick={descargarCsr} className="inline-flex items-center gap-1 rounded-md bg-brand-cyan px-2 py-1 text-xs font-medium text-white hover:bg-brand-cyan-700">
                      <Download size={11} /> Descargar .csr
                    </button>
                  </div>
                </div>
              </div>
            )}
            <ol className="ml-5 list-decimal space-y-2 text-sm text-brand-ink">
              <li>
                <a href="https://auth.afip.gob.ar/contribuyente_/login.xhtml" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-cyan hover:underline">
                  Abrí el portal AFIP <ExternalLink size={11} />
                </a>{' '}con tu clave fiscal nivel 3.
              </li>
              <li>Buscá <strong>Administración de Certificados Digitales</strong>.</li>
              <li>Creá un nuevo certificado con alias <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{emisor.cert_alias ?? `gestion-global-${emisor.cuit}`}</code> y subí el .csr que descargaste.</li>
              <li>AFIP te devolverá un <strong>.crt</strong>. Bajalo a tu compu.</li>
              <li>En <strong>Administrador de Relaciones</strong> autorizá el WS <em>Facturación Electrónica</em> (servicio <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">wsfe</code>) con ese alias.</li>
            </ol>
            <div className="flex items-center gap-2 pt-2">
              <Button variant="secondary" onClick={() => setActiveStep(0)}>Atrás</Button>
              <Button onClick={() => setActiveStep(2)}>Ya lo subí · siguiente</Button>
            </div>
          </div>
        </StepPanel>
      )}

      {activeStep === 2 && (
        <StepPanel stepKey="cert" title="Paso 3 · Subir cert firmado por AFIP" subtitle="Aceptamos .crt, .cer o pegar el PEM. Validamos que matchee con la key generada antes.">
          <div className="card-premium space-y-3 p-5">
            <input
              ref={certInputRef}
              type="file"
              accept=".crt,.cer,.pem,application/x-x509-ca-cert"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCertFile(f); }}
            />
            <div
              onClick={() => certInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void handleCertFile(f); }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-brand-zebra/30 p-8 text-center transition hover:border-brand-cyan hover:bg-brand-cyan-pale/20"
            >
              <Upload size={28} className="text-brand-cyan" />
              <p className="text-sm font-medium text-brand-ink">Soltá acá el .crt / .cer, o click para elegir</p>
              <p className="text-xs text-brand-muted">También podés pegar el PEM abajo.</p>
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
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setActiveStep(1)}>Atrás</Button>
              <Button onClick={() => handleSubirCert()} disabled={!certText.trim()} loading={busy === 'cert'}>
                <CheckCircle2 size={14} /> Validar e instalar
              </Button>
              {emisor.cert_subido_at && (
                <Button onClick={() => setActiveStep(3)}>
                  Siguiente · probar conexión
                </Button>
              )}
            </div>
            {emisor.cert_subido_at && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={14} /> Cert instalado · {emisor.cert_alias}
                </div>
                <p className="mt-1 text-xs text-emerald-800/80">
                  Válido desde {emisor.cert_valido_desde ?? '?'} hasta {emisor.cert_valido_hasta ?? '?'}.
                </p>
              </div>
            )}
          </div>
        </StepPanel>
      )}

      {activeStep === 3 && (
        <StepPanel stepKey="test" title="Paso 4 · Probar conexión" subtitle="Hacemos WSAA login + FEDummy. Si responde OK, ya podés emitir comprobantes.">
          <div className="card-premium space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium text-brand-ink">
                  Ambiente: {emisor.ambiente === 'produccion' ? 'Producción (REAL)' : 'Homologación (test)'}
                </p>
                <p className="text-brand-muted">WSAA + WSFE FEDummy. TA cacheado 12h.</p>
              </div>
              <Button onClick={handleTest} loading={busy === 'test'} disabled={!stage.certSubido}>
                <PlugZap size={15} /> Probar conexión
              </Button>
            </div>
            <TestResultCard emisor={emisor} />
            {stage.testOk && emisor.ambiente === 'homologacion' && (
              <div className="rounded-xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan-pale/30 to-brand-teal/10 p-4">
                <p className="kicker text-brand-cyan">Listo para producción</p>
                <p className="mt-1 text-sm text-brand-ink">
                  Si ya probaste homologación y todo OK, cambiá a producción con un cert nuevo de producción.
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

function AmbienteToggle({
  ambiente,
  listo,
  onChange,
  busy,
}: {
  ambiente: ArcaAmbiente;
  listo: boolean;
  onChange: (next: ArcaAmbiente) => void;
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

function TestResultCard({ emisor }: { emisor: ArcaEmisor }) {
  if (!emisor.ultimo_test_at) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm text-brand-muted">
        Sin pruebas todavía.
      </div>
    );
  }
  const ok = emisor.ultimo_test_ok;
  return (
    <div className={cn('rounded-xl border-2 p-4 text-sm', ok ? 'border-emerald-300 bg-emerald-50/60 text-emerald-900' : 'border-red-300 bg-red-50/60 text-red-900')}>
      <div className="flex items-center gap-2 font-semibold">
        {ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        {ok ? 'Conexión OK' : 'Conexión con problemas'}
        {emisor.ultimo_test_latencia_ms != null && (
          <span className="ml-auto text-xs font-normal opacity-70">{emisor.ultimo_test_latencia_ms}ms</span>
        )}
      </div>
      <p className="mt-1 text-xs opacity-80">{emisor.ultimo_test_msg ?? '—'}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider opacity-60">
        {new Date(emisor.ultimo_test_at).toLocaleString('es-AR')}
      </p>
    </div>
  );
}
