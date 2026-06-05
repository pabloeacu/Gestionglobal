import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  ArrowLeft,
  Building2,
  Pencil,
  Plus,
  Building,
  Mail,
  AlertCircle,
  CheckCircle2,
  Scale,
  Trash2,
  Wallet,
  CalendarClock,
  Layers,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import {
  Button,
  Tabs,
  useConfirm,
  usePrompt,
  AnimatedNumber,
  CopyButton,
  InlineEdit,
} from '@/components/common';
import { altaClientePortal } from '@/services/api/usuarios';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { AdministracionFormDrawer } from '../components/AdministracionFormDrawer';
import { ConsorcioFormDrawer } from '../components/ConsorcioFormDrawer';
import {
  getAdministracion,
  archiveAdministracion,
  updateAdministracion,
  type AdministracionRow,
  type AdministracionEstado,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  setConsorcioActivo,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import {
  listCtaCteAdministracion,
  type CtaCteEntry,
} from '@/services/api/cobranzas';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { TabWebinars } from '../components/TabWebinars';
import { humanizeError } from '@/lib/errors';

type TabKey = 'general' | 'fiscal' | 'registral' | 'consorcios' | 'ctacte' | 'webinars' | 'emails';

const ESTADO_BADGES: Record<AdministracionEstado, { label: string; cls: string }> = {
  activo: { label: 'Activo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  prospecto: { label: 'Prospecto', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  suspendido: { label: 'Suspendido', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  baja: { label: 'Baja', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function AdministracionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [admin, setAdmin] = useState<AdministracionRow | null>(null);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('general');
  const [editOpen, setEditOpen] = useState(false);
  const [consorcioFormOpen, setConsorcioFormOpen] = useState(false);
  const [editingConsorcio, setEditingConsorcio] = useState<ConsorcioRow | null>(null);
  const [creandoAcceso, setCreandoAcceso] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [a, cs] = await Promise.all([
      getAdministracion(id),
      listConsorciosByAdministracion(id, true),
    ]);
    setLoading(false);
    if (!a.ok) {
      toast.error(humanizeError(a.error));
      return;
    }
    setAdmin(a.data);
    if (cs.ok) setConsorcios(cs.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onArchive() {
    if (!admin) return;
    const ok = await confirm({
      title: 'Dar de baja la administración',
      message: `Vas a marcar "${admin.nombre}" como dada de baja. Los consorcios y el histórico se conservan, pero deja de aparecer en operación activa.`,
      confirmLabel: 'Dar de baja',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const res = await archiveAdministracion(admin.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Administración dada de baja');
    void load();
  }

  // Edición inline: actualiza el campo y refresca admin con la nueva fila.
  async function patchField<K extends keyof AdministracionRow>(
    field: K,
    value: AdministracionRow[K] | null,
  ): Promise<void> {
    if (!admin) return;
    const res = await updateAdministracion(admin.id, {
      [field]: value,
    } as Partial<AdministracionRow>);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      throw new Error(res.error.message);
    }
    setAdmin(res.data);
    toast.success('Guardado');
  }

  // Crear acceso al portal del cliente (auth user + email con credenciales).
  // El alta de la cuenta la dispara el gerente; la edge fn alta-cliente-portal
  // crea el user con password temporal y encola el email de bienvenida.
  async function onCrearAcceso() {
    if (!admin) return;
    const email = await prompt({
      title: 'Crear acceso al portal',
      message: `Vas a crear el usuario para que "${admin.nombre}" entre al portal de clientes. Le enviamos las credenciales por email.`,
      label: 'Email del cliente',
      placeholder: 'cliente@correo.com',
      defaultValue: admin.email ?? '',
      confirmLabel: 'Crear acceso',
    });
    if (!email || !email.trim()) return;
    setCreandoAcceso(true);
    const res = await altaClientePortal({
      administracion_id: admin.id,
      email: email.trim(),
      nombre: admin.nombre,
    });
    setCreandoAcceso(false);
    if (!res.ok) {
      toast.error('No pudimos crear el acceso al portal', { description: humanizeError(res.error) });
      return;
    }
    const data = res.data as { password_set?: boolean } | null;
    toast.success(
      data?.password_set === false
        ? `Ese email ya tenía usuario; quedó vinculado a ${admin.nombre}.`
        : `Acceso creado. Enviamos las credenciales a ${email.trim()}.`,
    );
    void load();
  }

  if (loading && !admin) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Abriendo ficha" />
      </div>
    );
  }
  if (!admin) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-12 text-center">
        <AlertCircle className="mx-auto text-brand-muted" />
        <p className="text-sm text-brand-muted">No encontramos esta administración.</p>
        <Button variant="secondary" onClick={() => navigate('/gerencia/clientes')}>
          <ArrowLeft size={15} /> Volver al listado
        </Button>
      </div>
    );
  }

  const badge = ESTADO_BADGES[admin.estado as AdministracionEstado];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/gerencia/clientes"
        className="inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
      >
        <ArrowLeft size={14} /> Administraciones
      </Link>

      {/* Cover header con gradient + triángulos */}
      <FichaCover
        admin={admin}
        badge={badge}
        tieneAcceso={Boolean(admin.user_id)}
        creandoAcceso={creandoAcceso}
        onCrearAcceso={() => void onCrearAcceso()}
        onEdit={() => setEditOpen(true)}
        onArchive={() => void onArchive()}
      />

      {/* KPI strip */}
      <KpiStrip admin={admin} consorcios={consorcios} />

      {/* Tabs */}
      <Tabs
        items={[
          { key: 'general', label: 'General' },
          { key: 'fiscal', label: 'Fiscal' },
          { key: 'registral', label: 'Registral' },
          { key: 'consorcios', label: 'Consorcios', badge: consorcios.length || undefined },
          { key: 'ctacte', label: 'Cta. corriente' },
          { key: 'webinars', label: 'Webinars' },
          { key: 'emails', label: 'Emails' },
        ]}
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      <div className="card-premium relative overflow-hidden p-6">
        <TrianglesAccent
          position="top-right"
          size={180}
          tone="cyan"
          density="soft"
          className="opacity-30"
        />
        <TrianglesAccent
          position="bottom-left"
          size={140}
          tone="teal"
          density="soft"
          className="opacity-25"
        />
        <div className="relative">
          {tab === 'general' && <TabGeneral admin={admin} onPatch={patchField} />}
          {tab === 'fiscal' && <TabFiscal admin={admin} onPatch={patchField} />}
          {tab === 'registral' && <TabRegistral admin={admin} />}
          {tab === 'consorcios' && (
            <TabConsorcios
              consorcios={consorcios}
              onCreate={() => {
                setEditingConsorcio(null);
                setConsorcioFormOpen(true);
              }}
              onEdit={(c) => {
                setEditingConsorcio(c);
                setConsorcioFormOpen(true);
              }}
              onToggleActivo={async (c, activo) => {
                const res = await setConsorcioActivo(c.id, activo);
                if (!res.ok) return toast.error(humanizeError(res.error));
                toast.success(activo ? 'Consorcio reactivado' : 'Consorcio dado de baja');
                void load();
              }}
            />
          )}
          {tab === 'ctacte' && <TabCtaCte administracionId={admin.id} />}
          {tab === 'webinars' && <TabWebinars administracionId={admin.id} />}
          {tab === 'emails' && <TabEmailsPlaceholder />}
        </div>
      </div>

      <AdministracionFormDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={admin}
        onSaved={(r) => setAdmin(r)}
      />
      <ConsorcioFormDrawer
        open={consorcioFormOpen}
        onClose={() => setConsorcioFormOpen(false)}
        administracionId={admin.id}
        editing={editingConsorcio}
        onSaved={() => void load()}
      />
    </div>
  );
}

// ---------------- cover header ----------------

function FichaCover({
  admin,
  badge,
  tieneAcceso,
  creandoAcceso,
  onCrearAcceso,
  onEdit,
  onArchive,
}: {
  admin: AdministracionRow;
  badge: { label: string; cls: string };
  tieneAcceso: boolean;
  creandoAcceso: boolean;
  onCrearAcceso: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const initials = (admin.nombre ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm motion-safe:animate-fade-up">
      {/* Cover gradient */}
      <div className="relative h-28 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal sm:h-32">
        <TrianglesAccent
          position="top-right"
          size={220}
          tone="cyan"
          density="rich"
          className="opacity-60"
        />
        <TrianglesAccent
          position="bottom-left"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-40"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.35),transparent_55%)]"
        />
      </div>
      {/* Avatar + meta */}
      <div className="relative px-6 pb-5 pt-0 sm:px-8">
        <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-brand-cyan to-brand-teal font-display text-2xl font-bold text-white shadow-lg sm:h-24 sm:w-24 sm:text-3xl">
              {initials || <Building2 size={32} />}
            </span>
            <div className="min-w-0 pb-1">
              <p className="kicker text-brand-cyan">Ficha de administración</p>
              <h1 className="break-words font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
                {admin.nombre}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`inline-block rounded-full border px-2.5 py-0.5 font-semibold ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-brand-muted">
                  <span className="text-brand-ink">Código</span>
                  <span className="tabular">{admin.codigo}</span>
                </span>
                {admin.cuit && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 font-semibold text-brand-muted">
                    <span>CUIT</span>
                    <CopyButton value={admin.cuit} label="CUIT" tabular className="px-1 py-0 text-brand-ink" />
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tieneAcceso ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700"
                title="Este cliente ya tiene usuario para entrar al portal"
              >
                <ShieldCheck size={14} /> Acceso al portal activo
              </span>
            ) : (
              <Button onClick={onCrearAcceso} loading={creandoAcceso}>
                <KeyRound size={14} /> Crear acceso al portal
              </Button>
            )}
            <Button variant="secondary" onClick={onEdit}>
              <Pencil size={14} /> Editar
            </Button>
            {admin.estado !== 'baja' && (
              <Button variant="ghost" onClick={onArchive}>
                <Trash2 size={14} /> Dar de baja
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------- KPI strip ----------------

function KpiStrip({
  admin,
  consorcios,
}: {
  admin: AdministracionRow;
  consorcios: ConsorcioRow[];
}) {
  const stats = useMemo(() => {
    const activos = consorcios.filter((c) => c.activo).length;
    const totales = consorcios.length;
    const abono = consorcios
      .filter((c) => c.activo)
      .reduce((s, c) => s + Number(c.monto_abono ?? 0), 0);
    const venceRpac = admin.matricula_rpac_vencimiento
      ? new Date(admin.matricula_rpac_vencimiento)
      : null;
    const today = new Date();
    const dias = venceRpac
      ? Math.ceil((venceRpac.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    return { activos, totales, abono, venceRpac, dias };
  }, [consorcios, admin.matricula_rpac_vencimiento]);

  const venceTone =
    stats.dias === null
      ? 'slate'
      : stats.dias < 0
        ? 'red'
        : stats.dias <= 30
          ? 'amber'
          : 'emerald';

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        icon={Layers}
        label="Consorcios activos"
        value={<AnimatedNumber value={stats.activos} />}
        hint={`${stats.totales} totales`}
        tone="cyan"
        delay={0}
      />
      <KpiCard
        icon={Building}
        label="Cartera"
        value={<AnimatedNumber value={stats.totales} />}
        hint={stats.totales === 1 ? 'consorcio' : 'consorcios'}
        tone="teal"
        delay={60}
      />
      <KpiCard
        icon={Wallet}
        label="Abono mensual"
        value={
          <span className="tabular">
            $<AnimatedNumber value={Math.round(stats.abono)} />
          </span>
        }
        hint="suma activos"
        tone="cyan"
        delay={120}
      />
      <KpiCard
        icon={CalendarClock}
        label="Vence RPAC"
        value={
          stats.dias === null ? (
            <span className="text-brand-muted">—</span>
          ) : stats.dias < 0 ? (
            <span className="text-red-600">vencida</span>
          ) : (
            <span>
              <AnimatedNumber value={stats.dias} /> d
            </span>
          )
        }
        hint={
          stats.venceRpac
            ? stats.venceRpac.toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })
            : 'sin matrícula'
        }
        tone={venceTone === 'red' || venceTone === 'amber' ? 'amber' : 'teal'}
        delay={180}
      />
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  delay = 0,
}: {
  icon: typeof Wallet;
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone: 'cyan' | 'teal' | 'amber';
  delay?: number;
}) {
  const ring =
    tone === 'cyan'
      ? 'border-brand-cyan/30 hover:border-brand-cyan/60'
      : tone === 'teal'
        ? 'border-brand-teal/30 hover:border-brand-teal/60'
        : 'border-amber-300/50 hover:border-amber-400/70';
  const iconCls =
    tone === 'cyan'
      ? 'bg-brand-cyan-pale/50 text-brand-cyan'
      : tone === 'teal'
        ? 'bg-brand-teal/10 text-brand-teal'
        : 'bg-amber-100 text-amber-700';
  const glow =
    tone === 'cyan'
      ? 'bg-brand-cyan/15'
      : tone === 'teal'
        ? 'bg-brand-teal/15'
        : 'bg-amber-300/20';
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-white p-4 transition motion-safe:animate-fade-up hover:-translate-y-0.5',
        ring,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <TrianglesAccent
        position="top-right"
        size={110}
        tone={tone === 'amber' ? 'cyan' : tone}
        density="soft"
        className="opacity-35"
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100',
          glow,
        )}
      />
      <div className="relative flex items-start gap-3">
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', iconCls)}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="kicker text-brand-muted">{label}</p>
          <p className="mt-0.5 font-display text-xl font-bold leading-none text-brand-ink">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-brand-muted">{hint}</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------- tab content ----------------

type PatchFn = <K extends keyof AdministracionRow>(
  field: K,
  value: AdministracionRow[K] | null,
) => Promise<void>;

function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 border-b border-slate-100 py-3 sm:grid-cols-3">
      <dt className="kicker">{label}</dt>
      <dd className="text-sm text-brand-ink sm:col-span-2">{children}</dd>
    </div>
  );
}

function TabGeneral({
  admin,
  onPatch,
}: {
  admin: AdministracionRow;
  onPatch: PatchFn;
}) {
  return (
    <dl>
      <DataRow label="Responsable nombre">
        <InlineEdit
          value={admin.responsable_nombre}
          placeholder="Sin asignar"
          onSave={(v) => onPatch('responsable_nombre', v)}
        />
      </DataRow>
      <DataRow label="Responsable apellido">
        <InlineEdit
          value={admin.responsable_apellido}
          placeholder="Sin asignar"
          onSave={(v) => onPatch('responsable_apellido', v)}
        />
      </DataRow>
      {/* AJL-3 · Datos del padre y la madre (RPAC los pide) */}
      <DataRow label="Padre (apellido y nombres)">
        <InlineEdit
          value={(admin as { padre_apellido_nombre?: string | null }).padre_apellido_nombre ?? null}
          placeholder="Sin cargar"
          onSave={(v) => onPatch('padre_apellido_nombre' as keyof AdministracionRow, v)}
        />
      </DataRow>
      <DataRow label="Madre (apellido y nombres)">
        <InlineEdit
          value={(admin as { madre_apellido_nombre?: string | null }).madre_apellido_nombre ?? null}
          placeholder="Sin cargar"
          onSave={(v) => onPatch('madre_apellido_nombre' as keyof AdministracionRow, v)}
        />
      </DataRow>
      <DataRow label="Email">
        {admin.email ? (
          <CopyButton value={admin.email} label="Email" />
        ) : (
          <InlineEdit
            value={admin.email}
            placeholder="agregar email"
            type="email"
            onSave={(v) => onPatch('email', v)}
          />
        )}
      </DataRow>
      <DataRow label="Teléfono">
        {admin.telefono ? (
          <CopyButton value={admin.telefono} label="Teléfono" tabular />
        ) : (
          <InlineEdit
            value={admin.telefono}
            placeholder="agregar teléfono"
            type="tel"
            onSave={(v) => onPatch('telefono', v)}
          />
        )}
      </DataRow>
      <DataRow label="WhatsApp">
        {admin.whatsapp ? (
          <CopyButton value={admin.whatsapp} label="WhatsApp" tabular />
        ) : (
          <InlineEdit
            value={admin.whatsapp}
            placeholder="agregar WhatsApp"
            type="tel"
            onSave={(v) => onPatch('whatsapp', v)}
          />
        )}
      </DataRow>
      <DataRow label="Dirección">
        <InlineEdit
          value={admin.direccion}
          placeholder="agregar dirección"
          onSave={(v) => onPatch('direccion', v)}
        />
      </DataRow>
      <DataRow label="Localidad / Provincia">
        <span className="text-sm">
          {[admin.localidad, admin.provincia, admin.codigo_postal]
            .filter(Boolean)
            .join(', ') || <span className="text-brand-muted">—</span>}
        </span>
      </DataRow>
      <DataRow label="Origen / Canal">
        <InlineEdit
          value={admin.origen}
          placeholder="referencia, web, partner…"
          onSave={(v) => onPatch('origen', v)}
        />
      </DataRow>
      <DataRow label="Convenio">
        <InlineEdit
          value={admin.convenio}
          placeholder="sin convenio"
          onSave={(v) => onPatch('convenio', v)}
        />
      </DataRow>
      <DataRow label="Descuento">
        {admin.descuento_porc > 0 ? (
          <span className="tabular font-medium text-emerald-700">
            {admin.descuento_porc}%
          </span>
        ) : (
          <span className="text-brand-muted">—</span>
        )}
      </DataRow>
      <DataRow label="Observaciones">
        <InlineEdit
          value={admin.observaciones}
          placeholder="Notas internas, contexto, próximos pasos…"
          multiline
          onSave={(v) => onPatch('observaciones', v)}
        />
      </DataRow>
    </dl>
  );
}

function TabFiscal({
  admin,
  onPatch,
}: {
  admin: AdministracionRow;
  onPatch: PatchFn;
}) {
  return (
    <dl>
      <DataRow label="CUIT">
        {admin.cuit ? (
          <CopyButton value={admin.cuit} label="CUIT" tabular />
        ) : (
          <InlineEdit
            value={admin.cuit}
            placeholder="agregar CUIT"
            onSave={(v) => onPatch('cuit', v)}
          />
        )}
      </DataRow>
      <DataRow label="Condición IVA">
        <span>{admin.condicion_iva?.replaceAll('_', ' ') ?? <span className="text-brand-muted">—</span>}</span>
      </DataRow>
      <DataRow label="Domicilio fiscal">
        <InlineEdit
          value={admin.domicilio_fiscal}
          placeholder="agregar domicilio fiscal"
          onSave={(v) => onPatch('domicilio_fiscal', v)}
        />
      </DataRow>
    </dl>
  );
}

function TabRegistral({ admin }: { admin: AdministracionRow }) {
  const venceRpac = admin.matricula_rpac_vencimiento
    ? new Date(admin.matricula_rpac_vencimiento)
    : null;
  const today = new Date();
  const diasParaVencer = venceRpac
    ? Math.ceil((venceRpac.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const vencidoOClose = diasParaVencer !== null && diasParaVencer <= 30;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Scale size={16} className="text-brand-cyan" />
          <p className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            RPAC · Buenos Aires
          </p>
        </div>
        <dl>
          <DataRow label="Matrícula">
            <span>{admin.matricula_rpac ?? <span className="text-brand-muted">—</span>}</span>
          </DataRow>
          {/* AJL-3 · Legajo RPAC + Clave Fiscal ARCA (con dots+ojito) */}
          <DataRow label="Legajo">
            <span>
              {(admin as { legajo_rpac?: string | null }).legajo_rpac ?? (
                <span className="text-brand-muted">—</span>
              )}
            </span>
          </DataRow>
          <DataRow label="Clave Fiscal ARCA">
            <ClaveFiscalReveal valor={(admin as { clave_fiscal_arca?: string | null }).clave_fiscal_arca ?? null} />
          </DataRow>
          <DataRow label="Fecha de matriculación">
            <span>{admin.matricula_rpac_fecha ?? <span className="text-brand-muted">—</span>}</span>
          </DataRow>
          <DataRow label="Vencimiento">
            {admin.matricula_rpac_vencimiento ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                  vencidoOClose ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700',
                )}
              >
                {vencidoOClose ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                {admin.matricula_rpac_vencimiento}
                {diasParaVencer !== null &&
                  ` · ${diasParaVencer < 0 ? `vencida hace ${-diasParaVencer} d` : `en ${diasParaVencer} días`}`}
              </span>
            ) : (
              <span className="text-brand-muted">—</span>
            )}
          </DataRow>
        </dl>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Scale size={16} className="text-brand-cyan" />
          <p className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            RPA · CABA
          </p>
        </div>
        <dl>
          <DataRow label="Matrícula">
            <span>{admin.matricula_rpa ?? <span className="text-brand-muted">—</span>}</span>
          </DataRow>
          <DataRow label="Fecha">
            <span>{admin.matricula_rpa_fecha ?? <span className="text-brand-muted">—</span>}</span>
          </DataRow>
          <DataRow label="Vencimiento">
            <span>{admin.matricula_rpa_vencimiento ?? <span className="text-brand-muted">—</span>}</span>
          </DataRow>
        </dl>
      </div>
    </div>
  );
}

function TabConsorcios({
  consorcios,
  onCreate,
  onEdit,
  onToggleActivo,
}: {
  consorcios: ConsorcioRow[];
  onCreate: () => void;
  onEdit: (c: ConsorcioRow) => void;
  onToggleActivo: (c: ConsorcioRow, activo: boolean) => void;
}) {
  if (consorcios.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
          <Building size={20} />
        </span>
        <h3 className="font-display text-lg font-bold">Sin consorcios todavía</h3>
        <p className="max-w-sm text-sm text-brand-muted">
          Cargá los consorcios que administra este cliente. Si no tienen CUIT
          propio, el sistema les asigna un DNI ficticio automáticamente.
        </p>
        <Button onClick={onCreate}>
          <Plus size={15} /> Nuevo consorcio
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-brand-muted">
          <span className="font-semibold text-brand-ink">{consorcios.length}</span>{' '}
          consorcios totales · {consorcios.filter((c) => c.activo).length} activos
        </p>
        <Button onClick={onCreate}>
          <Plus size={15} /> Nuevo
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
              <th className="px-4 py-2.5">Código</th>
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">Documento</th>
              <th className="px-4 py-2.5 text-right">UF</th>
              <th className="px-4 py-2.5 text-right">Abono</th>
              <th className="px-4 py-2.5">Facturar al</th>
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {consorcios.map((c) => (
              <tr
                key={c.id}
                className={cn(
                  'border-b border-slate-100 transition hover:bg-brand-zebra/40',
                  !c.activo && 'opacity-60',
                )}
              >
                <td className="px-4 py-3 font-mono text-xs text-brand-muted">{c.codigo}</td>
                <td className="px-4 py-3 font-medium text-brand-ink">{c.nombre}</td>
                <td className="px-4 py-3 tabular text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                    {c.tipo_documento === 'cuit' ? 'CUIT' : 'DNI'}
                  </span>{' '}
                  <CopyButton
                    value={c.numero_documento}
                    label={c.tipo_documento === 'cuit' ? 'CUIT' : 'DNI'}
                    tabular
                  />
                </td>
                <td className="px-4 py-3 text-right tabular">{c.unidades_funcionales}</td>
                <td className="px-4 py-3 text-right tabular">{formatMoney(c.monto_abono)}</td>
                <td className="px-4 py-3 text-xs text-brand-muted">
                  {c.facturar_con_cuit_administracion ? 'Administración' : 'Consorcio'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                      c.activo
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {c.activo ? 'Activo' : 'Baja'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => onEdit(c)}
                      className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                      title="Editar"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => onToggleActivo(c, !c.activo)}
                      className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                      title={c.activo ? 'Dar de baja' : 'Reactivar'}
                    >
                      {c.activo ? <Trash2 size={14} /> : <CheckCircle2 size={14} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TabCtaCte({ administracionId }: { administracionId: string }) {
  const [rows, setRows] = useState<CtaCteEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void listCtaCteAdministracion(administracionId).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(humanizeError(res.error));
        return;
      }
      setRows(res.data);
    });
  }, [administracionId]);

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }
  if (error) {
    return <div className="p-8 text-center text-sm text-red-600">{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
          <Wallet size={20} />
        </span>
        <h3 className="font-display text-lg font-bold">Cuenta corriente vacía</h3>
        <p className="max-w-sm text-sm text-brand-muted">
          Cuando emitas comprobantes y registres cobranzas, vas a ver acá la
          línea de tiempo y el saldo acumulado del cliente.
        </p>
      </div>
    );
  }

  const saldoActual = rows[0]?.saldo ?? 0;
  const totalCargos = rows.filter((r) => r.signo === 1).reduce((s, r) => s + r.monto, 0);
  const totalAbonos = rows.filter((r) => r.signo === -1).reduce((s, r) => s + r.monto, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="kicker text-brand-muted">Cargos</p>
          <p className="mt-0.5 font-display text-lg font-bold tabular text-brand-ink">
            $<AnimatedNumber value={Math.round(totalCargos)} />
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <p className="kicker text-brand-muted">Cobranzas</p>
          <p className="mt-0.5 font-display text-lg font-bold tabular text-emerald-700">
            $<AnimatedNumber value={Math.round(totalAbonos)} />
          </p>
        </div>
        <div className={`rounded-xl border-2 p-3 text-center ${
          saldoActual > 0
            ? 'border-amber-300/60 bg-amber-50'
            : 'border-emerald-300/60 bg-emerald-50'
        }`}>
          <p className="kicker text-brand-muted">Saldo actual</p>
          <p className={`mt-0.5 font-display text-lg font-bold tabular ${
            saldoActual > 0 ? 'text-amber-700' : 'text-emerald-700'
          }`}>
            $<AnimatedNumber value={Math.round(saldoActual)} />
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-brand-zebra/40 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Movimiento</th>
              <th className="px-4 py-2.5 text-right">Cargo</th>
              <th className="px-4 py-2.5 text-right">Cobranza</th>
              <th className="px-4 py-2.5 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr
                key={r.id}
                className="border-b border-slate-100 hover:bg-brand-zebra/30 motion-safe:animate-fade-up"
                style={{ animationDelay: `${Math.min(idx, 10) * 25}ms` }}
              >
                <td className="px-4 py-3 tabular text-xs text-brand-muted">
                  {formatDateShort(r.fecha)}
                </td>
                <td className="px-4 py-3">
                  {r.tipo === 'comprobante' && r.comprobante_id ? (
                    <Link
                      to={`/gerencia/facturacion/${r.comprobante_id}`}
                      className="font-medium text-brand-ink hover:text-brand-cyan"
                    >
                      {r.titulo}
                    </Link>
                  ) : (
                    <span className="text-brand-ink">{r.titulo}</span>
                  )}
                  {r.consorcio_nombre && (
                    <span className="block text-xs text-brand-muted">
                      · {r.consorcio_nombre}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {r.signo === 1 ? (
                    <span className="text-brand-ink">{moneyTab(r.monto)}</span>
                  ) : (
                    <span className="text-brand-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular">
                  {r.signo === -1 ? (
                    <span className="text-emerald-700">{moneyTab(r.monto)}</span>
                  ) : (
                    <span className="text-brand-muted">—</span>
                  )}
                </td>
                <td className={`px-4 py-3 text-right tabular font-semibold ${
                  r.saldo > 0 ? 'text-amber-700' : r.saldo < 0 ? 'text-emerald-700' : 'text-brand-muted'
                }`}>
                  {moneyTab(r.saldo)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function moneyTab(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function TabEmailsPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
        <Mail size={20} />
      </span>
      <h3 className="font-display text-lg font-bold">Bandejas de email</h3>
      <p className="max-w-sm text-sm text-brand-muted">
        Pronto vas a poder cargar emails de facturación, cobranzas y trámites
        para esta administración (administracion_emails).
      </p>
    </div>
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

// AJL-3 · Componente helper para mostrar la clave fiscal ARCA con dots + ojito.
// Reutiliza la lógica de PasswordRevealInput pero sin form input (es solo display).
function ClaveFiscalReveal({ valor }: { valor: string | null }) {
  const [visible, setVisible] = useState(false);
  if (!valor) return <span className="text-brand-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-sm">
      <span>{visible ? valor : '•'.repeat(Math.min(valor.length, 12))}</span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="rounded p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
        aria-label={visible ? 'Ocultar' : 'Mostrar'}
        title={visible ? 'Ocultar' : 'Mostrar'}
      >
        {visible ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      <CopyButton value={valor} label="Clave" />
    </span>
  );
}
