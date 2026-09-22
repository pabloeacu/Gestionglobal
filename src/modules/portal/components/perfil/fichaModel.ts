import type { PerfilRegulatorio, HechoConCerteza } from '@/services/api/perfilRegulatorio';

// Modelo compartido de la ficha regulatoria del cliente (página + hot card del home).
// Obligaciones declarables: cada una se ancla por su ÚLTIMO evento (la RPC sólo acepta
// ultima_*; la próxima se re-infiere). La pregunta se enmarca en el último, nunca en el próximo.

export type FieldKey =
  | 'matriculaFecha'
  | 'ultimaRenovacion'
  | 'ultimoCursoActualizacion'
  | 'ultimaDdjj'
  | 'ultimoCertificado'
  | 'ultimaConsultoria';

export interface Obligacion {
  key: string; // clave de no_requiere (opt-out)
  field: FieldKey;
  factUltima: keyof PerfilRegulatorio;
  factProxima: keyof PerfilRegulatorio | null;
  label: string;
  pregunta: string;
}

export const OBLIGACIONES: Obligacion[] = [
  { key: 'renovacion', field: 'ultimaRenovacion', factUltima: 'ultima_renovacion', factProxima: 'proxima_renovacion', label: 'Renovación de matrícula', pregunta: '¿Cuándo renovaste tu matrícula por última vez?' },
  { key: 'curso_actualizacion', field: 'ultimoCursoActualizacion', factUltima: 'ultimo_curso_actualizacion', factProxima: 'proximo_curso_actualizacion', label: 'Curso de actualización', pregunta: '¿Cuándo hiciste tu último curso de actualización?' },
  { key: 'ddjj', field: 'ultimaDdjj', factUltima: 'ultima_ddjj', factProxima: 'proxima_ddjj', label: 'DDJJ anual', pregunta: '¿Cuándo presentaste tu última DDJJ?' },
  { key: 'certificado', field: 'ultimoCertificado', factUltima: 'ultimo_certificado', factProxima: 'proximo_certificado', label: 'Certificado', pregunta: '¿Cuándo obtuviste tu último certificado?' },
  { key: 'consultoria', field: 'ultimaConsultoria', factUltima: 'ultima_consultoria', factProxima: null, label: 'Consultoría jurídica', pregunta: '¿Cuándo fue tu última consultoría jurídica?' },
];

export function hechoDe(perfil: PerfilRegulatorio, k: keyof PerfilRegulatorio): HechoConCerteza {
  return perfil[k] as HechoConCerteza;
}

// Obligaciones que hoy piden acción del cliente (último evento desconocido, sin opt-out, sin snooze).
export function colaAccionable(perfil: PerfilRegulatorio, snoozed: Set<string>): Obligacion[] {
  const noReq = perfil.no_requiere ?? {};
  return OBLIGACIONES.filter(
    (o) => hechoDe(perfil, o.factUltima).certeza === 'desconocido' && !(o.key in noReq) && !snoozed.has(o.key),
  );
}

// Total de datos que necesitan el OK del cliente (cola + jurisdicción + fecha de matrícula).
export function contarPendientes(perfil: PerfilRegulatorio, snoozed: Set<string>): number {
  const jur = perfil.jurisdiccion === null && !snoozed.has('jurisdiccion') ? 1 : 0;
  const matFecha =
    perfil.matricula.fecha_certeza === 'desconocido' && perfil.matriculado.valor && !snoozed.has('matriculaFecha')
      ? 1
      : 0;
  return colaAccionable(perfil, snoozed).length + jur + matFecha;
}

// snooze per-viewer (localStorage, jamás fuente de verdad) — "Todavía no" no escribe nada.
function snoozeStorageKey(adminId: string) {
  return `gg.ficha.snooze.${adminId}`;
}
export function readSnoozed(adminId: string): Set<string> {
  try {
    const raw = localStorage.getItem(snoozeStorageKey(adminId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
export function writeSnoozed(adminId: string, s: Set<string>) {
  try {
    localStorage.setItem(snoozeStorageKey(adminId), JSON.stringify([...s]));
  } catch {
    /* per-viewer best-effort */
  }
}
