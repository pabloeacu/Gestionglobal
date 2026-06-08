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
  Paperclip,
  X as XIcon,
  UploadCloud,
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
import {
  obtenerInfoSolicitudPorToken,
  firmarAdjuntoCliente,
  subirAdjuntoGestor,
} from '@/services/api/accesoExterno';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';

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
        setError(humanizeError(res.error));
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
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Hero · 5.F print: en papel se vuelve sobrio (sin gradient ni triángulos) */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal py-10 text-white shadow print:bg-white print:bg-none print:py-4 print:text-brand-ink print:shadow-none">
        <TrianglesAccent position="top-right" size={260} tone="cyan" density="rich" className="opacity-50 print:hidden" />
        <TrianglesAccent position="bottom-left" size={180} tone="teal" density="soft" className="opacity-40 print:hidden" />
        <div className="relative mx-auto max-w-3xl px-6">
          <div className="flex items-center gap-2 text-sm text-white/85 print:text-brand-cyan">
            <ShieldCheck size={16} /> Acceso seguro · Gestión Global
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl print:text-2xl">
            {loading ? 'Cargando…' : data?.acceso ? tituloPorTipo(data.acceso.tipo) : 'Acceso externo'}
          </h1>
          {data?.acceso && (
            <p className="mt-2 text-sm text-white/85 print:text-brand-muted">
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
              Si el enlace venció, podés pedirle uno nuevo al equipo de Gestión Global.
            </p>
            {/* 5.D · CTA "Pedir link nuevo" — mailto pre-armado con el
                token original para que el gerente identifique al destinatario
                rápido. Sin backend nuevo: el email lo manda la app del usuario. */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <a
                href={`mailto:contacto@gestionglobal.ar?subject=${encodeURIComponent(
                  'Solicito un nuevo enlace de acceso',
                )}&body=${encodeURIComponent(
                  `Hola,\n\nMe gustaría pedir un nuevo enlace para acceder al recurso compartido.\n\nReferencia (no la borres): ${
                    token ?? '(sin token)'
                  }\n\nGracias.`,
                )}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white shadow transition hover:bg-rose-800"
              >
                <Mail size={14} /> Pedir un nuevo enlace
              </a>
              <a
                href="https://wa.me/5491100000000?text=Hola%2C%20necesito%20un%20nuevo%20enlace%20de%20acceso%20a%20Gesti%C3%B3n%20Global"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
              >
                <Phone size={14} /> WhatsApp
              </a>
            </div>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {/* 5.E · indicador "Última actualización". Si fue actualizado
                hace <1 día, mostramos badge "Reciente" verde para dar
                confianza inmediata al destinatario. */}
            <UltimaActualizacion payload={data} />

            {/* 5.A · si el recurso tiene fecha estimada/vencimiento,
                ofrecemos agregar al calendario en .ics descargable.
                5.F · print: el botón se oculta en papel (no es accionable). */}
            <div className="print:hidden">
              <AgregarAlCalendario payload={data} />
            </div>

            {/* 5.F · Botón "Imprimir" visible solo en pantalla (en papel
                sería redundante). Usa window.print() del browser. */}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-ink transition hover:bg-slate-50 print:hidden"
            >
              <FileText size={14} /> Imprimir / Guardar PDF
            </button>

            {/* Recurso */}
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="kicker mb-3 text-brand-cyan">Detalle</div>
              <RecursoView payload={data} />
            </section>

            {/* #147 · Perfil Gestor: si el token es de una solicitud, mostramos
                timeline + formulario de carga de avance.
                5.F · print: oculto en papel (es interactivo, no aporta al PDF) */}
            {data.acceso?.tipo === 'solicitud' && token && (
              <div className="print:hidden">
                <PanelGestor token={token} />
              </div>
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
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted print:border-t-2 print:border-brand-cyan">
        Gestión Global · gestionglobal.ar — Acceso temporal y seguro.{' '}
        <span className="print:hidden">No compartas este link.</span>
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
interface AdjuntoStaged {
  nombre: string;
  size: number;
  url: string;     // URL pública del bucket
  uploading: boolean;
  error?: string;
}

// Bloque K (obs nueva): info que ve el gestor sobre la solicitud original.
// Le permite descargar lo que el cliente envió: datos del formulario +
// adjuntos. Antes solo subía avances sin contexto.
type InfoSolicitud = {
  solicitud_id: string;
  servicio: string;
  solicitante_nombre: string;
  solicitante_email: string;
  solicitante_telefono: string;
  formulario_titulo: string | null;
  formulario_categoria: string | null;
  datos: Record<string, unknown>;
  adjuntos: Array<{
    field_name: string;
    /** Etiqueta humana del campo (consigna) resuelta server-side (mig 0208). */
    label?: string | null;
    filename_original: string;
    storage_path: string;
  }>;
  created_at: string;
};

function PanelGestor({ token }: { token: string }) {
  const [avances, setAvances] = useState<GestorAvanceLinea[] | null>(null);
  const [loadingAvances, setLoadingAvances] = useState(true);
  const [info, setInfo] = useState<InfoSolicitud | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [adjuntosUrls, setAdjuntosUrls] = useState<Record<string, string>>({});
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  // #154 · adjuntos ilimitados
  const [adjuntos, setAdjuntos] = useState<AdjuntoStaged[]>([]);

  async function cargarAvances() {
    setLoadingAvances(true);
    const res = await fetchGestorAvances(token);
    if (res.ok) setAvances(res.data);
    setLoadingAvances(false);
  }

  async function cargarInfo() {
    // DGG-34 R4: capitalizado en service `accesoExterno`.
    const res = await obtenerInfoSolicitudPorToken(token);
    if (res.ok && res.data) {
      const d = res.data as InfoSolicitud;
      setInfo(d);
      // Firmar URLs de los adjuntos. download:true fuerza Content-Disposition
      // attachment para que el browser baje el archivo en vez de previsualizar.
      const signed: Record<string, string> = {};
      for (const a of d.adjuntos) {
        const sr = await firmarAdjuntoCliente(a.storage_path, 3600);
        if (sr.ok) signed[a.storage_path] = sr.data;
      }
      setAdjuntosUrls(signed);
    }
  }

  async function descargarInfoPdf() {
    if (!info) return;
    try {
      const { generateTramitePdfBlob } = await import(
        '@/modules/acceso-externo/lib/generateTramitePdf'
      );
      const blob = await generateTramitePdfBlob({
        solicitud_id: info.solicitud_id,
        servicio: info.servicio,
        formulario_titulo: info.formulario_titulo,
        formulario_categoria: info.formulario_categoria,
        solicitante_nombre: info.solicitante_nombre,
        solicitante_email: info.solicitante_email,
        solicitante_telefono: info.solicitante_telefono,
        datos: info.datos,
        adjuntos: info.adjuntos.map((a) => ({
          ...a,
          url_descarga: adjuntosUrls[a.storage_path] ?? undefined,
        })),
        created_at: info.created_at,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tramite-${info.solicitud_id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('No pudimos generar el PDF', {
        description: humanizeError(e),
      });
    }
  }

  useEffect(() => {
    void cargarAvances();
    void cargarInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // #154 · sube cada archivo al bucket 'gestor-uploads' bajo prefijo
  // <token>/<timestamp>-<random>-<filename>. Devuelve URL pública del bucket.
  async function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const staged: AdjuntoStaged[] = Array.from(files).map((f) => ({
      nombre: f.name,
      size: f.size,
      url: '',
      uploading: true,
    }));
    setAdjuntos((prev) => [...prev, ...staged]);

    await Promise.all(
      Array.from(files).map(async (f, i) => {
        const stagedIdx = adjuntos.length + i;
        try {
          const up = await subirAdjuntoGestor(token, f);
          if (!up.ok) throw new Error(up.error.message);
          setAdjuntos((prev) =>
            prev.map((a, k) =>
              k === stagedIdx ? { ...a, uploading: false, url: up.data } : a,
            ),
          );
        } catch (e) {
          const msg = (e as { message?: string })?.message ?? 'Falló la subida';
          setAdjuntos((prev) =>
            prev.map((a, k) =>
              k === stagedIdx ? { ...a, uploading: false, error: msg } : a,
            ),
          );
        }
      }),
    );
  }

  function quitarAdjunto(idx: number) {
    setAdjuntos((prev) => prev.filter((_, k) => k !== idx));
  }

  async function enviar() {
    if (descripcion.trim().length < 3) {
      toast.error('Escribí una descripción de tu avance');
      return;
    }
    if (adjuntos.some((a) => a.uploading)) {
      toast.error('Esperá a que terminen de subir los adjuntos');
      return;
    }
    const urls = adjuntos.filter((a) => !a.error && a.url).map((a) => a.url);
    setEnviando(true);
    const res = await gestorCargarAvance(token, descripcion.trim(), urls);
    setEnviando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Avance enviado al cliente');
    setEnviado(true);
    setDescripcion('');
    setAdjuntos([]);
    void cargarAvances();
  }

  return (
    <section className="rounded-2xl border border-brand-cyan/30 bg-gradient-to-br from-brand-cyan-pale/30 via-white to-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-brand-cyan">
        <Briefcase size={18} />
        <span className="kicker">Panel de gestoría</span>
      </div>

      {/* Bloque K (obs nueva): info que recibió el gestor — datos del
          formulario que llenó el cliente + adjuntos descargables. Cierra
          el bucle: ver lo que pidió → resolver → subir resultado. */}
      {info && (
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="kicker text-brand-cyan">Información del trámite</p>
              <h3 className="font-display text-base font-bold text-brand-ink">
                {info.formulario_titulo || info.servicio}
              </h3>
              <p className="text-xs text-brand-muted">
                Solicitante: {info.solicitante_nombre}
                {info.solicitante_email && ` · ${info.solicitante_email}`}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setInfoOpen((v) => !v)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-muted hover:bg-slate-50"
              >
                {infoOpen ? 'Ocultar' : 'Ver datos'}
              </button>
              <button
                type="button"
                onClick={() => void descargarInfoPdf()}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-cyan px-3 py-1 text-xs font-semibold text-white hover:bg-brand-cyan/90"
                title="Descargar ficha del trámite como PDF"
              >
                <UploadCloud size={11} className="rotate-180" /> Descargar PDF
              </button>
            </div>
          </div>

          {infoOpen && (
            <>
              {/* Datos del formulario en formato legible */}
              <dl className="mt-2 grid grid-cols-1 gap-1.5 rounded-lg bg-slate-50/60 p-3 text-xs sm:grid-cols-2">
                {Object.entries(info.datos).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-brand-muted">{k.replace(/_/g, ' ')}</dt>
                    <dd className="font-medium text-brand-ink break-words">
                      {v === null || v === undefined || v === ''
                        ? '—'
                        : typeof v === 'object'
                          ? JSON.stringify(v)
                          : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>

              {/* Adjuntos del cliente — descarga directa con download attr */}
              {info.adjuntos.length > 0 && (
                <div className="mt-3">
                  <p className="kicker mb-1.5 text-brand-muted">
                    Documentación adjunta del cliente ({info.adjuntos.length})
                  </p>
                  <ul className="space-y-1">
                    {info.adjuntos.map((a) => (
                      <li key={a.storage_path}>
                        <a
                          href={adjuntosUrls[a.storage_path] ?? '#'}
                          download={a.filename_original}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-brand-ink hover:bg-brand-cyan/10 hover:text-brand-cyan"
                          title="Descargar archivo"
                        >
                          <Paperclip size={11} className="shrink-0 text-brand-cyan" />
                          <span className="min-w-0 break-words">
                            {(a.label ?? a.field_name) && (
                              <span className="font-semibold">
                                {a.label ?? a.field_name}:{' '}
                              </span>
                            )}
                            {a.filename_original}
                          </span>
                          <UploadCloud size={10} className="rotate-180 text-brand-muted" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

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

        {/* #154 · Adjuntos ilimitados */}
        <div className="rounded-xl border border-dashed border-brand-cyan/30 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="kicker text-brand-cyan inline-flex items-center gap-1">
              <Paperclip size={12} /> Archivos adjuntos
              {adjuntos.length > 0 ? ` (${adjuntos.length})` : ''}
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-cyan-pale/40 px-3 py-1.5 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan-pale">
              <UploadCloud size={12} />
              Agregar
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  void onFilesPicked(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {adjuntos.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {adjuntos.map((a, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Paperclip size={11} className="shrink-0 text-brand-cyan" />
                    <span className="truncate text-brand-ink">{a.nombre}</span>
                    <span className="shrink-0 text-brand-muted">
                      ({Math.max(1, Math.round(a.size / 1024))} KB)
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {a.uploading ? (
                      <Loader2 size={11} className="animate-spin text-brand-muted" />
                    ) : a.error ? (
                      <span className="text-rose-600">{a.error}</span>
                    ) : (
                      <CheckCircle2 size={11} className="text-emerald-600" />
                    )}
                    <button
                      type="button"
                      onClick={() => quitarAdjunto(idx)}
                      className="rounded p-0.5 text-brand-muted hover:bg-slate-200 hover:text-brand-ink"
                      aria-label="Quitar"
                    >
                      <XIcon size={11} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-brand-muted">
              Sin adjuntos. Sumá los que necesites: planos, resoluciones, fotos, etc.
            </p>
          )}
        </div>

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
                {a.archivos_urls && a.archivos_urls.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {a.archivos_urls.map((u, k) => (
                      <li key={k}>
                        <a
                          href={u}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-brand-cyan hover:underline"
                        >
                          <Paperclip size={10} /> {nombreArchivo(u)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
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

function nombreArchivo(url: string): string {
  try {
    const last = url.split('/').pop() ?? '';
    // El formato es <ts>-<rand>-<nombre>. Quitamos prefijo si está.
    const m = last.match(/^\d+-[a-z0-9]+-(.*)$/i);
    return m?.[1] ?? last;
  } catch {
    return 'archivo';
  }
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
