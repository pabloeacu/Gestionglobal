import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  MapPin,
  Ticket,
  FileText,
  Library,
  Loader2,
  BookmarkPlus,
  X,
  Upload,
  Download,
  Mail,
} from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { ImageUploader } from '@/modules/campus/components/ImageUploader';
import { listarEsquemas } from '@/services/api/certificado-esquemas';
import {
  uploadCampusMedia,
  emitirCertificadosEvento,
  getCertCompleto,
  certificadoParaPdf,
  resolverEsquemaParaCert,
  uploadCertificadoPdf,
  certificadoRegistrarPdf,
  sendCertificadoEmail,
  listCertificadosPorEvento,
  type CertificadoRow,
} from '@/services/api/campus';
import { renderCertificadoPdfBlob, generateCertificadoPdf } from '@/modules/campus/lib/generateCertificadoPdf';
import { toast } from '@/lib/toast';
import {
  getWebinar,
  listInscriptos,
  listInscriptoTokens,
  inscribirManual,
  crearReunionZoom,
  actualizarWebinar,
  marcarAsistenciaWebinar,
  parseDocentes,
  listDisertantes,
  crearDisertante,
  actualizarDisertante,
  type WebinarRow,
  type WebinarDocente,
  type DisertanteRow,
  type InscriptoConCanal,
} from '@/services/api/webinars';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

// F6 (DGG-63) · ¿el evento está "vigente" para inscripción? Espeja la regla
// SQL de private.webinar_vigente_id() (mig 0294): no cancelado y now() < cierre,
// donde cierre = inicio para presencial (la lista se arma hasta que empieza) e
// inicio+duración para online/mixto (se puede entrar mientras transcurre).
function esWebinarVigente(w: WebinarRow): boolean {
  if (w.status === 'cancelado') return false;
  const inicio = new Date(w.fecha_hora).getTime();
  const cierre = w.modalidad === 'presencial'
    ? inicio
    : inicio + (w.duracion_min ?? 0) * 60_000;
  return Date.now() < cierre;
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
        Cargando evento…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/gerencia/formularios/webinars" className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-brand-cyan">
            <ArrowLeft size={12} /> Volver a Eventos
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
        <AsistenciaTab inscriptos={inscriptos} webinar={webinar} onRecargar={recargar} />
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
      <ModalidadCard webinar={webinar} onRecargar={onRecargar} />
      <ArancelCard webinar={webinar} onRecargar={onRecargar} />
      <BannerCard webinar={webinar} onRecargar={onRecargar} />
      <DocentesCard webinar={webinar} onRecargar={onRecargar} />

      <div className="grid gap-4 md:grid-cols-2">
      {/* Canales online (Zoom + YouTube) — no aplican a eventos presenciales */}
      {webinar.modalidad !== 'presencial' && (<>
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
      </>)}

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
  const sinNombre = docentes.filter((d) => !d.nombre.trim()).length;
  if (sinNombre > 0) faltantes.push(`el nombre de ${sinNombre} docente${sinNombre === 1 ? '' : 's'}`);
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
    toast.success(next ? 'Evento publicado' : 'Evento despublicado');
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
        Sólo un evento <strong>publicado y vigente</strong> aparece en la inscripción (landing y
        portal). Vigencia: los <strong>presenciales</strong> cierran la lista al <strong>horario de
        inicio</strong>; los <strong>online / mixtos</strong> siguen abiertos hasta inicio + duración
        (se puede entrar mientras transcurre). Si hay varios, se muestra el más próximo
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
    if (!Number.isFinite(duracion) || duracion < 15 || duracion > 600) {
      toast.error('La duración debe estar entre 15 y 600 minutos'); return;
    }
    const d = new Date(`${fecha}T${hora || '00:00'}:00`);
    if (Number.isNaN(d.getTime())) { toast.error('La fecha u hora no es válida'); return; }
    const fechaHora = d.toISOString();
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
    toast.success('Datos del evento actualizados');
    void onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={18} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Datos del evento</h2>
      </div>
      <div className="space-y-3">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Cómo cumplir con la DDJJ 2026" />
        </Field>
        <Field label="Descripción">
          <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={3} placeholder="Resumen del contenido del evento" />
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

// Modalidad + tipo + lugar del evento (online / presencial / mixto).
function ModalidadCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [modalidad, setModalidad] = useState<'online' | 'presencial' | 'mixto'>(
    (webinar.modalidad as 'online' | 'presencial' | 'mixto') ?? 'online',
  );
  const [tipo, setTipo] = useState<string>(webinar.tipo ?? 'webinar');
  const [lugar, setLugar] = useState(webinar.ubicacion_lugar ?? '');
  const [direccion, setDireccion] = useState(webinar.ubicacion_direccion ?? '');
  const [localidad, setLocalidad] = useState(webinar.ubicacion_localidad ?? '');
  const [mapaUrl, setMapaUrl] = useState(webinar.ubicacion_mapa_url ?? '');
  const [instrucciones, setInstrucciones] = useState(webinar.ubicacion_instrucciones ?? '');
  const [cupoPresencial, setCupoPresencial] = useState<string>(
    webinar.cupo_presencial != null ? String(webinar.cupo_presencial) : '',
  );
  const [saving, setSaving] = useState(false);
  const esPresencial = modalidad !== 'online';

  const dirty =
    modalidad !== ((webinar.modalidad as string) ?? 'online') ||
    tipo !== (webinar.tipo ?? 'webinar') ||
    lugar !== (webinar.ubicacion_lugar ?? '') ||
    direccion !== (webinar.ubicacion_direccion ?? '') ||
    localidad !== (webinar.ubicacion_localidad ?? '') ||
    mapaUrl !== (webinar.ubicacion_mapa_url ?? '') ||
    instrucciones !== (webinar.ubicacion_instrucciones ?? '') ||
    cupoPresencial !== (webinar.cupo_presencial != null ? String(webinar.cupo_presencial) : '');

  async function guardar() {
    if (esPresencial && !direccion.trim()) {
      toast.error('Para eventos presenciales/mixtos cargá la dirección');
      return;
    }
    const cupoNum = cupoPresencial.trim() === '' ? null : Number(cupoPresencial);
    if (cupoNum != null && (!Number.isFinite(cupoNum) || cupoNum <= 0)) {
      toast.error('El cupo presencial debe ser un número mayor a 0');
      return;
    }
    setSaving(true);
    const res = await actualizarWebinar(webinar.id, {
      modalidad,
      tipo: tipo as never,
      ubicacionLugar: esPresencial ? lugar.trim() || null : null,
      ubicacionDireccion: esPresencial ? direccion.trim() || null : null,
      ubicacionLocalidad: esPresencial ? localidad.trim() || null : null,
      ubicacionMapaUrl: esPresencial ? mapaUrl.trim() || null : null,
      ubicacionInstrucciones: esPresencial ? instrucciones.trim() || null : null,
      cupoPresencial: esPresencial ? cupoNum : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Modalidad y lugar actualizados');
    void onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <MapPin size={18} className="text-violet-600" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Modalidad y lugar</h2>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modalidad" required>
            <Select value={modalidad} onChange={(e) => setModalidad(e.target.value as 'online' | 'presencial' | 'mixto')}>
              <option value="online">Online (Zoom / YouTube)</option>
              <option value="presencial">Presencial</option>
              <option value="mixto">Mixto (el inscripto elige)</option>
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="webinar">Webinar</option>
              <option value="charla">Charla</option>
              <option value="taller">Taller</option>
              <option value="jornada">Jornada</option>
              <option value="curso">Curso</option>
              <option value="podcast">Podcast</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
        </div>
        {esPresencial && (
          <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Lugar" hint="Ej. Auditorio Central">
                <Input value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Nombre del lugar" />
              </Field>
              <Field label="Cupo presencial" hint="Vacío = sin límite">
                <Input type="number" min={1} value={cupoPresencial} onChange={(e) => setCupoPresencial(e.target.value)} placeholder="—" />
              </Field>
            </div>
            <Field label="Dirección" required>
              <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número" />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Localidad">
                <Input value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Ciudad / provincia" />
              </Field>
              <Field label="Link de Google Maps" hint="Opcional">
                <Input value={mapaUrl} onChange={(e) => setMapaUrl(e.target.value)} placeholder="https://maps.google.com/..." />
              </Field>
            </div>
            <Field label="Cómo llegar / instrucciones" hint="Opcional">
              <Textarea rows={2} value={instrucciones} onChange={(e) => setInstrucciones(e.target.value)} placeholder="Estacionamiento, transporte, piso, etc." />
            </Field>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={guardar} loading={saving} disabled={!dirty}>
          <Save size={14} /> Guardar cambios
        </Button>
      </div>
    </section>
  );
}

// Arancel: SÓLO informativo (dato del evento). No hay cobranza online.
function ArancelCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [arancelado, setArancelado] = useState<boolean>(webinar.es_arancelado ?? false);
  const [monto, setMonto] = useState<string>(webinar.arancel_monto != null ? String(webinar.arancel_monto) : '');
  const [nota, setNota] = useState(webinar.arancel_nota ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    arancelado !== (webinar.es_arancelado ?? false) ||
    monto !== (webinar.arancel_monto != null ? String(webinar.arancel_monto) : '') ||
    nota !== (webinar.arancel_nota ?? '');

  async function guardar() {
    const montoNum = monto.trim() === '' ? null : Number(monto);
    if (montoNum != null && (!Number.isFinite(montoNum) || montoNum < 0)) {
      toast.error('El monto debe ser un número mayor o igual a 0');
      return;
    }
    setSaving(true);
    const res = await actualizarWebinar(webinar.id, {
      esArancelado: arancelado,
      arancelMonto: arancelado ? montoNum : null,
      arancelNota: arancelado ? nota.trim() || null : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Arancel actualizado');
    void onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Ticket size={18} className="text-amber-600" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Arancel</h2>
        <span className="ml-auto text-[11px] text-brand-muted">Sólo informativo · no se cobra online</span>
      </div>
      <div className="space-y-3">
        <Field label="¿El evento tiene costo?">
          <Select value={arancelado ? 'si' : 'no'} onChange={(e) => setArancelado(e.target.value === 'si')}>
            <option value="no">Gratuito</option>
            <option value="si">Arancelado</option>
          </Select>
        </Field>
        {arancelado && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Monto (ARS)" hint="Opcional">
              <Input type="number" min={0} step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Ej. 5000" />
            </Field>
            <Field label="Nota" hint="Ej. se abona en el lugar">
              <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Cómo / dónde se abona" />
            </Field>
          </div>
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={guardar} loading={saving} disabled={!dirty}>
          <Save size={14} /> Guardar cambios
        </Button>
      </div>
    </section>
  );
}

// Banner + flyer: el banner es la imagen ancha (3:1) que encabeza la página de
// inscripción; el flyer es el arte vertical (1080×1350) que va al costado del
// formulario. Ambos suben al bucket campus-media vía ImageUploader (R20).
function BannerCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [banner, setBanner] = useState<string | null>(webinar.banner_url);
  const [flyer, setFlyer] = useState<string | null>(webinar.flyer_url);

  async function persistBanner(url: string | null) {
    const res = await actualizarWebinar(webinar.id, { bannerUrl: url });
    if (!res.ok) {
      toast.error('No pudimos guardar el banner', { description: humanizeError(res.error) });
      return;
    }
    await onRecargar();
  }

  async function persistFlyer(url: string | null) {
    const res = await actualizarWebinar(webinar.id, { flyerUrl: url });
    if (!res.ok) {
      toast.error('No pudimos guardar el flyer', { description: humanizeError(res.error) });
      return;
    }
    await onRecargar();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ImageIcon size={18} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-bold text-brand-ink">Banner y flyer</h2>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <p className="mb-3 text-xs text-brand-muted">
            <strong>Banner</strong> — encabeza la página de inscripción (landing y portal).
            Recomendado 3:1 (ej. 1200×400).
          </p>
          <ImageUploader
            value={banner}
            onChange={setBanner}
            onPersist={(url) => persistBanner(url)}
            scope="webinar-banner"
            ownerId={webinar.id}
            shape="wide"
            label="Banner del evento"
            hint="Hasta 5 MB · se recorta en 3:1"
          />
        </div>
        <div>
          <p className="mb-3 text-xs text-brand-muted">
            <strong>Flyer</strong> — arte vertical que se muestra al costado del formulario.
            Formato 1080×1350 (4:5). Opcional.
          </p>
          <ImageUploader
            value={flyer}
            onChange={setFlyer}
            onPersist={(url) => persistFlyer(url)}
            scope="webinar-flyer"
            ownerId={webinar.id}
            shape="portrait"
            label="Flyer promocional"
            hint="Hasta 5 MB · se recorta en 4:5 (1080×1350)"
          />
        </div>
      </div>
    </section>
  );
}

// Docentes / Disertantes: roster [{nombre, foto_url, cv_url, bio}] snapshoteado
// en webinars.docentes. La foto sube al bucket campus-media (scope
// webinar-docente) y el CV (PDF) a scope webinar-disertante-cv, ambos R20. Se
// puede (refinamientos Pablo · 0293):
//   · "Elegir del banco" → traer un disertante ya cargado (foto + CV + bio) del
//     catálogo reutilizable public.disertantes y snapshotearlo al evento.
//   · "Agregar nuevo" → cargarlo a mano y, con "Guardar en el banco", dejarlo
//     disponible para el próximo evento.
// El público lee SIEMPRE el snapshot del evento (no el catálogo, que es
// staff-only) → editar el banco luego no rompe eventos pasados.
//
// §6 (Agente A) · cada docente lleva un id estable de sesión (NO se persiste):
//   · key={id} → React no reasigna el estado interno del ImageUploader a la
//     fila equivocada al quitar uno del medio (evita aplicar una foto en vuelo
//     a otro docente).
//   · rowsRef siempre tiene el último estado → las mutaciones (foto/quitar/
//     nombre/cv) parten de lo último, sin races al subir 2 fotos seguidas.
//   · persist deduplica contra el último array guardado (lastPersisted) → el
//     blur del nombre no dispara writes redundantes y es correcto sin importar
//     el índice.
//   · bancoId (session-only, NO se snapshotea): si el disertante vino del banco
//     o ya se guardó, "Guardar en el banco" actualiza en vez de duplicar.
interface DocenteRow extends WebinarDocente {
  id: string;
  bancoId?: string | null;
}
let _docSeq = 0;
const nextDocId = () => `doc-${++_docSeq}`;
const stripDocentes = (rows: DocenteRow[]): WebinarDocente[] =>
  rows.map(({ nombre, foto_url, cv_url, bio }) => ({
    nombre,
    foto_url,
    cv_url: cv_url ?? null,
    bio: bio ?? null,
  }));

function DocentesCard({ webinar, onRecargar }: { webinar: WebinarRow; onRecargar: () => Promise<void> }) {
  const [rows, setRowsState] = useState<DocenteRow[]>(() =>
    parseDocentes(webinar.docentes).map((d) => ({ id: nextDocId(), ...d })),
  );
  const rowsRef = useRef(rows);
  const lastPersisted = useRef(JSON.stringify(stripDocentes(rows)));
  const [cvBusy, setCvBusy] = useState<string | null>(null);
  const [bancoBusy, setBancoBusy] = useState<string | null>(null);
  // Banco de disertantes (catálogo reutilizable). Se carga perezoso al abrir.
  const [bancoOpen, setBancoOpen] = useState(false);
  const [bancoItems, setBancoItems] = useState<DisertanteRow[] | null>(null);
  const [bancoLoading, setBancoLoading] = useState(false);

  function setRows(next: DocenteRow[]) {
    rowsRef.current = next;
    setRowsState(next);
  }

  async function persist(next: DocenteRow[]) {
    const stripped = stripDocentes(next);
    const json = JSON.stringify(stripped);
    if (json === lastPersisted.current) return; // sin cambios reales → no escribe
    const res = await actualizarWebinar(webinar.id, { docentes: stripped });
    if (!res.ok) {
      toast.error('No pudimos guardar los disertantes', { description: humanizeError(res.error) });
      return;
    }
    lastPersisted.current = json;
    await onRecargar();
  }

  function addDocente() {
    const next = [...rowsRef.current, { id: nextDocId(), nombre: '', foto_url: null, cv_url: null, bio: null }];
    setRows(next);
    void persist(next);
  }
  function removeDocente(id: string) {
    const next = rowsRef.current.filter((r) => r.id !== id);
    setRows(next);
    void persist(next);
  }
  function setFoto(id: string, url: string | null) {
    const next = rowsRef.current.map((r) => (r.id === id ? { ...r, foto_url: url } : r));
    setRows(next);
    void persist(next);
  }
  function setNombre(id: string, v: string) {
    setRows(rowsRef.current.map((r) => (r.id === id ? { ...r, nombre: v } : r)));
  }
  function setBio(id: string, v: string) {
    setRows(rowsRef.current.map((r) => (r.id === id ? { ...r, bio: v } : r)));
  }
  function setCv(id: string, url: string | null) {
    const next = rowsRef.current.map((r) => (r.id === id ? { ...r, cv_url: url } : r));
    setRows(next);
    void persist(next);
  }

  async function uploadCv(id: string, file: File) {
    if (file.type !== 'application/pdf') { toast.error('El CV debe ser un PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('El CV no puede pesar más de 10 MB'); return; }
    setCvBusy(id);
    const res = await uploadCampusMedia('webinar-disertante-cv', webinar.id, file);
    setCvBusy(null);
    if (!res.ok) {
      toast.error('No pudimos subir el CV', { description: humanizeError(res.error) });
      return;
    }
    setCv(id, res.data);
    toast.success('CV cargado');
  }

  // Guarda/actualiza el disertante en el catálogo reutilizable (banco). NO toca
  // el snapshot del evento (ese ya se persiste solo). Marca bancoId para no
  // duplicar en el próximo "guardar".
  async function guardarEnBanco(id: string) {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row) return;
    if (!row.nombre.trim()) { toast.error('Poné el nombre antes de guardar en el banco'); return; }
    setBancoBusy(id);
    const payload = {
      nombre: row.nombre.trim(),
      foto_url: row.foto_url,
      cv_url: row.cv_url ?? null,
      bio: row.bio ?? null,
    };
    const res = row.bancoId
      ? await actualizarDisertante(row.bancoId, payload)
      : await crearDisertante(payload);
    setBancoBusy(null);
    if (!res.ok) {
      toast.error('No pudimos guardar en el banco', { description: humanizeError(res.error) });
      return;
    }
    setRows(rowsRef.current.map((r) => (r.id === id ? { ...r, bancoId: res.data.id } : r)));
    setBancoItems(null); // invalida cache → próxima apertura relee el catálogo
    toast.success(row.bancoId ? 'Actualizado en el banco' : 'Guardado en el banco');
  }

  async function openBanco() {
    setBancoOpen(true);
    if (bancoItems !== null) return; // ya cargado en esta sesión
    setBancoLoading(true);
    const res = await listDisertantes();
    setBancoLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar el banco', { description: humanizeError(res.error) });
      setBancoItems([]);
      return;
    }
    setBancoItems(res.data);
  }

  function addFromBanco(d: DisertanteRow) {
    const next = [
      ...rowsRef.current,
      { id: nextDocId(), bancoId: d.id, nombre: d.nombre, foto_url: d.foto_url, cv_url: d.cv_url, bio: d.bio },
    ];
    setRows(next);
    void persist(next);
    setBancoOpen(false);
    toast.success(`${d.nombre} agregado al evento`);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GraduationCap size={18} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-bold text-brand-ink">Docentes / Disertantes</h2>
          {rows.length > 0 && (
            <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
              {rows.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void openBanco()}>
            <Library size={13} /> Elegir del banco
          </Button>
          <Button variant="secondary" onClick={addDocente}>
            <Plus size={13} /> Agregar nuevo
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-brand-muted">
          Sin disertantes cargados. Agregá al menos uno (nombre + foto) o elegilo del banco para que
          la página de inscripción muestre quién dicta el evento.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-nowrap"
            >
              <ImageUploader
                value={r.foto_url}
                onChange={() => { /* preview se refleja vía setFoto → setRows */ }}
                onPersist={(url) => setFoto(r.id, url)}
                scope="webinar-docente"
                ownerId={webinar.id}
                shape="circle"
                size="sm"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <Field label="Nombre del disertante">
                  <Input
                    value={r.nombre}
                    onChange={(e) => setNombre(r.id, e.target.value)}
                    onBlur={() => void persist(rowsRef.current)}
                    placeholder="Ej. Dra. María González"
                  />
                </Field>
                <Field label="Bio" hint="Opcional · una línea">
                  <Input
                    value={r.bio ?? ''}
                    onChange={(e) => setBio(r.id, e.target.value)}
                    onBlur={() => void persist(rowsRef.current)}
                    placeholder="Ej. Contadora, especialista en propiedad horizontal"
                  />
                </Field>
                {/* CV (PDF) */}
                <div className="flex flex-wrap items-center gap-2">
                  {r.cv_url ? (
                    <>
                      <a
                        href={r.cv_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-cyan hover:bg-brand-cyan-pale/30"
                      >
                        <FileText size={12} /> Ver CV
                      </a>
                      <button
                        type="button"
                        onClick={() => setCv(r.id, null)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Quitar CV
                      </button>
                    </>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-ink shadow-sm hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/30">
                      {cvBusy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                      Subir CV (PDF)
                      <input
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void uploadCv(r.id, f);
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => void guardarEnBanco(r.id)}
                  disabled={bancoBusy === r.id}
                  aria-label={r.bancoId ? 'Actualizar en el banco' : 'Guardar en el banco'}
                  title={r.bancoId ? 'Actualizar en el banco' : 'Guardar en el banco'}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/40 text-brand-cyan hover:bg-brand-cyan-pale/70 disabled:opacity-60"
                >
                  {bancoBusy === r.id ? <Loader2 size={15} className="animate-spin" /> : <BookmarkPlus size={15} />}
                </button>
                <button
                  type="button"
                  onClick={() => removeDocente(r.id)}
                  aria-label="Quitar disertante"
                  title="Quitar del evento"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {bancoOpen && (
        <DisertantesBancoModal
          items={bancoItems}
          loading={bancoLoading}
          onClose={() => setBancoOpen(false)}
          onPick={addFromBanco}
        />
      )}
    </section>
  );
}

// Modal del banco de disertantes · grilla del catálogo reutilizable (foto +
// nombre + CV + bio). Elegir uno lo snapshotea al evento.
function DisertantesBancoModal({
  items,
  loading,
  onClose,
  onPick,
}: {
  items: DisertanteRow[] | null;
  loading: boolean;
  onClose: () => void;
  onPick: (d: DisertanteRow) => void;
}) {
  const [q, setQ] = useState('');
  const visibles = (items ?? []).filter((it) =>
    q.trim() ? it.nombre.toLowerCase().includes(q.trim().toLowerCase()) : true,
  );
  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-brand-ink/60 p-4">
      <div className="card-premium relative flex max-h-[80vh] w-full max-w-lg flex-col gap-3 p-4">
        <header className="flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 font-display text-base font-semibold text-brand-ink">
            <Library size={16} className="text-brand-cyan" /> Banco de disertantes
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
          >
            <X size={16} />
          </button>
        </header>
        {items && items.length > 6 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar disertante…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
          />
        )}
        <div className="min-h-[120px] overflow-y-auto">
          {loading ? (
            <div className="grid h-32 place-items-center text-brand-muted">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : visibles.length === 0 ? (
            <p className="grid h-32 place-items-center px-4 text-center text-sm text-brand-muted">
              {items && items.length === 0
                ? 'Todavía no hay disertantes en el banco. Cargá el primero con "Agregar nuevo" y tocá "Guardar en el banco".'
                : 'Ningún disertante coincide con la búsqueda.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibles.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onPick(d)}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-cyan hover:shadow-sm"
                    title={`Agregar a ${d.nombre} al evento`}
                  >
                    {d.foto_url ? (
                      <img
                        src={d.foto_url}
                        alt={d.nombre}
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-full border border-slate-200 object-cover"
                      />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-slate-200 bg-brand-cyan/10 text-sm font-semibold text-brand-cyan">
                        {d.nombre.slice(0, 1).toUpperCase() || '?'}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-brand-ink">{d.nombre}</span>
                      {d.bio && <span className="block truncate text-xs text-brand-muted">{d.bio}</span>}
                    </span>
                    {d.cv_url && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-cyan-pale/50 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan">
                        <FileText size={10} /> CV
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
  const [emitiendo, setEmitiendo] = useState(false);
  const [progreso, setProgreso] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    void listarEsquemas().then((r) => {
      if (r.ok) setEsquemas(r.data.map((e) => ({ id: e.id, nombre: e.nombre, es_default: e.es_default })));
    });
  }, []);

  // Etapa B (DGG-100) · Emisión + envío del certificado por email con PDF adjunto.
  // El PDF se renderiza acá (browser), se sube al bucket `certificados` y se
  // dispara el mail. Va a TODOS los asistentes (clientes + prospectos).
  async function emitirYEnviar() {
    setEmitiendo(true);
    setProgreso(null);
    try {
      const em = await emitirCertificadosEvento(webinar.id);
      if (!em.ok) {
        toast.error('No pudimos emitir', { description: humanizeError(em.error) });
        return;
      }
      const ids = em.data;
      if (ids.length === 0) {
        toast.success('No había asistentes nuevos para certificar');
        return;
      }
      setProgreso({ done: 0, total: ids.length });
      let okCount = 0;
      let failCount = 0;
      let done = 0;
      for (const certId of ids) {
        try {
          const cr = await getCertCompleto(certId);
          if (!cr.ok) throw new Error(humanizeError(cr.error));
          const esquema = await resolverEsquemaParaCert(cr.data);
          const blob = await renderCertificadoPdfBlob(certificadoParaPdf(cr.data), esquema ?? undefined);
          const up = await uploadCertificadoPdf(certId, cr.data.codigo, blob);
          if (!up.ok) throw new Error(humanizeError(up.error));
          const reg = await certificadoRegistrarPdf(certId, up.data);
          if (!reg.ok) throw new Error(humanizeError(reg.error));
          const mail = await sendCertificadoEmail(certId);
          if (!mail.ok) throw new Error(humanizeError(mail.error));
          okCount++;
        } catch (e) {
          console.error('[cert-evento] falló un certificado', certId, e);
          failCount++;
        }
        done++;
        setProgreso({ done, total: ids.length });
      }
      if (failCount === 0) {
        toast.success(`${okCount} certificado${okCount === 1 ? '' : 's'} emitido${okCount === 1 ? '' : 's'} y enviado${okCount === 1 ? '' : 's'} por email`);
      } else {
        toast.error(`${okCount} enviado${okCount === 1 ? '' : 's'}, ${failCount} con error. Reintentá para completar los pendientes.`);
      }
      void onRecargar();
    } finally {
      setEmitiendo(false);
      setProgreso(null);
    }
  }

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
    toast.success('Certificado del evento actualizado');
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
          <Button variant="ghost" onClick={() => void emitirYEnviar()} loading={emitiendo} disabled={emitiendo}>
            {emitiendo && progreso
              ? `Emitiendo… ${progreso.done}/${progreso.total}`
              : emitiendo
                ? 'Emitiendo…'
                : 'Emitir y enviar a asistentes'}
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
                    ) : i.canal === 'presencial' ? (
                      <span className="inline-flex items-center gap-1 text-violet-700"><MapPin size={11} /> Presencial</span>
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

// Etapa B · celda de certificado por asistente (gerencia): descargar el PDF +
// reenviar por email (por si el asistente reclama que no lo recibió). Reusa el
// trío de descarga (origen-aware) + la edge fn de envío.
function CertCell({ cert }: { cert: CertificadoRow | null }) {
  const [busy, setBusy] = useState<'dl' | 'send' | null>(null);
  if (!cert) return <span className="text-xs text-brand-muted">—</span>;
  const c = cert;
  async function descargar() {
    setBusy('dl');
    try {
      const esquema = await resolverEsquemaParaCert(c);
      await generateCertificadoPdf(certificadoParaPdf(c), esquema ?? undefined);
    } catch (e) {
      console.error('[cert-cell] descargar falló', e);
      toast.error('No pudimos generar el certificado.');
    } finally {
      setBusy(null);
    }
  }
  async function reenviar() {
    setBusy('send');
    const r = await sendCertificadoEmail(c.id);
    setBusy(null);
    if (!r.ok) {
      toast.error('No pudimos reenviar', { description: humanizeError(r.error) });
      return;
    }
    toast.success('Certificado reenviado por email');
  }
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void descargar()}
        disabled={busy !== null}
        title="Descargar certificado (PDF)"
        aria-label="Descargar certificado"
        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-brand-cyan transition hover:bg-brand-cyan-pale/40 disabled:opacity-50"
      >
        {busy === 'dl' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
      </button>
      <button
        type="button"
        onClick={() => void reenviar()}
        disabled={busy !== null}
        title="Reenviar por email"
        aria-label="Reenviar certificado por email"
        className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-brand-muted transition hover:bg-slate-50 disabled:opacity-50"
      >
        {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
      </button>
    </div>
  );
}

function AsistenciaTab({ inscriptos, webinar, onRecargar }: {
  inscriptos: InscriptoConCanal[];
  webinar: WebinarRow;
  onRecargar: () => Promise<void>;
}) {
  const presentes = inscriptos.filter((i) => i.asistio);
  const ausentes = inscriptos.filter((i) => !i.asistio);
  const tasa = inscriptos.length ? Math.round((presentes.length / inscriptos.length) * 100) : 0;
  const esPresencial = webinar.modalidad !== 'online';
  const [busyId, setBusyId] = useState<string | null>(null);
  // Etapa B · certs emitidos del evento, indexados por email (para el ícono de
  // descarga/reenvío por asistente — por si reclaman que no lo recibieron).
  const [certIndex, setCertIndex] = useState<{
    byProfile: Record<string, CertificadoRow>;
    byProspecto: Record<string, CertificadoRow>;
    byEmail: Record<string, CertificadoRow>;
  }>({ byProfile: {}, byProspecto: {}, byEmail: {} });
  useEffect(() => {
    void listCertificadosPorEvento(webinar.id).then((r) => {
      if (!r.ok) return;
      const byProfile: Record<string, CertificadoRow> = {};
      const byProspecto: Record<string, CertificadoRow> = {};
      const byEmail: Record<string, CertificadoRow> = {};
      for (const c of r.data) {
        if (c.alumno_profile_id) byProfile[c.alumno_profile_id] = c;
        if (c.prospecto_id) byProspecto[c.prospecto_id] = c;
        const snap = (c.payload_snapshot ?? {}) as { email?: string };
        const email = (snap.email ?? '').toLowerCase().trim();
        if (email) byEmail[email] = c;
      }
      setCertIndex({ byProfile, byProspecto, byEmail });
    });
  }, [webinar.id, inscriptos]);
  // Match robusto por id (profile/prospecto); email sólo como fallback. Evita
  // que dos inscriptos con el mismo email colapsen al mismo cert (hallazgo §6 A#11).
  const certDe = (i: InscriptoConCanal): CertificadoRow | null =>
    (i.profile_id ? certIndex.byProfile[i.profile_id] : undefined) ??
    (i.prospecto_id ? certIndex.byProspecto[i.prospecto_id] : undefined) ??
    certIndex.byEmail[i.email_snapshot.toLowerCase().trim()] ??
    null;

  async function toggle(i: InscriptoConCanal) {
    setBusyId(i.id);
    const res = await marcarAsistenciaWebinar(i.id, !i.asistio);
    setBusyId(null);
    if (!res.ok) {
      toast.error('No pudimos actualizar la asistencia', { description: humanizeError(res.error) });
      return;
    }
    await onRecargar();
  }

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

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-brand-muted">
        {esPresencial
          ? 'Pasá lista marcando quién asistió. Si el evento es mixto, los inscriptos online también quedan registrados por el webhook de Zoom.'
          : 'La asistencia se computa por webhook de Zoom (match por email) y se cierra cuando el evento termina. Los inscriptos por YouTube Live no tienen asistencia automática.'}
      </div>

      {esPresencial ? (
        inscriptos.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-brand-muted">
            Todavía no hay inscriptos para pasar lista.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Asistió</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Nombre</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Canal</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Cert.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inscriptos.map((i) => (
                  <tr key={i.id} className={i.asistio ? 'bg-green-50/40' : ''}>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={busyId === i.id}
                        onClick={() => void toggle(i)}
                        className={cn(
                          'grid h-6 w-6 place-items-center rounded-md border transition disabled:opacity-50',
                          i.asistio
                            ? 'border-green-500 bg-green-500 text-white'
                            : 'border-slate-300 bg-white text-transparent hover:border-brand-cyan',
                        )}
                        aria-label={i.asistio ? 'Marcar ausente' : 'Marcar presente'}
                        aria-pressed={i.asistio}
                      >
                        <CheckCircle2 size={14} />
                      </button>
                    </td>
                    <td className="px-4 py-2 font-medium text-brand-ink">{i.nombre_snapshot}</td>
                    <td className="px-4 py-2 text-brand-muted">{i.email_snapshot}</td>
                    <td className="px-4 py-2 text-brand-muted">{i.canal}</td>
                    <td className="px-4 py-2"><CertCell cert={certDe(i)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        presentes.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-green-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Presente</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Email</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Canal</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Tiempo conectado</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-green-700">Cert.</th>
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
                    <td className="px-4 py-2"><CertCell cert={certDe(i)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
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
