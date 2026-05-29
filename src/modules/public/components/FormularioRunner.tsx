import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import {
  Send,
  Loader2,
  CheckCircle2,
  Upload,
  X as XIcon,
  AlertCircle,
  Download,
  FileText,
} from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  submitFormulario,
  type FormularioRow,
  type FormularioSchemaDef,
  type FormularioFieldDef,
} from '@/services/api/formularios';
import { cn } from '@/lib/cn';

interface FormularioRunnerProps {
  formulario: FormularioRow;
  /**
   * Valores pre-cargados (típicamente vienen del perfil del cliente cuando
   * está logueado desde el portal). El runner hace matching case-insensitive
   * por nombre del campo y lo precarga + marca como "auto-rellenado".
   */
  prefillValues?: Record<string, unknown>;
}

interface FieldState {
  value: unknown;
  touched: boolean;
  prefilled?: boolean;  // viene de perfil del cliente, mostrar badge
}

/**
 * Normaliza un nombre de campo para matching: lowercase + sin acentos + sin
 * espacios/guiones. Permite que 'Correo Electrónico' matchee con 'correo_electronico'.
 */
function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-]+/g, '_');
}

// Runner: renderiza un formulario desde su schema jsonb, maneja validaciones
// reactivas, lógica condicional declarativa, adjuntos múltiples por campo y
// submit al edge function. Pensado para uso público (URL `/formulario/:slug`).
export function FormularioRunner({ formulario, prefillValues }: FormularioRunnerProps) {
  const schema = formulario.schema as unknown as FormularioSchemaDef;
  const [state, setState] = useState<Record<string, FieldState>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ mensaje: string; redirect: string | null } | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [prefilledCount, setPrefilledCount] = useState(0);

  // Auto-fill al recibir prefillValues. Hace matching case-insensitive entre
  // el name de cada campo del schema y las keys del dict del perfil del cliente.
  useEffect(() => {
    if (!prefillValues || Object.keys(prefillValues).length === 0) return;

    // Normalizar keys del prefill para lookup rápido
    const lookup: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prefillValues)) {
      if (v === null || v === undefined || v === '') continue;
      if (k.startsWith('_')) continue;  // _user_id, _origen son meta
      lookup[normalizeKey(k)] = v;
    }

    const newState: Record<string, FieldState> = {};
    let count = 0;
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (['heading', 'separator', 'html', 'file', 'file_download'].includes(field.type)) continue;
        const normalizedName = normalizeKey(field.name);
        const match = lookup[normalizedName];
        if (match !== undefined) {
          newState[field.name] = { value: match, touched: false, prefilled: true };
          count++;
        }
      }
    }
    if (count > 0) {
      setState(newState);
      setPrefilledCount(count);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillValues]);

  const data = useMemo(() => {
    const d: Record<string, unknown> = {};
    for (const k of Object.keys(state)) d[k] = state[k]?.value;
    return d;
  }, [state]);

  function setField(name: string, value: unknown) {
    setState((s) => ({ ...s, [name]: { value, touched: true } }));
    setTopError(null);
  }

  function isFieldVisible(field: FormularioFieldDef): boolean {
    if (!field.condition) return true;
    return String(data[field.condition.field] ?? '') === field.condition.equals;
  }

  function validate(): string[] {
    const errors: string[] = [];
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (['heading', 'separator', 'html', 'file_download'].includes(field.type)) continue;
        if (!isFieldVisible(field)) continue;

        if (field.type === 'file') {
          const fl = files[field.name] ?? [];
          if (field.required && fl.length === 0) {
            errors.push(`${field.label}: requerido`);
          }
          if (field.max_files && fl.length > field.max_files) {
            errors.push(`${field.label}: máximo ${field.max_files} archivos`);
          }
          continue;
        }

        const val = data[field.name];
        const empty =
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0);
        if (field.required && empty) {
          errors.push(`${field.label}: requerido`);
          continue;
        }
        if (empty) continue;

        if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) {
          errors.push(`${field.label}: email inválido`);
        }
        if (field.type === 'tel') {
          const digits = String(val).replace(/\D/g, '');
          if (digits.length < 8) errors.push(`${field.label}: teléfono incompleto`);
        }
        if (field.type === 'number' && isNaN(Number(val))) {
          errors.push(`${field.label}: número inválido`);
        }
      }
    }
    return errors;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (errors.length > 0) {
      setTopError(errors.join(' · '));
      toast.error('Revisá los campos marcados');
      return;
    }
    setSending(true);

    // Aplanar files a [{ field, file }]
    const flatFiles: Array<{ field: string; file: File }> = [];
    for (const k of Object.keys(files)) {
      for (const f of files[k] ?? []) flatFiles.push({ field: k, file: f });
    }

    const res = await submitFormulario({
      slug: formulario.slug,
      datos: data,
      files: flatFiles,
    });
    setSending(false);

    if (!res.ok) {
      setTopError(res.error.message);
      toast.error('No pudimos enviar el formulario', { description: res.error.message });
      return;
    }
    toast.success('Formulario enviado');
    setDone({ mensaje: res.data.mensaje, redirect: res.data.redirect_url });
    if (res.data.redirect_url) {
      window.setTimeout(() => { window.location.href = res.data.redirect_url!; }, 2500);
    }
  }

  // Pantalla de confirmación post-submit
  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="font-display text-2xl font-bold text-brand-ink">¡Listo!</h2>
        <p className="mt-3 text-sm leading-relaxed text-brand-ink">{done.mensaje}</p>
        {done.redirect && (
          <p className="mt-4 text-xs text-brand-muted">Redirigiendo en un instante…</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {prefilledCount > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 shadow-sm">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} />
          <div className="min-w-0">
            <p className="font-semibold">
              Pre-rellenamos {prefilledCount} {prefilledCount === 1 ? 'campo' : 'campos'} con tus datos
            </p>
            <p className="mt-0.5 text-xs text-emerald-800/90">
              Tomamos los datos de tu perfil. Si necesitás modificarlos para esta solicitud, simplemente editá el valor.
            </p>
          </div>
        </div>
      )}
      {schema.sections.map((section, sIdx) => (
        <section
          key={sIdx}
          className="card-premium relative overflow-hidden p-6 motion-safe:animate-fade-up"
          style={{ animationDelay: `${sIdx * 60}ms` }}
        >
          <TrianglesAccent
            position="top-right"
            size={140}
            tone="cyan"
            density="soft"
            className="opacity-25"
          />
          <div className="relative space-y-4">
            {section.title && (
              <div>
                <h3 className="font-display text-lg font-bold text-brand-ink">
                  {section.title}
                </h3>
                {section.subtitle && (
                  <p className="text-sm text-brand-muted">{section.subtitle}</p>
                )}
              </div>
            )}
            {section.fields.map((field) => {
              if (!isFieldVisible(field)) return null;
              return (
                <FieldRenderer
                  key={field.name}
                  field={field}
                  value={data[field.name]}
                  prefilled={state[field.name]?.prefilled === true}
                  onChange={(v) => setField(field.name, v)}
                  files={files[field.name] ?? []}
                  onFilesChange={(fs) => setFiles((s) => ({ ...s, [field.name]: fs }))}
                />
              );
            })}
          </div>
        </section>
      ))}

      {topError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <strong>Revisá el formulario</strong>
          </div>
          <p className="mt-1 text-xs leading-relaxed">{topError}</p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={sending}>
          {sending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Send size={14} /> {schema.submit_label ?? 'Enviar'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

interface FieldRendererProps {
  field: FormularioFieldDef;
  value: unknown;
  prefilled?: boolean;
  onChange: (v: unknown) => void;
  files: File[];
  onFilesChange: (f: File[]) => void;
}

/** Badge sutil que indica que el campo fue pre-rellenado desde el perfil del cliente. */
function PrefilledBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
      title="Tomado de tu perfil"
    >
      <CheckCircle2 size={10} /> de tu perfil
    </span>
  );
}

/** Compose label con badge si está pre-rellenado. */
function fieldLabel(field: FormularioFieldDef, prefilled: boolean): React.ReactNode {
  if (!prefilled) return field.label;
  return (
    <span className="inline-flex items-center gap-2">
      {field.label}
      <PrefilledBadge />
    </span>
  );
}

function FieldRenderer({ field, value, prefilled = false, onChange, files, onFilesChange }: FieldRendererProps) {
  switch (field.type) {
    case 'heading':
      return (
        <h4 className="font-display text-base font-bold text-brand-ink">{field.label}</h4>
      );
    case 'separator':
      return <hr className="border-slate-200" />;
    case 'html':
      return (
        <div
          className="prose-sm text-brand-muted"
          dangerouslySetInnerHTML={{ __html: field.label }}
        />
      );

    case 'textarea':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Textarea
            rows={4}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          >
            <option value="">— Elegí una opción —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'radio':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options?.map((opt) => {
              const checked = String(value) === opt;
              return (
                <label
                  key={opt}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition',
                    checked
                      ? 'border-brand-cyan bg-brand-cyan-pale/30 text-brand-ink'
                      : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40',
                  )}
                >
                  <input
                    type="radio"
                    name={field.name}
                    value={opt}
                    checked={checked}
                    onChange={() => onChange(opt)}
                    className="text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </Field>
      );

    case 'checkbox':
      return (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 rounded text-brand-cyan focus:ring-brand-cyan/40"
          />
          <span>
            {field.label}
            {field.required && <span className="ml-1 text-red-600">*</span>}
            {field.hint && (
              <span className="block text-xs text-brand-muted">{field.hint}</span>
            )}
          </span>
        </label>
      );

    case 'file':
      return (
        <FileUploader
          field={field}
          files={files}
          onFilesChange={onFilesChange}
        />
      );

    case 'file_download':
      return <FileDownloadCard field={field} />;

    default:
      // text / email / tel / number / date
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Input
            type={field.type === 'tel' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </Field>
      );
  }
}

/**
 * Tarjeta de descarga: muestra un archivo provisto por la gerencia (plantillas,
 * instructivos, etc.) que el usuario público del formulario puede descargar.
 * No es un campo de entrada: no se valida ni se envía.
 */
function FileDownloadCard({ field }: { field: FormularioFieldDef }) {
  if (!field.download_url) {
    // Si no hay archivo cargado todavía, mostramos un placeholder discreto
    // (sólo se ve en preview del builder antes de subir el archivo).
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-brand-muted">
        <div className="flex items-center gap-3">
          <FileText size={18} className="shrink-0 text-slate-400" />
          <p>{field.label || 'Archivo a descargar'} (sin archivo cargado)</p>
        </div>
      </div>
    );
  }

  const sizeLabel =
    typeof field.download_size_bytes === 'number'
      ? field.download_size_bytes < 1024
        ? `${field.download_size_bytes} B`
        : field.download_size_bytes < 1024 * 1024
          ? `${(field.download_size_bytes / 1024).toFixed(1)} KB`
          : `${(field.download_size_bytes / (1024 * 1024)).toFixed(1)} MB`
      : null;

  return (
    <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan-pale/30 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-brand-cyan shadow-sm">
          <FileText size={18} />
        </span>
        <div className="min-w-0 flex-1">
          {field.label && (
            <p className="font-semibold text-brand-ink">{field.label}</p>
          )}
          {field.hint && (
            <p className="mt-0.5 text-xs text-brand-muted">{field.hint}</p>
          )}
          <p className="mt-1 truncate text-xs text-brand-ink/70">
            {field.download_filename ?? 'archivo'}
            {sizeLabel ? ` · ${sizeLabel}` : ''}
          </p>
        </div>
        <a
          href={field.download_url}
          download={field.download_filename}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-cyan/90"
        >
          <Download size={14} />
          Descargar
        </a>
      </div>
    </div>
  );
}

function FileUploader({
  field,
  files,
  onFilesChange,
}: {
  field: FormularioFieldDef;
  files: File[];
  onFilesChange: (f: File[]) => void;
}) {
  const maxFiles = field.max_files ?? 1;
  const acceptStr = field.accept?.join(',') ?? '';

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files ?? []);
    const total = [...files, ...newFiles].slice(0, maxFiles);
    onFilesChange(total);
    e.target.value = ''; // reset input para permitir re-pick mismo archivo
  }

  function removeAt(i: number) {
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <Field label={field.label} required={field.required} hint={field.hint}>
      <div className="space-y-2">
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="truncate text-brand-ink">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-brand-muted hover:text-red-600"
                  aria-label="Quitar archivo"
                >
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < maxFiles && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-brand-muted transition hover:border-brand-cyan hover:bg-brand-cyan-pale/20 hover:text-brand-cyan">
            <Upload size={16} />
            <span>
              {files.length === 0
                ? `Subir ${maxFiles > 1 ? 'archivos' : 'archivo'}`
                : `Agregar otro (${files.length}/${maxFiles})`}
            </span>
            <input
              type="file"
              accept={acceptStr}
              multiple={maxFiles > 1}
              onChange={onPick}
              className="hidden"
            />
          </label>
        )}
      </div>
    </Field>
  );
}
