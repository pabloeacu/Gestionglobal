import { supabase } from '@/lib/supabase';
import { ok, fail, toApiError, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

// Accesos externos sin login (Documento Maestro punto 7 + #30 backlog).
// Tabla: accesos_externos (migración 0037). Sólo staff escribe; G1 (Wizard)
// consume `generar_acceso_externo` para mandar URLs públicas firmadas.

export type AccesoExternoRow = Database['public']['Tables']['accesos_externos']['Row'];

export type RecursoTipo = 'tramite' | 'solicitud' | 'tracking' | 'documento';

// DGG-138 (2026-08-14): política de vigencia del enlace externo — 20 días
// RENOVABLES. Cada envío de aviso a la gestoría y cada visita del gestor
// renuevan a GREATEST(vence_at, now()+20d) del lado del server. Este valor
// espeja los DEFAULT de las RPCs (mig 0423); cambiarlo requiere migración.
export const DIAS_VALIDEZ_ENLACE_EXTERNO = 20;

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
      p_dias_validez: input.diasValidez ?? DIAS_VALIDEZ_ENLACE_EXTERNO,
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

// DGG-139 · Compartir un tracking con el cliente: genera el token Y encola el
// email con el link (RPC tramite_compartir_acceso, multi-tabla → R5). El modal
// promete "lo recibe por mail" — ahora es verdad.
export async function compartirAccesoTramite(input: {
  tramiteId: string;
  email: string;
  nombre?: string | null;
  dias?: number;
  observaciones?: string | null;
}): Promise<ApiResponse<{ token: string; url: string }>> {
  try {
    const args = {
      p_tramite_id: input.tramiteId,
      p_email: input.email,
      p_nombre: input.nombre ?? null,
      p_dias: input.dias ?? DIAS_VALIDEZ_ENLACE_EXTERNO,
      p_observaciones: input.observaciones ?? null,
    } as unknown as {
      p_tramite_id: string;
      p_email: string;
      p_nombre: string;
      p_dias: number;
      p_observaciones: string;
    };
    const { data, error } = await supabase.rpc('tramite_compartir_acceso', args);
    if (error) throw error;
    const res = data as unknown as { token: string; url: string };
    return ok({ token: res.token, url: res.url });
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// 5.C · acceso + agregado de aperturas (badge "Visto N veces · última hace …").
export interface AccesoConAperturas extends AccesoExternoRow {
  total_aperturas: number;
  ultima_apertura: string | null;
}

export async function listAccesosDeRecurso(
  tipo: RecursoTipo,
  id: string,
): Promise<ApiResponse<AccesoConAperturas[]>> {
  try {
    const { data, error } = await supabase
      .from('accesos_externos')
      .select('*')
      .eq('recurso_tipo', tipo)
      .eq('recurso_id', id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const accesos = (data ?? []) as AccesoExternoRow[];

    // 5.C · aperturas agregadas por token (vw_accesos_externos_aperturas).
    const tokens = accesos.map((a) => a.token);
    const aperturasByToken = new Map<
      string,
      { total: number; ultima: string | null }
    >();
    if (tokens.length > 0) {
      const { data: aps } = await supabase
        .from('vw_accesos_externos_aperturas')
        .select('token, total_aperturas, ultima_apertura')
        .in('token', tokens);
      for (const r of (aps ?? []) as Array<{
        token: string;
        total_aperturas: number;
        ultima_apertura: string | null;
      }>) {
        aperturasByToken.set(r.token, {
          total: r.total_aperturas,
          ultima: r.ultima_apertura,
        });
      }
    }

    return ok(
      accesos.map((a) => ({
        ...a,
        total_aperturas: aperturasByToken.get(a.token)?.total ?? 0,
        ultima_apertura: aperturasByToken.get(a.token)?.ultima ?? null,
      })),
    );
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

// 5.C · registra una apertura del link público. Se llama desde el front (anon)
// en el useEffect inicial de AccesoExternoPage. RPC SD valida token vivo y
// trunca IP. No revela nada (no devuelve datos del recurso).
export async function registrarApertura(token: string): Promise<void> {
  try {
    const ua =
      typeof navigator !== 'undefined' ? navigator.userAgent : null;
    // Los args opcionales aceptan NULL en PG pero pg-meta los tipa NOT NULL.
    const args = {
      p_token: token,
      p_user_agent: ua,
      p_ip: null, // la IP real no es visible desde el browser; queda NULL
    } as unknown as { p_token: string; p_user_agent: string; p_ip: string };
    await supabase.rpc('registrar_apertura_acceso', args);
  } catch {
    /* noop — el tracking de aperturas es best-effort, no debe romper la vista */
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
  // 5.B · contacto del gerente responsable (si el recurso lo tiene).
  responsable?: {
    nombre: string | null;
    email: string | null;
    telefono: string | null;
  } | null;
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

// =============================================================================
// #147 · Perfil Gestor: gestor (acceso externo) carga línea de avance
// =============================================================================

export interface GestorAvanceLinea {
  id: string;
  categoria_slug: string;
  categoria_label: string;
  categoria_icono: string;
  categoria_color: string;
  descripcion: string;
  archivos_urls: string[];
  autor_nombre: string;
  created_at: string;
}

/**
 * Lista líneas de avance previas del trámite asociado al token.
 * Da contexto al gestor antes de cargar su aporte. Pública (anon).
 */
export async function fetchGestorAvances(
  token: string,
): Promise<ApiResponse<GestorAvanceLinea[]>> {
  try {
    const { data, error } = await supabase.rpc(
      'gestor_listar_avances' as never,
      { p_token: token } as never,
    );
    if (error) throw error;
    return ok((data ?? []) as unknown as GestorAvanceLinea[]);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}

/**
 * El gestor carga su avance (F4). Inserta tracking_lineas con visible_cliente=false
 * y moderacion_estado='pendiente': el aporte queda en revisión de la gerencia, que
 * decide publicar/interno/descartar. El cliente NO se entera hasta que se publica.
 * Pública (anon, valida token).
 */
export async function gestorCargarAvance(
  token: string,
  descripcion: string,
  archivosUrls: string[] = [],
): Promise<ApiResponse<string>> {
  try {
    const args = {
      p_token: token,
      p_descripcion: descripcion,
      p_archivos_urls: archivosUrls,
    } as unknown as {
      p_token: string;
      p_descripcion: string;
      p_archivos_urls: string[];
    };
    const { data, error } = await supabase.rpc(
      'gestor_cargar_avance' as never,
      args as never,
    );
    if (error) throw error;
    return ok(data as unknown as string);
  } catch (e) {
    const err = toApiError(e);
    return fail(err.code, err.message, err.details);
  }
}
