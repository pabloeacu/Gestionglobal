import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  FileText,
  Mail,
  Paperclip,
  Phone,
  Sparkles,
  Trash2,
  User,
  Loader2,
  Send,
} from 'lucide-react';
import {
  Button,
  Field,
  Textarea,
  usePrompt,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { toast } from '@/lib/toast';
import {
  descartar,
  getSolicitud,
  marcarEnRevision,
  type SolicitudDetalle,
  type SolicitudEstado,
} from '@/services/api/solicitudes';
import { WizardActivacion } from '../components/WizardActivacion';
import { cn } from '@/lib/cn';

const ESTADO_BADGE: Record<SolicitudEstado, string> = {
  recibida: 'bg-blue-50 text-blue-700 border-blue-200',
  en_revision: 'bg-amber-50 text-amber-700 border-amber-200',
  derivada: 'bg-violet-50 text-violet-700 border-violet-200',
  activada: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  descartada: 'bg-slate-100 text-slate-500 border-slate-200',
};

const ESTADO_LABEL: Record<SolicitudEstado, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  derivada: 'Derivada',
  activada: 'Activada',
  descartada: 'Descartada',
};

export function SolicitudDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const prompt = usePrompt();

  const [data, setData] = useState<SolicitudDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [observ, setObserv] = useState('');
  const [savingObserv, setSavingObserv] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await getSolicitud(id);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setData(res.data);
    setObserv(res.data.observaciones ?? '');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEnRevision() {
    if (!data) return;
    setSavingObserv(true);
    const res = await marcarEnRevision(data.id, observ.trim() || undefined);
    setSavingObserv(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Marcada en revisión');
    await load();
  }

  async function handleDescartar() {
    if (!data) return;
    const motivo = await prompt({
      title: 'Descartar solicitud',
      message:
        'Indicá el motivo del descarte. Se conservará el registro para auditoría.',
      placeholder: 'Ej: duplicada, fuera de alcance, datos incompletos…',
      confirmLabel: 'Descartar',
    });
    if (!motivo) return;
    const res = await descartar(data.id, motivo);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Solicitud descartada');
    navigate('/gerencia/solicitudes');
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <BrandLoader size={48} label="Cargando solicitud…" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-3 py-24 text-center">
        <AlertCircle className="mx-auto text-brand-muted" />
        <h2 className="font-display text-xl font-bold text-brand-ink">
          Solicitud no encontrada
        </h2>
        <Link
          to="/gerencia/solicitudes"
          className="text-sm font-medium text-brand-cyan hover:underline"
        >
          ← Volver al centro de solicitudes
        </Link>
      </div>
    );
  }

  const estado = (data.estado ?? 'recibida') as SolicitudEstado;
  const yaActivada = estado === 'activada';
  const yaDescartada = estado === 'descartada';

  return (
    <div className="relative mx-auto max-w-5xl space-y-6">
      <TrianglesAccent
        position="top-right"
        size={240}
        tone="cyan"
        density="soft"
        className="opacity-40"
      />

      {/* Breadcrumb + estado */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/gerencia/solicitudes"
          className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-cyan"
        >
          <ArrowLeft size={14} /> Solicitudes
        </Link>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider',
            ESTADO_BADGE[estado],
          )}
        >
          {ESTADO_LABEL[estado]}
        </span>
      </header>

      {/* Hero */}
      <section className="card-premium relative overflow-hidden p-6">
        <TrianglesAccent
          position="bottom-left"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-30"
        />
        <div className="relative">
          <p className="kicker text-brand-cyan">
            {data.formulario_categoria ?? 'Solicitud'}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            {data.formulario_titulo ??
              data.servicio_nombre ??
              'Servicio sin identificar'}
          </h1>
          <p className="mt-2 text-sm text-brand-muted">
            Recibida el{' '}
            <span className="text-brand-ink">
              {new Date(data.created_at ?? '').toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </p>
        </div>

        {/* Datos del solicitante */}
        <div className="relative mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <DataChip
            icon={User}
            label="Solicitante"
            value={data.solicitante_nombre ?? '—'}
          />
          <DataChip
            icon={Mail}
            label="Email"
            value={data.solicitante_email ?? '—'}
            href={
              data.solicitante_email ? `mailto:${data.solicitante_email}` : null
            }
          />
          <DataChip
            icon={Phone}
            label="Teléfono"
            value={data.solicitante_telefono ?? '—'}
            href={
              data.solicitante_telefono
                ? `tel:${data.solicitante_telefono}`
                : null
            }
          />
        </div>

        {/* Acciones principales */}
        {!yaActivada && !yaDescartada && (
          <div className="relative mt-6 flex flex-wrap gap-2">
            <Button onClick={() => setWizardOpen(true)}>
              <Sparkles size={15} />
              Abrir wizard de activación
            </Button>
            <Button variant="ghost" onClick={handleEnRevision} loading={savingObserv}>
              <Eye size={15} />
              Marcar en revisión
            </Button>
            <Button variant="ghost" onClick={handleDescartar}>
              <Trash2 size={15} />
              Descartar
            </Button>
          </div>
        )}
      </section>

      {/* Observaciones */}
      <section className="card-premium p-5">
        <p className="kicker mb-2 text-brand-cyan">Observaciones internas</p>
        <Field label="">
          <Textarea
            value={observ}
            onChange={(e) => setObserv(e.target.value)}
            placeholder="Notas internas del equipo de gerencia…"
            rows={3}
            disabled={yaActivada || yaDescartada}
          />
        </Field>
      </section>

      {/* Adjuntos del formulario */}
      <section className="card-premium p-5">
        <p className="kicker mb-3 text-brand-cyan">
          Adjuntos del solicitante ({data.submission_adjuntos.length})
        </p>
        {data.submission_adjuntos.length === 0 ? (
          <p className="text-sm text-brand-muted">
            No envió documentación con la solicitud.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.submission_adjuntos.map((a, i) => (
              <li key={i}>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-cyan hover:bg-brand-cyan-pale/30"
                >
                  <span className="flex items-center gap-2">
                    <Paperclip size={14} className="text-brand-cyan" />
                    <span className="font-medium text-brand-ink">
                      {a.nombre}
                    </span>
                    <span className="text-xs text-brand-muted">({a.campo})</span>
                  </span>
                  <FileText size={14} className="text-brand-muted" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Payload del formulario */}
      {data.submission_payload && (
        <section className="card-premium p-5">
          <p className="kicker mb-3 text-brand-cyan">Datos del formulario</p>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {Object.entries(data.submission_payload).map(([key, val]) => {
              if (val === null || val === undefined || val === '') return null;
              return (
                <div key={key}>
                  <dt className="kicker text-brand-muted">{key}</dt>
                  <dd className="break-words text-brand-ink">
                    {typeof val === 'object'
                      ? JSON.stringify(val)
                      : String(val)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      {/* Historial de derivaciones */}
      {data.derivaciones.length > 0 && (
        <section className="card-premium p-5">
          <p className="kicker mb-3 text-brand-cyan">
            Derivaciones a gestoría ({data.derivaciones.length})
          </p>
          <ul className="space-y-2">
            {data.derivaciones.map((d) => (
              <li
                key={d.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"
              >
                <Send className="mt-0.5 text-violet-500" size={14} />
                <div className="flex-1 min-w-0 text-sm">
                  <p className="font-medium text-brand-ink">
                    {d.destinatario_nombre ?? d.destinatario_email}
                  </p>
                  {d.destinatario_nombre && (
                    <p className="truncate text-xs text-brand-muted">
                      {d.destinatario_email}
                    </p>
                  )}
                  {d.observaciones && (
                    <p className="mt-1 text-xs text-brand-ink/80">
                      {d.observaciones}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] uppercase tracking-wider text-brand-muted">
                    {new Date(d.enviada_at ?? '').toLocaleString('es-AR')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Si ya activada, link al tracking */}
      {yaActivada && data.tramite_id && (
        <section className="card-premium border-2 border-emerald-200 bg-emerald-50/40 p-5">
          <p className="text-sm text-brand-ink">
            <Sparkles
              size={14}
              className="mr-1 inline text-emerald-600"
            />
            Esta solicitud ya fue activada como tracking.{' '}
            <Link
              to={`/gerencia/tramites/${data.tramite_id}`}
              className="font-semibold text-brand-cyan hover:underline"
            >
              Abrir el tracking →
            </Link>
          </p>
        </section>
      )}

      {/* Wizard */}
      <WizardActivacion
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        solicitud={data}
        onActivated={() => void load()}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------

function DataChip({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Loader2;
  label: string;
  value: string;
  href?: string | null;
}) {
  const inner = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
        <Icon size={14} />
      </span>
      <div className="min-w-0">
        <p className="kicker truncate text-brand-muted">{label}</p>
        <p className="truncate font-medium text-brand-ink">{value}</p>
      </div>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-cyan/50"
      >
        {inner}
      </a>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      {inner}
    </div>
  );
}
