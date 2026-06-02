import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  MessageCircle,
  Paperclip,
  Send,
  User,
  AlertTriangle,
  History,
  Download,
  Trash2,
  X,
  Plus,
} from 'lucide-react';
import {
  Button,
  Tabs,
  AnimatedNumber,
  CopyButton,
  useConfirm,
  Select,
  Textarea,
  Field,
} from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateTime } from '@/lib/dates';
import { cn } from '@/lib/cn';
import {
  getTramite,
  updateTramite,
  addComentario,
  subirAdjunto,
  urlFirmadaAdjunto,
  eliminarAdjunto,
  incrementarVistas,
  computeSla,
  TRAMITE_ESTADOS,
  TRAMITE_PRIORIDADES,
  TRAMITE_ESTADO_LABEL,
  TRAMITE_PRIORIDAD_LABEL,
  TRAMITE_CATEGORIA_LABEL,
  type TramiteDetail,
  type TramiteEstado,
  type TramitePrioridad,
  type TramiteCategoria,
  type TramiteAdjuntoRow,
} from '@/services/api/tramites';
import { humanizeError } from '@/lib/errors';

type TabKey = 'detalle' | 'comentarios' | 'adjuntos' | 'historial';

const ESTADO_BG: Record<TramiteEstado, string> = {
  abierto: 'from-blue-500 to-blue-700',
  en_progreso: 'from-cyan-500 to-cyan-700',
  esperando_cliente: 'from-amber-500 to-amber-700',
  resuelto: 'from-emerald-500 to-emerald-700',
  cerrado: 'from-slate-500 to-slate-700',
  cancelado: 'from-red-500 to-red-700',
};

export function TramiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<TramiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('detalle');
  // DGG-33 · removido `staffList` (era para el selector "Asignar a"). Esta
  // página ya no se rutea (la legacy `/gerencia/tramites/:id` redirige a
  // `/gerencia/trackings/:id`), pero limpiamos el código muerto.

  async function load() {
    if (!id) return;
    setLoading(true);
    const res = await getTramite(id);
    setLoading(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      navigate('/gerencia/tramites');
      return;
    }
    setData(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Incrementar vista 1 vez
  useEffect(() => {
    if (!id) return;
    void incrementarVistas(id);
  }, [id]);

  // DGG-33 · removido useEffect que cargaba staffList para el selector
  // "Asignar a..." (ahora no hay asignaciones individuales).

  useRealtimeRefresh(
    ['tramites', 'tramite_comentarios', 'tramite_eventos', 'tramite_adjuntos'],
    () => void load(),
    280,
  );

  const sla = useMemo(() => (data ? computeSla(data) : null), [data]);

  if (loading || !data) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <BrandLoader />
      </div>
    );
  }

  async function patch<K extends keyof TramiteDetail>(
    field: K,
    value: TramiteDetail[K],
  ) {
    if (!data) return;
    const res = await updateTramite(data.id, { [field]: value } as never);
    if (!res.ok) {
      toast.error(`No se pudo actualizar: ${humanizeError(res.error)}`);
      return;
    }
    void load();
    toast.success('Actualizado');
  }

  const estadoBgCls = ESTADO_BG[data.estado as TramiteEstado];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Link
          to="/gerencia/tramites"
          className="inline-flex items-center gap-1 text-sm text-brand-muted hover:text-brand-cyan"
        >
          <ArrowLeft size={14} /> Volver a trámites
        </Link>
      </div>

      {/* Cover gradient */}
      <header
        className={cn(
          'relative overflow-hidden rounded-2xl bg-gradient-to-br p-6 text-white sm:p-8',
          estadoBgCls,
        )}
      >
        <TrianglesAccent
          position="top-right"
          size={180}
          tone="cyan"
          density="soft"
          className="opacity-15"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 backdrop-blur">
                <Briefcase size={17} />
              </span>
              <span className="font-mono text-sm uppercase tracking-wider opacity-90">
                {data.codigo}
              </span>
              <CopyButton value={data.codigo} />
            </div>
            <h1 className="font-display text-2xl font-bold sm:text-3xl">
              {data.titulo}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Chip>
                {TRAMITE_ESTADO_LABEL[data.estado as TramiteEstado]}
              </Chip>
              <Chip>
                {TRAMITE_PRIORIDAD_LABEL[data.prioridad as TramitePrioridad]}
              </Chip>
              <Chip>
                {TRAMITE_CATEGORIA_LABEL[data.categoria as TramiteCategoria]}
              </Chip>
              {data.administracion && (
                <Chip>
                  <Link
                    to={`/gerencia/clientes/${data.administracion.id}`}
                    className="hover:underline"
                  >
                    {data.administracion.nombre}
                  </Link>
                </Chip>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock
          icon={Clock}
          label="Días abierto"
          value={<AnimatedNumber value={sla?.diasAbierto ?? 0} />}
        />
        <StatBlock
          icon={Calendar}
          label="Vence"
          value={
            sla?.diasRestantes === null ? (
              <span className="text-brand-muted">—</span>
            ) : sla?.vencido ? (
              <span className="text-red-700">
                Hace {Math.abs(sla.diasRestantes ?? 0)}d
              </span>
            ) : (
              <span
                className={cn(
                  sla && sla.diasRestantes !== null && sla.diasRestantes <= 1
                    ? 'text-red-700'
                    : sla && sla.diasRestantes !== null && sla.diasRestantes <= 3
                      ? 'text-amber-700'
                      : 'text-emerald-700',
                )}
              >
                en {sla?.diasRestantes ?? 0}d
              </span>
            )
          }
        />
        <StatBlock
          icon={MessageCircle}
          label="Comentarios"
          value={<AnimatedNumber value={data.total_comentarios} />}
        />
        <StatBlock
          icon={Paperclip}
          label="Adjuntos"
          value={<AnimatedNumber value={data.total_adjuntos} />}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Main content */}
        <div className="min-w-0 space-y-4">
          <Tabs
            items={[
              { key: 'detalle', label: 'Detalle', icon: <FileText size={14} /> },
              {
                key: 'comentarios',
                label: 'Comentarios',
                icon: <MessageCircle size={14} />,
                badge: data.comentarios.length,
              },
              {
                key: 'adjuntos',
                label: 'Adjuntos',
                icon: <Paperclip size={14} />,
                badge: data.adjuntos.length,
              },
              {
                key: 'historial',
                label: 'Historial',
                icon: <History size={14} />,
                badge: data.eventos.length,
              },
            ]}
            activeKey={tab}
            onChange={(k) => setTab(k as TabKey)}
          />

          {tab === 'detalle' && <DetallePane data={data} />}
          {tab === 'comentarios' && (
            <ComentariosPane
              data={data}
              currentUserId={user?.id ?? null}
              onChanged={() => void load()}
            />
          )}
          {tab === 'adjuntos' && (
            <AdjuntosPane data={data} onChanged={() => void load()} />
          )}
          {tab === 'historial' && <HistorialPane data={data} />}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="card-premium space-y-3 p-4">
            <h3 className="kicker">Estado</h3>
            <Select
              value={data.estado}
              onChange={(e) => void patch('estado', e.target.value as never)}
            >
              {TRAMITE_ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {TRAMITE_ESTADO_LABEL[e]}
                </option>
              ))}
            </Select>
          </div>
          <div className="card-premium space-y-3 p-4">
            <h3 className="kicker">Prioridad</h3>
            <Select
              value={data.prioridad}
              onChange={(e) => void patch('prioridad', e.target.value as never)}
            >
              {TRAMITE_PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {TRAMITE_PRIORIDAD_LABEL[p]}
                </option>
              ))}
            </Select>
          </div>
          {/* DGG-33: removido sidebar "Asignado a" (no hay asignaciones
              individuales). */}
          <div className="card-premium space-y-3 p-4">
            <h3 className="kicker">Vencimiento</h3>
            <input
              type="date"
              value={data.vence_at ? data.vence_at.slice(0, 10) : ''}
              onChange={(e) =>
                void patch(
                  'vence_at',
                  (e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null) as never,
                )
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
            />
          </div>
          <div className="card-premium space-y-2 p-4 text-xs text-brand-muted">
            <p>
              <span className="font-medium text-brand-ink">Creado:</span>{' '}
              {formatDateTime(data.created_at)}
            </p>
            {data.creador?.full_name && (
              <p>
                <span className="font-medium text-brand-ink">Por:</span>{' '}
                {data.creador.full_name}
              </p>
            )}
            {data.resuelto_at && (
              <p>
                <span className="font-medium text-brand-ink">Resuelto:</span>{' '}
                {formatDateTime(data.resuelto_at)}
                {data.resolutor?.full_name && ` · ${data.resolutor.full_name}`}
              </p>
            )}
            <p>
              <span className="font-medium text-brand-ink">Vistas:</span>{' '}
              {data.total_vistas}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
      {children}
    </span>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="card-premium p-4">
      <div className="flex items-center gap-2 text-brand-muted">
        <Icon size={14} />
        <p className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className="mt-1 font-display text-xl font-bold text-brand-ink">
        {value}
      </p>
    </div>
  );
}

// -------------------- Panes --------------------

function DetallePane({ data }: { data: TramiteDetail }) {
  return (
    <section className="card-premium space-y-4 p-5">
      <div>
        <p className="kicker">Descripción</p>
        {data.descripcion ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink">
            {data.descripcion}
          </p>
        ) : (
          <p className="mt-1 text-sm italic text-brand-muted">
            Sin descripción
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <DetailRow label="Solicitante">
          {data.solicitante_nombre ? (
            <>
              <p className="text-sm">{data.solicitante_nombre}</p>
              {data.solicitante_email && (
                <p className="text-xs text-brand-muted">
                  {data.solicitante_email}
                </p>
              )}
              {data.solicitante_telefono && (
                <p className="text-xs text-brand-muted">
                  {data.solicitante_telefono}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm italic text-brand-muted">—</p>
          )}
        </DetailRow>
        <DetailRow label="Cliente">
          {data.administracion ? (
            <Link
              to={`/gerencia/clientes/${data.administracion.id}`}
              className="text-sm text-brand-cyan hover:underline"
            >
              {data.administracion.nombre}
            </Link>
          ) : (
            <p className="text-sm italic text-brand-muted">Sin cliente</p>
          )}
          {data.consorcio?.nombre && (
            <p className="text-xs text-brand-muted">
              · {data.consorcio.nombre}
            </p>
          )}
        </DetailRow>
        {data.comprobante && (
          <DetailRow label="Comprobante vinculado">
            <Link
              to={`/gerencia/facturacion/${data.comprobante.id}`}
              className="text-sm text-brand-cyan hover:underline"
            >
              {data.comprobante.tipo} {String(data.comprobante.punto_venta).padStart(5, '0')}-
              {data.comprobante.numero
                ? String(data.comprobante.numero).padStart(8, '0')
                : '—'}
            </Link>
          </DetailRow>
        )}
        {data.submission && (
          <DetailRow label="Formulario de origen">
            <p className="text-sm text-brand-muted">
              Submission del{' '}
              <span className="font-medium text-brand-ink">
                {formatDateTime(data.submission.created_at)}
              </span>
            </p>
          </DetailRow>
        )}
      </div>
    </section>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="kicker">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// -------------------- Comentarios --------------------

function ComentariosPane({
  data,
  currentUserId,
  onChanged,
}: {
  data: TramiteDetail;
  currentUserId: string | null;
  onChanged: () => void;
}) {
  const [contenido, setContenido] = useState('');
  const [visible, setVisible] =
    useState<'todos' | 'cliente' | 'staff'>('todos');
  const [sending, setSending] = useState(false);

  async function onSend() {
    if (!contenido.trim()) return;
    setSending(true);
    const res = await addComentario(data.id, contenido.trim(), visible);
    setSending(false);
    if (!res.ok) {
      toast.error(`No se pudo enviar: ${humanizeError(res.error)}`);
      return;
    }
    setContenido('');
    onChanged();
    toast.success('Comentario agregado');
  }

  return (
    <section className="space-y-4">
      <div className="card-premium space-y-3 p-4">
        <Field label="Tu comentario">
          <Textarea
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            placeholder="Escribí una actualización, una respuesta al cliente, una nota interna…"
            rows={3}
          />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-brand-muted">Visible para</label>
            <Select
              value={visible}
              onChange={(e) =>
                setVisible(e.target.value as 'todos' | 'cliente' | 'staff')
              }
              className="!w-auto"
            >
              <option value="todos">Cliente + staff</option>
              <option value="staff">Solo staff (nota interna)</option>
              <option value="cliente">Solo cliente</option>
            </Select>
          </div>
          <Button onClick={() => void onSend()} disabled={sending || !contenido.trim()}>
            <Send size={14} /> {sending ? 'Enviando…' : 'Comentar'}
          </Button>
        </div>
      </div>

      {data.comentarios.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-brand-muted">
          Aún no hay comentarios. Sé el primero en escribir.
        </p>
      ) : (
        <ol className="space-y-3">
          {data.comentarios.map((c) => {
            const mine = c.autor_id === currentUserId;
            return (
              <li
                key={c.id}
                className={cn(
                  'card-premium p-4 motion-safe:animate-fade-up',
                  c.visible_para === 'staff' &&
                    'border-amber-200/70 bg-amber-50/50',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white',
                      c.autor_role === 'administrador'
                        ? 'bg-brand-teal'
                        : 'bg-brand-cyan',
                    )}
                  >
                    {(c.autor_nombre ?? '?')
                      .split(/\s+/)
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-brand-muted">
                      <span className="font-medium text-brand-ink">
                        {c.autor_nombre ?? 'Anónimo'}
                        {mine && (
                          <span className="ml-1 text-[10px] text-brand-muted">
                            (vos)
                          </span>
                        )}
                      </span>
                      <span>·</span>
                      <span>{formatDateTime(c.created_at)}</span>
                      {c.visible_para === 'staff' && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          Nota interna
                        </span>
                      )}
                      {c.visible_para === 'cliente' && (
                        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          Solo cliente
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-brand-ink">
                      {c.contenido}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// -------------------- Adjuntos --------------------

function AdjuntosPane({
  data,
  onChanged,
}: {
  data: TramiteDetail;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    mime: string | null;
    filename: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      const res = await subirAdjunto(data.id, f);
      if (res.ok) ok++;
      else toast.error(`${f.name}: ${humanizeError(res.error)}`);
    }
    setUploading(false);
    if (ok > 0) toast.success(`${ok} archivo(s) subido(s)`);
    onChanged();
    if (inputRef.current) inputRef.current.value = '';
  }

  async function abrirPreview(a: TramiteAdjuntoRow) {
    const res = await urlFirmadaAdjunto(a.storage_path, 900);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setPreview({
      url: res.data,
      mime: a.mime_type,
      filename: a.filename_original,
    });
  }

  async function onDelete(a: TramiteAdjuntoRow) {
    const ok = await confirm({
      title: 'Eliminar adjunto',
      message: `Vas a eliminar "${a.filename_original}". Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarAdjunto(a);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Adjunto eliminado');
    onChanged();
  }

  return (
    <section className="space-y-3">
      <div className="card-premium flex items-center justify-between gap-3 p-4">
        <p className="text-sm text-brand-muted">
          Subí PDFs, imágenes y documentos. Hasta 10 MB cada uno.
        </p>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-blue">
          <Plus size={14} />
          {uploading ? 'Subiendo…' : 'Adjuntar'}
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </label>
      </div>

      {data.adjuntos.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-brand-muted">
          Sin adjuntos por ahora.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {data.adjuntos.map((a) => (
            <li
              key={a.id}
              className="card-premium flex items-center gap-3 p-3 motion-safe:animate-fade-up"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
                <Paperclip size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => void abrirPreview(a)}
                  className="block w-full truncate text-left text-sm font-medium text-brand-ink hover:text-brand-cyan"
                >
                  {a.filename_original}
                </button>
                <p className="text-[11px] text-brand-muted">
                  {a.mime_type ?? 'archivo'} ·{' '}
                  {a.size_bytes
                    ? `${(a.size_bytes / 1024).toFixed(0)} KB`
                    : '—'}{' '}
                  · {formatDateTime(a.uploaded_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onDelete(a)}
                className="rounded-md p-1.5 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
                aria-label="Eliminar adjunto"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-brand-ink/70 p-4 motion-safe:animate-fade-up"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="truncate text-sm font-medium text-brand-ink">
                {preview.filename}
              </p>
              <div className="flex items-center gap-1">
                <a
                  href={preview.url}
                  download={preview.filename}
                  className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                  aria-label="Descargar"
                >
                  <Download size={14} />
                </a>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                  aria-label="Cerrar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="grid max-h-[80vh] place-items-center overflow-auto bg-slate-50">
              {preview.mime?.startsWith('image/') ? (
                <img
                  src={preview.url}
                  alt={preview.filename}
                  className="max-h-[80vh] object-contain"
                />
              ) : preview.mime === 'application/pdf' ? (
                <iframe
                  title={preview.filename}
                  src={preview.url}
                  className="h-[80vh] w-full border-0"
                />
              ) : (
                <div className="p-12 text-center text-sm text-brand-muted">
                  <p>No podemos previsualizar este tipo de archivo.</p>
                  <a
                    href={preview.url}
                    download={preview.filename}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue"
                  >
                    <Download size={12} /> Descargar
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// -------------------- Historial --------------------

function HistorialPane({ data }: { data: TramiteDetail }) {
  if (data.eventos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-brand-muted">
        Sin eventos registrados.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {data.eventos.map((e, idx) => {
        const meta = describeEvento(e);
        const isLast = idx === data.eventos.length - 1;
        return (
          <li
            key={e.id}
            className="relative flex gap-3 pb-3 motion-safe:animate-fade-up"
            style={{ animationDelay: `${Math.min(idx, 12) * 30}ms` }}
          >
            {!isLast && (
              <span className="absolute left-[15px] top-7 bottom-0 w-px bg-slate-200" />
            )}
            <span
              className={cn(
                'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white',
                meta.tone,
              )}
            >
              <meta.Icon size={13} />
            </span>
            <div className="min-w-0 flex-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
              <p className="text-brand-ink">{meta.label}</p>
              <p className="text-[11px] text-brand-muted">
                {e.actor_nombre ?? 'Sistema'} ·{' '}
                {formatDateTime(e.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function describeEvento(e: TramiteDetail['eventos'][number]) {
  const data = (e.data ?? {}) as Record<string, unknown>;
  switch (e.tipo) {
    case 'creado':
      return {
        Icon: Plus,
        tone: 'bg-emerald-500',
        label: 'Trámite creado',
      };
    case 'asignado':
      return {
        Icon: User,
        tone: 'bg-brand-cyan',
        label: 'Asignación actualizada',
      };
    case 'desasignado':
      return {
        Icon: User,
        tone: 'bg-slate-400',
        label: 'Desasignado',
      };
    case 'cambio_estado': {
      const desde = data.desde as string | undefined;
      const hasta = data.hasta as string | undefined;
      return {
        Icon: Clock,
        tone: 'bg-blue-500',
        label: `Estado: ${TRAMITE_ESTADO_LABEL[(desde as TramiteEstado) ?? 'abierto'] ?? desde} → ${TRAMITE_ESTADO_LABEL[(hasta as TramiteEstado) ?? 'abierto'] ?? hasta}`,
      };
    }
    case 'cambio_prioridad': {
      const desde = data.desde as string | undefined;
      const hasta = data.hasta as string | undefined;
      return {
        Icon: AlertTriangle,
        tone: 'bg-orange-500',
        label: `Prioridad: ${desde} → ${hasta}`,
      };
    }
    case 'comentario':
      return {
        Icon: MessageCircle,
        tone: 'bg-violet-500',
        label: 'Nuevo comentario',
      };
    case 'adjunto':
      return {
        Icon: Paperclip,
        tone: 'bg-amber-500',
        label: `Adjunto: ${(data.filename as string) ?? 'archivo'}`,
      };
    case 'resuelto':
      return {
        Icon: CheckCircle2,
        tone: 'bg-emerald-600',
        label: 'Trámite resuelto/cerrado',
      };
    case 'reabierto':
      return {
        Icon: AlertTriangle,
        tone: 'bg-amber-600',
        label: 'Trámite reabierto',
      };
    default:
      return {
        Icon: Clock,
        tone: 'bg-slate-400',
        label: e.tipo,
      };
  }
}
