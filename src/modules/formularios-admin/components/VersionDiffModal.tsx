// ============================================================================
// VersionDiffModal · diff visual entre 2 versiones de un formulario
//   (DGG-33 / P5-4.E)
//
// Compara los snapshots `schema` de dos versiones (A = más vieja, B = más
// nueva por convención). Detecta a nivel sección y campo:
//
//   • Secciones agregadas (en B, no en A) → bloque verde
//   • Secciones eliminadas (en A, no en B) → bloque rojo
//   • Secciones modificadas (mismo título, contenido distinto) → bloque ámbar
//       con desglose por campo: + agregados, - eliminados, ~ modificados
//   • Para campos modificados: detalle prop-a-prop (label, required, type,
//     options, placeholder, condition, …) → vista old → new compacta
//
// Cita patrón Notion "page history". Estética GG: paleta de marca, tipografía
// display para títulos, fontMono para los slugs/nombres internos.
// ============================================================================

import { useMemo } from 'react';
import {
  Minus,
  Plus,
  ArrowRight,
  GitCommit,
  Sparkles,
  FileWarning,
} from 'lucide-react';
import { Modal } from '@/components/common';
import { cn } from '@/lib/cn';
import type {
  FormularioSchemaDef,
  FormularioFieldDef,
  FormularioSectionDef,
} from '@/services/api/formularios';

interface VersionDiffModalProps {
  open: boolean;
  onClose: () => void;
  versionA: { num: number; at: string; schema: FormularioSchemaDef };
  versionB: { num: number; at: string; schema: FormularioSchemaDef };
}

// Resultado del diff: array de DiffSection (paralelo entre A y B).
type FieldDiffKind = 'added' | 'removed' | 'modified' | 'equal';
interface FieldDiff {
  kind: FieldDiffKind;
  name: string;
  before?: FormularioFieldDef;
  after?: FormularioFieldDef;
  changedProps?: string[]; // sólo si kind === 'modified'
}
interface SectionDiff {
  kind: 'added' | 'removed' | 'modified' | 'equal';
  titleBefore?: string;
  titleAfter?: string;
  fieldsDiff: FieldDiff[];
}

// Props relevantes de un campo para comparación. Si querés afinar el ojo
// del diff, restringí esta lista (algunas como `description` quizás no
// merecen quemar visual del diff).
const FIELD_PROPS_TO_DIFF = [
  'type',
  'label',
  'name',
  'required',
  'placeholder',
  'description',
  'options',
  'min',
  'max',
  'minLength',
  'maxLength',
  'pattern',
  'condition',
  'rows',
  'max_files',
  'accept',
] as const;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if ((a as unknown[]).length !== (b as unknown[]).length) return false;
    for (let i = 0; i < (a as unknown[]).length; i++) {
      if (!deepEqual((a as unknown[])[i], (b as unknown[])[i])) return false;
    }
    return true;
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(
      (a as unknown as Record<string, unknown>)[k],
      (b as unknown as Record<string, unknown>)[k],
    )) return false;
  }
  return true;
}

function diffField(a: FormularioFieldDef, b: FormularioFieldDef): {
  changed: boolean;
  props: string[];
} {
  const props: string[] = [];
  for (const k of FIELD_PROPS_TO_DIFF) {
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    if (!deepEqual(va, vb)) props.push(k);
  }
  return { changed: props.length > 0, props };
}

function diffSection(a: FormularioSectionDef, b: FormularioSectionDef): FieldDiff[] {
  const result: FieldDiff[] = [];
  const byNameA = new Map(a.fields.map((f) => [f.name || `_${a.fields.indexOf(f)}`, f]));
  const byNameB = new Map(b.fields.map((f) => [f.name || `_${b.fields.indexOf(f)}`, f]));
  const allNames = new Set<string>([...byNameA.keys(), ...byNameB.keys()]);

  // Para mantener orden estable: primero los nombres que están en B (orden
  // de B), después los que están sólo en A (eliminados).
  const orderedNames: string[] = [];
  for (const f of b.fields) {
    orderedNames.push(f.name || `_${b.fields.indexOf(f)}`);
  }
  for (const f of a.fields) {
    const n = f.name || `_${a.fields.indexOf(f)}`;
    if (!orderedNames.includes(n)) orderedNames.push(n);
  }

  for (const name of orderedNames) {
    if (!allNames.has(name)) continue;
    const inA = byNameA.get(name);
    const inB = byNameB.get(name);
    if (!inA && inB) {
      result.push({ kind: 'added', name, after: inB });
    } else if (inA && !inB) {
      result.push({ kind: 'removed', name, before: inA });
    } else if (inA && inB) {
      const { changed, props } = diffField(inA, inB);
      if (changed) {
        result.push({ kind: 'modified', name, before: inA, after: inB, changedProps: props });
      } else {
        result.push({ kind: 'equal', name, before: inA, after: inB });
      }
    }
  }
  return result;
}

function computeDiff(a: FormularioSchemaDef, b: FormularioSchemaDef): SectionDiff[] {
  const out: SectionDiff[] = [];
  const maxLen = Math.max(a.sections.length, b.sections.length);
  for (let i = 0; i < maxLen; i++) {
    const sa = a.sections[i];
    const sb = b.sections[i];
    if (!sa && sb) {
      out.push({
        kind: 'added',
        titleAfter: sb.title,
        fieldsDiff: sb.fields.map((f) => ({ kind: 'added', name: f.name, after: f })),
      });
    } else if (sa && !sb) {
      out.push({
        kind: 'removed',
        titleBefore: sa.title,
        fieldsDiff: sa.fields.map((f) => ({ kind: 'removed', name: f.name, before: f })),
      });
    } else if (sa && sb) {
      const fd = diffSection(sa, sb);
      const hasFieldChanges = fd.some((d) => d.kind !== 'equal');
      const titleChanged = sa.title !== sb.title;
      out.push({
        kind: hasFieldChanges || titleChanged ? 'modified' : 'equal',
        titleBefore: sa.title,
        titleAfter: sb.title,
        fieldsDiff: fd,
      });
    }
  }
  return out;
}

function previewValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 78) + '…' : v;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  try { return JSON.stringify(v).slice(0, 60); } catch { return String(v); }
}

export function VersionDiffModal({
  open,
  onClose,
  versionA,
  versionB,
}: VersionDiffModalProps) {
  const diff = useMemo(
    () => computeDiff(versionA.schema, versionB.schema),
    [versionA, versionB],
  );

  // Totales para el sub-header.
  const tot = useMemo(() => {
    let added = 0, removed = 0, modified = 0;
    for (const s of diff) {
      if (s.kind === 'added') added++;
      else if (s.kind === 'removed') removed++;
      else if (s.kind === 'modified') modified++;
      for (const fd of s.fieldsDiff) {
        if (fd.kind === 'added') added++;
        else if (fd.kind === 'removed') removed++;
        else if (fd.kind === 'modified') modified++;
      }
    }
    return { added, removed, modified };
  }, [diff]);

  const noChanges = tot.added + tot.removed + tot.modified === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Diff · v${versionA.num} → v${versionB.num}`}
      kicker="Historial de versiones"
      width={820}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
            v{versionA.num} · {new Date(versionA.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          <ArrowRight size={12} className="text-brand-muted" />
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-brand-cyan">
            v{versionB.num} · {new Date(versionB.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
          <span className="ml-auto inline-flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-700">
              <Plus size={11} /> {tot.added}
            </span>
            <span className="inline-flex items-center gap-1 text-rose-700">
              <Minus size={11} /> {tot.removed}
            </span>
            <span className="inline-flex items-center gap-1 text-amber-700">
              <GitCommit size={11} /> {tot.modified}
            </span>
          </span>
        </div>

        {noChanges && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-brand-muted">
            <Sparkles size={16} className="mx-auto mb-2 text-brand-muted/70" />
            No detectamos cambios entre estas dos versiones.
          </div>
        )}

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {diff.map((s, idx) => (
            <SectionBlock key={idx} section={s} />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function SectionBlock({ section }: { section: SectionDiff }) {
  // Estilo del bloque según kind global.
  const blockClass =
    section.kind === 'added'
      ? 'border-emerald-200 bg-emerald-50/60'
      : section.kind === 'removed'
        ? 'border-rose-200 bg-rose-50/60'
        : section.kind === 'modified'
          ? 'border-amber-200 bg-amber-50/40'
          : 'border-slate-200 bg-white';

  const title =
    section.titleAfter && section.titleBefore && section.titleAfter !== section.titleBefore
      ? `${section.titleBefore} → ${section.titleAfter}`
      : section.titleAfter ?? section.titleBefore ?? '(sin título)';

  const Icon = section.kind === 'added' ? Plus : section.kind === 'removed' ? Minus : section.kind === 'modified' ? GitCommit : Sparkles;

  // Si la sección no tiene cambios y ningún campo cambió → la ocultamos
  // para reducir ruido visual.
  if (section.kind === 'equal' && section.fieldsDiff.every((d) => d.kind === 'equal')) {
    return null;
  }

  return (
    <div className={cn('rounded-xl border p-3 text-sm', blockClass)}>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'grid h-6 w-6 place-items-center rounded-md',
            section.kind === 'added'
              ? 'bg-emerald-100 text-emerald-700'
              : section.kind === 'removed'
                ? 'bg-rose-100 text-rose-700'
                : section.kind === 'modified'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-700',
          )}
        >
          <Icon size={12} />
        </span>
        <p className="font-semibold text-brand-ink">{title}</p>
        <span className="ml-auto text-[11px] text-brand-muted">
          {section.kind === 'equal'
            ? `${section.fieldsDiff.filter((d) => d.kind !== 'equal').length} cambios en campos`
            : section.kind === 'added'
              ? 'sección agregada'
              : section.kind === 'removed'
                ? 'sección eliminada'
                : 'modificada'}
        </span>
      </div>
      <ul className="space-y-1.5">
        {section.fieldsDiff
          .filter((d) => d.kind !== 'equal')
          .map((d, i) => (
            <FieldDiffRow key={i} d={d} />
          ))}
      </ul>
    </div>
  );
}

function FieldDiffRow({ d }: { d: FieldDiff }) {
  const Icon =
    d.kind === 'added' ? Plus
    : d.kind === 'removed' ? Minus
    : d.kind === 'modified' ? GitCommit
    : FileWarning;
  const tone =
    d.kind === 'added' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : d.kind === 'removed' ? 'text-rose-700 bg-rose-50 border-rose-200'
    : 'text-amber-800 bg-amber-50 border-amber-200';

  return (
    <li className={cn('rounded-lg border px-2.5 py-1.5 text-xs', tone)}>
      <div className="flex items-center gap-2">
        <Icon size={12} />
        <code className="font-mono text-[11.5px]">{d.name || '(sin name)'}</code>
        {d.kind === 'added' && d.after && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {d.after.type}
          </span>
        )}
        {d.kind === 'removed' && d.before && (
          <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {d.before.type}
          </span>
        )}
        {d.kind === 'modified' && d.changedProps && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {d.changedProps.length} {d.changedProps.length === 1 ? 'cambio' : 'cambios'}
          </span>
        )}
      </div>

      {d.kind === 'modified' && d.changedProps && d.before && d.after && (
        <ul className="mt-1.5 space-y-1 pl-5">
          {d.changedProps.map((p) => (
            <li key={p} className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
              <span className="font-medium text-amber-900">{p}:</span>
              <span className="space-x-1.5">
                <span className="rounded bg-rose-100 px-1 text-rose-700 line-through">
                  {previewValue((d.before as unknown as Record<string, unknown>)[p])}
                </span>
                <ArrowRight size={10} className="inline text-amber-700" />
                <span className="rounded bg-emerald-100 px-1 text-emerald-800">
                  {previewValue((d.after as unknown as Record<string, unknown>)[p])}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
