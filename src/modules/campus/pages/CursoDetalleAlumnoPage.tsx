import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Lock,
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
  listProgreso,
  resolverEsquemaParaCert,
  verificacionUrl,
  type CertificadoRow,
  type CursoDetalle,
  type CursoEncuentroRow,
  type CursoMatriculaRow,
  type CursoProgresoRow,
  type MatriculaCondicionItem,
  type ProgresoResumen,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';
import { ClasePlayer } from '../components/ClasePlayer';
import { ExamenRunner } from '../components/ExamenRunner';
import { ProgresoBar } from '../components/ProgresoBar';
import { EncuentrosEnVivoAlumno, ClaseEnVivoFullLayout } from '../components/EncuentrosEnVivoAlumno';
import { EncuestaAlumnoCard } from '../components/EncuestaAlumnoCard';
import { humanizeError } from '@/lib/errors';

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
  const [encuentros, setEncuentros] = useState<CursoEncuentroRow[]>([]);
  // E-GG-14: separar carga INICIAL de refreshes silenciosos. Si en cada
  // realtime/refetch ponemos loading=true, el árbol entero se desmonta
  // (incluido el <ZoomLiveEmbed>) → al re-montar dispara un join() duplicado
  // y Zoom interpreta dos solicitudes de admisión.
  const [initialLoading, setInitialLoading] = useState(true);
  const [claseActivaId, setClaseActivaId] = useState<string | null>(null);
  // DGG-14: cuando el alumno entra a un encuentro en vivo, el layout
  // cambia a "modo clase" — embed full-width, sidebar oculto.
  const [encuentroEnVivoId, setEncuentroEnVivoId] = useState<string | null>(null);

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
        const [p, r, c, cert, enc] = await Promise.all([
          listProgreso(found.id),
          getProgresoResumen(found.id),
          listCondicionesMatricula(found.id),
          getCertificadoMatricula(found.id),
          listEncuentros(d.data.curso.id),
        ]);
        if (p.ok) setProgreso(p.data);
        if (r.ok) setResumen(r.data);
        if (c.ok) setCondiciones(c.data);
        if (cert.ok) setCertificado(cert.data);
        if (enc.ok) setEncuentros(enc.data);
      } else {
        setMatricula(null);
        setProgreso([]);
        setResumen(null);
        setCondiciones([]);
        setCertificado(null);
        setEncuentros([]);
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
      .filter((m) => m.clases.length > 0);
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
        })),
      ),
    [modulosVisibles],
  );

  const claseActiva = useMemo(
    () => clases.find((c) => c.id === claseActivaId) ?? clases[0] ?? null,
    [clases, claseActivaId],
  );

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
            {modulosVisibles.map((m) => (
              <section key={m.id}>
                <h3 className="kicker flex items-center gap-2 px-1 text-brand-muted">
                  {m.icono_url && (
                    <img
                      src={m.icono_url}
                      alt=""
                      className="h-5 w-5 rounded border border-slate-200 object-cover"
                    />
                  )}
                  <span>
                    Módulo {m.orden} · {m.titulo}
                  </span>
                </h3>
                {m.docente_nombre && (
                  <div className="mt-1 flex items-center gap-2 px-1">
                    {m.docente_foto_url ? (
                      <img
                        src={m.docente_foto_url}
                        alt=""
                        className="h-6 w-6 rounded-full object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-cyan/10 text-[10px] font-semibold text-brand-cyan">
                        {(m.docente_nombre.split(' ').pop() ?? '·').charAt(0)}
                      </span>
                    )}
                    <span className="text-xs font-medium text-brand-ink">
                      {m.docente_nombre}
                    </span>
                  </div>
                )}
                <ul className="mt-1 space-y-1">
                  {m.clases.map((c) => {
                    const done = completadasSet.has(c.id);
                    const isActive = (claseActiva?.id ?? '') === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setClaseActivaId(c.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition',
                            isActive
                              ? 'bg-brand-cyan/10 text-brand-ink'
                              : 'text-brand-muted hover:bg-slate-50 hover:text-brand-ink',
                          )}
                        >
                          {done ? (
                            <CheckCircle2 size={14} className="text-emerald-600" />
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
              </section>
            ))}

            {data.examenes.length > 0 && (
              <section>
                <h3 className="kicker px-1 text-brand-muted">Exámenes</h3>
                <ul className="mt-1 space-y-1">
                  {data.examenes.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg px-2 py-1.5 text-sm text-brand-muted"
                    >
                      <ScrollText
                        size={14}
                        className="mr-1 inline text-brand-cyan"
                      />
                      {e.titulo}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </nav>
        </aside>

        {/* Contenido principal */}
        <main className="space-y-6">
          {/* Encuentros sincrónicos en vivo (DGG-14) */}
          {encuentros.some((e: any) => e.zoom_meeting_id) && (
            <EncuentrosEnVivoAlumno
              encuentros={encuentros}
              userName={userNameStable}
              activoEncuentroId={encuentroEnVivoId}
              onEntrar={(id) => setEncuentroEnVivoId(id)}
              onSalir={() => setEncuentroEnVivoId(null)}
            />
          )}
          {(condiciones.filter((c) => c.activa).length > 0 || certificado) && (
            <CondicionesAlumnoPanel
              condiciones={condiciones.filter((c) => c.activa)}
              certificado={certificado}
            />
          )}
          {claseActiva ? (
            <ClasePlayer
              matriculaId={matricula.id}
              clase={claseActiva}
              docenteNombre={claseActiva.docenteNombre}
              docenteFoto={claseActiva.docenteFoto}
              completada={completadasSet.has(claseActiva.id)}
              onCompletada={() => void reload()}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
              Este curso todavía no tiene clases publicadas.
            </div>
          )}

          {/* Bibliografía */}
          {bibliografiaVisible.length > 0 && (
            <section className="card-premium p-5">
              <header className="mb-2 flex items-center gap-2">
                <BookOpen size={16} className="text-brand-cyan" />
                <h2 className="font-display text-lg font-semibold text-brand-ink">
                  Bibliografía
                </h2>
              </header>
              <ul className="divide-y divide-slate-100">
                {bibliografiaVisible.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div>
                      <p className="font-semibold text-brand-ink">{b.titulo}</p>
                      {b.autor && (
                        <p className="text-xs text-brand-muted">{b.autor}</p>
                      )}
                    </div>
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
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Exámenes */}
          {data.examenes.length > 0 && (
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
          )}

          {/* Encuesta de Satisfacción (mig 0136) — sólo si está activa */}
          <EncuestaAlumnoCard curso_id={data.curso.id} matricula_id={matricula.id} />
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
            {c.tipo === 'examen' && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-muted">
                <Lock size={11} /> Automática
              </span>
            )}
            {!c.cumplida && c.tipo !== 'examen' && (
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

