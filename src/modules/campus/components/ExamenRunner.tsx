import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ScrollText, XCircle } from 'lucide-react';
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
  type ExamenIntentoRow,
  type RespuestaPregunta,
  type ResultadoExamen,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

interface ExamenRunnerProps {
  matriculaId: string;
  examen: CursoExamenRow & {
    preguntas: Array<CursoPreguntaRow & { opciones: CursoOpcionRow[] }>;
  };
}

// Motor del examen para el alumno. Maneja arranque del intento + envío.
export function ExamenRunner({ matriculaId, examen }: ExamenRunnerProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [intento, setIntento] = useState<ExamenIntentoRow | null>(null);
  const [previos, setPrevios] = useState<ExamenIntentoRow[]>([]);
  const [respuestas, setRespuestas] = useState<Record<string, string[]>>({});
  const [resultado, setResultado] = useState<ResultadoExamen | null>(null);

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
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setPrevios(res.data);
  }

  const intentosRestantes = Math.max(
    0,
    (examen.intentos_max ?? 1) - previos.length,
  );
  const yaCerrado =
    examen.fecha_cierre !== null && new Date(examen.fecha_cierre) < new Date();
  const aunNoHabilitado =
    examen.fecha_habilitacion !== null &&
    new Date(examen.fecha_habilitacion) > new Date();

  async function arrancar() {
    setLoading(true);
    const res = await iniciarIntento(examen.id, matriculaId);
    setLoading(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setIntento(res.data);
    setRespuestas({});
    setResultado(null);
  }

  function toggleOpcion(preguntaId: string, opcionId: string, multi: boolean) {
    setRespuestas((prev) => {
      const actuales = prev[preguntaId] ?? [];
      if (multi) {
        return {
          ...prev,
          [preguntaId]: actuales.includes(opcionId)
            ? actuales.filter((x) => x !== opcionId)
            : [...actuales, opcionId],
        };
      }
      return { ...prev, [preguntaId]: [opcionId] };
    });
  }

  async function enviar() {
    if (!intento) return;
    const payload: RespuestaPregunta[] = examen.preguntas.map((p) => ({
      pregunta_id: p.id,
      opcion_ids: respuestas[p.id] ?? [],
    }));
    setSubmitting(true);
    const res = await responderExamen(intento.id, payload);
    setSubmitting(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
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

  if (resultado) {
    return (
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
          {' · '}
          Mínimo: {examen.nota_aprobacion}
          {resultado.pendientes_revision > 0 && (
            <> · {resultado.pendientes_revision} respuestas en revisión</>
          )}
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setIntento(null);
            setResultado(null);
          }}
        >
          Volver
        </Button>
      </div>
    );
  }

  if (!intento) {
    // Tarjeta de entrada.
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
              <p className="mt-1 text-sm text-brand-muted">{examen.descripcion}</p>
            )}
            <p className="mt-2 text-xs text-brand-muted">
              {examen.preguntas.length} preguntas · {totalPuntaje} puntos ·
              {' '}Nota mínima {examen.nota_aprobacion}/100 · Intentos restantes:{' '}
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
          disabled={
            intentosRestantes <= 0 || yaCerrado || aunNoHabilitado || loading
          }
        >
          Comenzar examen
        </Button>
      </div>
    );
  }

  // En intento.
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

      {examen.preguntas.map((p, i) => (
        <fieldset
          key={p.id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <legend className="kicker text-brand-cyan">Pregunta {i + 1}</legend>
          <p className="mt-2 font-display text-base font-semibold text-brand-ink">
            {p.enunciado}
          </p>
          <div className="mt-3 space-y-2">
            {p.opciones.map((o) => {
              const seleccion = respuestas[p.id] ?? [];
              const checked = seleccion.includes(o.id);
              // V/F y MC single-correcta de hecho funcionan igual con radios;
              // dejamos checkboxes para soportar múltiples respuestas correctas.
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
                    type="checkbox"
                    className="mt-1 accent-brand-cyan"
                    checked={checked}
                    onChange={() => toggleOpcion(p.id, o.id, true)}
                  />
                  <span className="text-brand-ink">{o.texto}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            setIntento(null);
            setRespuestas({});
          }}
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
