// Tipos del constructor visual. Reutilizamos los tipos del runner para que el
// schema producido sea 1:1 lo que `FormularioRunner` ya sabe interpretar.
//
// Tipo extendido de campo: agregamos algunas claves opcionales al
// FormularioFieldDef del runner que sólo viven en el builder (descripción
// alternativa para la palette, default_value para reset, etc.). El runner las
// ignora porque sólo lee las que conoce.

import type { FormularioFieldDef } from '@/services/api/formularios';

export type FieldType = FormularioFieldDef['type'];

// Tipos soportados desde la palette, en el orden de presentación.
export const FIELD_TYPES: ReadonlyArray<{
  type: FieldType;
  label: string;
  hint: string;
}> = [
  { type: 'text', label: 'Texto corto', hint: 'Una línea' },
  { type: 'textarea', label: 'Texto largo', hint: 'Multilínea' },
  { type: 'email', label: 'Email', hint: 'Con validación' },
  { type: 'tel', label: 'Teléfono', hint: 'Sólo dígitos' },
  { type: 'number', label: 'Número', hint: 'Entero o decimal' },
  { type: 'date', label: 'Fecha', hint: 'Selector nativo' },
  { type: 'select', label: 'Lista (1 opción)', hint: 'Desplegable' },
  { type: 'multiselect', label: 'Lista (varias)', hint: 'Multiselección' },
  { type: 'radio', label: 'Radio', hint: 'Una entre varias' },
  { type: 'checkbox', label: 'Checkbox', hint: 'Sí/No' },
  { type: 'file', label: 'Archivo', hint: 'Adjunto' },
  { type: 'heading', label: 'Título', hint: 'Encabezado decorativo' },
  { type: 'separator', label: 'Separador', hint: 'Línea horizontal' },
];

export interface SelectedField {
  sectionIdx: number;
  fieldIdx: number;
}

export interface SelectedSection {
  sectionIdx: number;
}

export type Selection =
  | { kind: 'field'; value: SelectedField }
  | { kind: 'section'; value: SelectedSection }
  | null;
