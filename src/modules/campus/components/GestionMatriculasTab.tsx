import { useCallback, useEffect, useState } from 'react';
import {
  Award,
  Banknote,
  Check,
  CheckCircle2,
  Circle,
  Lock,
  Loader2,
  UserPlus,
  Users,
} from 'lucide-react';
import { AnimatedNumber, Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  CONDICION_TIPO_LABEL,
  fmtFecha,
  listCondicionesMatricula,
  listMatriculas,
  tildarCondicion,
  type CondicionTipo,
  type CursoDetalle,
  type MatriculaCondicionItem,
  type MatriculaListItem,
} from '@/services/api/campus';
import { AsignarAlumnoDrawer } from './AsignarAlumnoDrawer';
import { RegistrarPagoModal } from './RegistrarPagoModal';

// Tab de gestión de matrículas: lista de alumnos asignados al curso con su
// checklist de condiciones tildable por staff (DGG-10). El examen aparece
// auto-tildado y read-only.
export function GestionMatriculasTab({ data }: { data: CursoDetalle }) {
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [condiciones, setCondiciones] = useState<
    Record<string, MatriculaCondicionItem[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pagoTarget, setPagoTarget] = useState<MatriculaListItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const m = await listMatriculas({ cursoId: data.curso.id });
    if (!m.ok) {
      setLoading(false);
      toast.error(m.error.message);
      return;
    }
    setMatriculas(m.data);
    const pares = await Promise.all(
      m.data.map(async (mm) => {
        const c = await listCondicionesMatricula(mm.id);
        return [mm.id, c.ok ? c.data : []] as const;
      }),
    );
    const acc: Record<string, MatriculaCondicionItem[]> = {};
    for (const [k, v] of pares) acc[k] = v;
    setCondiciones(acc);
    setLoading(false);
  }, [data.curso.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onTildar(c: MatriculaCondicionItem) {
    if (c.tipo === 'examen') return; // read-only, lo tilda el sistema
    if (c.tipo === 'pago' && !c.cumplida) {
      // El pago se registra con asiento; abrir el modal.
      const m = matriculas.find((mm) => mm.id === c.matricula_id) ?? null;
      setPagoTarget(m);
      return;
    }
    const res = await tildarCondicion({
      matriculaCondicionId: c.id,
      cumplida: !c.cumplida,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success(c.cumplida ? 'Condición destildada' : 'Condición acreditada');
    void load();
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center text-brand-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card-premium p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-brand-cyan" />
            <h2 className="font-display text-lg font-semibold text-brand-ink">
              Alumnos asignados{' '}
              <span className="ml-1 text-sm text-brand-muted">
                (<AnimatedNumber value={matriculas.length} />)
              </span>
            </h2>
          </div>
          <Button onClick={() => setDrawerOpen(true)}>
            <UserPlus size={14} /> Asignar alumno
          </Button>
        </header>

        {matriculas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Users size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-brand-ink">
              Todavía no hay alumnos asignados
            </p>
            <p className="mt-1 text-sm text-brand-muted">
              El acceso al curso lo habilitás vos: tocá “Asignar alumno”.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {matriculas.map((m) => {
              const conds = (condiciones[m.id] ?? []).filter((c) => c.activa);
              const total = conds.length;
              const cumplidas = conds.filter((c) => c.cumplida).length;
              const todasOk = total > 0 && cumplidas === total;
              return (
                <li
                  key={m.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-ink">
                        {m.alumno_nombre ?? 'Alumno'}
                      </p>
                      <p className="text-xs text-brand-muted">
                        {m.administracion_nombre ?? 'Sin administración'} · vigencia{' '}
                        {fmtFecha(m.vigencia_hasta)}
                      </p>
                    </div>
                    {todasOk ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        <Award size={12} /> Condiciones cumplidas
                      </span>
                    ) : total > 0 ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        {cumplidas}/{total} condiciones
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        Sin condiciones
                      </span>
                    )}
                  </header>

                  {conds.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {conds.map((c) => {
                        const auto = c.tipo === 'examen';
                        return (
                          <li
                            key={c.id}
                            className="flex items-center justify-between gap-3 rounded-lg bg-brand-zebra/40 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {c.cumplida ? (
                                <CheckCircle2
                                  size={16}
                                  className="shrink-0 text-emerald-600"
                                />
                              ) : (
                                <Circle size={16} className="shrink-0 text-slate-300" />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm text-brand-ink">
                                  {c.etiqueta}
                                </p>
                                {c.cumplida && c.cumplida_at && (
                                  <p className="text-[11px] text-brand-muted">
                                    {auto ? 'Automática · ' : ''}
                                    {fmtFecha(c.cumplida_at)}
                                  </p>
                                )}
                              </div>
                            </div>
                            {auto ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-muted">
                                <Lock size={11} /> Auto
                              </span>
                            ) : c.tipo === 'pago' && !c.cumplida ? (
                              <Button
                                variant="tonal"
                                className="!px-2.5 !py-1 text-xs"
                                onClick={() => void onTildar(c)}
                              >
                                <Banknote size={12} /> Registrar pago
                              </Button>
                            ) : (
                              <button
                                onClick={() => void onTildar(c)}
                                className={cn(
                                  'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                                  c.cumplida
                                    ? 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50'
                                    : 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan hover:bg-brand-cyan/10',
                                )}
                              >
                                {c.cumplida ? (
                                  'Destildar'
                                ) : (
                                  <>
                                    <Check size={12} /> Acreditar
                                  </>
                                )}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AsignarAlumnoDrawer
        open={drawerOpen}
        cursoId={data.curso.id}
        cursoTitulo={data.curso.titulo}
        onClose={() => setDrawerOpen(false)}
        onAsignado={() => void load()}
      />
      <RegistrarPagoModal
        open={pagoTarget !== null}
        matriculaId={pagoTarget?.id ?? null}
        alumnoNombre={pagoTarget?.alumno_nombre ?? 'el alumno'}
        montoSugerido={
          data.curso.precio_lista !== null ? Number(data.curso.precio_lista) : null
        }
        onClose={() => setPagoTarget(null)}
        onRegistrado={() => void load()}
      />
    </div>
  );
}

// Etiqueta legible del tipo (export utilitario por si se reusa).
export function condicionLabel(tipo: CondicionTipo): string {
  return CONDICION_TIPO_LABEL[tipo];
}
