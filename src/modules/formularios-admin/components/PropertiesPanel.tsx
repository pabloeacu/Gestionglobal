// Panel derecho: edita propiedades del campo o sección seleccionados.
// Edición reactiva en memoria, el padre persiste con "Guardar".

import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from '@/components/common';
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
  onPatch,
}: {
  schema: FormularioSchemaDef;
  sectionIdx: number;
  fieldIdx: number;
  field: FormularioFieldDef;
  onPatch: (patch: Partial<FormularioFieldDef>) => void;
}) {
  const hasOptions = ['select', 'multiselect', 'radio'].includes(field.type);
  const noLabelTypes = ['separator'];

  const otrosCampos = schema.sections.flatMap((s, sI) =>
    s.fields.filter(
      (f, fI) =>
        !(sI === sectionIdx && fI === fieldIdx) &&
        !['separator', 'heading', 'html'].includes(f.type),
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

      {!['separator', 'heading'].includes(field.type) && (
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

      <Field label="Mostrar sólo si…" hint="Lógica condicional opcional.">
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
          {field.condition?.field && (
            <Input
              placeholder="Valor exacto que debe tener"
              value={field.condition.equals}
              onChange={(e) =>
                onPatch({
                  condition: {
                    field: field.condition!.field,
                    equals: e.target.value,
                  },
                })
              }
            />
          )}
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
