import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  getProgresoResumen,
  listCursos,
  listMatriculas,
  MATRICULA_ESTADO_BADGE,
  MATRICULA_ESTADO_LABEL,
  type CursoListItem,
  type MatriculaListItem,
  type MatriculaEstado,
  type ProgresoResumen,
} from '@/services/api/campus';
import { ProgresoBar } from '../components/ProgresoBar';
import { CursoCard } from '../components/CursoCard';

// "Mis cursos" para el alumno (portal). Muestra matrículas con su progreso
// y abajo un catálogo de cursos disponibles para inscribirse.
export function MisCursosPage() {
  const user = useCurrentUser();
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [progresos, setProgresos] = useState<Record<string, ProgresoResumen>>({});
  const [catalogo, setCatalogo] = useState<CursoListItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    const [m, c] = await Promise.all([
      listMatriculas({ profileId: user.id }),
      listCursos({ soloActivos: true }),
    ]);
    setLoading(false);
    if (!m.ok) {
      toast.error(`No pudimos cargar tus cursos: ${m.error.message}`);
      return;
    }
    setMatriculas(m.data);
    if (c.ok) {
      // Cursos donde NO está matriculado todavía.
      const ids = new Set(m.data.map((x) => x.curso?.id));
      setCatalogo(c.data.filter((x) => !ids.has(x.id)));
    }

    // Resúmenes en paralelo.
    const entries = await Promise.all(
      m.data.map(async (mm) => {
        const r = await getProgresoResumen(mm.id);
        return [mm.id, r.ok ? r.data : null] as const;
      }),
    );
    const acc: Record<string, ProgresoResumen> = {};
    for (const [k, v] of entries) if (v) acc[k] = v;
    setProgresos(acc);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useRealtimeRefresh(
    ['curso_matriculas', 'curso_progreso', 'examen_intentos'],
    () => void load(),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="kicker text-brand-cyan">Campus virtual</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Mis cursos
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Acá vas a ver los cursos a los que estás inscripto y los disponibles
          para sumar.
        </p>
      </header>

      <section className="card-premium relative overflow-hidden p-5">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-2xl" />
              ))}
            </div>
          ) : matriculas.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title="Todavía no tenés cursos"
              description={
                <>
                  Explorá el catálogo de abajo y sumate a la formación continua.
                </>
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {matriculas.map((m) => {
                const r = progresos[m.id];
                return (
                  <li key={m.id}>
                    <Link
                      to={`/portal/campus/${m.curso?.slug ?? m.curso_id}`}
                      className="group flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-cyan hover:shadow-md motion-safe:animate-fade-up"
                    >
                      <header className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="kicker text-brand-cyan">
                            {m.curso?.modalidad ?? 'curso'}
                          </p>
                          <h3 className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
                            {m.curso?.titulo ?? 'Curso'}
                          </h3>
                        </div>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                            MATRICULA_ESTADO_BADGE[m.estado as MatriculaEstado],
                          )}
                        >
                          {MATRICULA_ESTADO_LABEL[m.estado as MatriculaEstado]}
                        </span>
                      </header>
                      {r && <ProgresoBar porcentaje={r.porcentaje} />}
                      <footer className="flex items-center justify-between text-xs text-brand-muted">
                        <span>
                          {r?.completadas ?? 0}/{r?.total_clases ?? 0} clases
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-brand-cyan group-hover:underline">
                          <GraduationCap size={13} /> Continuar
                        </span>
                      </footer>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Catálogo */}
      {catalogo.length > 0 && (
        <section className="space-y-3">
          <header className="flex items-center gap-2">
            <Sparkles size={16} className="text-brand-cyan" />
            <h2 className="font-display text-lg font-semibold text-brand-ink">
              Cursos disponibles
            </h2>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalogo.map((c) => (
              <CursoCard
                key={c.id}
                curso={c}
                to={`/portal/campus/${c.slug}`}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
