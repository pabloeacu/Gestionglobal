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

// DGG-234 F6: jurisdicción normalizada para el gating de obligaciones. El contrato
// del calc trae 'rpac' (PBA) | 'rpa' (CABA/Neuquén) | null. Hoy 'rpa' = CABA (0 clientes
// Neuquén); cuando el contrato se extienda al enum pleno, distinguir caba/neuquen acá.
export type JurNorm = 'pba' | 'caba' | 'neuquen';
export function jurNorm(perfil: PerfilRegulatorio): JurNorm {
  return perfil.jurisdiccion === 'rpa' ? 'caba' : 'pba'; // 'rpac'|null → pba (muestra todo, 0 regresión)
}

// DGG-234 F6 · etiquetas jurisdicción-aware — reemplazan los "RPAC" hardcodeados de la
// ficha (E-GG-236). Antes del cutover los 3 CABA computaban PBA y "RPAC" era consistente;
// tras el cutover la ficha debe rotular su matrícula/renovación/legajo según la jurisdicción
// real, igual que ya lo hacen el pill del home y el card (F6b) y los emails/push (F4b).
// NOTA: el contrato del calc aún es binario ('rpac'|'rpa'|null) → hoy 'rpa'→caba siempre;
// cuando se extienda al enum pleno, jurNorm distinguirá neuquen y estos helpers ya lo cubren.
export function matriculaLabel(perfil: PerfilRegulatorio): string {
  switch (jurNorm(perfil)) {
    case 'caba':
      return 'RPA (CABA)';
    case 'neuquen':
      return 'RPA (Neuquén)';
    default:
      return 'RPAC';
  }
}
export function jurisdiccionLabel(perfil: PerfilRegulatorio): string {
  switch (jurNorm(perfil)) {
    case 'caba':
      return 'RPA · CABA';
    case 'neuquen':
      return 'RPA · Neuquén';
    default:
      return 'RPAC · Buenos Aires';
  }
}
// ¿Su matrícula se verifica contra un registro oficial consultable (TRAMIX)? Sólo PBA.
// Gobierna el copy de "cargá tu legajo … y lo verificamos con el registro oficial".
export function tieneRegistroOficial(perfil: PerfilRegulatorio): boolean {
  return jurNorm(perfil) === 'pba';
}

export interface Obligacion {
  key: string; // clave de no_requiere (opt-out)
  field: FieldKey;
  factUltima: keyof PerfilRegulatorio;
  factProxima: keyof PerfilRegulatorio | null;
  label: string;
  pregunta: string;
  aplicaEn: JurNorm[]; // DGG-234 F6: jurisdicciones donde la obligación corresponde
}

export const OBLIGACIONES: Obligacion[] = [
  { key: 'renovacion', field: 'ultimaRenovacion', factUltima: 'ultima_renovacion', factProxima: 'proxima_renovacion', label: 'Renovación de matrícula', pregunta: '¿Cuándo renovaste tu matrícula por última vez?', aplicaEn: ['pba', 'caba', 'neuquen'] },
  { key: 'curso_actualizacion', field: 'ultimoCursoActualizacion', factUltima: 'ultimo_curso_actualizacion', factProxima: 'proximo_curso_actualizacion', label: 'Curso de actualización', pregunta: '¿Cuándo hiciste tu último curso de actualización?', aplicaEn: ['pba', 'caba'] },
  { key: 'ddjj', field: 'ultimaDdjj', factUltima: 'ultima_ddjj', factProxima: 'proxima_ddjj', label: 'DDJJ anual', pregunta: '¿Cuándo presentaste tu última DDJJ?', aplicaEn: ['pba', 'caba'] },
  { key: 'certificado', field: 'ultimoCertificado', factUltima: 'ultimo_certificado', factProxima: 'proximo_certificado', label: 'Certificado', pregunta: '¿Cuándo obtuviste tu último certificado?', aplicaEn: ['pba'] },
  { key: 'consultoria', field: 'ultimaConsultoria', factUltima: 'ultima_consultoria', factProxima: null, label: 'Consultoría jurídica', pregunta: '¿Cuándo fue tu última consultoría jurídica?', aplicaEn: ['pba', 'caba', 'neuquen'] },
];

// DGG-234 F6: obligaciones que aplican a la jurisdicción del cliente (ocultar lo que no aplica).
// Para PBA/desconocido devuelve TODAS (0 regresión); para CABA oculta el certificado (RPAC-only).
export function obligacionesVisibles(perfil: PerfilRegulatorio): Obligacion[] {
  const j = jurNorm(perfil);
  return OBLIGACIONES.filter((o) => o.aplicaEn.includes(j));
}

export function hechoDe(perfil: PerfilRegulatorio, k: keyof PerfilRegulatorio): HechoConCerteza {
  return perfil[k] as HechoConCerteza;
}

// Obligaciones que hoy piden acción del cliente (último evento desconocido, sin opt-out, sin snooze).
// DGG-234 F6: sólo entre las que aplican a la jurisdicción.
export function colaAccionable(perfil: PerfilRegulatorio, snoozed: Set<string>): Obligacion[] {
  const noReq = perfil.no_requiere ?? {};
  return obligacionesVisibles(perfil).filter(
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
