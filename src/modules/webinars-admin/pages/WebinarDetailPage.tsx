import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  ExternalLink,
  Video,
  Youtube,
  Users,
  Clock,
  CheckCircle2,
  Copy as CopyIcon,
  Link2,
  Megaphone,
  Image as ImageIcon,
  GraduationCap,
  Plus,
  Trash2,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { Button, Field, Input, Modal, Textarea } from '@/components/common';
import { ImageUploader } from '@/modules/campus/components/ImageUploader';
import { listarEsquemas } from '@/services/api/certificado-esquemas';
import { toast } from '@/lib/toast';
import {
  getWebinar,
  listInscriptos,
  listInscriptoTokens,
  inscribirManual,
  crearReunionZoom,
  actualizarWebinar,
  emitirCertificadosWebinarLote,
  parseDocentes,
  type WebinarRow,
  type WebinarDocente,
  type InscriptoConCanal,
} from '@/services/api/webinars';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

// F6 (DGG-63) · ¿el webinar está "vigente" para inscripción? Espeja la regla
// SQL de webinar_inscripcion_activa(): no cancelado y now() < inicio+duración.
function esWebinarVigente(w: WebinarRow): boolean {
  if (w.status === 'cancelado') return false;
  const fin = new Date(w.fecha_hora).getTime() + (w.duracion_min ?? 0) * 60_000;
  return Date.now() < fin;
}

// ISO almacenado → partes locales para los inputs date/time (mismo criterio
// que el alta: el ISO se arma con hora local del browser).
function isoToLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

type Tab = 'config' | 'inscriptos' | 'asistencia';

function fmtFecha(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtDuracion(seg: number): string {
  if (seg < 60) return `${seg}s`;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}m ${s}s`;
}

export function WebinarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [webinar, setWebinar] = useState<WebinarRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('config');
  const [inscriptos, setInscriptos] = useState<InscriptoConCanal[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [creatingZoom, setCreatingZoom] = useState(false);
  const [inscribirModalOpen, setInscribirModalOpen] = useState(false);

  async function recargar() {
    if (!id) return;
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      getWebinar(id),
      listInscriptos(id),
      listInscriptoTokens(id),
    ]);
    setLoading(false);
    if (r1.ok) setWebinar(r1.data);
    if (r2.ok) setInscriptos(r2.data);
    if (r3.ok) {
      const map: Record<string, string> = {};
      r3.data.forEach((t) => { map[t.inscripto_id] = t.token; });
      setTokens(map);
    }
  }
  useEffect(() => { void recargar(); }, [id]);

  async function onCrearZoom() {
    if (!webinar) return;
    setCreatingZoom(true);
    const res = await crearReunionZoom({ webinarId: webinar.id });
    setCreatingZoom(false);
    if (!res.ok) {
      toast.error('No pudimos crear la reunión Zoom', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Reunión Zoom creada · webhooks activos');
    void recargar();
  }

  if (loading || !webinar) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
        Cargando webinar…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/gerencia/formularios/webinars" className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-brand-cyan">
            <ArrowLeft size={12} /> Volver a Webinars
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {webinar.titulo}
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            <Clock size={12} className="inline" /> {fmtFecha(webinar.fecha_hora)} · {webinar.duracion_min} min
          </p>
        </div>
        <span className={cn(
          'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider',
          webinar.status === 'en_curso' ? 'border-red-200 bg-red-50 text-red-700 animate-pulse' :
          webinar.status === 'finalizado' ? 'border-green-200 bg-green-50 text-green-700' :
          webinar.status === 'cancelado' ? 'border-amber-200 bg-amber-50 text-amber-700' :
          'border-slate-200 bg-slate-50 text-slate-700'
        )}>
          {webinar.status === 'en_curso' ? '● En vivo' : webinar.status === 'finalizado' ? 'Finalizado' : webinar.status === 'cancelado' ? 'Cancelado' : 'Programado'}
        </span>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton active={tab === 'config'} onClick={() => setTab('config')}>Configuración</TabButton>
        <TabButton active={tab === 'inscriptos'} onClick={() => setTab('inscriptos')}>
          Inscriptos ({inscriptos.length})
        </TabButton>
        <TabButton active={tab === 'asistencia'} onClick={() => setTab('asistencia')}>Asistencia</TabButton>
      </div>

      {tab === 'config' && (
        <ConfigTab webinar={webinar} onCrearZoom={onCrearZoom} creatingZoom={creatingZoom} onRecargar={recargar} />
      )}

      {tab === 'inscriptos' && (
        <InscriptosTab
          inscriptos={inscriptos}
          tokens={tokens}
          onAbrirInscribir={() => setInscribirModalOpen(true)}
        />
      )}

      {tab === 'asistencia' && (
        <AsistenciaTab inscriptos={inscriptos} webinar={webinar} />
      )}

      {inscribirModalOpen && (
        <InscribirManualModal
          webinarId={webinar.id}
          onClose={() => setInscribirModalOpen(false)}
          onCreated={() => { setInscribirModalOpen(false); void recargar(); }}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-t-lg px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-b-2 border-brand-cyan bg-brand-cyan/5 text-brand-ink'
          : 'border-b-2 border-transparent text-brand-muted hover:bg-slate-50 hover:text-brand-ink',
      )}
    >
      {children}
    </button>
  );
}

function ConfigTab({ webinar, onCrearZoom, creatingZoom, onRecargar }: {
  webinar: WebinarRow;
  onCrearZoom: () => void;
  creatingZoom: boolean;
  onRecargar: () => Promise<void>;
}) {
  const tieneZoom = !!webinar.zoom_meeting_id;
  const tieneYoutube = !!webinar.youtube_live_url;
  const [editingYoutube, setEditingYoutube] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState(webinar.youtube_live_url ?? '');
  const [savingYoutube, setSavingYoutube] = useState(false);

  async function saveYoutube() {
    setSavingYoutube(true);
    const res = await actualizarWebinar(webinar.id, { youtubeLiveUrl: youtubeUrl.trim() || null });
    setSavingYoutube(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('YouTube Live URL guardada');
    setEditingYoutube(false);
    void onRecargar();
  }

  return (
    <div className="space-y-4">
      {/* F6 (DGG-63) · Publicación + identidad del webinar (esquema tipo curso) */}
      <PublicacionCard webinar={webinar} onRecargar={onRecargar} />
      <DatosWebinarCard webinar={webinar} onRecargar={onRecargar} />
      <BannerCard webinar={webinar} onRecargar={onRecargar} />
      <DocentesCard webinar={webinar} onRecargar={onRecargar} />

      <div className="grid gap-4 md:grid-cols-2">
      {/* Canal Zoom */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Video size={18} className="text-blue-600" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Canal Zoom</h2>
          <span className="ml-auto rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
            Cupo {webinar.cupo_zoom ?? '∞'}
          </span>
        </div>
        {!tieneZoom ? (
          <>
            <p className="text-sm text-brand-muted">
              No hay sala Zoom creada. Al crearla, los inscriptos hasta el cupo entran por Zoom.
            </p>
            <Button onClick={onCrearZoom} loading={creatingZoom} className="mt-3 w-full">
              <Video size={14} /> Crear sala Zoom
            </Button>
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <Row label="Meeting ID" value={String(webinar.zoom_meeting_id)} copyable />
            {webinar.zoom_password && <Row label="Contraseña" value={webinar.zoom_password} copyable />}
            <a
              href={webinar.zoom_start_url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <ExternalLink size={12} /> Iniciar como host
            </a>
          </div>
        )}
      </section>

      {/* Canal YouTube Live */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Youtube size={18} className="text-red-600" />
          <h2 className="font-display text-lg font-bold text-brand-ink">YouTube Live (fallback)</h2>
        </div>
        <p className="text-xs text-brand-muted mb-3">
          Cuando el cupo Zoom se completa, los inscriptos nuevos reciben este link.
        </p>
        {editingYoutube ? (
          <div className="space-y-2">
            <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/live/..." />
            <div className="flex justify-end gap-2">
              <Button variant="ghost"  onClick={() => { setEditingYoutube(false); setYoutubeUrl(webinar.youtube_live_url ?? ''); }}>Cancelar</Button>
              <Button  onClick={saveYoutube} loading={savingYoutube}>Guardar</Button>
            </div>
          </div>
        ) : tieneYoutube ? (
          <div className="space-y-2 text-sm">
            <Row label="URL" value={webinar.youtube_live_url!} copyable />
            <Button variant="ghost"  onClick={() => setEditingYoutube(true)}>Editar URL</Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setEditingYoutube(true)} className="w-full">
            <Youtube size={14} /> Configurar YouTube Live
          </Button>
        )}
      </section>

      {/* Grabación */}
      {webinar.grabacion_url && (
        <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold text-brand-ink mb-2">Grabación post-evento</h2>
          <a
            href={webinar.grabacion_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-brand-cyan hover:underline"
          >
            <ExternalLink size={13} /> Ver grabación
          </a>
        </section>
      )}

      {/* Certificado de asistencia */}
      <CertificadoWebinarSection webinar={webinar} onRecargar={onRecargar} />
      </div>
    </div>
  );
}

// ============================================================================
// F6 (DGG-63) · Secciones del editor rico del webinar.
// ============================================================================

// Publicación: toggle "Publicado" + estado de vigencia + aviso suave (decisión
// de Pablo: no se bloquea publicar; se avisa si falta banner o docentes para
// que la página de inscripción se vea completa).
function PublicacionCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const docentes = parseDocentes(webinar.docentes);
  const vigente = esWebinarVigente(webinar);

  const faltantes: string[] = [];
  if (!webinar.banner_url) faltantes.push('el banner');
  if (docentes.length === 0) faltantes.push('al menos un docente');
  // Sin canal (Zoom/YouTube) la inscripción del público falla en silencio
  // (inscribir_a_webinar exige zoom_join_url o youtube_live_url).
  if (!webinar.zoom_join_url && !webinar.youtube_live_url) {
    faltantes.push('un canal de transmisión (creá la sala Zoom o cargá YouTube Live)');
  }

  async function toggle(next: boolean) {
    setSaving(true);
    const res = await actualizarWebinar(webinar.id, { publicado: next });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos actualizar la publicación', { description: humanizeError(res.error) });
      return;
    }
    toast.success(next ? 'Webinar publicado' : 'Webinar despublicado');
    void onRecargar();
  }

  const estado = !webinar.publicado
    ? { label: 'Borrador · no se muestra', cls: 'bg-slate-100 text-slate-600 ring-slate-200' }
    : vigente
      ? { label: 'Publicado y vigente · se muestra en la inscripción', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
      : { label: 'Publicado pero fuera de vigencia · no se muestra', cls: 'bg-amber-50 text-amber-700 ring-amber-200' };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={18} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Publicación</h2>
        </div>
        {/* Toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={webinar.publicado}
          disabled={saving}
          onClick={() => void toggle(!webinar.publicado)}
          className={cn(
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-60',
            webinar.publicado ? 'bg-brand-cyan' : 'bg-slate-300',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
              webinar.publicado ? 'translate-x-6' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1', estado.cls)}>
          {estado.label}
        </span>
      </div>

      <p className="mt-3 text-xs text-brand-muted">
        Sólo un webinar <strong>publicado y vigente</strong> aparece en la inscripción (landing y
        portal). Vigencia = hasta el inicio + la duración. Si hay varios, se muestra el más próximo
        («el más próximo gana») — podés publicar más de uno sin problema.
      </p>

      {webinar.publicado && faltantes.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            La página de inscripción se va a ver incompleta: falta {faltantes.join(' y ')}. Podés
            publicarlo igual, pero te conviene completarlo abajo.
          </span>
        </div>
      )}
    </section>
  );
}

// Datos del webinar: edición de título / descripción / fecha-hora / duración
// (antes sólo se seteaban al crear, sin edición posterior).
function DatosWebinarCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const inicial = isoToLocalParts(webinar.fecha_hora);
  const [titulo, setTitulo] = useState(webinar.titulo);
  const [descripcion, setDescripcion] = useState(webinar.descripcion ?? '');
  const [fecha, setFecha] = useState(inicial.date);
  const [hora, setHora] = useState(inicial.time);
  const [duracion, setDuracion] = useState(webinar.duracion_min);
  const [saving, setSaving] = useState(false);

  const dirty =
    titulo !== webinar.titulo ||
    descripcion !== (webinar.descripcion ?? '') ||
    fecha !== inicial.date ||
    hora !== inicial.time ||
    duracion !== webinar.duracion_min;

  async function guardar() {
    if (!titulo.trim()) { toast.error('El título no puede quedar vacío'); return; }
    if (!fecha) { toast.error('Falta la fecha'); return; }
    const fechaHora = new Date(`${fecha}T${hora || '00:00'}:00`).toISOString();
    setSaving(true);
    const res = await actualizarWebinar(webinar.id, {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      fechaHora,
      duracionMin: duracion,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar los cambios', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Datos del webinar actualizados');
    void onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={18} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Datos del webinar</h2>
      </div>
      <div className="space-y-3">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Cómo cumplir con la DDJJ 2026" />
        </Field>
        <Field label="Descripción">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Resumen del contenido del webinar" />
        </Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Hora">
            <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </Field>
          <Field label="Duración (min)">
            <Input type="number" value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} min={15} max={600} step={15} />
          </Field>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={guardar} loading={saving} disabled={!dirty}>
          <Save size={14} /> Guardar cambios
        </Button>
      </div>
    </section>
  );
}

// Banner: imagen ancha (3:1) que encabeza la página de inscripción. Sube al
// bucket campus-media (scope webinar-banner) vía ImageUploader (R20).
function BannerCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [banner, setBanner] = useState<string | null>(webinar.banner_url);

  async function persist(url: string | null) {
    const res = await actualizarWebinar(webinar.id, { bannerUrl: url });
    if (!res.ok) {
      toast.error('No pudimos guardar el banner', { description: humanizeError(res.error) });
      return;
    }
    await onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ImageIcon size={18} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Banner</h2>
      </div>
      <p className="mb-3 text-xs text-brand-muted">
        Imagen que encabeza la página de inscripción (landing y portal). Recomendado 3:1 (ej. 1200×400).
      </p>
      <ImageUploader
        value={banner}
        onChange={setBanner}
        onPersist={(url) => persist(url)}
        scope="webinar-banner"
        ownerId={webinar.id}
        shape="wide"
        label="Banner del webinar"
        hint="Hasta 5 MB · se recorta en 3:1"
      />
    </section>
  );
}

// Docentes: roster [{nombre, foto_url}]. Agregar / quitar / nombre + foto de
// cada uno. La foto sube al bucket campus-media (scope webinar-docente, R20);
// el array completo se persiste en webinars.docentes.
function DocentesCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [docentes, setDocentes] = useState<WebinarDocente[]>(() => parseDocentes(webinar.docentes));

  // Siempre persiste el array EXPLÍCITO que se le pasa (evita closures rancios
  // al combinar edición de nombre con subida de foto).
  async function persist(next: WebinarDocente[]) {
    setDocentes(next);
    const res = await actualizarWebinar(webinar.id, { docentes: next });
    if (!res.ok) {
      toast.error('No pudimos guardar los docentes', { description: humanizeError(res.error) });
      return;
    }
    await onRecargar();
  }

  function setNombreLocal(i: number, v: string) {
    setDocentes((prev) => prev.map((d, j) => (j === i ? { ...d, nombre: v } : d)));
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GraduationCap size={18} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Docentes</h2>
          {docentes.length > 0 && (
            <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
              {docentes.length}
            </span>
          )}
        </div>
        <Button variant="secondary" onClick={() => void persist([...docentes, { nombre: '', foto_url: null }])}>
          <Plus size={13} /> Agregar docente
        </Button>
      </div>

      {docentes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-brand-muted">
          Sin docentes cargados. Agregá al menos uno (nombre + foto) para que la página de
          inscripción muestre quién dicta el webinar.
        </p>
      ) : (
        <ul className="space-y-3">
          {docentes.map((d, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-nowrap"
            >
              <ImageUploader
                value={d.foto_url}
                onChange={() => { /* preview se refleja vía persist(next) */ }}
                onPersist={(url) =>
                  persist(docentes.map((x, j) => (j === i ? { ...x, foto_url: url } : x)))
                }
                scope="webinar-docente"
                ownerId={webinar.id}
                shape="circle"
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <Field label="Nombre del docente">
                  <Input
                    value={d.nombre}
                    onChange={(e) => setNombreLocal(i, e.target.value)}
                    onBlur={() => { if (d.nombre !== parseDocentes(webinar.docentes)[i]?.nombre) void persist(docentes); }}
                    placeholder="Ej. Dra. María González"
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => void persist(docentes.filter((_, j) => j !== i))}
                aria-label="Quitar docente"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-red-600 hover:bg-red-50"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CertificadoWebinarSection({
  webinar,
  onRecargar,
}: {
  webinar: WebinarRow;
  onRecargar: () => Promise<void>;
}) {
  const [emite, setEmite] = useState<boolean>(webinar.cert_emite ?? false);
  const [esquemaId, setEsquemaId] = useState<string | null>(webinar.cert_esquema_id ?? null);
  const [esquemas, setEsquemas] = useState<Array<{ id: string; nombre: string; es_default: boolean }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listarEsquemas().then((r) => {
      if (r.ok) setEsquemas(r.data.map((e) => ({ id: e.id, nombre: e.nombre, es_default: e.es_default })));
    });
  }, []);

  async function guardar() {
    setSaving(true);
    const res = await actualizarWebinar(webinar.id, {
      certEmite: emite,
      certEsquemaId: emite ? esquemaId : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Certificado del webinar actualizado');
    void onRecargar();
  }

  return (
    <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Award size={18} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Certificado de asistencia</h2>
        <a
          href="/gerencia/campus/plantillas"
          className="ml-auto text-[11px] font-medium text-brand-cyan hover:underline"
        >
          Gestionar plantillas →
        </a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-brand-ink">
          <input
            type="checkbox"
            checked={emite}
            onChange={(e) => setEmite(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
          />
          Emitir certificado a quienes asistan
        </label>
        {emite && (
          <div>
            <p className="kicker mb-1 text-brand-muted">Plantilla</p>
            <select
              value={esquemaId ?? ''}
              onChange={(e) => setEsquemaId(e.target.value || null)}
              className="input-field w-full"
            >
              <option value="">
                Default institucional
                {esquemas.find((x) => x.es_default)
                  ? ` (${esquemas.find((x) => x.es_default)!.nombre})`
                  : ''}
              </option>
              {esquemas
                .filter((x) => !x.es_default)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {webinar.cert_emite && (
          <Button
            variant="ghost"
            onClick={async () => {
              const r = await emitirCertificadosWebinarLote(webinar.id);
              if (!r.ok) {
                toast.error('No pudimos emitir', { description: humanizeError(r.error) });
                return;
              }
              toast.success(
                r.data === 0
                  ? 'No había asistentes nuevos para emitir'
                  : `${r.data} certificado${r.data === 1 ? '' : 's'} emitido${r.data === 1 ? '' : 's'}`,
              );
            }}
          >
            Emitir a asistentes
          </Button>
        )}
        <Button onClick={guardar} loading={saving}>
          Guardar
        </Button>
      </div>
    </section>
  );
}

function Row({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  function copy() {
    void navigator.clipboard.writeText(value);
    toast.success('Copiado');
  }
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
      <span className="min-w-[80px] text-xs uppercase tracking-wider text-brand-muted">{label}</span>
      <span className="flex-1 truncate font-mono text-xs">{value}</span>
      {copyable && (
        <button onClick={copy} type="button" className="text-brand-muted hover:text-brand-cyan">
          <CopyIcon size={12} />
        </button>
      )}
    </div>
  );
}

function InscriptosTab({ inscriptos, tokens, onAbrirInscribir }: {
  inscriptos: InscriptoConCanal[];
  tokens: Record<string, string>;
  onAbrirInscribir: () => void;
}) {
  function copiarLink(token: string) {
    const url = `${window.location.origin}/webinar/${token}`;
    void navigator.clipboard.writeText(url);
    toast.success('Link copiado');
  }

  if (inscriptos.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <Users size={32} className="mx-auto mb-2 text-brand-muted" />
        <p className="text-sm text-brand-muted">Todavía no hay inscriptos.</p>
        <Button onClick={onAbrirInscribir} className="mt-3" variant="secondary">
          <Users size={14} /> Inscribir manualmente
        </Button>
      </div>
    );
  }

  const clientes = inscriptos.filter((i) => i.administracion_id !== null);
  const prospectos = inscriptos.filter((i) => i.prospecto_id !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 text-xs">
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
            {clientes.length} cliente{clientes.length === 1 ? '' : 's'}
          </span>
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-700">
            {prospectos.length} prospecto{prospectos.length === 1 ? '' : 's'}
          </span>
        </div>
        <Button onClick={onAbrirInscribir} variant="secondary" >
          <Users size={13} /> Inscribir manualmente
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Email</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Tipo</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Canal</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Magic-link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inscriptos.map((i) => {
              const token = tokens[i.id];
              const esClient = i.administracion_id !== null;
              return (
                <tr key={i.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-brand-ink">{i.nombre_snapshot}</td>
                  <td className="px-4 py-2 text-brand-muted">{i.email_snapshot}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                      esClient ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700',
                    )}>
                      {esClient ? 'Cliente' : 'Prospecto'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {i.canal === 'zoom' ? (
                      <span className="inline-flex items-center gap-1 text-blue-700"><Video size={11} /> Zoom</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-700"><Youtube size={11} /> YouTube</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {token ? (
                      <button
                        type="button"
                        onClick={() => copiarLink(token)}
                        className="inline-flex items-center gap-1 text-xs text-brand-cyan hover:underline"
                      >
                        <Link2 size={11} /> Copiar
                      </button>
                    ) : (
                      <span className="text-xs text-brand-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AsistenciaTab({ inscriptos, webinar }: { inscriptos: InscriptoConCanal[]; webinar: WebinarRow }) {
  const presentes = inscriptos.filter((i) => i.asistio);
  const ausentes = inscriptos.filter((i) => !i.asistio);
  const tasa = inscriptos.length ? Math.round((presentes.length / inscriptos.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-brand-muted">Presentes</p>
          <p className="mt-1 font-display text-2xl font-bold text-green-700">{presentes.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-brand-muted">Ausentes</p>
          <p className="mt-1 font-display text-2xl font-bold text-slate-600">{ausentes.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center">
          <p className="text-xs uppercase tracking-wider text-brand-muted">Tasa</p>
          <p className="mt-1 font-display text-2xl font-bold text-brand-ink">{tasa}%</p>
        </div>
      </div>

      {webinar.status !== 'finalizado' && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-brand-muted">
          La asistencia se computa por webhook de Zoom (match por email) y se cierra cuando el webinar termina.
          Los inscriptos por YouTube Live no tienen asistencia automática (Zoom es el canal con webhook).
        </div>
      )}

      {presentes.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-green-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Presente</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Email</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Canal</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Tiempo conectado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {presentes.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2 font-medium text-brand-ink">
                    <CheckCircle2 size={12} className="inline text-green-600" /> {i.nombre_snapshot}
                  </td>
                  <td className="px-4 py-2 text-brand-muted">{i.email_snapshot}</td>
                  <td className="px-4 py-2">{i.canal}</td>
                  <td className="px-4 py-2 text-brand-muted">{fmtDuracion(i.tiempo_conectado_seg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InscribirManualModal({ webinarId, onClose, onCreated }: {
  webinarId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [loading, setLoading] = useState(false);

  async function inscribir() {
    if (!email.trim() || !nombre.trim()) {
      toast.error('Email y nombre son obligatorios');
      return;
    }
    setLoading(true);
    const res = await inscribirManual({
      webinarId,
      email: email.trim(),
      nombre: nombre.trim(),
      telefono: telefono.trim() || null,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos inscribir', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`Inscripto al canal ${res.data.canal}`);
    onCreated();
  }

  return (
    <Modal open onClose={onClose} title="Inscribir manualmente" width={420}>
      <div className="space-y-3">
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@ejemplo.com" />
        </Field>
        <Field label="Nombre" required>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del inscripto" />
        </Field>
        <Field label="Teléfono">
          <Input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+54 9 11 ..." />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={inscribir} loading={loading}>Inscribir</Button>
        </div>
      </div>
    </Modal>
  );
}
