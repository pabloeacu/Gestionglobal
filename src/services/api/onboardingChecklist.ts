// Onboarding checklist · "Primeros 5 minutos" del gerente (J1).
// Se persiste en profiles.onboarding_checklist jsonb.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';

export type ChecklistKey =
  | 'crear_cliente'
  | 'registrar_tramite'
  | 'ver_agenda'
  | 'configurar_email'
  | 'instalar_pwa'
  | 'dismissed';

export type ChecklistState = Partial<Record<ChecklistKey, boolean>>;

export async function getChecklist(): Promise<ApiResponse<ChecklistState>> {
  // Hay que filtrar por auth.uid() porque la RLS de profiles permite a staff
  // ver TODOS los profiles → .single() rompía con "more than one row".
  // Resultado del bug: para cualquier gerente, la query fallaba y el componente
  // volvía a mostrar el asistente al refrescar el dashboard.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail('NO_SESSION', 'Sin sesión activa.');
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_checklist')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return fail('CHECKLIST_GET', error.message, error);
  return ok((data?.onboarding_checklist ?? {}) as ChecklistState);
}

export async function setChecklistItem(
  key: ChecklistKey,
  value: boolean,
): Promise<ApiResponse<ChecklistState>> {
  const { data, error } = await supabase.rpc('onboarding_checklist_set', {
    p_key: key,
    p_value: value,
  });
  if (error) return fail('CHECKLIST_SET', error.message, error);
  return ok((data ?? {}) as ChecklistState);
}
