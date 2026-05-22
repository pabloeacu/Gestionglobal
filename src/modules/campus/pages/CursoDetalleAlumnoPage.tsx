import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  BookOpen,
  CheckCircle2,
  Circle,
  Lock,
  ScrollText,
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
  getCurso,
  getProgresoResumen,
  listCondicionesMatricula,
  listMatriculas,
  listProgreso,
  type CursoDetalle,
  type CursoMatriculaRow,
  type CursoProgresoRow,
  type MatriculaCondicionItem,
  type ProgresoResumen,
} from '@/services/api/campus';
import { ClasePlayer } from '../components/ClasePlayer';
import { ExamenRunner } from '../components/ExamenRunner';
import { ProgresoBar } from '../components/ProgresoBar';

// Página del alumno matriculado (portal). Si no está matriculado y el curso es
// público, muestra CTA de inscripción.
export function CursoDetalleAlumnoPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const user = useCurrentUser();
  const [data, setData] = useState<CursoDetalle | null>(null);
  const [matricula, setMatricula] = useState<CursoMatriculaRow | null>(null);
  const [progreso, setProgreso] = useState<CursoProgresoRow[]>([]);
  const [resumen, setResumen] = useState<ProgresoResumen | null>(null);
  const [condiciones, setCondiciones] = useState<MatriculaCondicionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claseActivaId, setClaseActivaId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const d = await getCurso(slug);
    if (!d.ok) {
      setLoading(false);
      toast.error(d.error.message);
      return;
    }
    setData(d.data);

    // Buscar matrícula del usuario actual.
    if (user) {
      const m = await listMatriculas({
        cursoId: d.data.curso.id,
        profileId: user.id,
      });
      const found = m.ok && m.data.length > 0 ? m.data[0] : null;
      if (found) {
        setMatricula(found);
        const [p, r, c] = await Promise.all([
          listProgreso(found.id),
          getProgresoResumen(found.id),
          listCondicionesMatricula(found.id),
        ]);
        if (p.ok) setProgreso(p.data);
        if (r.ok) setResumen(r.data);
        if (c.ok) setCondiciones(c.data);
      } else {
        setMatricula(null);
        setProgreso([]);
        setResumen(null);
        setCondiciones([]);
      }
    }
    setLoading(false);
  }, [slug, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtimeRefresh(['curso_progreso', 'examen_intentos'], () => void reload());

  const completadasSet = useMemo(
    () => new Set(progreso.filter((p) => p.completada).map((p) => p.clase_id)),
    [progreso],
  );

  const clases = useMemo(() => {
    if (!data) return [];
    return data.modulos.flatMap((m) =>
      m.clases.map((c) => ({ ...c, modulo: m.titulo, moduloOrden: m.orden })),
    );
  }, [data]);

  const claseActiva = useMemo(
    () => clases.find((c) => c.id === claseActivaId) ?? clases[0] ?? null,
    [clases, claseActivaId],
  );

  if (loading || !data) {
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

  return (
    <div className="mx-auto max-w-7xl">
      <Link
        to="/portal/campus"
        className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
      >
        <ArrowLeft size={13} /> Mis cursos
      </Link>

      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Campus</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {data.curso.titulo}
          </h1>
          {resumen && (
            <div className="mt-3 flex items-center gap-3 text-xs text-brand-muted">
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
            {data.modulos.map((m) => (
              <section key={m.id}>
                <h3 className="kicker px-1 text-brand-muted">
                  Módulo {m.orden} · {m.titulo}
                </h3>
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
          {condiciones.filter((c) => c.activa).length > 0 && (
            <CondicionesAlumnoPanel condiciones={condiciones.filter((c) => c.activa)} />
          )}
          {claseActiva ? (
            <ClasePlayer
              matriculaId={matricula.id}
              clase={claseActiva}
              completada={completadasSet.has(claseActiva.id)}
              onCompletada={() => void reload()}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
              Este curso todavía no tiene clases publicadas.
            </div>
          )}

          {/* Bibliografía */}
          {data.bibliografia.length > 0 && (
            <section className="card-premium p-5">
              <header className="mb-2 flex items-center gap-2">
                <BookOpen size={16} className="text-brand-cyan" />
                <h2 className="font-display text-lg font-semibold text-brand-ink">
                  Bibliografía
                </h2>
              </header>
              <ul className="divide-y divide-slate-100">
                {data.bibliografia.map((b) => (
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
        </main>
      </div>
    </div>
  );
}

// Panel motivacional: qué le falta al alumno para el certificado (DGG-10).
function CondicionesAlumnoPanel({
  condiciones,
}: {
  condiciones: MatriculaCondicionItem[];
}) {
  const cumplidas = condiciones.filter((c) => c.cumplida).length;
  const total = condiciones.length;
  const todasOk = cumplidas === total;
  const pendientes = condiciones.filter((c) => !c.cumplida);

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

