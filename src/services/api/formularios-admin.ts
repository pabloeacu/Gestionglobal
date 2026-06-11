// API de gerencia para CRUD del Form Builder (Ronda 5, Agente E).
// Mantiene la separación: `formularios.ts` queda para el motor público
// (getPorSlug + submit + listGerencia legacy); acá viven los endpoints de
// creación/edición/versionado del constructor visual.
//
// Regla 4: ningún componente toca supabase.from() directamente.
// Regla 11: las queries usan índices ya existentes (slug, categoria, id).

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';
import type {
  FormularioFieldDef,
  FormularioRow,
  FormularioSchemaDef,
} from '@/services/api/formularios';

export type FormularioVersionRow =
  Database['public']['Tables']['formulario_versiones']['Row'];

export interface CrearFormularioInput {
  slug: string;
  titulo: string;
  categoria: string;
  descripcion?: string;
  schema?: FormularioSchemaDef;
}

// Bloque J / obs 14 (ampliado 2026-05-29): TODO formulario arranca con la
// identidad estándar de 6 campos OBLIGATORIOS. Son los keys que la plataforma
// usa para identificar clientes, hacer cross-match con administraciones y
// poblar el perfil. Apellido y Nombre van por separado para poder normalizar
// y comparar correctamente. El operador puede agregar más campos arriba o
// abajo, pero estos seis son inmutables (el builder los marca como protegidos
// y la migración 0133 los garantiza en todos los formularios existentes).
//
// El edge function `submit-formulario` los re-valida en el server (defensa
// en profundidad). Cross-match usa email > cuit > dni (RPC
// `solicitud_match_cliente`, mig 0115).
export const IDENTIDAD_FIELD_NAMES = [
  'apellido', 'nombre', 'dni', 'cuit', 'email', 'celular',
] as const;

export const IDENTIDAD_FIELDS: FormularioFieldDef[] = [
  { name: 'apellido', type: 'text',  label: 'Apellido',           required: true, placeholder: 'García' },
  { name: 'nombre',   type: 'text',  label: 'Nombre',             required: true, placeholder: 'Diego' },
  { name: 'dni',      type: 'text',  label: 'DNI',                required: true, placeholder: 'Sin puntos' },
  { name: 'cuit',     type: 'text',  label: 'CUIT/CUIL',          required: true, placeholder: '11 dígitos sin guiones' },
  { name: 'email',    type: 'email', label: 'Correo electrónico', required: true, placeholder: 'tu@correo.com' },
  { name: 'celular',  type: 'tel',   label: 'Celular',            required: true, placeholder: '+54 11 5555-1234' },
];

const SCHEMA_VACIO: FormularioSchemaDef = {
  sections: [
    {
      title: 'Identificación',
      subtitle: 'Datos obligatorios para identificarte como cliente.',
      fields: IDENTIDAD_FIELDS.map((f) => ({ ...f })),
    },
  ],
  submit_label: 'Enviar',
};

// DGG-37 (JL-PREVIEW · 2026-06-02) · sube una imagen de ejemplo para un
// campo type=file (el "ojito" del runner). Devuelve la URL pública.
export async function subirImagenPreview(
  formularioId: string,
  fieldKey: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${formularioId}/${fieldKey}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeStorageKey(file.name)}`;
  const { error } = await supabase.storage
    .from('formulario-previews')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return fail('FORM_PREVIEW_UPLOAD', error.message, error);
  const { data } = supabase.storage.from('formulario-previews').getPublicUrl(path);
  return ok(data.publicUrl);
}

// DGG-34 R4 sweep · sube un archivo de "descarga" para un campo de tipo
// `file_download` en el builder (PropertiesPanel.tsx). Devuelve la URL pública.
export async function subirArchivoDescarga(
  formularioId: string,
  fieldKey: string,
  file: File,
): Promise<ApiResponse<string>> {
  // E-GG-40 sweep
  const { safeStorageKey } = await import('@/lib/storageKeys');
  const path = `${formularioId}/${fieldKey}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${safeStorageKey(file.name)}`;
  const { error } = await supabase.storage
    .from('formulario-descargas')
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) return fail('FORM_DESCARGA_UPLOAD', error.message, error);
  const { data } = supabase.storage.from('formulario-descargas').getPublicUrl(path);
  return ok(data.publicUrl);
}

export async function listFormulariosAdmin(): Promise<
  ApiResponse<FormularioRow[]>
> {
  const { data, error } = await supabase
    .from('formularios')
    .select('*')
    .order('orden', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) return fail('FORM_ADMIN_LIST', error.message, error);
  return ok(data ?? []);
}

export async function getFormularioPorId(
  id: string,
): Promise<ApiResponse<FormularioRow>> {
  const { data, error } = await supabase
    .from('formularios')
    .select('*')
    .eq('id', id)
    .single();
  if (error) return fail('FORM_ADMIN_GET', error.message, error);
  return ok(data);
}

export async function crearFormulario(
  input: CrearFormularioInput,
): Promise<ApiResponse<FormularioRow>> {
  const { data, error } = await supabase
    .from('formularios')
    .insert({
      slug: input.slug,
      titulo: input.titulo,
      categoria: input.categoria,
      descripcion: input.descripcion ?? null,
      schema: (input.schema ?? SCHEMA_VACIO) as unknown as Database['public']['Tables']['formularios']['Insert']['schema'],
      publico: true,
      activo: false,
    })
    .select('*')
    .single();
  if (error) return fail('FORM_ADMIN_CREATE', error.message, error);
  return ok(data);
}

export interface ActualizarFormularioInput {
  titulo?: string;
  descripcion?: string | null;
  categoria?: string;
  schema?: FormularioSchemaDef;
  activo?: boolean;
  publico?: boolean;
  textos_legales?: string | null;
  mensaje_confirmacion?: string;
  redirect_url_after?: string | null;
  notificar_a_emails?: string[];
  exige_aceptacion_terminos?: boolean;
  webinar_id?: string | null;
}

export async function actualizarFormulario(
  id: string,
  patch: ActualizarFormularioInput,
): Promise<ApiResponse<FormularioRow>> {
  const update: Database['public']['Tables']['formularios']['Update'] = {};
  if (patch.titulo !== undefined) update.titulo = patch.titulo;
  if (patch.descripcion !== undefined) update.descripcion = patch.descripcion;
  if (patch.categoria !== undefined) update.categoria = patch.categoria;
  if (patch.schema !== undefined) {
    update.schema = patch.schema as unknown as Database['public']['Tables']['formularios']['Update']['schema'];
  }
  if (patch.activo !== undefined) update.activo = patch.activo;
  if (patch.publico !== undefined) update.publico = patch.publico;
  if (patch.textos_legales !== undefined) update.textos_legales = patch.textos_legales;
  if (patch.mensaje_confirmacion !== undefined) update.mensaje_confirmacion = patch.mensaje_confirmacion;
  if (patch.redirect_url_after !== undefined) update.redirect_url_after = patch.redirect_url_after;
  if (patch.notificar_a_emails !== undefined) update.notificar_a_emails = patch.notificar_a_emails;
  if (patch.exige_aceptacion_terminos !== undefined) update.exige_aceptacion_terminos = patch.exige_aceptacion_terminos;
  if (patch.webinar_id !== undefined) update.webinar_id = patch.webinar_id;

  const { data, error } = await supabase
    .from('formularios')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('FORM_ADMIN_UPDATE', error.message, error);
  return ok(data);
}

export async function toggleActivo(
  id: string,
  activo: boolean,
): Promise<ApiResponse<FormularioRow>> {
  return actualizarFormulario(id, { activo });
}

// 4.A · autosave silencioso del builder. Escribe en `schema_draft` (NO en
// `schema`), de modo que NO dispara el trigger de versionado (mig 0034). El
// versionado real se reserva para "Guardar versión" (actualizarFormulario con
// schema). Devuelve el timestamp del guardado para el indicador "Guardado
// hace Xs".
export async function autosaveSchema(
  id: string,
  schema: FormularioSchemaDef,
): Promise<ApiResponse<{ at: string }>> {
  const at = new Date().toISOString();
  const { error } = await supabase
    .from('formularios')
    .update({
      schema_draft: schema as unknown as Database['public']['Tables']['formularios']['Update']['schema_draft'],
      schema_draft_at: at,
    })
    .eq('id', id);
  if (error) return fail('FORM_AUTOSAVE', error.message, error);
  return ok({ at });
}

// 4.A · "Guardar versión": promueve el schema actual (dispara versionado SQL) y
// limpia el draft pendiente. Es el actualizarFormulario con schema + reset de
// schema_draft en una sola escritura.
export async function guardarVersion(
  id: string,
  schema: FormularioSchemaDef,
): Promise<ApiResponse<FormularioRow>> {
  const { data, error } = await supabase
    .from('formularios')
    .update({
      schema: schema as unknown as Database['public']['Tables']['formularios']['Update']['schema'],
      schema_draft: null,
      schema_draft_at: null,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return fail('FORM_GUARDAR_VERSION', error.message, error);
  return ok(data);
}

export async function duplicarFormulario(
  id: string,
  nuevoSlug: string,
  nuevoTitulo: string,
): Promise<ApiResponse<FormularioRow>> {
  const origen = await getFormularioPorId(id);
  if (!origen.ok) return origen;
  const { data, error } = await supabase
    .from('formularios')
    .insert({
      slug: nuevoSlug,
      titulo: nuevoTitulo,
      categoria: origen.data.categoria,
      descripcion: origen.data.descripcion,
      schema: origen.data.schema as Database['public']['Tables']['formularios']['Insert']['schema'],
      publico: origen.data.publico,
      activo: false,
      textos_legales: origen.data.textos_legales,
      mensaje_confirmacion: origen.data.mensaje_confirmacion,
      notificar_a_emails: origen.data.notificar_a_emails,
    })
    .select('*')
    .single();
  if (error) return fail('FORM_ADMIN_DUPLICATE', error.message, error);
  return ok(data);
}

export async function eliminarFormulario(
  id: string,
): Promise<ApiResponse<{ id: string }>> {
  const { error } = await supabase
    .from('formularios')
    .delete()
    .eq('id', id);
  if (error) return fail('FORM_ADMIN_DELETE', error.message, error);
  return ok({ id });
}

export async function listVersiones(
  formularioId: string,
): Promise<ApiResponse<FormularioVersionRow[]>> {
  const { data, error } = await supabase
    .from('formulario_versiones')
    .select('*')
    .eq('formulario_id', formularioId)
    .order('version_num', { ascending: false });
  if (error) return fail('FORM_VER_LIST', error.message, error);
  return ok(data ?? []);
}

export async function restaurarVersion(
  formularioId: string,
  versionNum: number,
): Promise<ApiResponse<{ formulario_id: string }>> {
  const { data, error } = await supabase.rpc('restaurar_formulario_version', {
    p_formulario_id: formularioId,
    p_version_num: versionNum,
  });
  if (error) return fail('FORM_VER_RESTORE', error.message, error);
  return ok({ formulario_id: String(data) });
}

// Helpers para el constructor visual ---------------------------------------

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// 4.F · validador de schema en tiempo real. Detecta problemas que de otro modo
// sólo aparecen en runtime público. Cada advertencia trae una referencia
// (sectionIdx/fieldIdx) para hacer scroll al campo desde el popover.
export type SchemaWarningKind =
  | 'condition_huerfana'
  | 'name_duplicado'
  | 'max_files_inconsistente'
  | 'seccion_vacia'
  | 'name_vacio';

export interface SchemaWarning {
  kind: SchemaWarningKind;
  mensaje: string;
  sectionIdx: number;
  fieldIdx?: number;
}

// Presentacionales (sin dato/sin key). Incluye file_download + costos_info para
// alinear con el runner y la validación required (F5 · consistencia de skip-lists).
const TIPOS_SIN_NAME = ['separator', 'heading', 'html', 'file_download', 'costos_info'];

export function validarSchema(schema: FormularioSchemaDef): SchemaWarning[] {
  const out: SchemaWarning[] = [];
  // names existentes (para detectar conditions huérfanas).
  const namesPresentes = new Set<string>();
  const nameCount = new Map<string, number>();
  schema.sections.forEach((sec) => {
    sec.fields.forEach((f) => {
      if (f.name && !TIPOS_SIN_NAME.includes(f.type)) {
        namesPresentes.add(f.name);
        nameCount.set(f.name, (nameCount.get(f.name) ?? 0) + 1);
      }
    });
  });

  schema.sections.forEach((sec, si) => {
    // Sección vacía.
    if (sec.fields.length === 0) {
      out.push({
        kind: 'seccion_vacia',
        mensaje: `La sección "${sec.title ?? `#${si + 1}`}" no tiene campos.`,
        sectionIdx: si,
      });
    }
    sec.fields.forEach((f, fi) => {
      const esVisible = !TIPOS_SIN_NAME.includes(f.type);
      // Name vacío.
      if (esVisible && !f.name) {
        out.push({
          kind: 'name_vacio',
          mensaje: `Campo "${f.label || `#${fi + 1}`}" sin key interna.`,
          sectionIdx: si,
          fieldIdx: fi,
        });
      }
      // Name duplicado.
      if (f.name && (nameCount.get(f.name) ?? 0) > 1) {
        out.push({
          kind: 'name_duplicado',
          mensaje: `Key duplicada: "${f.name}".`,
          sectionIdx: si,
          fieldIdx: fi,
        });
      }
      // Condition huérfana.
      if (f.condition?.field && !namesPresentes.has(f.condition.field)) {
        out.push({
          kind: 'condition_huerfana',
          mensaje: `"${f.label || f.name}" depende de un campo inexistente ("${f.condition.field}").`,
          sectionIdx: si,
          fieldIdx: fi,
        });
      }
      // max_files inconsistente: requerido pero permite 0 archivos.
      if (
        f.type === 'file' &&
        f.required &&
        typeof f.max_files === 'number' &&
        f.max_files < 1
      ) {
        out.push({
          kind: 'max_files_inconsistente',
          mensaje: `"${f.label || f.name}" es obligatorio pero permite 0 archivos.`,
          sectionIdx: si,
          fieldIdx: fi,
        });
      }
    });
  });

  // Dedup de duplicados (sólo una advertencia por name duplicado).
  const seen = new Set<string>();
  return out.filter((w) => {
    if (w.kind !== 'name_duplicado') return true;
    const key = `dup:${w.mensaje}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Garantiza un `name` único de campo dentro del schema (autosugerido desde
// el label). El builder lo usa para no permitir colisiones al editar.
export function ensureUniqueFieldName(
  schema: FormularioSchemaDef,
  candidate: string,
  ignoreName?: string,
): string {
  const taken = new Set<string>();
  for (const s of schema.sections) {
    for (const f of s.fields) {
      if (f.name && f.name !== ignoreName) taken.add(f.name);
    }
  }
  let base = slugify(candidate).replace(/-/g, '_') || 'campo';
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
