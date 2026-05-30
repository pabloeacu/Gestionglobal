// Card de la encuesta de satisfacción dentro del CursoDetalleAlumnoPage.
// Mig 0136. Renderiza la encuesta si está activa y el alumno está matriculado.
// Incluye sección "Testimonio" siempre presente al final (opcional).

import { useEffect, useState } from 'react';
import {
  ClipboardList,
  Send,
  CheckCircle2,
  Star,
  Loader2,
  X as XIcon,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { Button, Field, Input, Textarea, useConfirm } from '@/components/common';
import {
  getEncuestaPorCurso,
  getMiRespuesta,
  responderEncuesta,
  uploadFotoTestimonio,
  type CursoEncuestaRow,
  type CursoEncuestaRespuestaRow,
  type EncuestaSchema,
  type PreguntaDef,
} from '@/services/api/encuestas';
import { cn } from '@/lib/cn';

interface EncuestaAlumnoCardProps {
  curso_id: string;
  matricula_id: string;
}

export function EncuestaAlumnoCard({ curso_id, matricula_id }: EncuestaAlumnoCardProps) {
  const [encuesta, setEncuesta] = useState<CursoEncuestaRow | null>(null);
  const [miResp, setMiResp] = useState<CursoEncuestaRespuestaRow | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [eRes, rRes] = await Promise.all([
      getEncuestaPorCurso(curso_id),
      getMiRespuesta(matricula_id),
    ]);
    setLoading(false);
    if (eRes.ok) setEncuesta(eRes.data);
    if (rRes.ok) setMiResp(rRes.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curso_id, matricula_id]);

  if (loading) return null;
  if (!encuesta || !encuesta.activa) return null;
  const schema = (encuesta.schema as unknown as EncuestaSchema) ?? { preguntas: [] };
  if (schema.preguntas.length === 0) return null;

  if (miResp) {
    return (
      <section className="card-premium relative overflow-hidden border border-emerald-200 bg-emerald-50/40 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={20} />
          <div className="min-w-0 flex-1">
            <p className="kicker text-emerald-700">Encuesta completada</p>
            <h3 className="font-display text-lg font-bold text-brand-ink">
              ¡Gracias por tu feedback!
            </h3>
            <p className="mt-1 text-sm text-brand-ink/80">
              Ya enviaste tu respuesta a la encuesta de satisfacción del curso.
              {encuesta.requerida_para_cert &&
                ' Esto cumple uno de los requisitos para emitir tu certificado.'}
            </p>
            {(miResp.testimonio_comentario || miResp.testimonio_foto_url) && (
              <p className="mt-2 text-xs text-emerald-700/80">
                {miResp.permite_publicar
                  ? '✓ También nos diste permiso para usar tu testimonio.'
                  : 'Dejaste un testimonio interno (sin permiso de publicación).'}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <EncuestaForm
      encuesta={encuesta}
      curso_id={curso_id}
      matricula_id={matricula_id}
      onEnviada={() => void load()}
    />
  );
}

// ----------------------------------------------------------------------------
// Form de respuesta
// ----------------------------------------------------------------------------
function EncuestaForm({
  encuesta,
  curso_id,
  matricula_id,
  onEnviada,
}: {
  encuesta: CursoEncuestaRow;
  curso_id: string;
  matricula_id: string;
  onEnviada: () => void;
}) {
  const schema = encuesta.schema as unknown as EncuestaSchema;
  const [respuestas, setRespuestas] = useState<Record<string, unknown>>({});
  const [nombre, setNombre] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const [permite, setPermite] = useState(false);
  const [sending, setSending] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const confirm = useConfirm();

  function set(id: string, v: unknown) {
    setRespuestas((r) => ({ ...r, [id]: v }));
    setTopError(null);
  }

  function validar(): string[] {
    const errs: string[] = [];
    for (const q of schema.preguntas) {
      if (!q.required) continue;
      const v = respuestas[q.id];
      const empty =
        v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) errs.push(q.titulo);
    }
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validar();
    if (errs.length > 0) {
      setTopError(`Te falta responder: ${errs.join(' · ')}`);
      toast.error('Hay preguntas sin responder');
      return;
    }
    // Confirmación si pidió permiso de publicar
    if (permite) {
      const ok = await confirm({
        title: 'Permitís que usemos tu testimonio',
        message:
          'Vas a permitir que Gestión Global pueda utilizar tu nombre, foto y comentario en redes sociales, presentaciones u otros materiales propios. ¿Confirmás?',
        confirmLabel: 'Sí, permito',
      });
      if (!ok) return;
    }
    setSending(true);
    // 1) Si hay foto, subir al bucket
    let fotoFinalUrl: string | null = fotoUrl;
    if (foto) {
      const up = await uploadFotoTestimonio(curso_id, matricula_id, foto);
      if (!up.ok) {
        setSending(false);
        toast.error('No pudimos subir la foto', { description: up.error.message });
        return;
      }
      fotoFinalUrl = up.data;
    }
    // 2) Enviar respuesta
    const testimonio = {
      nombre: nombre.trim() || null,
      foto_url: fotoFinalUrl,
      comentario: comentario.trim() || null,
      permite_publicar: permite,
    };
    const r = await responderEncuesta(matricula_id, respuestas, testimonio);
    setSending(false);
    if (!r.ok) {
      setTopError(r.error.message);
      toast.error('No pudimos enviar la encuesta', { description: r.error.message });
      return;
    }
    toast.success('Encuesta enviada · ¡gracias!');
    onEnviada();
  }

  function onPickFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error('La foto no puede pesar más de 5 MB.');
      return;
    }
    setFoto(f);
    setFotoUrl(URL.createObjectURL(f));
  }

  return (
    <form onSubmit={onSubmit} className="card-premium space-y-5 p-5">
      <header>
        <p className="kicker flex items-center gap-1 text-brand-cyan">
          <ClipboardList size={12} /> {encuesta.titulo}
        </p>
        {encuesta.descripcion && (
          <p className="mt-1 text-sm text-brand-muted">{encuesta.descripcion}</p>
        )}
        {encuesta.requerida_para_cert && (
          <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            Requerida para emitir tu certificado
          </p>
        )}
      </header>

      <ul className="space-y-4">
        {schema.preguntas.map((q, i) => (
          <li
            key={q.id}
            className="rounded-xl border border-slate-200 bg-white p-4 motion-safe:animate-fade-up"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <PreguntaRunner
              pregunta={q}
              valor={respuestas[q.id]}
              onChange={(v) => set(q.id, v)}
            />
          </li>
        ))}
      </ul>

      {/* Sección testimonio (siempre presente, todo opcional) */}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
        <p className="kicker text-violet-700">Testimonio (opcional)</p>
        <h4 className="font-display text-base font-bold text-brand-ink">
          ¿Querés dejarnos tu testimonio?
        </h4>
        <p className="mt-1 text-xs text-brand-muted">
          Todo este bloque es opcional. Si querés, podés dejar tu nombre, una
          foto y un comentario sobre tu experiencia, y elegir si nos das permiso
          para usarlos en nuestras redes/materiales.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Nombre">
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="¿Cómo te gustaría que figure?"
            />
          </Field>
          <Field label="Foto">
            <div className="flex items-center gap-3">
              {fotoUrl ? (
                <div className="relative">
                  <img
                    src={fotoUrl}
                    alt=""
                    className="h-12 w-12 rounded-full object-cover ring-1 ring-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFoto(null);
                      setFotoUrl(null);
                    }}
                    aria-label="Quitar foto"
                    className="absolute -right-1 -top-1 rounded-full bg-white p-0.5 text-red-600 shadow"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-brand-muted">
                  <ImageIcon size={16} />
                </span>
              )}
              <label className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-ink hover:bg-slate-50">
                Elegir foto
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickFoto}
                  className="hidden"
                />
              </label>
            </div>
          </Field>
        </div>
        <Field label="Comentario" hint="¿Cómo describirías tu experiencia con el curso?">
          <Textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={3}
            placeholder="Lo que más me gustó fue…"
          />
        </Field>
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <input
            type="checkbox"
            checked={permite}
            onChange={(e) => setPermite(e.target.checked)}
            className="mt-0.5 rounded text-brand-cyan"
          />
          <span>
            <strong>Doy mi permiso</strong> para que Gestión Global pueda
            utilizar mi nombre, foto y comentario en redes sociales,
            presentaciones u otros materiales propios.
          </span>
        </label>
      </section>

      {topError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {topError}
        </div>
      )}

      <footer className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={sending}>
          {sending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Send size={14} /> Enviar encuesta
            </>
          )}
        </Button>
      </footer>
    </form>
  );
}

// ----------------------------------------------------------------------------
// Render individual de pregunta (runner)
// ----------------------------------------------------------------------------
function PreguntaRunner({
  pregunta,
  valor,
  onChange,
}: {
  pregunta: PreguntaDef;
  valor: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div>
      <p className="font-medium text-brand-ink">
        {pregunta.titulo}
        {pregunta.required && <span className="ml-1 text-red-600">*</span>}
      </p>
      {pregunta.ayuda && (
        <p className="mt-0.5 text-xs text-brand-muted">{pregunta.ayuda}</p>
      )}
      <div className="mt-3">
        {pregunta.tipo === 'escala_10' && (
          <Escala10 valor={Number(valor) || 0} onChange={(n) => onChange(n)} />
        )}
        {pregunta.tipo === 'estrellas' && (
          <Estrellas valor={Number(valor) || 0} onChange={(n) => onChange(n)} />
        )}
        {pregunta.tipo === 'multiple' && (
          <div className="grid gap-2 sm:grid-cols-2">
            {(pregunta.opciones ?? []).map((op) => {
              const checked = String(valor) === op;
              return (
                <label
                  key={op}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition',
                    checked
                      ? 'border-brand-cyan bg-brand-cyan-pale/30 text-brand-ink'
                      : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40',
                  )}
                >
                  <input
                    type="radio"
                    name={pregunta.id}
                    value={op}
                    checked={checked}
                    onChange={() => onChange(op)}
                    className="text-brand-cyan"
                  />
                  <span>{op}</span>
                </label>
              );
            })}
          </div>
        )}
        {pregunta.tipo === 'texto' && (
          <Textarea
            rows={3}
            value={String(valor ?? '')}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function Escala10({
  valor,
  onChange,
}: {
  valor: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }).map((_, i) => {
        const n = i + 1;
        const sel = valor === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              'h-9 min-w-9 rounded-lg border px-2 text-sm font-semibold transition',
              sel
                ? 'border-brand-cyan bg-brand-cyan text-white shadow'
                : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/40',
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function Estrellas({
  valor,
  onChange,
}: {
  valor: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => {
        const n = i + 1;
        const filled = n <= valor;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="p-0.5 transition hover:scale-110"
            aria-label={`${n} estrellas`}
          >
            <Star
              size={28}
              className={cn(
                filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
              )}
            />
          </button>
        );
      })}
      {valor > 0 && (
        <span className="ml-2 text-sm font-medium text-brand-muted">{valor}/5</span>
      )}
    </div>
  );
}
