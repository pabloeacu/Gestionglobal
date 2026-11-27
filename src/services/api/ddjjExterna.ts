import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Json } from '@/types/database';

// ============================================================================
// Service · Wizard autónomo "Presentación de DDJJ externa" (DGG-275 F4).
// Abre un trámite DDJJ (categoria 'dj', servicio rpac_ddjj) resolviendo o
// creando el cliente vía la RPC tramite_ddjj_externa_iniciar (mig 0753), que
// reusa el dup-check DGG-123 compartido (private.administracion_resolver_o_crear,
// mig 0752). NO crea el usuario de auth: eso es el edge alta-cliente-portal
// (idempotente), que el wizard invoca después con el administracion_id devuelto.
// El comprobante se emite al cierre (WizardCierreDdjj / F3), no acá.
// ============================================================================

/** Datos para crear un cliente nuevo (mismo molde que solicitudes.CrearClienteInput).
 *  Se omiten los vacíos; el dup-check DGG-123 corre server-side. */
export interface DdjjCrearClienteInput {
  nombre: string;
  cuit?: string | null;
  email?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  localidad?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  condicion_iva?: string | null;
  domicilio_fiscal?: string | null;
  responsable_nombre?: string | null;
  responsable_apellido?: string | null;
  observaciones?: string | null;
}

export interface DdjjExternaIniciarInput {
  /** Vincular a un cliente existente (excluyente con crearCliente). */
  clienteId?: string | null;
  /** Datos para dar de alta un cliente nuevo (excluyente con clienteId). */
  crearCliente?: DdjjCrearClienteInput | null;
  periodo?: string | null;
  fechaInicio?: string | null; // YYYY-MM-DD
}

export interface DdjjExternaResult {
  tramite_id: string;
  administracion_id: string;
  cliente_creado: boolean;
  servicio_id: string;
  email_cliente: string | null;
  nombre_cliente: string | null;
}

export async function iniciarDdjjExterna(
  input: DdjjExternaIniciarInput,
): Promise<ApiResponse<DdjjExternaResult>> {
  if (!input.clienteId && !input.crearCliente) {
    return fail('DDJJ_EXT_SIN_CLIENTE', 'Indicá un cliente existente o los datos para crear uno nuevo');
  }
  const { data, error } = await supabase.rpc('tramite_ddjj_externa_iniciar', {
    p_cliente_id: input.clienteId ?? null,
    p_crear_cliente_input: (input.crearCliente ?? null) as unknown as Json | null,
    p_periodo: input.periodo ?? null,
    p_fecha_inicio: input.fechaInicio ?? null,
  } as never);
  if (error) return fail('DDJJ_EXT_RPC', error.message, error);
  return ok(data as unknown as DdjjExternaResult);
}
