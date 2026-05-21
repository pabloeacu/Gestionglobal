import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// Accesos externos sin login (Documento Maestro punto 7 + #30 backlog).
// Tabla: accesos_externos (migración 0037). Sólo staff escribe; G1 (Wizard)
// consume `generar_acceso_externo` para mandar URLs públicas firmadas.

export type AccesoExternoRow = Database['public']['Tables']['accesos_externos']['Row'];

export type RecursoTipo = 'tramite' | 'solicitud' | 'tracking' | 'documento';

export interface GenerarAccesoInput {
  recursoTipo: RecursoTipo;
  recursoId: string;
  emailDestinatario: string;
  nombreDestinatario?: string | null;
  diasValidez?: number;
  observaciones?: string | null;
}

export async function generarAcceso(
  input: GenerarAccesoInput,
): Promise<ApiResponse<{ token: string; url: string }>> {
  try {
    const args = {
      p_recurso_tipo: input.recursoTipo,
      p_recurso_id: input.recursoId,
      p_email_destinatario: input.emailDestinatario,
      p_nombre_destinatario: input.nombreDestinatario ?? null,
      p_dias_validez: input.diasValidez ?? 14,
      p_observaciones: input.observaciones ?? null,
    } as unknown as {
      p_recurso_tipo: string;
      p_recurso_id: string;
      p_email_destinatario: string;
      p_nombre_destinatario: string;
      p_dias_validez: number;
      p_observaciones: string;
    };
    const { data, error } = await supabase.rpc('generar_acceso_externo', args);
    if (error) throw error;
    const token = String(data);
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://gestionglobal.ar';
    return ok({ token, url: `${origin}/externo/${token}` });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function listAccesosDeRecurso(
  tipo: RecursoTipo,
  id: string,
): Promise<ApiResponse<AccesoExternoRow[]>> {
  try {
    const { data, error } = await supabase
      .from('accesos_externos')
      .select('*')
      .eq('recurso_tipo', tipo)
      .eq('recurso_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ok((data ?? []) as AccesoExternoRow[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

export async function revocarAcceso(token: string): Promise<ApiResponse<null>> {
  try {
    const { error } = await supabase.rpc('revocar_acceso_externo', { p_token: token });
    if (error) throw error;
    return ok(null);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// Fetch público (sin login) usado por AccesoExternoPage.
// Va al edge function `acceso-externo` con anon key.
export interface AccesoExternoPayload {
  ok: boolean;
  acceso?: {
    tipo: RecursoTipo;
    destinatario: string;
    vence_at: string;
  };
  recurso?: Record<string, unknown> | null;
  historial?: unknown[];
  adjuntos?: { nombre: string; url: string }[];
  error?: { code: string; message: string };
}

export async function fetchAccesoExterno(
  token: string,
): Promise<ApiResponse<AccesoExternoPayload>> {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anon) {
      return fail('NO_CONFIG', 'Supabase no está configurado.');
    }
    const res = await fetch(`${url}/functions/v1/acceso-externo/${token}`, {
      method: 'GET',
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const body = (await res.json()) as AccesoExternoPayload;
    if (!res.ok || !body.ok) {
      return fail(
        body.error?.code ?? String(res.status),
        body.error?.message ?? 'No pudimos cargar este acceso.',
      );
    }
    return ok(body);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
