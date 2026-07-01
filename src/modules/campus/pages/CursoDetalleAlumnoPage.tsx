import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Lock,
  Paperclip,
  ScrollText,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  certificadoParaPdf,
  esVisibleAlumno,
  getCertificadoMatricula,
  getCurso,
  getProgresoResumen,
  listCondicionesMatricula,
  listEncuentros,
  listMatriculas,
  listModulosSincronicos,
  listProgreso,
  matriculaTieneAcceso,
  resolverEsquemaParaCert,
  verificacionUrl,
  type CertificadoRow,
  type CursoBibliografiaRow,
  type CursoDetalle,
  type CursoEncuentroRow,
  type CursoMatriculaRow,
  type CursoProgresoRow,
  type MatriculaCondicionItem,
  type ModuloSincronicoRow,
  type ProgresoResumen,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';
import { ClasePlayer } from '../components/ClasePlayer';
import { ExamenRunner } from '../components/ExamenRunner';
import { ProgresoBar } from '../components/ProgresoBar';
import { EncuentrosEnVivoAlumno, ClaseEnVivoFullLayout } from '../components/EncuentrosEnVivoAlumno';
import { EncuestaAlumnoCard } from '../components/EncuestaAlumnoCard';
import {
  getEncuestaPorCurso,
  type CursoEncuestaRow,
} from '@/services/api/encuestas';
import { humanizeError } from '@/lib/errors';

// (DGG-51) El panel derecho del curso muestra UN nodo por vez. Los "nodos" del
// menú son: cada clase y, además — como estadios propios, no colgando de cada
// clase — encuentros sincrónicos, bibliografía, examen (último) y certificado.
type NodoSel =
  | { tipo: 'clase'; id: string }
  | { tipo: 'programa' }
  | { tipo: 'enlace' }
  | { tipo: 'sincronico' }
  | { tipo: 'bibliografia' }
  | { tipo: 'examen' }
  | { tipo: 'encuesta' }
  | { tipo: 'certificado' };

// Página del alumno matriculado (portal). Si no está matriculado y el curso es
// público, muestra CTA de inscripción.
export function CursoDetalleAlumnoPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const user = useCurrentUser();
  const userId = user?.id;
  const [data, setData] = useState<CursoDetalle | null>(null);
  const [matricula, setMatricula] = useState<CursoMatriculaRow | null>(null);
  const [progreso, setProgreso] = useState<CursoProgresoRow[]>([]);
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const [condiciones, setCondiciones] = useState<MatriculaCondicionItem[]>([]);
  const [certificado, setCertificado] = useState<CertificadoRow | null>(null);
  const [encuesta, setEncuesta] = useState<CursoEncuestaRow | null>(null);
  const [encuentros, setEncuentros] = useState<CursoEncuentroRow[]>([]);
  const [modulos, setModulos] = useState<ModuloSincronicoRow[]>([]);
  // E-GG-14: separar carga INICIAL de refreshes silenciosos. Si en cada
  // realtime/refetch ponemos loading=true, el árbol entero se desmonta
  // (incluido el <ZoomLiveEmbed>) → al re-montar dispara un join() duplicado
  // y Zoom interpreta dos solicitudes de admisión.
  const [initialLoading, setInitialLoading] = useState(true);
  // El panel derecho muestra el nodo seleccionado; null = default a 1ª clase.
  const [nodoSel, setNodoSel] = useState<NodoSel | null>(null);
  // DGG-14: cuando el alumno entra a un encuentro en vivo, el layout
  // cambia a "modo clase" — embed full-width, sidebar oculto.
  const [encuentroEnVivoId, setEncuentroEnVivoId] = useState<string | null>(null);
  // Acordeón del menú lateral del alumno: sólo UN módulo abierto a la vez (menos
  // scroll, experiencia más concentrada). El nombre del módulo + el docente
  // quedan SIEMPRE visibles; las clases se colapsan/expanden. null = todos
  // colapsados; accordionTocado distingue el default del estado elegido.
  const [openModuloId, setOpenModuloId] = useState<string | null>(null);
  const [accordionTocado, setAccordionTocado] = useState(false);
  // JL #6 (DGG-94) · ref al panel de contenido para autoscrollear al elegir una
  // sección del sidebar (importa en mobile, donde el sidebar está arriba).
  const mainRef = useRef<HTMLElement>(null);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setInitialLoading(true);
    const d = await getCurso(slug);
    if (!d.ok) {
      if (!silent) setInitialLoading(false);
      if (!silent) toast.error(humanizeError(d.error));
      return;
    }
    setData(d.data);

    // Buscar matrícula del usuario actual.
    if (userId) {
      const m = await listMatriculas({
        cursoId: d.data.curso.id,
        profileId: userId,
      });
      const found = m.ok && m.data.length > 0 ? m.data[0] : null;
      if (found) {
        setMatricula(found);
        const [p, r, c, cert, enc, mods, enq] = await Promise.all([
          listProgreso(found.id),
          getProgresoResumen(found.id),
          listCondicionesMatricula(found.id),
          getCertificadoMatricula(found.id),
          listEncuentros(d.data.curso.id),
          listModulosSincronicos(d.data.curso.id),
          getEncuestaPorCurso(d.data.curso.id),
        ]);
        if (p.ok) setProgreso(p.data);
        if (r.ok) setResumen(r.data);
        if (c.ok) setCondiciones(c.data);
        if (cert.ok) setCertificado(cert.data);
        if (enc.ok) setEncuentros(enc.data);
        if (mods.ok) setModulos(mods.data);
        if (enq.ok) setEncuesta(enq.data);
      } else {
        setMatricula(null);
        setProgreso([]);
        setResumen(null);
        setCondiciones([]);
        setEncuesta(null);
        setCertificado(null);
        setEncuentros([]);
        setModulos([]);
      }
    }
    if (!silent) setInitialLoading(false);
    // E-GG-14: dependemos de userId (string estable) NO del objeto user
    // (cambia de referencia en cada token refresh).
  }, [slug, userId]);

  // Carga inicial — única que puede mostrar Skeleton.
  useEffect(() => {
    void reload({ silent: false });
  }, [reload]);

  // Refreshes silenciosos por realtime. NUNCA suben loading → el árbol no
  // se desmonta → el embed de Zoom sobrevive.
  useRealtimeRefresh(
    ['curso_progreso', 'examen_intentos', 'matricula_condiciones', 'certificados'],
    () => void reload({ silent: true }),
  );

  // Memoizado: el userName tiene que tener referencia estable para que el
  // <ZoomLiveEmbed> NO re-monte cuando React re-renderea el padre por otra
  // razón (eg token refresh).
  const userNameStable = useMemo(
    () => user?.fullName ?? user?.email ?? 'Alumno',
    [user?.fullName, user?.email],
  );

  const completadasSet = useMemo(
    () => new Set(progreso.filter((p) => p.completada).map((p) => p.clase_id)),
    [progreso],
  );

  // L1 (sesión 30/05/2026): el alumno sólo ve módulos y clases publicados, y
  // sólo bibliografía publicada. Los recursos despublicados o programados a
  // futuro se ocultan por completo de la vista.
  const modulosVisibles = useMemo(() => {
    if (!data) return [];
    return data.modulos
      .filter((m) => esVisibleAlumno(m))
      .map((m) => ({
        ...m,
        clases: m.clases.filter((c) => esVisibleAlumno(c)),
      }))
      // Material extra (DGG-72): un módulo con material pero sin clases visibles
      // igual debe mostrarse (su "material extra" es parte del módulo).
      .filter((m) => m.clases.length > 0 || m.material.length > 0);
  }, [data]);

  const bibliografiaVisible = useMemo(() => {
    if (!data) return [];
    return data.bibliografia.filter((b) => esVisibleAlumno(b));
  }, [data]);

  const clases = useMemo(
    () =>
      modulosVisibles.flatMap((m) =>
        m.clases.map((c) => ({
          ...c,
          modulo: m.titulo,
          moduloOrden: m.orden,
          docenteNombre: m.docente_nombre,
          docenteFoto: m.docente_foto_url,
          docenteCv: m.docente_cv_url,
        })),
      ),
    [modulosVisibles],
  );

  // Nodo efectivo: si el alumno no eligió nada, default a la primera clase.
  const nodoEfectivo: NodoSel = useMemo(() => {
    if (nodoSel) return nodoSel;
    const primera = clases[0];
    if (primera) return { tipo: 'clase', id: primera.id };
    return { tipo: 'clase', id: '' };
  }, [nodoSel, clases]);

  // JL #6 (DGG-94) · Al elegir una sección del sidebar, el alumno no veía el
  // contenido nuevo: en mobile (apilado) el viewport queda en el menú; en desktop
  // el sidebar (hasta 20 módulos) es más alto que el contenido, y al elegir una
  // sección de ABAJO el contenido (arriba) queda fuera de vista (el sticky ya se
  // agotó cerca del fondo). Fix: scrollear el panel a la vista tras CADA selección
  // real (nodoSel != null, no en la carga inicial), en AMBOS entornos. Combinado
  // con el sticky desktop: al navegar el menú el contenido sigue visible, y al
  // clickear cualquier sección (incluida la última) se garantiza que se vea.
  useEffect(() => {
    if (!nodoSel || typeof window === 'undefined') return;
    const t = setTimeout(() => {
      mainRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(t);
  }, [nodoSel]);

  // Encuesta de satisfacción: tiene NODO PROPIO (no cuelga del nodo certificado,
  // que sólo aparece con condiciones/cert). Así el alumno la alcanza siempre que
  // esté activa con preguntas. (Bug: en cursos sin condiciones la encuesta era
  // inalcanzable porque vivía dentro del nodo "Mi certificado".)
  const encuestaActiva =
    !!encuesta?.activa &&
    (((encuesta.schema as { preguntas?: unknown[] } | null)?.preguntas?.length) ??
      0) > 0;

  const claseActiva = useMemo(
    () =>
      nodoEfectivo.tipo === 'clase'
        ? clases.find((c) => c.id === nodoEfectivo.id) ?? null
        : null,
    [clases, nodoEfectivo],
  );

  // Módulo abierto efectivo del acordeón: hasta que el alumno toque el acordeón,
  // se abre el módulo de la clase activa (o el primero); después respeta su
  // elección (incluido "todos colapsados").
  const moduloDeActivaId = useMemo(() => {
    if (claseActiva) {
      const m = modulosVisibles.find((mm) =>
        mm.clases.some((c) => c.id === claseActiva.id),
      );
      if (m) return m.id;
    }
    return modulosVisibles[0]?.id ?? null;
  }, [claseActiva, modulosVisibles]);
  const openModuloEfectivo = accordionTocado ? openModuloId : moduloDeActivaId;

  if (initialLoading || !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <Skeleton className="h-10 w-2/3 rounded-lg" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  // DGG-10: sin autoservicio. Si el alumno no tiene matrícula asignada, no
  // puede auto-inscribirse — sólo ve un mensaje informativo.
  if (!matricula) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          to="/portal/campus"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft size={13} /> Mis cursos
        </Link>
        <div className="card-premium relative overflow-hidden p-8">
          <TrianglesAccent
            position="top-right"
            size={200}
            tone="cyan"
            density="rich"
            className="opacity-25"
          />
          <div className="relative">
            <IllustratedEmpty
              illustration="lista"
              title="No tenés acceso a este curso"
              description={
                <>
                  El acceso al campus lo habilita la gerencia. Si necesitás
                  cursar “{data.curso.titulo}”, escribile a tu administrador.
                </>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // DGG-82: la matrícula existe pero su ventana de acceso post-finalización
  // venció (o quedó 'vencida'). El contenido viene vacío por RLS
  // (private.curso_matriculado), así que mostramos un aviso claro en vez de
  // un curso en blanco.
  if (!matriculaTieneAcceso(matricula)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          to="/portal/campus"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft size={13} /> Mis cursos
        </Link>
        <div className="card-premium relative overflow-hidden p-8">
          <TrianglesAccent
            position="top-right"
            size={200}
            tone="cyan"
            density="rich"
            className="opacity-25"
          />
          <div className="relative">
            <IllustratedEmpty
              illustration="lista"
              title="Tu acceso a este curso finalizó"
              description={
                <>
                  Completaste “{data.curso.titulo}” y ya pasó el período de
                  repaso. Si necesitás volver a acceder, escribile a tu
                  administrador.
                </>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  // DGG-14: modo "clase en vivo" — layout dedicado full-width.
  // Cuando el alumno entra a un encuentro, se renderea SOLO el embed Zoom
  // en formato grande (toolbar nativa, controles, todo lo de Zoom estándar).
  // El sidebar del curso queda oculto para no competir por espacio.
  const encuentroEnVivo = encuentroEnVivoId
    ? encuentros.find((e) => e.id === encuentroEnVivoId)
    : null;
  if (encuentroEnVivo) {
    // Fullscreen — el componente toma 100vh del viewport sin scroll global.
    return (
      <ClaseEnVivoFullLayout
        encuentro={encuentroEnVivo}
        cursoTitulo={data.curso.titulo}
        userName={userNameStable}
        onSalir={() => setEncuentroEnVivoId(null)}
      />
    );
  }

  // Aviso fijo de encuentro en vivo AHORA (independiente del nodo activo).
  const enVivoAhora =
    encuentros.find(
      (e) => e.zoom_status === 'en_curso' || e.webex_status === 'en_curso',
    ) ?? null;

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        to="/portal/campus"
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
      >
        <ArrowLeft size={13} /> Mis cursos
      </Link>

      {data.curso.banner_url ? (
        <div className="relative mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
          <div className="aspect-[3/1] w-full">
            <img
              src={data.curso.banner_url}
              alt=""
              className="h-full w-full object-cover"
            />
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand-ink/80 via-brand-ink/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
            <p className="kicker text-brand-cyan-pale">Campus</p>
            <h1 className="mt-1 font-display text-2xl font-bold text-white drop-shadow-sm sm:text-3xl">
              {data.curso.titulo}
            </h1>
            {data.curso.instructor_nombre && (
              <p className="mt-1 flex items-center gap-2 text-sm text-white/80">
                {data.curso.instructor_foto_url && (
                  <img
                    src={data.curso.instructor_foto_url}
                    alt=""
                    className="h-6 w-6 rounded-full border border-white/40 object-cover"
                  />
                )}
                <span>{data.curso.instructor_nombre}</span>
              </p>
            )}
          </div>
        </div>
      ) : null}

      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {!data.curso.banner_url && (
            <>
              <p className="kicker text-brand-cyan">Campus</p>
              <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
                {data.curso.titulo}
              </h1>
            </>
          )}
          {resumen && (
            <div className={cn('flex items-center gap-3 text-xs text-brand-muted', !data.curso.banner_url && 'mt-3')}>
              <ProgresoBar porcentaje={resumen.porcentaje} className="max-w-xs" />
              <span>
                {resumen.completadas}/{resumen.total_clases} clases ·{' '}
                {resumen.examenes_aprobados} examen(es) aprobado(s)
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        {/* Sidebar de módulos + clases */}
        <aside className="card-premium relative overflow-hidden p-3">
          <TrianglesAccent
            position="top-right"
            size={110}
            tone="cyan"
            density="soft"
            className="opacity-15"
          />
          <nav className="relative space-y-3">
            {/* DGG-81 · Recursos del curso ARRIBA DE TODO, solo si tienen contenido. */}
            {data.curso.programa_url && (
              <NavNodo
                icon={<FileText size={15} className="text-brand-cyan" />}
                label="Programa"
                sub="Descargar PDF"
                active={nodoEfectivo.tipo === 'programa'}
                onClick={() => setNodoSel({ tipo: 'programa' })}
              />
            )}
            {data.curso.enlace_url && (
              <NavNodo
                icon={<Link2 size={15} className="text-brand-cyan" />}
                label={data.curso.enlace_titulo || 'Enlace de conexión'}
                sub="Acceso directo"
                active={nodoEfectivo.tipo === 'enlace'}
                onClick={() => setNodoSel({ tipo: 'enlace' })}
              />
            )}
            {modulosVisibles.map((m) => {
              const open = openModuloEfectivo === m.id;
              const tieneActiva =
                claseActiva != null &&
                m.clases.some((c) => c.id === claseActiva.id);
              return (
                <section
                  key={m.id}
                  className={cn(
                    'overflow-hidden rounded-xl border bg-white transition-colors',
                    open ? 'border-brand-cyan/30' : 'border-slate-200',
                  )}
                >
                  {/* Header (toggle): número + título + chevron */}
                  <button
                    type="button"
                    onClick={() => {
                      setAccordionTocado(true);
                      setOpenModuloId(open ? null : m.id);
                    }}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-cyan/10 text-[11px] font-bold text-brand-cyan">
                      {m.orden}
                    </span>
                    {m.icono_url && (
                      <img
                        src={m.icono_url}
                        alt=""
                        className="h-5 w-5 shrink-0 rounded border border-slate-200 object-cover"
                      />
                    )}
                    <span className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-brand-ink">
                      {m.titulo}
                    </span>
                    {tieneActiva && !open && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-cyan"
                        aria-hidden
                      />
                    )}
                    <ChevronDown
                      size={16}
                      className={cn(
                        'shrink-0 text-brand-muted transition-transform duration-300',
                        open && 'rotate-180',
                      )}
                    />
                  </button>

                  {/* Docente: SIEMPRE visible (colapsado o no) */}
                  {m.docente_nombre && (
                    <div className="flex items-center gap-2 px-3 pb-2.5">
                      {m.docente_foto_url ? (
                        <img
                          src={m.docente_foto_url}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
                        />
                      ) : (
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-cyan/10 text-[10px] font-semibold text-brand-cyan">
                          {(m.docente_nombre.split(' ').pop() ?? '·').charAt(0)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-brand-ink">
                        {m.docente_nombre}
                      </span>
                      {m.docente_cv_url && (
                        <a
                          href={m.docente_cv_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          title="Descargar CV del docente"
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] font-semibold text-brand-cyan hover:bg-brand-cyan/10"
                        >
                          <Download size={11} /> CV
                        </a>
                      )}
                    </div>
                  )}

                  {/* Clases del módulo: colapsable (acordeón, 1 abierto a la vez) */}
                  {open && (
                    <ul className="space-y-1 border-t border-slate-100 px-2 py-2 motion-safe:animate-fade-up">
                      {m.clases.map((c) => {
                        const done = completadasSet.has(c.id);
                        const isActive =
                          nodoEfectivo.tipo === 'clase' &&
                          nodoEfectivo.id === c.id;
                        return (
                          <li key={c.id}>
                            <button
                              onClick={() =>
                                setNodoSel({ tipo: 'clase', id: c.id })
                              }
                              className={cn(
                                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition',
                                isActive
                                  ? 'bg-brand-cyan/10 text-brand-ink'
                                  : 'text-brand-muted hover:bg-slate-50 hover:text-brand-ink',
                              )}
                            >
                              {done ? (
                                <CheckCircle2
                                  size={14}
                                  className="text-emerald-600"
                                />
                              ) : c.tipo === 'sincronica_zoom' ? (
                                <Video size={14} className="text-amber-600" />
                              ) : c.tipo === 'lectura_pdf' ? (
                                <BookOpen size={14} />
                              ) : (
                                <ScrollText size={14} />
                              )}
                              <span className="flex-1 truncate">{c.titulo}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Material extra del módulo (DGG-72): links/archivos.
                      Sólo aparece si el módulo tiene ≥1 ítem cargado. */}
                  {open && m.material.length > 0 && (
                    <div className="border-t border-slate-100 px-2 py-2 motion-safe:animate-fade-up">
                      <p className="mb-1.5 flex items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
                        <Paperclip size={11} /> Material extra
                      </p>
                      <ul className="space-y-1">
                        {m.material.map((mat) => (
                          <li
                            key={mat.id}
                            className="rounded-lg px-2 py-1.5 hover:bg-slate-50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm text-brand-ink">
                                {mat.titulo}
                              </span>
                              <div className="flex shrink-0 items-center gap-2">
                                {mat.archivo_url && (
                                  <a
                                    href={mat.archivo_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download
                                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-cyan hover:underline"
                                  >
                                    <Download size={12} /> Descargar
                                  </a>
                                )}
                                {mat.url && (
                                  <a
                                    href={mat.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-brand-cyan hover:underline"
                                  >
                                    Abrir
                                  </a>
                                )}
                              </div>
                            </div>
                            {mat.descripcion && (
                              <p className="mt-0.5 text-xs text-brand-muted">
                                {mat.descripcion}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              );
            })}

            {/* Nodos por tipo (DGG-51): cada uno abre SOLO su contenido. */}
            {encuentros.length > 0 && (
              <NavNodo
                icon={<Video size={15} className="text-amber-600" />}
                label="Encuentros sincrónicos"
                sub={`${encuentros.length} en vivo`}
                active={nodoEfectivo.tipo === 'sincronico'}
                onClick={() => setNodoSel({ tipo: 'sincronico' })}
              />
            )}
            {bibliografiaVisible.length > 0 && (
              <NavNodo
                icon={<BookOpen size={15} className="text-brand-cyan" />}
                label="Bibliografía"
                sub={`${bibliografiaVisible.length} material${
                  bibliografiaVisible.length === 1 ? '' : 'es'
                }`}
                active={nodoEfectivo.tipo === 'bibliografia'}
                onClick={() => setNodoSel({ tipo: 'bibliografia' })}
              />
            )}
            {data.examenes.length > 0 && (
              <NavNodo
                icon={<ScrollText size={15} className="text-brand-cyan" />}
                label={
                  data.examenes.length === 1
                    ? data.examenes[0]?.titulo ?? 'Evaluaciones'
                    : 'Evaluaciones'
                }
                sub="Examen final"
                active={nodoEfectivo.tipo === 'examen'}
                onClick={() => setNodoSel({ tipo: 'examen' })}
              />
            )}
            {encuestaActiva && (
              <NavNodo
                icon={<ClipboardList size={15} className="text-violet-600" />}
                label="Encuesta de satisfacción"
                sub="Contanos tu experiencia"
                active={nodoEfectivo.tipo === 'encuesta'}
                onClick={() => setNodoSel({ tipo: 'encuesta' })}
              />
            )}
            {(condiciones.filter((c) => c.activa).length > 0 || certificado) && (
              <NavNodo
                icon={
                  <Award
                    size={15}
                    className={certificado ? 'text-emerald-600' : 'text-brand-cyan'}
                  />
                }
                label="Mi certificado"
                sub={certificado ? 'Emitido · descargá' : 'Condiciones'}
                active={nodoEfectivo.tipo === 'certificado'}
                onClick={() => setNodoSel({ tipo: 'certificado' })}
              />
            )}
          </nav>
        </aside>

        {/* Contenido principal — un nodo por vez (DGG-51).
            JL #6 (DGG-94): en desktop el sidebar (hasta 20 módulos) es mucho más
            alto que el contenido → al elegir una sección de abajo, el contenido
            (arriba a la derecha) quedaba fuera de vista y el alumno veía el panel
            vacío. Fix: sticky en desktop (el contenido sigue el scroll y queda
            siempre visible) + autoscroll en mobile (una sola columna, apilado). */}
        <main
          ref={mainRef}
          className="space-y-6 scroll-mt-4 lg:sticky lg:top-6 lg:self-start"
        >
          {/* Aviso fijo: encuentro en vivo AHORA, esté donde esté el alumno */}
          {enVivoAhora && nodoEfectivo.tipo !== 'sincronico' && (
            <button
              onClick={() => setNodoSel({ tipo: 'sincronico' })}
              className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left transition hover:bg-amber-100"
            >
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
                <Video size={16} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 ring-2 ring-white" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-amber-900">
                  Hay un encuentro en vivo ahora
                </span>
                <span className="block truncate text-xs text-amber-800">
                  {enVivoAhora.titulo} · tocá para entrar
                </span>
              </span>
            </button>
          )}

          {nodoEfectivo.tipo === 'programa' ? (
            <ProgramaPanel url={data.curso.programa_url} />
          ) : nodoEfectivo.tipo === 'enlace' ? (
            <EnlacePanel
              titulo={data.curso.enlace_titulo}
              descripcion={data.curso.enlace_descripcion}
              url={data.curso.enlace_url}
            />
          ) : nodoEfectivo.tipo === 'sincronico' ? (
            encuentros.length > 0 ? (
              <EncuentrosEnVivoAlumno
                encuentros={encuentros}
                modulos={modulos}
                userName={userNameStable}
                activoEncuentroId={encuentroEnVivoId}
                onEntrar={(id) => setEncuentroEnVivoId(id)}
                onSalir={() => setEncuentroEnVivoId(null)}
              />
            ) : (
              <NodoVacio
                icon={<Video size={26} />}
                titulo="Sin encuentros sincrónicos"
                mensaje="Este curso no tiene encuentros en vivo programados."
              />
            )
          ) : nodoEfectivo.tipo === 'bibliografia' ? (
            <BibliografiaPanel items={bibliografiaVisible} />
          ) : nodoEfectivo.tipo === 'examen' ? (
            data.examenes.length > 0 ? (
              <section className="space-y-4">
                <header className="flex items-center gap-2">
                  <ScrollText size={16} className="text-brand-cyan" />
                  <h2 className="font-display text-lg font-semibold text-brand-ink">
                    Evaluaciones
                  </h2>
                </header>
                {data.examenes.map((e) => (
                  <ExamenRunner key={e.id} matriculaId={matricula.id} examen={e} />
                ))}
              </section>
            ) : (
              <NodoVacio
                icon={<ScrollText size={26} />}
                titulo="Sin evaluaciones"
                mensaje="Este curso todavía no tiene examen."
              />
            )
          ) : nodoEfectivo.tipo === 'certificado' ? (
            <CondicionesAlumnoPanel
              condiciones={condiciones.filter((c) => c.activa)}
              certificado={certificado}
            />
          ) : nodoEfectivo.tipo === 'encuesta' ? (
            <EncuestaAlumnoCard
              curso_id={data.curso.id}
              matricula_id={matricula.id}
            />
          ) : claseActiva ? (
            <ClasePlayer
              matriculaId={matricula.id}
              clase={claseActiva}
              docenteNombre={claseActiva.docenteNombre}
              docenteFoto={claseActiva.docenteFoto}
              docenteCvUrl={claseActiva.docenteCv}
              completada={completadasSet.has(claseActiva.id)}
              onCompletada={() => void reload()}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
              Este curso todavía no tiene clases publicadas.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// Panel motivacional: qué le falta al alumno para el certificado (DGG-10).
// Si ya está emitido, muestra el botón de descarga + link de verificación.
function CondicionesAlumnoPanel({
  condiciones,
  certificado,
}: {
  condiciones: MatriculaCondicionItem[];
  certificado: CertificadoRow | null;
}) {
  const [descargando, setDescargando] = useState(false);
  const cumplidas = condiciones.filter((c) => c.cumplida).length;
  const total = condiciones.length;
  const todasOk = total > 0 && cumplidas === total;
  const pendientes = condiciones.filter((c) => !c.cumplida);

  async function onDescargar() {
    if (!certificado) return;
    setDescargando(true);
    try {
      const esquema = await resolverEsquemaParaCert(certificado);
      await generateCertificadoPdf(
        certificadoParaPdf(certificado),
        esquema ?? undefined,
      );
    } catch (err) {
      console.error('[cert-pdf] portal alumno descarga falló:', err);
      const detalle =
        err instanceof Error
          ? err.message.slice(0, 180)
          : 'Error desconocido';
      toast.error('No pudimos generar el PDF.', { description: detalle });
    } finally {
      setDescargando(false);
    }
  }

  // Estado emitido: "¡Listo! Descargá tu certificado".
  if (certificado) {
    return (
      <section className="card-premium relative overflow-hidden p-5 ring-1 ring-emerald-200">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          <header className="mb-2 flex items-center gap-2">
            <Award size={18} className="text-emerald-600" />
            <h2 className="font-display text-lg font-semibold text-brand-ink">
              ¡Listo! Descargá tu certificado
            </h2>
          </header>
          <p className="text-sm text-brand-muted">
            Completaste todas las condiciones del curso. Tu certificado ya está
            emitido y es verificable.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void onDescargar()}
              disabled={descargando}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90 disabled:opacity-60"
            >
              {descargando ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Descargar certificado (PDF)
            </button>
            <a
              href={verificacionUrl(certificado.codigo)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-cyan hover:underline"
            >
              <ShieldCheck size={14} /> Verificar autenticidad
            </a>
          </div>
          <p className="mt-3 font-mono text-[11px] text-brand-muted">
            Código: {certificado.codigo}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'card-premium relative overflow-hidden p-5',
        todasOk && 'ring-1 ring-emerald-200',
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Award
            size={16}
            className={todasOk ? 'text-emerald-600' : 'text-brand-cyan'}
          />
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            Tu certificado
          </h2>
        </div>
        <span
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
            todasOk
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan',
          )}
        >
          {cumplidas}/{total} cumplidas
        </span>
      </header>

      {todasOk ? (
        <p className="text-sm text-emerald-700">
          ¡Cumpliste todas las condiciones! Tu certificado va a estar disponible
          en breve.
        </p>
      ) : (
        <p className="text-sm text-brand-muted">
          Te falta:{' '}
          <strong className="text-brand-ink">
            {pendientes.map((c) => c.etiqueta).join(' · ')}
          </strong>
        </p>
      )}

      <ul className="mt-3 space-y-1.5">
        {condiciones.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-lg bg-brand-zebra/40 px-3 py-2 text-sm"
          >
            {c.cumplida ? (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            ) : (
              <Circle size={16} className="shrink-0 text-slate-300" />
            )}
            <span
              className={cn(
                'flex-1',
                c.cumplida ? 'text-brand-ink' : 'text-brand-muted',
              )}
            >
              {c.etiqueta}
            </span>
            {(c.tipo === 'examen' || c.tipo === 'encuesta') && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-muted">
                <Lock size={11} /> Automática
              </span>
            )}
            {!c.cumplida && c.tipo !== 'examen' && c.tipo !== 'encuesta' && (
              <span className="shrink-0 text-[11px] text-amber-600">
                Pendiente de verificación
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Nodo de "estadio" del menú (encuentros / bibliografía / examen / certificado).
// Se ve como un módulo clicable; al seleccionarlo el panel derecho muestra SOLO
// su contenido (DGG-51).
function NavNodo({
  icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition',
        active
          ? 'border-brand-cyan/30 bg-brand-cyan/10'
          : 'border-slate-200 bg-white hover:border-brand-cyan/30 hover:bg-slate-50',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-cyan/10">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-brand-ink">
          {label}
        </span>
        {sub && (
          <span className="block truncate text-[11px] text-brand-muted">{sub}</span>
        )}
      </span>
    </button>
  );
}

// Panel de bibliografía (nodo): link externo y/o PDF descargable por ítem.
function BibliografiaPanel({ items }: { items: CursoBibliografiaRow[] }) {
  if (items.length === 0) {
    return (
      <NodoVacio
        icon={<BookOpen size={26} />}
        titulo="Sin bibliografía"
        mensaje="Este curso todavía no tiene material de lectura cargado."
      />
    );
  }
  return (
    <section className="card-premium p-5">
      <header className="mb-3 flex items-center gap-2">
        <BookOpen size={16} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          Bibliografía
        </h2>
      </header>
      <ul className="divide-y divide-slate-100">
        {items.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-3 py-3 text-sm"
          >
            <div className="min-w-0">
              <p className="font-semibold text-brand-ink">{b.titulo}</p>
              {b.autor && <p className="text-xs text-brand-muted">{b.autor}</p>}
              {b.descripcion && (
                <p className="mt-0.5 text-xs text-brand-muted">{b.descripcion}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {b.archivo_url && (
                <a
                  href={b.archivo_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-brand-ink hover:bg-slate-50"
                >
                  <Download size={13} /> Descargar
                </a>
              )}
              {b.url && (
                <a
                  href={b.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-brand-cyan hover:underline"
                >
                  Abrir
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// DGG-81 · Nodo "Programa": el PDF del programa del curso (ver / descargar).
function ProgramaPanel({ url }: { url: string | null }) {
  if (!url) {
    return (
      <NodoVacio
        icon={<FileText size={26} />}
        titulo="Sin programa"
        mensaje="Este curso todavía no tiene un programa cargado."
      />
    );
  }
  return (
    <section className="card-premium p-5">
      <header className="mb-3 flex items-center gap-2">
        <FileText size={16} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          Programa
        </h2>
      </header>
      <p className="mb-4 text-sm text-brand-muted">
        El programa completo del curso, con contenidos y carga horaria.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
        >
          <ExternalLink size={15} /> Ver programa
        </a>
        <a
          href={url}
          download
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-ink transition hover:bg-slate-50"
        >
          <Download size={15} /> Descargar
        </a>
      </div>
    </section>
  );
}

// DGG-81 · Nodo "Enlace de conexión": título + descripción + botón al link.
function EnlacePanel({
  titulo,
  descripcion,
  url,
}: {
  titulo: string | null;
  descripcion: string | null;
  url: string | null;
}) {
  if (!url) {
    return (
      <NodoVacio
        icon={<Link2 size={26} />}
        titulo="Sin enlace"
        mensaje="Este curso todavía no tiene un enlace de conexión configurado."
      />
    );
  }
  return (
    <section className="card-premium p-5">
      <header className="mb-3 flex items-center gap-2">
        <Link2 size={16} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          {titulo || 'Enlace de conexión'}
        </h2>
      </header>
      {descripcion && (
        <p className="mb-4 text-sm text-brand-muted">{descripcion}</p>
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
      >
        <ExternalLink size={15} /> Ir al enlace
      </a>
    </section>
  );
}

// Placeholder de nodo sin contenido.
function NodoVacio({
  icon,
  titulo,
  mensaje,
}: {
  icon: React.ReactNode;
  titulo: string;
  mensaje: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
        {icon}
      </span>
      <p className="mt-3 font-display text-base font-semibold text-brand-ink">
        {titulo}
      </p>
      <p className="mt-1 text-sm text-brand-muted">{mensaje}</p>
    </div>
  );
}

