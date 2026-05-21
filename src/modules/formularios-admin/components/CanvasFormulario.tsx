// Canvas central del builder. Renderiza el schema como sería en el formulario
// público (sin inputs reales, sólo estructura) y soporta:
//   - Drop desde la palette (insertar campo nuevo).
//   - Drop de un campo existente (reordenar, mover entre secciones).
//   - Hover overlay con acciones rápidas (delete / duplicate).
//   - Click sobre campo o sección → setSelection().
//
// Drag&drop: HTML5 nativo. El dataTransfer codifica:
//   { origin: 'palette', type } ó { origin: 'canvas', sectionIdx, fieldIdx }
// El destino se marca como `[draggable].drop-target` y al onDrop se hace la
// mutación en el padre vía callbacks.

import { useState } from 'react';
import {
  Trash2,
  Copy as CopyIcon,
  GripVertical,
  Plus,
  ChevronUp,
  ChevronDown,
  Eye,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import type {
  FormularioFieldDef,
  FormularioSchemaDef,
  FormularioSectionDef,
} from '@/services/api/formularios';
import { cn } from '@/lib/cn';
import type { Selection } from '../types';

interface CanvasProps {
  schema: FormularioSchemaDef;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onInsertField: (
    sectionIdx: number,
    insertAt: number,
    field: FormularioFieldDef,
  ) => void;
  onMoveField: (
    fromSection: number,
    fromIdx: number,
    toSection: number,
    toIdx: number,
  ) => void;
  onDuplicateField: (sectionIdx: number, fieldIdx: number) => void;
  onDeleteField: (sectionIdx: number, fieldIdx: number) => void;
  onAddSection: () => void;
  onDeleteSection: (sectionIdx: number) => void;
  onMoveSection: (sectionIdx: number, dir: -1 | 1) => void;
}

interface DragPayloadPalette {
  origin: 'palette';
  type: FormularioFieldDef['type'];
}
interface DragPayloadCanvas {
  origin: 'canvas';
  sectionIdx: number;
  fieldIdx: number;
}
type DragPayload = DragPayloadPalette | DragPayloadCanvas;

function readPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData('application/x-form-builder');
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function CanvasFormulario(props: CanvasProps) {
  const {
    schema,
    selection,
    onSelect,
    onInsertField,
    onMoveField,
    onDuplicateField,
    onDeleteField,
    onAddSection,
    onDeleteSection,
    onMoveSection,
  } = props;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-2 text-xs text-brand-muted">
        <Eye size={12} className="-mt-0.5 mr-1 inline" />
        Vista del lienzo (no es la vista pública final)
      </div>
      <div className="flex-1 overflow-y-auto bg-brand-zebra/40 p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {schema.sections.map((section, sIdx) => (
            <SectionBlock
              key={sIdx}
              sectionIdx={sIdx}
              section={section}
              isSelected={
                selection?.kind === 'section' &&
                selection.value.sectionIdx === sIdx
              }
              selectedFieldIdx={
                selection?.kind === 'field' && selection.value.sectionIdx === sIdx
                  ? selection.value.fieldIdx
                  : -1
              }
              total={schema.sections.length}
              onSelectSection={() => onSelect({ kind: 'section', value: { sectionIdx: sIdx } })}
              onSelectField={(fIdx) =>
                onSelect({ kind: 'field', value: { sectionIdx: sIdx, fieldIdx: fIdx } })
              }
              onInsertField={onInsertField}
              onMoveField={onMoveField}
              onDuplicateField={onDuplicateField}
              onDeleteField={onDeleteField}
              onDeleteSection={() => onDeleteSection(sIdx)}
              onMoveSection={(dir) => onMoveSection(sIdx, dir)}
            />
          ))}

          <button
            onClick={onAddSection}
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white py-4 text-sm font-medium text-brand-muted transition hover:border-brand-cyan hover:bg-brand-cyan-pale/20 hover:text-brand-cyan"
          >
            <Plus size={16} /> Agregar sección
          </button>
        </div>
      </div>
    </div>
  );
}

interface SectionBlockProps {
  sectionIdx: number;
  section: FormularioSectionDef;
  isSelected: boolean;
  selectedFieldIdx: number;
  total: number;
  onSelectSection: () => void;
  onSelectField: (fIdx: number) => void;
  onInsertField: (
    sectionIdx: number,
    insertAt: number,
    field: FormularioFieldDef,
  ) => void;
  onMoveField: (
    fromSection: number,
    fromIdx: number,
    toSection: number,
    toIdx: number,
  ) => void;
  onDuplicateField: (sectionIdx: number, fieldIdx: number) => void;
  onDeleteField: (sectionIdx: number, fieldIdx: number) => void;
  onDeleteSection: () => void;
  onMoveSection: (dir: -1 | 1) => void;
}

function SectionBlock(props: SectionBlockProps) {
  const {
    sectionIdx,
    section,
    isSelected,
    selectedFieldIdx,
    total,
    onSelectSection,
    onSelectField,
    onInsertField,
    onMoveField,
    onDuplicateField,
    onDeleteField,
    onDeleteSection,
    onMoveSection,
  } = props;
  const [hoverDropIdx, setHoverDropIdx] = useState<number | null>(null);

  function handleDrop(insertAt: number, e: React.DragEvent) {
    e.preventDefault();
    setHoverDropIdx(null);
    const payload = readPayload(e);
    if (!payload) return;
    if (payload.origin === 'palette') {
      onInsertField(sectionIdx, insertAt, makeFieldFromType(payload.type, section));
    } else {
      onMoveField(payload.sectionIdx, payload.fieldIdx, sectionIdx, insertAt);
    }
  }

  return (
    <section
      onClick={onSelectSection}
      className={cn(
        'card-premium relative overflow-hidden p-5 transition motion-safe:animate-fade-up',
        isSelected && 'ring-2 ring-brand-cyan',
      )}
    >
      <TrianglesAccent
        position="top-right"
        size={120}
        tone="cyan"
        density="soft"
        className="opacity-20"
      />
      <div className="relative space-y-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="kicker">Sección {sectionIdx + 1}</p>
            <h3 className="font-display text-base font-bold text-brand-ink">
              {section.title || 'Sin título'}
            </h3>
            {section.subtitle && (
              <p className="text-xs text-brand-muted">{section.subtitle}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveSection(-1);
              }}
              disabled={sectionIdx === 0}
              className="rounded p-1 text-brand-muted hover:bg-slate-100 disabled:opacity-30"
              aria-label="Subir sección"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMoveSection(1);
              }}
              disabled={sectionIdx >= total - 1}
              className="rounded p-1 text-brand-muted hover:bg-slate-100 disabled:opacity-30"
              aria-label="Bajar sección"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSection();
              }}
              disabled={total === 1}
              className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-30"
              aria-label="Eliminar sección"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <DropZone
            isHover={hoverDropIdx === 0}
            onDragEnter={() => setHoverDropIdx(0)}
            onDragLeave={() => setHoverDropIdx((v) => (v === 0 ? null : v))}
            onDrop={(e) => handleDrop(0, e)}
          />
          {section.fields.map((field, fIdx) => (
            <div key={fIdx}>
              <FieldRow
                field={field}
                selected={selectedFieldIdx === fIdx}
                sectionIdx={sectionIdx}
                fieldIdx={fIdx}
                onClick={() => onSelectField(fIdx)}
                onDuplicate={() => onDuplicateField(sectionIdx, fIdx)}
                onDelete={() => onDeleteField(sectionIdx, fIdx)}
              />
              <DropZone
                isHover={hoverDropIdx === fIdx + 1}
                onDragEnter={() => setHoverDropIdx(fIdx + 1)}
                onDragLeave={() =>
                  setHoverDropIdx((v) => (v === fIdx + 1 ? null : v))
                }
                onDrop={(e) => handleDrop(fIdx + 1, e)}
              />
            </div>
          ))}
          {section.fields.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-brand-muted">
              Arrastrá campos desde la paleta de la izquierda.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DropZone({
  isHover,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  isHover: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        onDragEnter();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'h-2 rounded transition-all',
        isHover ? 'h-7 bg-brand-cyan/20 ring-2 ring-brand-cyan' : 'bg-transparent',
      )}
    />
  );
}

function FieldRow({
  field,
  selected,
  sectionIdx,
  fieldIdx,
  onClick,
  onDuplicate,
  onDelete,
}: {
  field: FormularioFieldDef;
  selected: boolean;
  sectionIdx: number;
  fieldIdx: number;
  onClick: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  function onDragStart(e: React.DragEvent) {
    e.stopPropagation();
    e.dataTransfer.setData(
      'application/x-form-builder',
      JSON.stringify({ origin: 'canvas', sectionIdx, fieldIdx }),
    );
    e.dataTransfer.effectAllowed = 'move';
  }
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'group relative cursor-pointer rounded-lg border bg-white p-3 transition',
        selected
          ? 'border-brand-cyan ring-2 ring-brand-cyan'
          : 'border-slate-200 hover:border-brand-cyan/40',
      )}
    >
      <div className="flex items-start gap-2">
        <GripVertical
          size={14}
          className="mt-0.5 text-brand-muted opacity-50 group-hover:opacity-100"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-brand-muted">
              {field.type}
            </span>
            {field.required && (
              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700">
                req
              </span>
            )}
            {field.condition && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                if
              </span>
            )}
          </div>
          <p className="truncate text-sm font-medium text-brand-ink">
            {field.label || '(sin label)'}
          </p>
          <p className="truncate text-[11px] text-brand-muted">
            <code>{field.name}</code>
            {field.placeholder ? <> · “{field.placeholder}”</> : null}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="rounded p-1 text-brand-muted hover:bg-slate-100"
            aria-label="Duplicar"
          >
            <CopyIcon size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-red-600 hover:bg-red-50"
            aria-label="Eliminar"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function makeFieldFromType(
  type: FormularioFieldDef['type'],
  section: FormularioSectionDef,
): FormularioFieldDef {
  const taken = new Set(section.fields.map((f) => f.name));
  let i = section.fields.length + 1;
  let name = `${type}_${i}`;
  while (taken.has(name)) {
    i += 1;
    name = `${type}_${i}`;
  }
  const base: FormularioFieldDef = {
    type,
    name,
    label: defaultLabel(type),
  };
  if (type === 'select' || type === 'multiselect' || type === 'radio') {
    base.options = ['Opción 1', 'Opción 2'];
  }
  if (type === 'file') {
    base.max_files = 1;
    base.accept = ['.pdf', '.jpg', '.jpeg', '.png'];
  }
  return base;
}

function defaultLabel(type: FormularioFieldDef['type']): string {
  switch (type) {
    case 'text':
      return 'Texto';
    case 'textarea':
      return 'Descripción';
    case 'email':
      return 'Email';
    case 'tel':
      return 'Teléfono';
    case 'number':
      return 'Número';
    case 'date':
      return 'Fecha';
    case 'select':
      return 'Elegí una opción';
    case 'multiselect':
      return 'Elegí varias opciones';
    case 'radio':
      return 'Opción única';
    case 'checkbox':
      return 'Acepto…';
    case 'file':
      return 'Adjuntar archivo';
    case 'heading':
      return 'Encabezado';
    case 'separator':
      return '';
    default:
      return 'Campo';
  }
}
