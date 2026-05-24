import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Video,
  Youtube,
  Users,
  Clock,
  CheckCircle2,
  Copy as CopyIcon,
  Link2,
} from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  getWebinar,
  listInscriptos,
  listInscriptoTokens,
  inscribirManual,
  crearReunionZoom,
  actualizarWebinar,
  type WebinarRow,
  type InscriptoConCanal,
} from '@/services/api/webinars';
import { cn } from '@/lib/cn';

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
      toast.error('No pudimos crear la reunión Zoom', { description: res.error.message });
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
      toast.error('No pudimos guardar', { description: res.error.message });
      return;
    }
    toast.success('YouTube Live URL guardada');
    setEditingYoutube(false);
    void onRecargar();
  }

  return (
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

      {/* Descripción */}
      {webinar.descripcion && (
        <section className="md:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold text-brand-ink mb-2">Descripción</h2>
          <p className="text-sm text-brand-muted whitespace-pre-wrap">{webinar.descripcion}</p>
        </section>
      )}

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
    </div>
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
      toast.error('No pudimos inscribir', { description: res.error.message });
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
