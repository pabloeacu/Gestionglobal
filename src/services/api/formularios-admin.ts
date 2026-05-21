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

const SCHEMA_VACIO: FormularioSchemaDef = {
  sections: [
    {
      title: 'Primera sección',
      fields: [],
    },
  ],
  submit_label: 'Enviar',
};

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
