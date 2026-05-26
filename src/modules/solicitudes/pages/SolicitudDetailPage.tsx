import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  ExternalLink,
  FileText,
  Mail,
  Paperclip,
  Phone,
  Reply,
  Sparkles,
  Trash2,
  User,
  Loader2,
  Send,
  X,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
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
  responderSolicitud,
  restaurarSolicitud,
  type RespuestaCasilla,
  type SolicitudDetalle,
  type SolicitudEstado,
} from '@/services/api/solicitudes';
import { WizardActivacion } from '../components/WizardActivacion';
import { cn } from '@/lib/cn';

// Categorías para clasificar la respuesta. Todas envían desde contacto@
// gestionglobal.ar (decisión 2026-05-26: única casilla real); las "casillas"
// quedan como metadata interna del tipo de comunicación.
const CASILLAS_RESPUESTA: { value: RespuestaCasilla; label: string }[] = [
  { value: 'tramites', label: 'Trámites' },
  { value: 'info', label: 'Info' },
  { value: 'cursos', label: 'Cursos' },
  { value: 'facturacion', label: 'Facturación' },
  { value: 'recupero', label: 'Recupero' },
];

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
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<SolicitudDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [observ, setObserv] = useState('');
  const [savingObserv, setSavingObserv] = useState(false);
  // 1.B · lightbox de adjuntos.
  const [lightbox, setLightbox] = useState<{
    url: string;
    nombre: string;
  } | null>(null);
  // 1.H · modal "Responder".
  const [responderOpen, setResponderOpen] = useState(false);

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

  // 1.D · si llegamos con ?wizard=derivar (acción rápida desde la card),
  // abrimos el wizard en su paso 1 y limpiamos el query param.
  useEffect(() => {
    if (searchParams.get('wizard') === 'derivar' && data) {
      setWizardOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('wizard');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, data]);

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
    const solId = data.id;
    const res = await descartar(solId, motivo);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    // 1.F · red de seguridad: 8 s de gracia para deshacer (Gmail "Undo send").
    // 8s y no 5s: con latencia real 5s era ajustado para alcanzar a clickear.
    toast.success('Solicitud descartada', {
      duration: 8000,
      action: {
        label: 'Deshacer',
        onClick: async () => {
          const r = await restaurarSolicitud(solId);
          if (!r.ok) {
            toast.error('No pudimos restaurar', { description: r.error.message });
            return;
          }
          toast.success('Solicitud restaurada');
          // Si seguimos en el detalle, recargamos; si navegamos, volvemos.
          await load();
        },
      },
    });
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
            {/* 1.H · responder desde la plataforma (motor Workspace). */}
            {data.solicitante_email && (
              <Button variant="secondary" onClick={() => setResponderOpen(true)}>
                <Reply size={15} />
                Responder
              </Button>
            )}
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
                {/* 1.B · click abre el lightbox (PDF iframe / imagen img); el
                    ícono abre en pestaña como fallback. */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm transition hover:border-brand-cyan hover:bg-brand-cyan-pale/30">
                  <button
                    type="button"
                    onClick={() => setLightbox({ url: a.url, nombre: a.nombre })}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <Paperclip size={14} className="text-brand-cyan" />
                    <span className="font-medium text-brand-ink">{a.nombre}</span>
                    <span className="text-xs text-brand-muted">({a.campo})</span>
                  </button>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 rounded p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
                    title="Abrir en pestaña nueva"
                    aria-label={`Abrir ${a.nombre} en pestaña nueva`}
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Payload del formulario · 1.C · labels legibles del schema. */}
      {data.submission_payload && (
        <section className="card-premium p-5">
          <p className="kicker mb-3 text-brand-cyan">Datos del formulario</p>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {payloadEnOrden(data.submission_payload, data.formulario_schema).map(
              (entry) => (
                <div key={entry.name}>
                  <dt className="kicker text-brand-muted">{entry.label}</dt>
                  <dd className="break-words text-brand-ink">
                    {entry.valor}
                  </dd>
                </div>
              ),
            )}
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
            {/* 7.A · link al TrackingDetailPage nuevo (no al legacy). */}
            <Link
              to={`/gerencia/trackings/${data.tramite_id}`}
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

      {/* 1.B · lightbox de adjuntos */}
      <AdjuntoLightbox
        adjunto={lightbox}
        onClose={() => setLightbox(null)}
      />

      {/* 1.H · modal "Responder" */}
      {data.solicitante_email && (
        <ResponderModal
          open={responderOpen}
          onClose={() => setResponderOpen(false)}
          solicitudId={data.id}
          destinatario={data.solicitante_email}
          asuntoSugerido={`Re: ${
            data.formulario_titulo ?? data.servicio_nombre ?? 'tu solicitud'
          } · Gestión Global`}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// 1.B · Lightbox de adjuntos. PDFs en <iframe>, imágenes en <img>, resto con
// fallback "abrir en pestaña". Detecta el tipo por extensión de la URL.
// ----------------------------------------------------------------------------
function AdjuntoLightbox({
  adjunto,
  onClose,
}: {
  adjunto: { url: string; nombre: string } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!adjunto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adjunto, onClose]);

  if (!adjunto) return null;

  const ext = (adjunto.url.split('?')[0]?.split('.').pop() ?? '').toLowerCase();
  const esPdf = ext === 'pdf';
  const esImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'].includes(ext);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-brand-ink/70 p-4 backdrop-blur-sm motion-safe:animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa de ${adjunto.nombre}`}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-brand-ink">
            <Paperclip size={14} className="shrink-0 text-brand-cyan" />
            <span className="truncate">{adjunto.nombre}</span>
          </span>
          <div className="flex items-center gap-1">
            <a
              href={adjunto.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md p-1.5 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
              title="Abrir en pestaña nueva"
            >
              <ExternalLink size={16} />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-brand-muted transition hover:bg-slate-100"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="grid flex-1 place-items-center overflow-auto bg-slate-50">
          {esPdf ? (
            <iframe
              src={adjunto.url}
              title={adjunto.nombre}
              className="h-[75vh] w-full border-0"
            />
          ) : esImg ? (
            <img
              src={adjunto.url}
              alt={adjunto.nombre}
              className="max-h-[75vh] w-auto object-contain"
            />
          ) : (
            <div className="grid place-items-center gap-3 p-12 text-center">
              <FileText size={40} className="text-brand-muted" />
              <p className="text-sm text-brand-muted">
                No podemos previsualizar este tipo de archivo.
              </p>
              <a
                href={adjunto.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-blue"
              >
                <ExternalLink size={14} /> Abrir en pestaña nueva
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// 1.H · Modal "Responder". Textarea + asunto pre-cargado + FROM elegible.
// Persiste vía RPC solicitud_responder (encola + audita en sent_emails).
// ----------------------------------------------------------------------------
function ResponderModal({
  open,
  onClose,
  solicitudId,
  destinatario,
  asuntoSugerido,
}: {
  open: boolean;
  onClose: () => void;
  solicitudId: string;
  destinatario: string;
  asuntoSugerido: string;
}) {
  const [asunto, setAsunto] = useState(asuntoSugerido);
  const [cuerpo, setCuerpo] = useState('');
  const [casilla, setCasilla] = useState<RespuestaCasilla>('tramites');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (open) {
      setAsunto(asuntoSugerido);
      setCuerpo('');
      setCasilla('tramites');
    }
  }, [open, asuntoSugerido]);

  async function handleEnviar() {
    if (!cuerpo.trim()) {
      toast.error('Escribí un mensaje antes de enviar');
      return;
    }
    setEnviando(true);
    const res = await responderSolicitud(solicitudId, {
      asunto: asunto.trim(),
      cuerpo: cuerpo.trim(),
      fromCasilla: casilla,
    });
    setEnviando(false);
    if (!res.ok) {
      toast.error('No pudimos enviar la respuesta', {
        description: res.error.message,
      });
      return;
    }
    toast.success('Respuesta enviada', {
      description: 'Quedó registrada en el historial de la solicitud.',
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Responder al solicitante"
      kicker="Email desde Gestión Global"
      icon={<Reply className="h-5 w-5 text-brand-cyan" />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void handleEnviar()} loading={enviando}>
            <Send size={14} /> Enviar respuesta
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Para">
          <Input value={destinatario} disabled />
        </Field>
        <Field
          label="Categoría"
          hint="Se envía desde contacto@gestionglobal.ar · la categoría es sólo para tracking interno."
        >
          <Select
            value={casilla}
            onChange={(e) => setCasilla(e.target.value as RespuestaCasilla)}
          >
            {CASILLAS_RESPUESTA.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Asunto">
          <Input value={asunto} onChange={(e) => setAsunto(e.target.value)} />
        </Field>
        <Field label="Mensaje" required>
          <Textarea
            rows={6}
            value={cuerpo}
            onChange={(e) => setCuerpo(e.target.value)}
            placeholder="Escribí tu respuesta…"
          />
        </Field>
        <p className="text-xs text-brand-muted">
          La respuesta se envía por el motor de email de Gestión Global y queda
          registrada en el historial de la solicitud.
        </p>
      </div>
    </Modal>
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

// 1.C · humaniza una key cruda ("dni_solicitante" → "Dni solicitante").
function humanize(key: string): string {
  const base = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// 1.C · extrae lista de campos del schema del builder, recorriendo
// secciones cuando aplica. Tolera schemas de distintos shapes.
type CampoSchema = { name: string; label: string };
function camposDelSchema(schema: unknown): CampoSchema[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: CampoSchema[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.name === 'string') {
      out.push({
        name: obj.name,
        label:
          typeof obj.label === 'string' && obj.label.trim()
            ? obj.label
            : humanize(obj.name),
      });
    }
    if (Array.isArray(obj.fields)) obj.fields.forEach(visit);
    if (Array.isArray(obj.secciones)) obj.secciones.forEach(visit);
    if (Array.isArray(obj.sections)) obj.sections.forEach(visit);
    if (Array.isArray(obj.campos)) obj.campos.forEach(visit);
  };
  visit(schema);
  return out;
}

// 1.C · ordena las entries por el orden del schema y resuelve labels.
function payloadEnOrden(
  payload: Record<string, unknown>,
  schema: unknown,
): Array<{ name: string; label: string; valor: string }> {
  const campos = camposDelSchema(schema);
  const indexByName = new Map(campos.map((c, i) => [c.name, i] as const));
  const renderValue = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    return String(v);
  };

  const entries = Object.entries(payload).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );
  entries.sort(([a], [b]) => {
    const ai = indexByName.get(a) ?? 999;
    const bi = indexByName.get(b) ?? 999;
    return ai - bi;
  });

  return entries.map(([k, v]) => {
    const def = campos.find((c) => c.name === k);
    return {
      name: k,
      label: def?.label ?? humanize(k),
      valor: renderValue(v),
    };
  });
}
