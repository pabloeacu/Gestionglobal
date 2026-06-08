// Helpers del schema de formularios (builder). Única fuente de verdad para
// resolver el slug de un campo (`name`) a su etiqueta humana (`label`/consigna).
//
// Usado por:
//  - SolicitudDetailPage: render del payload en orden con etiquetas legibles.
//  - Wizard Paso 2 (PasoDocumentacion): "referencia del campo" por cada adjunto
//    ("DNI Frente: archivo.jpg") — Pablo 2026-06-08.
//
// El espejo server-side (panel del gestor + mail al gestor) vive en
// `private.form_field_label(schema, slug)` (mig 0208). Mantener ambos en sync.

/** "dni_solicitante" → "Dni solicitante". Fallback cuando el campo no trae label. */
export function humanizeFieldName(key: string): string {
  const base = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export type CampoSchema = { name: string; label: string };

/**
 * Extrae la lista de campos `{name,label}` recorriendo el árbol del schema.
 * Tolera shapes distintos (fields / secciones / sections / campos). Si un campo
 * no trae `label`, humaniza el `name`.
 */
export function camposDelSchema(schema: unknown): CampoSchema[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: CampoSchema[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.name === 'string') {
      out.push({
        name: obj.name,
        label:
          typeof obj.label === 'string' && obj.label.trim()
            ? obj.label
            : humanizeFieldName(obj.name),
      });
    }
    if (Array.isArray(obj.fields)) obj.fields.forEach(visit);
    if (Array.isArray(obj.secciones)) obj.secciones.forEach(visit);
    if (Array.isArray(obj.sections)) obj.sections.forEach(visit);
    if (Array.isArray(obj.campos)) obj.campos.forEach(visit);
  };
  visit(schema);
  return out;
}

/** Mapa `slug → label` listo para lookups O(1). La primera aparición gana. */
export function fieldLabelMap(schema: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of camposDelSchema(schema)) {
    if (!(c.name in map)) map[c.name] = c.label;
  }
  return map;
}

/** Resuelve un slug a su etiqueta usando el mapa; si falta, humaniza el slug. */
export function labelDeCampo(map: Record<string, string>, name: string): string {
  return map[name] ?? humanizeFieldName(name);
}
