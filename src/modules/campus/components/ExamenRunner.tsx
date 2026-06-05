import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ScrollText, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  iniciarIntento,
  listIntentos,
  responderExamen,
  type CursoExamenRow,
  type CursoOpcionRow,
  type CursoPreguntaRow,
  type CursoExamenSeccionRow,
  type ExamenIntentoRow,
  type RespuestaPregunta,
  type ResultadoExamen,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

type PreguntaFull = CursoPreguntaRow & { opciones: CursoOpcionRow[] };

interface ExamenRunnerProps {
  matriculaId: string;
  examen: CursoExamenRow & {
    secciones: CursoExamenSeccionRow[];
    preguntas: PreguntaFull[];
  };
}

type Grupo = { seccion: CursoExamenSeccionRow | null; preguntas: PreguntaFull[] };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

// Agrupa las preguntas por sección (en orden) + grupo "sin sección" al final.
// Si el examen mezcla, baraja preguntas dentro de cada grupo y sus opciones.
function construirGrupos(
  examen: ExamenRunnerProps['examen'],
  mezclar: boolean,
): Grupo[] {
  const porSeccion = new Map<string, PreguntaFull[]>();
  const sin: PreguntaFull[] = [];
  for (const p of examen.preguntas) {
    if (p.seccion_id) {
      if (!porSeccion.has(p.seccion_id)) porSeccion.set(p.seccion_id, []);
      porSeccion.get(p.seccion_id)!.push(p);
    } else sin.push(p);
  }
  const prep = (ps: PreguntaFull[]) => {
    const ordered = mezclar ? shuffle(ps) : [...ps].sort((a, b) => a.orden - b.orden);
    return ordered.map((p) => ({
      ...p,
      opciones: mezclar
        ? shuffle(p.opciones)
        : [...p.opciones].sort((a, b) => a.orden - b.orden),
    }));
  };
  const grupos: Grupo[] = [];
  for (const s of [...examen.secciones].sort((a, b) => a.orden - b.orden)) {
    grupos.push({ seccion: s, preguntas: prep(porSeccion.get(s.id) ?? []) });
  }
  if (sin.length) grupos.push({ seccion: null, preguntas: prep(sin) });
  return grupos.filter((g) => g.preguntas.length > 0);
}

// Motor del examen para el alumno. Arranque del intento + envío + resultado.
export function ExamenRunner({ matriculaId, examen }: ExamenRunnerProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [intento, setIntento] = useState<ExamenIntentoRow | null>(null);
  const [previos, setPrevios] = useState<ExamenIntentoRow[]>([]);
  const [respuestas, setRespuestas] = useState<Record<string, string[]>>({});
  const [resultado, setResultado] = useState<ResultadoExamen | null>(null);
  const [vista, setVista] = useState<Grupo[]>([]);

  const totalPuntaje = useMemo(
    () => examen.preguntas.reduce((a, p) => a + (p.puntaje ?? 0), 0),
    [examen.preguntas],
  );

  useEffect(() => {
    void cargarPrevios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examen.id, matriculaId]);

  async function cargarPrevios() {
    setLoading(true);
    const res = await listIntentos(matriculaId, examen.id);
    setLoading(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    setPrevios(res.data);
  }

  const intentosRestantes = Math.max(0, (examen.intentos_max ?? 1) - previos.length);
  const yaCerrado =
    examen.fecha_cierre !== null && new Date(examen.fecha_cierre) < new Date();
  const aunNoHabilitado =
    examen.fecha_habilitacion !== null &&
    new Date(examen.fecha_habilitacion) > new Date();

  async function arrancar() {
    setLoading(true);
    const res = await iniciarIntento(examen.id, matriculaId);
    setLoading(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    setIntento(res.data);
    setVista(construirGrupos(examen, examen.mezclar_preguntas));
    setRespuestas({});
    setResultado(null);
  }

  function seleccionar(preguntaId: string, opcionId: string) {
    setRespuestas((prev) => ({ ...prev, [preguntaId]: [opcionId] }));
  }

  async function enviar() {
    if (!intento) return;
    const todas = vista.flatMap((g) => g.preguntas);
    const payload: RespuestaPregunta[] = todas.map((p) => ({
      pregunta_id: p.id,
      opcion_ids: respuestas[p.id] ?? [],
    }));
    setSubmitting(true);
    const res = await responderExamen(intento.id, payload);
    setSubmitting(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    setResultado(res.data);
    void cargarPrevios();
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center text-brand-muted">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  if (resultado) {
    const detalle = new Map(resultado.detalle.map((d) => [d.pregunta_id, d]));
    let n = 0;
    return (
      <div className="space-y-5">
        <div
          className={cn(
            'rounded-2xl border p-6 text-center motion-safe:animate-fade-up',
            resultado.aprobado
              ? 'border-emerald-200 bg-emerald-50/60'
              : 'border-amber-200 bg-amber-50/60',
          )}
        >
          {resultado.aprobado ? (
            <CheckCircle2 size={42} className="mx-auto text-emerald-600" />
          ) : (
            <AlertTriangle size={42} className="mx-auto text-amber-600" />
          )}
          <h3 className="mt-3 font-display text-2xl font-bold text-brand-ink">
            {resultado.aprobado ? '¡Aprobaste!' : 'No alcanzaste la nota mínima'}
          </h3>
          <p className="mt-1 text-sm text-brand-muted">
            Nota: <strong className="text-brand-ink">{resultado.nota}/100</strong>
            {' · '}Mínimo: {examen.nota_aprobacion}
            {resultado.pendientes_revision > 0 && (
              <> · {resultado.pendientes_revision} en revisión</>
            )}
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => { setIntento(null); setResultado(null); setVista([]); }}
          >
            Volver
          </Button>
        </div>

        {examen.mostrar_resultados &&
          vista.map((g, gi) => (
            <section key={gi} className="space-y-2">
              {g.seccion && (
                <h4 className="font-display text-sm font-semibold text-brand-ink">
                  {g.seccion.titulo}
                </h4>
              )}
              {g.preguntas.map((p) => {
                n += 1;
                const d = detalle.get(p.id);
                const estado = d?.pendiente_revision
                  ? 'pendiente'
                  : d?.correcta
                    ? 'ok'
                    : 'mal';
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'rounded-xl border p-3 text-sm',
                      estado === 'ok'
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : estado === 'mal'
                          ? 'border-red-200 bg-red-50/50'
                          : 'border-slate-200 bg-white',
                    )}
                  >
                    <p className="flex items-start gap-2 font-medium text-brand-ink">
                      {estado === 'ok' ? (
                        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                      ) : estado === 'mal' ? (
                        <XCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
                      ) : (
                        <Info size={15} className="mt-0.5 shrink-0 text-brand-muted" />
                      )}
                      <span><span className="text-brand-cyan">P{n}.</span> {p.enunciado}</span>
                    </p>
                    {p.explicacion && (
                      <p className="mt-1.5 pl-6 text-xs text-brand-muted">
                        <span className="font-semibold">Justificación:</span> {p.explicacion}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
      </div>
    );
  }

  // ── Tarjeta de entrada ───────────────────────────────────────────────────────
  if (!intento) {
    return (
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
            <ScrollText size={18} />
          </span>
          <div>
            <h3 className="font-display text-lg font-semibold text-brand-ink">
              {examen.titulo}
            </h3>
            {examen.descripcion && (
              <p className="mt-1 whitespace-pre-line text-sm text-brand-muted">
                {examen.descripcion}
              </p>
            )}
            <p className="mt-2 text-xs text-brand-muted">
              {examen.preguntas.length} preguntas · {totalPuntaje} puntos · Nota
              mínima {examen.nota_aprobacion}/100 · Intentos restantes:{' '}
              <strong>{intentosRestantes}</strong>
            </p>
          </div>
        </header>

        {previos.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-brand-zebra/40 p-3 text-xs">
            {previos.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span>Intento #{p.intento}</span>
                <span className="font-semibold text-brand-ink">
                  {p.nota !== null ? `${p.nota}/100` : '—'}{' '}
                  {p.aprobado ? (
                    <span className="ml-1 text-emerald-600">aprobado</span>
                  ) : p.aprobado === false ? (
                    <span className="ml-1 text-amber-600">no aprobado</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {aunNoHabilitado && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Este examen abre el {new Date(examen.fecha_habilitacion!).toLocaleString('es-AR')}.
          </p>
        )}
        {yaCerrado && (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            El examen cerró el {new Date(examen.fecha_cierre!).toLocaleString('es-AR')}.
          </p>
        )}

        <Button
          onClick={arrancar}
          disabled={intentosRestantes <= 0 || yaCerrado || aunNoHabilitado || loading}
        >
          Comenzar examen
        </Button>
      </div>
    );
  }

  // ── En intento ───────────────────────────────────────────────────────────────
  let n = 0;
  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-brand-cyan/30 bg-brand-cyan/5 p-4 text-sm">
        <p className="font-display text-base font-semibold text-brand-ink">
          Intento #{intento.intento} en curso
        </p>
        <p className="text-xs text-brand-muted">
          Marcá tus respuestas y enviá al final. No podés pausar.
        </p>
      </header>

      {vista.map((g, gi) => (
        <section key={gi} className="space-y-4">
          {g.seccion && (
            <div className="rounded-xl bg-brand-ink/5 px-4 py-2.5">
              <p className="font-display text-sm font-semibold text-brand-ink">
                {g.seccion.titulo}
              </p>
              {g.seccion.descripcion && (
                <p className="text-xs text-brand-muted">{g.seccion.descripcion}</p>
              )}
            </div>
          )}
          {g.preguntas.map((p) => {
            n += 1;
            const seleccion = respuestas[p.id] ?? [];
            return (
              <fieldset
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <legend className="kicker text-brand-cyan">Pregunta {n}</legend>
                <p className="mt-2 font-display text-base font-semibold text-brand-ink">
                  {p.enunciado}
                </p>
                <div className="mt-3 space-y-2">
                  {p.opciones.map((o) => {
                    const checked = seleccion.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition',
                          checked
                            ? 'border-brand-cyan bg-brand-cyan/5'
                            : 'border-slate-200 hover:border-slate-300',
                        )}
                      >
                        <input
                          type="radio"
                          name={`pregunta-${p.id}`}
                          className="mt-1 accent-brand-cyan"
                          checked={checked}
                          onChange={() => seleccionar(p.id, o.id)}
                        />
                        <span className="text-brand-ink">{o.texto}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => { setIntento(null); setRespuestas({}); setVista([]); }}
        >
          <XCircle size={14} /> Cancelar
        </Button>
        <Button onClick={enviar} loading={submitting}>
          Enviar respuestas
        </Button>
      </div>
    </div>
  );
}
