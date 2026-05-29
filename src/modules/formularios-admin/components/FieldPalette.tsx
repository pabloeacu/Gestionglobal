// Panel izquierdo del builder: paleta de tipos de campo arrastrables.
// Drag&drop con la API nativa HTML5 (Sin @dnd-kit: bundle más liviano).
// El source serializa `{ origin: 'palette', type }` y el canvas decide dónde
// insertar el campo.

import {
  Type,
  AlignLeft,
  Mail,
  Phone,
  Hash,
  Calendar,
  ChevronDown,
  ListChecks,
  CircleDot,
  CheckSquare,
  Upload,
  Download,
  Heading,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import { FIELD_TYPES, type FieldType } from '../types';

const ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  email: Mail,
  tel: Phone,
  number: Hash,
  date: Calendar,
  select: ChevronDown,
  multiselect: ListChecks,
  radio: CircleDot,
  checkbox: CheckSquare,
  file: Upload,
  file_download: Download,
  heading: Heading,
  separator: Minus,
  html: Type,
};

interface PaletteProps {
  // Callback fallback: si el usuario hace CLICK (no drag), agregamos el campo
  // al final de la sección seleccionada / primera sección. Más confiable que
  // DnD HTML5 nativo, sobre todo en mobile y trackpads.
  onClickAdd?: (type: FieldType) => void;
}

export function FieldPalette({ onClickAdd }: PaletteProps = {}) {
  function onDragStart(e: React.DragEvent, type: FieldType) {
    e.dataTransfer.setData(
      'application/x-form-builder',
      JSON.stringify({ origin: 'palette', type }),
    );
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <aside className="card-premium flex h-full w-[260px] shrink-0 flex-col overflow-hidden">
      <header className="border-b border-slate-100 px-4 py-3">
        <p className="kicker">Paleta</p>
        <p className="text-sm font-semibold text-brand-ink">Click o arrastrá</p>
        <p className="mt-0.5 text-[11px] text-brand-muted">
          Click → se agrega al final. Arrastre → elegís la posición.
        </p>
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-2">
          {FIELD_TYPES.map((ft) => {
            const Icon = ICONS[ft.type] ?? Type;
            return (
              <li key={ft.type}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => onDragStart(e, ft.type)}
                  onClick={() => onClickAdd?.(ft.type)}
                  className="flex w-full cursor-grab items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-brand-cyan/40 hover:bg-brand-cyan-pale/20 active:cursor-grabbing"
                >
                  <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-brand-cyan-pale/40 text-brand-cyan">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-brand-ink">
                      {ft.label}
                    </span>
                    <span className="block text-[11px] text-brand-muted">
                      {ft.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
