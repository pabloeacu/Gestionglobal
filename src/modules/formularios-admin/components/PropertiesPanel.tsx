// Panel derecho: edita propiedades del campo o sección seleccionados.
// Edición reactiva en memoria, el padre persiste con "Guardar".

import { useRef, useState } from 'react';
import { Plus, Trash2, Upload, FileText, Loader2, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { Button, Field, Input, Select, Textarea } from '@/components/common';
import { cn } from '@/lib/cn';
import type {
  FormularioFieldDef,
  FormularioSchemaDef,
  FormularioSectionDef,
} from '@/services/api/formularios';
import { ensureUniqueFieldName } from '@/services/api/formularios-admin';
import type { Selection } from '../types';

interface PropertiesPanelProps {
  schema: FormularioSchemaDef;
  selection: Selection;
  formularioId: string;
  onUpdateField: (
    sectionIdx: number,
    fieldIdx: number,
    patch: Partial<FormularioFieldDef>,
  ) => void;
  onUpdateSection: (
    sectionIdx: number,
    patch: Partial<FormularioSectionDef>,
  ) => void;
}

export function PropertiesPanel({
  schema,
  selection,
  formularioId,
  onUpdateField,
  onUpdateSection,
}: PropertiesPanelProps) {
  return (
    <aside className="card-premium flex h-full w-[320px] shrink-0 flex-col overflow-hidden">
      <header className="border-b border-slate-100 px-4 py-3">
        <p className="kicker">Propiedades</p>
        <p className="text-sm font-semibold text-brand-ink">
          {selection?.kind === 'field'
            ? 'Campo seleccionado'
            : selection?.kind === 'section'
              ? 'Sección seleccionada'
              : 'Nada seleccionado'}
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {!selection && (
          <p className="text-xs text-brand-muted">
            Clickeá un campo o una sección en el lienzo para editar sus
            propiedades.
          </p>
        )}
        {selection?.kind === 'section' && (
          <SectionEditor
            section={schema.sections[selection.value.sectionIdx]!}
            onPatch={(patch) => onUpdateSection(selection.value.sectionIdx, patch)}
          />
        )}
        {selection?.kind === 'field' && (
          <FieldEditor
            schema={schema}
            sectionIdx={selection.value.sectionIdx}
            fieldIdx={selection.value.fieldIdx}
            formularioId={formularioId}
            field={
              schema.sections[selection.value.sectionIdx]?.fields[
                selection.value.fieldIdx
              ]!
            }
            onPatch={(patch) =>
              onUpdateField(selection.value.sectionIdx, selection.value.fieldIdx, patch)
            }
          />
        )}
      </div>
    </aside>
  );
}

function SectionEditor({
  section,
  onPatch,
}: {
  section: FormularioSectionDef;
  onPatch: (patch: Partial<FormularioSectionDef>) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="Título de la sección">
        <Input
          value={section.title ?? ''}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </Field>
      <Field label="Subtítulo" hint="Una línea opcional debajo del título.">
        <Input
          value={section.subtitle ?? ''}
          onChange={(e) => onPatch({ subtitle: e.target.value })}
        />
      </Field>
    </div>
  );
}

function FieldEditor({
  schema,
  sectionIdx,
  fieldIdx,
  field,
  formularioId,
  onPatch,
}: {
  schema: FormularioSchemaDef;
  sectionIdx: number;
  fieldIdx: number;
  field: FormularioFieldDef;
  formularioId: string;
  onPatch: (patch: Partial<FormularioFieldDef>) => void;
}) {
  const hasOptions = ['select', 'multiselect', 'radio'].includes(field.type);
  const noLabelTypes = ['separator'];
  // file_download es presentacional: no se envía con la submission, así que NO
  // expone "Obligatorio" ni puede ser objetivo de lógica condicional.
  const noRequiredTypes = ['separator', 'heading', 'file_download'];

  const otrosCampos = schema.sections.flatMap((s, sI) =>
    s.fields.filter(
      (f, fI) =>
        !(sI === sectionIdx && fI === fieldIdx) &&
        !['separator', 'heading', 'html', 'file_download'].includes(f.type),
    ),
  );

  function onLabelChange(label: string) {
    onPatch({ label });
  }
  function onNameBlur(name: string) {
    const clean = ensureUniqueFieldName(schema, name, field.name);
    if (clean !== field.name) onPatch({ name: clean });
  }

  return (
    <div className="space-y-4">
      {!noLabelTypes.includes(field.type) && (
        <Field label="Etiqueta visible" required>
          <Input value={field.label} onChange={(e) => onLabelChange(e.target.value)} />
        </Field>
      )}
      <Field label="Nombre interno (key)" hint="A-Z, números y guión bajo.">
        <Input
          value={field.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          onBlur={(e) => onNameBlur(e.target.value)}
        />
      </Field>

      {['text', 'textarea', 'email', 'tel', 'number', 'date'].includes(
        field.type,
      ) && (
        <Field label="Placeholder">
          <Input
            value={field.placeholder ?? ''}
            onChange={(e) => onPatch({ placeholder: e.target.value })}
          />
        </Field>
      )}

      {!['separator', 'heading'].includes(field.type) && (
        <Field label="Texto de ayuda (hint)">
          <Input
            value={field.hint ?? ''}
            onChange={(e) => onPatch({ hint: e.target.value })}
          />
        </Field>
      )}

      {!noRequiredTypes.includes(field.type) && (
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
          <input
            type="checkbox"
            checked={Boolean(field.required)}
            onChange={(e) => onPatch({ required: e.target.checked })}
          />
          <span className="text-brand-ink">Obligatorio</span>
        </label>
      )}

      {hasOptions && (
        <OptionsEditor
          options={field.options ?? []}
          onChange={(opts) => onPatch({ options: opts })}
        />
      )}

      {(field.type === 'text' || field.type === 'textarea') && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mín. caracteres">
            <Input
              type="number"
              value={field.validation?.min ?? ''}
              onChange={(e) =>
                onPatch({
                  validation: {
                    ...field.validation,
                    min: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Máx. caracteres">
            <Input
              type="number"
              value={field.validation?.max ?? ''}
              onChange={(e) =>
                onPatch({
                  validation: {
                    ...field.validation,
                    max: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
      )}

      {field.type === 'number' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Mínimo">
            <Input
              type="number"
              value={field.validation?.min ?? ''}
              onChange={(e) =>
                onPatch({
                  validation: {
                    ...field.validation,
                    min: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Máximo">
            <Input
              type="number"
              value={field.validation?.max ?? ''}
              onChange={(e) =>
                onPatch({
                  validation: {
                    ...field.validation,
                    max: e.target.value === '' ? undefined : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
      )}

      {(field.type === 'text' || field.type === 'email' || field.type === 'tel') && (
        <Field label="Patrón regex" hint="Validación adicional opcional.">
          <Input
            value={field.validation?.pattern ?? ''}
            onChange={(e) =>
              onPatch({
                validation: {
                  ...field.validation,
                  pattern: e.target.value || undefined,
                },
              })
            }
          />
        </Field>
      )}

      {field.type === 'file' && (
        <div className="space-y-3">
          <Field label="Máx. archivos">
            <Input
              type="number"
              min={1}
              value={field.max_files ?? 1}
              onChange={(e) => onPatch({ max_files: Number(e.target.value) || 1 })}
            />
          </Field>
          <Field
            label="Extensiones permitidas"
            hint="Separadas por coma. Ej: .pdf, .jpg, .png"
          >
            <Input
              value={(field.accept ?? []).join(', ')}
              onChange={(e) =>
                onPatch({
                  accept: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>
      )}

      {field.type === 'file_download' && (
        <FileDownloadEditor
          field={field}
          formularioId={formularioId}
          onPatch={onPatch}
        />
      )}

      <Field
        label="Mostrar sólo si…"
        hint="Lógica condicional opcional. Si el campo dependiente es Select/Radio/Multiselect podés elegir uno o varios valores; con cualquiera de ellos el campo aparece."
      >
        <div className="space-y-2">
          <Select
            value={field.condition?.field ?? ''}
            onChange={(e) => {
              const target = e.target.value;
              if (!target) {
                const { condition: _omit, ...rest } = field;
                void _omit;
                onPatch(rest as Partial<FormularioFieldDef>);
                return;
              }
              onPatch({
                condition: {
                  field: target,
                  equals: field.condition?.equals ?? '',
                },
              });
            }}
          >
            <option value="">Siempre visible</option>
            {otrosCampos.map((c) => (
              <option key={c.name} value={c.name}>
                {c.label} ({c.name})
              </option>
            ))}
          </Select>
          {field.condition?.field &&
            (() => {
              const depField = otrosCampos.find(
                (c) => c.name === field.condition!.field,
              );
              const tieneOpciones =
                depField &&
                ['select', 'radio', 'multiselect'].includes(depField.type) &&
                Array.isArray(depField.options) &&
                depField.options.length > 0;
              const raw = field.condition!.equals;
              const seleccionadas: string[] = Array.isArray(raw)
                ? raw
                : raw
                  ? [raw]
                  : [];
              if (tieneOpciones) {
                return (
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="mb-1.5 text-[11px] text-brand-muted">
                      Tildá los valores con los que querés que aparezca:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {depField!.options!.map((op) => {
                        const checked = seleccionadas.includes(op);
                        return (
                          <label
                            key={op}
                            className={cn(
                              'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
                              checked
                                ? 'border-brand-cyan bg-brand-cyan-pale/40 text-brand-ink'
                                : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="h-3 w-3"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? Array.from(new Set([...seleccionadas, op]))
                                  : seleccionadas.filter((x) => x !== op);
                                onPatch({
                                  condition: {
                                    field: field.condition!.field,
                                    // Si hay un solo valor lo guardamos como string
                                    // para mantener compat con submissions viejas.
                                    equals: next.length === 1 ? next[0]! : next,
                                  },
                                });
                              }}
                            />
                            {op}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return (
                <Input
                  placeholder="Valor exacto que debe tener"
                  value={Array.isArray(raw) ? raw.join(', ') : raw}
                  onChange={(e) =>
                    onPatch({
                      condition: {
                        field: field.condition!.field,
                        equals: e.target.value,
                      },
                    })
                  }
                />
              );
            })()}
        </div>
      </Field>

      {field.type === 'heading' && (
        <Field label="Texto del encabezado">
          <Textarea
            rows={2}
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}

/**
 * Editor para campos file_download: la gerencia sube un archivo al bucket
 * `formulario-descargas` y el usuario público del formulario lo descarga.
 * Guarda url pública + filename + size en el field def.
 */
function FileDownloadEditor({
  field,
  formularioId,
  onPatch,
}: {
  field: FormularioFieldDef;
  formularioId: string;
  onPatch: (patch: Partial<FormularioFieldDef>) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // reset para permitir re-pick mismo archivo
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      toast.error('El archivo supera los 25 MB.');
      return;
    }
    setUploading(true);
    try {
      // Path único por field para evitar colisiones cuando hay varios
      // file_download en el mismo formulario. timestamp para invalidar caché.
      const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${formularioId}/${field.name}-${Date.now()}-${safeName}`;
      const upRes = await supabase.storage
        .from('formulario-descargas')
        .upload(path, f, { upsert: true, contentType: f.type || undefined });
      if (upRes.error) {
        toast.error('No pudimos subir el archivo', {
          description: upRes.error.message,
        });
        return;
      }
      const { data: pub } = supabase.storage
        .from('formulario-descargas')
        .getPublicUrl(path);
      onPatch({
        download_url: pub.publicUrl,
        download_filename: f.name,
        download_size_bytes: f.size,
      });
      toast.success('Archivo subido');
    } finally {
      setUploading(false);
    }
  }

  function onRemove() {
    onPatch({
      download_url: undefined,
      download_filename: undefined,
      download_size_bytes: undefined,
    });
  }

  const hasFile = Boolean(field.download_url);

  return (
    <Field
      label="Archivo a descargar"
      hint="Subí el archivo que el usuario podrá descargar desde el formulario."
    >
      <div className="space-y-2">
        {hasFile && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={14} className="shrink-0 text-brand-cyan" />
              <div className="min-w-0">
                <p className="truncate font-medium text-brand-ink">
                  {field.download_filename ?? 'archivo'}
                </p>
                {typeof field.download_size_bytes === 'number' && (
                  <p className="text-[11px] text-brand-muted">
                    {formatBytes(field.download_size_bytes)}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onRemove}
              className="text-brand-muted hover:text-red-600"
              title="Quitar archivo"
              aria-label="Quitar archivo"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onPick}
          disabled={uploading}
        />
        <Button
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Subiendo…
            </>
          ) : hasFile ? (
            <>
              <Upload size={12} /> Reemplazar archivo
            </>
          ) : (
            <>
              <Upload size={12} /> Subir archivo
            </>
          )}
        </Button>
        <p className="text-[11px] text-brand-muted">
          Hasta 25 MB. Cualquier formato (PDF, DOC, XLS, ZIP, imagen, etc.).
        </p>
      </div>
    </Field>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="kicker">Opciones</p>
      <ul className="space-y-1.5">
        {options.map((opt, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              onClick={() => onChange(options.filter((_, idx) => idx !== i))}
              className="rounded p-1 text-red-600 hover:bg-red-50"
              aria-label="Quitar opción"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() => onChange([...options, `Opción ${options.length + 1}`])}
      >
        <Plus size={12} /> Agregar opción
      </Button>
    </div>
  );
}
