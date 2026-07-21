import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, PartyPopper } from 'lucide-react';
import { Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  diasAccesoRestantes,
  getProgresoResumen,
  listMatriculas,
  matriculaTieneAcceso,
  MATRICULA_ESTADO_BADGE,
  MATRICULA_ESTADO_LABEL,
  type MatriculaListItem,
  type MatriculaEstado,
  type ProgresoResumen,
} from '@/services/api/campus';
import { ProgresoBar } from '../components/ProgresoBar';
import { humanizeError } from '@/lib/errors';
import { EncuentroHoyBanner } from '@/modules/campus/components/EncuentroHoyBanner';

// DGG-82: leyenda de felicitaciones en el card cuando el alumno terminó el
// curso y conserva acceso (ventana post-finalización). dias = vigencia − hoy.
function leyendaFelicitaciones(dias: number): string {
  if (dias <= 0)
    return '¡Felicitaciones! Ya terminaste el curso. Hoy es tu último día para repasar lo que quieras.';
  if (dias === 1)
    return '¡Felicitaciones! Ya terminaste el curso. Te queda 1 día para acceder y repasar lo que quieras.';
  return `¡Felicitaciones! Ya terminaste el curso. Te quedan ${dias} días para acceder y repasar lo que quieras!`;
}

// "Mis cursos" para el alumno (portal). DGG-10: sin autoservicio — el alumno
// solo ve los cursos que la gerencia le asignó (no hay catálogo abierto).
export function MisCursosPage() {
  const user = useCurrentUser();
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [progresos, setProgresos] = useState<Record<string, ProgresoResumen>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) return;
    setLoading(true);
    const m = await listMatriculas({ profileId: user.id });
    setLoading(false);
    if (!m.ok) {
      toast.error(`No pudimos cargar tus cursos: ${humanizeError(m.error)}`);
      return;
    }
    setMatriculas(m.data);

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

  // DGG-82: solo se ven los cursos con acceso vigente (activa o completada
  // dentro de la ventana). Vencida/anulada/completada-vencida desaparecen.
  const visibles = useMemo(
    () => matriculas.filter(matriculaTieneAcceso),
    [matriculas],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* DGG-112: aviso del encuentro sincrónico de HOY (solo si le falta asistir) */}
      <EncuentroHoyBanner />
      <header>
        <p className="kicker text-brand-cyan">Campus virtual</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
          Mis cursos
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Acá vas a ver los cursos que tu gestión te habilitó. El acceso lo
          asigna la gerencia.
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
          ) : visibles.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title="Todavía no tenés cursos asignados"
              description={
                <>
                  Cuando tu administrador te habilite un curso, lo vas a ver acá.
                </>
              }
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibles.map((m) => {
                const r = progresos[m.id];
                const diasRestantes = diasAccesoRestantes(m);
                return (
                  <li key={m.id} className="min-w-0">
                    <Link
                      to={`/portal/campus/${m.curso?.slug ?? m.curso_id}`}
                      className="group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-cyan hover:shadow-md motion-safe:animate-fade-up"
                    >
                      {m.curso?.banner_url ? (
                        <div className="relative aspect-[3/1] w-full overflow-hidden bg-slate-100">
                          <img
                            src={m.curso.banner_url}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                            loading="lazy"
                          />
                          <span
                            className={cn(
                              'absolute right-2 top-2 rounded-full border bg-white/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-sm backdrop-blur',
                              MATRICULA_ESTADO_BADGE[m.estado as MatriculaEstado],
                            )}
                          >
                            {MATRICULA_ESTADO_LABEL[m.estado as MatriculaEstado]}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <header className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="kicker text-brand-cyan">
                              {m.curso?.modalidad ?? 'curso'}
                            </p>
                            <h3 className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
                              {m.curso?.titulo ?? 'Curso'}
                            </h3>
                          </div>
                          {!m.curso?.banner_url && (
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                                MATRICULA_ESTADO_BADGE[m.estado as MatriculaEstado],
                              )}
                            >
                              {MATRICULA_ESTADO_LABEL[m.estado as MatriculaEstado]}
                            </span>
                          )}
                        </header>
                        {r && <ProgresoBar porcentaje={r.porcentaje} />}
                        <footer className="flex items-center justify-between text-xs text-brand-muted">
                          <span>
                            {r?.completadas ?? 0}/{r?.total_clases ?? 0} clases
                          </span>
                          <span className="inline-flex items-center gap-1 font-medium text-brand-cyan group-hover:underline">
                            <GraduationCap size={13} />{' '}
                            {diasRestantes !== null ? 'Repasar' : 'Continuar'}
                          </span>
                        </footer>
                        {diasRestantes !== null && (
                          <div className="mt-auto flex items-start gap-2 rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-3 text-xs font-medium leading-snug text-brand-cyan">
                            <PartyPopper
                              size={16}
                              className="mt-0.5 shrink-0"
                            />
                            <span>{leyendaFelicitaciones(diasRestantes)}</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
