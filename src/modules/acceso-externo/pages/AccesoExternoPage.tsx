import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2,
  ShieldCheck,
  AlertCircle,
  ExternalLink,
  FileText,
  CalendarPlus,
  Clock,
  User,
  Mail,
  Phone,
  Briefcase,
  Send,
  CheckCircle2,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { cn } from '@/lib/cn';
import {
  fetchAccesoExterno,
  fetchGestorAvances,
  gestorCargarAvance,
  registrarApertura,
  type AccesoExternoPayload,
  type GestorAvanceLinea,
} from '@/services/api/accesos';
import { toast } from '@/lib/toast';

// Página pública sin login. Carga el recurso vía edge function `acceso-externo`.
// Diseño premium: hero cyan, tarjeta de datos, galería de adjuntos, footer
// institucional.

export function AccesoExternoPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AccesoExternoPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError('Token no provisto');
        setLoading(false);
        return;
      }
      // 5.C · registramos la apertura (best-effort, no bloquea la vista).
      void registrarApertura(token);
      const res = await fetchAccesoExterno(token);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setData(res.data);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal py-10 text-white shadow">
        <TrianglesAccent position="top-right" size={260} tone="cyan" density="rich" className="opacity-50" />
        <TrianglesAccent position="bottom-left" size={180} tone="teal" density="soft" className="opacity-40" />
        <div className="relative mx-auto max-w-3xl px-6">
          <div className="flex items-center gap-2 text-sm text-white/85">
            <ShieldCheck size={16} /> Acceso seguro · Gestión Global
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            {loading ? 'Cargando…' : data?.acceso ? tituloPorTipo(data.acceso.tipo) : 'Acceso externo'}
          </h1>
          {data?.acceso && (
            <p className="mt-2 text-sm text-white/85">
              Hola, <span className="font-semibold">{data.acceso.destinatario}</span>.
              Este enlace expira el {new Date(data.acceso.vence_at).toLocaleDateString('es-AR', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}.
            </p>
          )}
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading && (
          <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-12 text-brand-muted shadow-sm">
            <Loader2 className="mb-2 animate-spin" />
            <p className="text-sm">Verificando tu acceso…</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle size={18} /> No pudimos abrir este enlace
            </div>
            <p className="mt-1 text-sm">{error}</p>
            <p className="mt-3 text-xs text-rose-700/80">
              Verificá que el link sea el original o pedí uno nuevo a tu contacto en Gestión Global.
            </p>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {/* 5.E · indicador "Última actualización". Si fue actualizado
                hace <1 día, mostramos badge "Reciente" verde para dar
                confianza inmediata al destinatario. */}
            <UltimaActualizacion payload={data} />

            {/* 5.A · si el recurso tiene fecha estimada/vencimiento,
                ofrecemos agregar al calendario en .ics descargable. */}
            <AgregarAlCalendario payload={data} />

            {/* Recurso */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="kicker mb-3 text-brand-cyan">Detalle</div>
              <RecursoView payload={data} />
            </section>

            {/* #147 · Perfil Gestor: si el token es de una solicitud, mostramos
                timeline + formulario de carga de avance. */}
            {data.acceso?.tipo === 'solicitud' && token && (
              <PanelGestor token={token} />
            )}

            {/* 5.B · tarjeta "Tu contacto" — humaniza el acceso. */}
            <TuContacto responsable={data.responsable} />

            {/* Adjuntos */}
            {data.adjuntos && data.adjuntos.length > 0 && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="kicker mb-3 text-brand-cyan">Adjuntos</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.adjuntos.map((a) => (
                    <a
                      key={a.url}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg border border-slate-200 p-3 transition hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/20"
                    >
                      <span className="inline-flex items-center gap-2 text-sm text-brand-ink">
                        <FileText size={14} className="text-brand-cyan" /> {a.nombre}
                      </span>
                      <ExternalLink size={12} className="text-brand-muted" />
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        Gestión Global · gestionglobal.ar — Acceso temporal y seguro. No compartas este link.
      </footer>
    </div>
  );
}

// 5.B · ---------------------------------------------------------------------
// Tarjeta "Tu contacto": avatar + nombre + mailto/tel directos del responsable.
function TuContacto({
  responsable,
}: {
  responsable: AccesoExternoPayload['responsable'];
}) {
  if (!responsable || (!responsable.nombre && !responsable.email && !responsable.telefono)) {
    return null;
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="kicker mb-3 text-brand-cyan">Tu contacto</div>
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-cyan-pale/50 text-brand-cyan">
          <User size={22} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-base font-bold text-brand-ink">
            {responsable.nombre ?? 'Tu gestor en Gestión Global'}
          </p>
          <div className="mt-1 flex flex-col gap-1 text-sm sm:flex-row sm:flex-wrap sm:gap-4">
            {responsable.email && (
              <a
                href={`mailto:${responsable.email}`}
                className="inline-flex items-center gap-1.5 text-brand-cyan hover:underline"
              >
                <Mail size={13} /> {responsable.email}
              </a>
            )}
            {responsable.telefono && (
              <a
                href={`tel:${responsable.telefono}`}
                className="inline-flex items-center gap-1.5 text-brand-cyan hover:underline"
              >
                <Phone size={13} /> {responsable.telefono}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function tituloPorTipo(tipo: string): string {
  switch (tipo) {
    case 'tramite': return 'Trámite';
    case 'solicitud': return 'Solicitud';
    case 'tracking': return 'Seguimiento';
    case 'documento': return 'Documento';
    default: return 'Acceso externo';
  }
}

function RecursoView({ payload }: { payload: AccesoExternoPayload }) {
  const r = payload.recurso as Record<string, unknown> | null;
  if (!r) return <p className="text-sm text-brand-muted">Sin datos disponibles.</p>;
  const tipo = payload.acceso?.tipo;
  if (tipo === 'tramite') {
    return (
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Item label="Código" value={r.codigo as string | undefined} />
        <Item label="Estado" value={r.estado as string | undefined} />
        <Item label="Título" value={r.titulo as string | undefined} full />
        <Item label="Descripción" value={r.descripcion as string | undefined} full />
        <Item label="Categoría" value={r.categoria as string | undefined} />
        <Item label="Prioridad" value={r.prioridad as string | undefined} />
        <Item
          label="Fecha solicitud"
          value={fmt(r.fecha_solicitud as string | undefined)}
        />
        <Item
          label="Fecha estimada"
          value={fmt(r.fecha_estimada as string | undefined)}
        />
      </dl>
    );
  }
  if (tipo === 'solicitud') {
    const datos = (r.datos_resumen ?? {}) as Record<string, unknown>;
    return (
      <div className="space-y-3 text-sm">
        <Item label="Formulario" value={r.formulario_slug as string | undefined} />
        <Item label="Estado" value={r.estado as string | undefined} />
        {Object.keys(datos).length > 0 && (
          <div>
            <p className="kicker mb-1 text-brand-muted">Datos</p>
            <dl className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
              {Object.entries(datos).map(([k, v]) => (
                <div key={k} className="text-xs">
                  <dt className="font-semibold text-brand-muted">{k}</dt>
                  <dd className="break-words text-brand-ink">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    );
  }
  return (
    <pre className="overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-brand-ink">
      {JSON.stringify(r, null, 2)}
    </pre>
  );
}

function Item({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={cn(full && 'sm:col-span-2')}>
      <dt className="kicker text-brand-muted">{label}</dt>
      <dd className="mt-0.5 text-brand-ink">{value}</dd>
    </div>
  );
}

function fmt(d?: string): string | undefined {
  if (!d) return undefined;
  try {
    return new Date(d).toLocaleDateString('es-AR', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  } catch {
    return d;
  }
}

// 5.E · ---------------------------------------------------------------------
function UltimaActualizacion({ payload }: { payload: AccesoExternoPayload }) {
  const r = (payload.recurso ?? {}) as Record<string, unknown>;
  const ts =
    (r.ultima_actividad_at as string | undefined) ??
    (r.updated_at as string | undefined) ??
    (r.fecha_estimada as string | undefined);
  if (!ts) return null;
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  const horas = (Date.now() - date.getTime()) / (1000 * 60 * 60);
  const reciente = horas < 24;
  const texto = (() => {
    if (horas < 1) return 'hace minutos';
    if (horas < 24) return `hace ${Math.round(horas)} h`;
    const dias = horas / 24;
    if (dias < 7) return `hace ${Math.round(dias)} d`;
    if (dias < 30) return `hace ${Math.round(dias / 7)} sem`;
    return date.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
  })();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-brand-muted shadow-sm">
      <Clock size={12} className="text-brand-cyan" />
      <span>Actualizado {texto}</span>
      {reciente && (
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
          Reciente
        </span>
      )}
    </div>
  );
}

// 5.A · ---------------------------------------------------------------------
// Genera y descarga un .ics para el recurso si tiene fecha.
function AgregarAlCalendario({ payload }: { payload: AccesoExternoPayload }) {
  const r = (payload.recurso ?? {}) as Record<string, unknown>;
  const fechaIso =
    (r.fecha_estimada as string | undefined) ??
    (r.fecha as string | undefined) ??
    (r.vence_at as string | undefined);
  if (!fechaIso) return null;
  const fecha = new Date(fechaIso);
  if (Number.isNaN(fecha.getTime())) return null;

  const tipo = payload.acceso?.tipo ?? 'recurso';
  const titulo =
    (r.titulo as string | undefined) ??
    (r.codigo as string | undefined) ??
    `${tituloPorTipo(tipo)} · Gestión Global`;
  const descripcion =
    (r.descripcion as string | undefined) ??
    'Vinculado a tu acceso de Gestión Global.';

  function descargar() {
    const dtStart = formatICSDate(fecha);
    const dtEnd = formatICSDate(new Date(fecha.getTime() + 30 * 60 * 1000));
    const uid = `gg-${Date.now()}@gestionglobal.ar`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Gestion Global//Acceso Externo//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${formatICSDate(new Date())}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeICS(titulo)}`,
      `DESCRIPTION:${escapeICS(descripcion)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([lines], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gestion-global-${tipo}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={descargar}
      className="inline-flex items-center gap-2 rounded-xl border border-brand-cyan/30 bg-brand-cyan-pale/30 px-3 py-2 text-sm font-medium text-brand-cyan transition hover:bg-brand-cyan-pale/50"
    >
      <CalendarPlus size={14} />
      Agregar al calendario ({fecha.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })})
    </button>
  );
}

function formatICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeICS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

// =============================================================================
// #147 · Perfil Gestor (carga de avance desde acceso externo)
// =============================================================================
function PanelGestor({ token }: { token: string }) {
  const [avances, setAvances] = useState<GestorAvanceLinea[] | null>(null);
  const [loadingAvances, setLoadingAvances] = useState(true);
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function cargarAvances() {
    setLoadingAvances(true);
    const res = await fetchGestorAvances(token);
    if (res.ok) setAvances(res.data);
    setLoadingAvances(false);
  }

  useEffect(() => {
    void cargarAvances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function enviar() {
    if (descripcion.trim().length < 3) {
      toast.error('Escribí una descripción de tu avance');
      return;
    }
    setEnviando(true);
    const res = await gestorCargarAvance(token, descripcion.trim(), []);
    setEnviando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Avance enviado al cliente');
    setEnviado(true);
    setDescripcion('');
    void cargarAvances();
  }

  return (
    <section className="rounded-2xl border border-brand-cyan/30 bg-gradient-to-br from-brand-cyan-pale/30 via-white to-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-brand-cyan">
        <Briefcase size={18} />
        <span className="kicker">Panel de gestoría</span>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-brand-ink">
          Cargar avance / documentación
        </label>
        <textarea
          rows={4}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Contale al cliente qué resolviste, qué se entregó al organismo, próximos pasos…"
          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-brand-ink shadow-sm transition focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20"
          disabled={enviando}
        />
        <p className="text-xs text-brand-muted">
          El cliente recibirá un email y notificación push automáticamente.
        </p>
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || descripcion.trim().length < 3}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-teal disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {enviando ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Send size={14} /> Enviar avance
            </>
          )}
        </button>
        {enviado && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircle2 size={12} /> Recibido por el cliente
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="mt-6 border-t border-slate-200 pt-4">
        <div className="kicker mb-3 text-brand-muted">
          Historial visible al cliente
        </div>
        {loadingAvances ? (
          <div className="flex items-center gap-2 text-xs text-brand-muted">
            <Loader2 size={12} className="animate-spin" /> Cargando…
          </div>
        ) : !avances || avances.length === 0 ? (
          <p className="text-xs text-brand-muted">
            Todavía no hay avances cargados.
          </p>
        ) : (
          <ul className="space-y-3">
            {avances.map((a) => (
              <li key={a.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="kicker text-brand-cyan">
                    {a.categoria_label}
                  </span>
                  <span className="text-[10px] text-brand-muted">
                    {fmtRel(a.created_at)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink">
                  {a.descripcion}
                </p>
                <p className="mt-1 text-[10px] text-brand-muted">
                  por {a.autor_nombre}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function fmtRel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const min = (Date.now() - t) / 60000;
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${Math.round(min)} min`;
  const h = min / 60;
  if (h < 24) return `hace ${Math.round(h)} h`;
  const d = h / 24;
  if (d < 7) return `hace ${Math.round(d)} d`;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default AccesoExternoPage;
