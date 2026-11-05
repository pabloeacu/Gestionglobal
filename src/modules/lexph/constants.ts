import { Gavel, ScrollText, Globe2, Lightbulb, type LucideIcon } from 'lucide-react';
import type { LexphTipo } from '@/services/api/lexph';

// DGG-244 · LexPH — metadatos de presentación de los tipos de artículo.
export interface TipoMeta {
  value: LexphTipo;
  label: string;
  plural: string;
  icon: LucideIcon;
  // clases de acento (chip) — paleta de marca
  chip: string;
}

export const TIPOS: TipoMeta[] = [
  {
    value: 'fallo',
    label: 'Fallo',
    plural: 'Fallos',
    icon: Gavel,
    chip: 'bg-brand-cyan-pale/70 text-brand-cyan',
  },
  {
    value: 'normativa',
    label: 'Normativa',
    plural: 'Normativas',
    icon: ScrollText,
    chip: 'bg-amber-50 text-amber-700',
  },
  {
    value: 'internacional',
    label: 'Internacional',
    plural: 'Internacional',
    icon: Globe2,
    chip: 'bg-violet-50 text-violet-700',
  },
  {
    value: 'insight',
    label: 'Insight',
    plural: 'Insights',
    icon: Lightbulb,
    chip: 'bg-emerald-50 text-emerald-700',
  },
];

export function tipoMeta(tipo: string): TipoMeta {
  return TIPOS.find((t) => t.value === tipo) ?? TIPOS[0]!;
}

// Campos estructurados por tipo (se guardan en `campos` jsonb).
export type CampoKind = 'text' | 'textarea' | 'lista';
export interface CampoDef {
  key: string;
  label: string;
  kind: CampoKind;
  placeholder?: string;
}

export const CAMPOS_POR_TIPO: Record<LexphTipo, CampoDef[]> = {
  fallo: [
    { key: 'tribunal', label: 'Tribunal', kind: 'text', placeholder: 'CNCiv, SCBA, CSJN…' },
    { key: 'sala', label: 'Sala / Secretaría', kind: 'text' },
    { key: 'fecha', label: 'Fecha del fallo', kind: 'text', placeholder: 'dd/mm/aaaa' },
    { key: 'caratula', label: 'Carátula', kind: 'text', placeholder: '"Pérez c/ Consorcio…"' },
    { key: 'voces', label: 'Voces / sumario (una por línea)', kind: 'lista' },
    { key: 'clave_administrador', label: 'Clave para el administrador', kind: 'textarea' },
    { key: 'riesgo_oportunidad', label: 'Riesgo / Oportunidad', kind: 'textarea' },
  ],
  normativa: [
    { key: 'organismo', label: 'Organismo', kind: 'text', placeholder: 'ARCA, PLH, Ministerio…' },
    { key: 'norma', label: 'Norma', kind: 'text', placeholder: 'Decreto 1228/2026, RG 5915…' },
    { key: 'fecha', label: 'Fecha / vigencia', kind: 'text', placeholder: 'dd/mm/aaaa' },
    { key: 'clave_administrador', label: 'Clave para el administrador', kind: 'textarea' },
  ],
  internacional: [
    { key: 'pais', label: 'País', kind: 'text', placeholder: 'España, Uruguay…' },
    { key: 'organismo', label: 'Organismo', kind: 'text' },
    { key: 'norma', label: 'Norma / referencia', kind: 'text', placeholder: 'BOE-A-2026-20955…' },
    { key: 'fecha', label: 'Fecha', kind: 'text', placeholder: 'dd/mm/aaaa' },
    { key: 'clave_administrador', label: 'Clave para el administrador', kind: 'textarea' },
  ],
  insight: [],
};

export const ESTADOS = [
  { value: 'borrador' as const, label: 'Borrador' },
  { value: 'publicado' as const, label: 'Publicado' },
];
