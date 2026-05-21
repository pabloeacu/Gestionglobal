import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  ScrollText,
  Video,
} from 'lucide-react';
import { Button, Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  getCurso,
  getProgresoResumen,
  listMatriculas,
  listProgreso,
  matricularse,
  type CursoDetalle,
  type CursoMatriculaRow,
  type CursoProgresoRow,
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
  const [loading, setLoading] = useState(true);
  const [matriculando, setMatriculando] = useState(false);
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
        const [p, r] = await Promise.all([
          listProgreso(found.id),
          getProgresoResumen(found.id),
        ]);
        if (p.ok) setProgreso(p.data);
        if (r.ok) setResumen(r.data);
      } else {
        setMatricula(null);
        setProgreso([]);
        setResumen(null);
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

  // No matriculado: hero + CTA
  if (!matricula) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          to="/portal/campus"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
        >
          <ArrowLeft size={13} /> Mis cursos
        </Link>
        <div className="card-premium relative overflow-hidden p-8">
          <TrianglesAccent
            position="top-right"
            size={220}
            tone="cyan"
            density="rich"
            className="opacity-30"
          />
          <div className="relative max-w-2xl">
            <p className="kicker text-brand-cyan">Campus virtual</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink">
              {data.curso.titulo}
            </h1>
            {data.curso.descripcion && (
              <p className="mt-3 text-base text-brand-muted">
                {data.curso.descripcion}
              </p>
            )}
            {data.curso.descripcion_html && (
              <div
                className="prose prose-sm mt-4 max-w-none text-brand-ink"
                // descripcion_html sólo lo edita staff (regla 4); el alumno no
                // tiene cómo inyectar.
                dangerouslySetInnerHTML={{ __html: data.curso.descripcion_html }}
              />
            )}
            <Button
              className="mt-6"
              loading={matriculando}
              onClick={async () => {
                setMatriculando(true);
                const res = await matricularse(data.curso.id);
                setMatriculando(false);
                if (!res.ok) {
                  toast.error(res.error.message);
                  return;
                }
                toast.success('¡Te inscribiste!');
                void reload();
              }}
            >
              <GraduationCap size={16} /> Inscribirme al curso
            </Button>
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

