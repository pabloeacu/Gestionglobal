import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { Button, Tabs, useConfirm } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { AdministracionFormDrawer } from '../components/AdministracionFormDrawer';
import { ConsorcioFormDrawer } from '../components/ConsorcioFormDrawer';
import {
  getAdministracion,
  archiveAdministracion,
  type AdministracionRow,
  type AdministracionEstado,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  setConsorcioActivo,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import { cn } from '@/lib/cn';

type TabKey = 'general' | 'fiscal' | 'registral' | 'consorcios' | 'emails';

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
  const [admin, setAdmin] = useState<AdministracionRow | null>(null);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('general');
  const [editOpen, setEditOpen] = useState(false);
  const [consorcioFormOpen, setConsorcioFormOpen] = useState(false);
  const [editingConsorcio, setEditingConsorcio] = useState<ConsorcioRow | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [a, cs] = await Promise.all([
      getAdministracion(id),
      listConsorciosByAdministracion(id, true),
    ]);
    setLoading(false);
    if (!a.ok) {
      toast.error(a.error.message);
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
      toast.error(res.error.message);
      return;
    }
    toast.success('Administración dada de baja');
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
  const consorciosActivos = consorcios.filter((c) => c.activo).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/gerencia/clientes"
          className="inline-flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft size={14} /> Administraciones
        </Link>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-cyan-pale/40 text-brand-cyan">
              <Building2 size={26} />
            </span>
            <div className="min-w-0">
              <p className="kicker text-brand-cyan">Ficha de administración</p>
              <h1 className="break-words font-display text-3xl font-bold leading-tight text-brand-ink">
                {admin.nombre}
              </h1>
              <p className="mt-1 text-sm text-brand-muted">
                Código <span className="font-medium text-brand-ink">{admin.codigo}</span>
                {admin.cuit && (
                  <>
                    {' · '}CUIT <span className="font-medium tabular text-brand-ink">{admin.cuit}</span>
                  </>
                )}
              </p>
              <p className="mt-2">
                <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="ml-2 inline-block rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-brand-muted">
                  {consorciosActivos} consorcios activos
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={14} /> Editar
            </Button>
            {admin.estado !== 'baja' && (
              <Button variant="ghost" onClick={() => void onArchive()}>
                <Trash2 size={14} /> Dar de baja
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        items={[
          { key: 'general', label: 'General' },
          { key: 'fiscal', label: 'Fiscal' },
          { key: 'registral', label: 'Registral' },
          { key: 'consorcios', label: 'Consorcios', badge: consorcios.length || undefined },
          { key: 'emails', label: 'Emails' },
        ]}
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      <div className="card-premium p-6">
        {tab === 'general' && <TabGeneral admin={admin} />}
        {tab === 'fiscal' && <TabFiscal admin={admin} />}
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
              if (!res.ok) return toast.error(res.error.message);
              toast.success(activo ? 'Consorcio reactivado' : 'Consorcio dado de baja');
              void load();
            }}
          />
        )}
        {tab === 'emails' && <TabEmailsPlaceholder />}
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

// ---------------- tab content ----------------

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-3 sm:grid-cols-3">
      <dt className="kicker">{label}</dt>
      <dd className="text-sm text-brand-ink sm:col-span-2">{value || <span className="text-brand-muted">—</span>}</dd>
    </div>
  );
}

function TabGeneral({ admin }: { admin: AdministracionRow }) {
  return (
    <dl>
      <DataRow
        label="Responsable"
        value={
          [admin.responsable_nombre, admin.responsable_apellido]
            .filter(Boolean)
            .join(' ') || null
        }
      />
      <DataRow label="Email" value={admin.email} />
      <DataRow label="Teléfono" value={admin.telefono} />
      <DataRow label="WhatsApp" value={admin.whatsapp} />
      <DataRow
        label="Dirección"
        value={
          [admin.direccion, admin.localidad, admin.provincia, admin.codigo_postal]
            .filter(Boolean)
            .join(', ') || null
        }
      />
      <DataRow label="Origen / Canal" value={admin.origen} />
      <DataRow label="Convenio" value={admin.convenio} />
      <DataRow
        label="Descuento"
        value={admin.descuento_porc > 0 ? `${admin.descuento_porc}%` : null}
      />
      <DataRow label="Observaciones" value={<pre className="whitespace-pre-wrap font-sans">{admin.observaciones ?? ''}</pre>} />
    </dl>
  );
}

function TabFiscal({ admin }: { admin: AdministracionRow }) {
  return (
    <dl>
      <DataRow label="CUIT" value={admin.cuit} />
      <DataRow label="Condición IVA" value={admin.condicion_iva?.replaceAll('_', ' ')} />
      <DataRow label="Domicilio fiscal" value={admin.domicilio_fiscal} />
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
          <DataRow label="Matrícula" value={admin.matricula_rpac} />
          <DataRow label="Fecha de matriculación" value={admin.matricula_rpac_fecha} />
          <DataRow
            label="Vencimiento"
            value={
              admin.matricula_rpac_vencimiento ? (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                    vencidoOClose
                      ? 'bg-red-50 text-red-700'
                      : 'bg-emerald-50 text-emerald-700',
                  )}
                >
                  {vencidoOClose ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                  {admin.matricula_rpac_vencimiento}
                  {diasParaVencer !== null &&
                    ` · ${diasParaVencer < 0 ? `vencida hace ${-diasParaVencer} d` : `en ${diasParaVencer} días`}`}
                </span>
              ) : null
            }
          />
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
          <DataRow label="Matrícula" value={admin.matricula_rpa} />
          <DataRow label="Fecha" value={admin.matricula_rpa_fecha} />
          <DataRow label="Vencimiento" value={admin.matricula_rpa_vencimiento} />
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
                  {c.numero_documento}
                </td>
                <td className="px-4 py-3 text-right tabular">{c.unidades_funcionales}</td>
                <td className="px-4 py-3 text-right tabular">
                  {formatMoney(c.monto_abono)}
                </td>
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
