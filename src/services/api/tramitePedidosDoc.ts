// tramitePedidosDoc · N2 · sistema de pedidos de documentación al cliente.
// Gerencia/gestoría crea pedido con items; cliente sube por item; gerencia
// aprueba o rechaza por item. Cuando todos los items están aprobados, el
// pedido se cierra automáticamente y el cliente recibe push + email.

import { supabase } from '@/lib/supabase';
import { ok, fail, type ApiResponse } from '@/lib/errors';
import type { Database } from '@/types/database';

const rpc = supabase.rpc.bind(supabase);

export type PedidoDocRow = Database['public']['Tables']['tramite_pedidos_doc']['Row'];
export type PedidoDocItemRow = Database['public']['Tables']['tramite_pedidos_doc_items']['Row'];

export interface PedidoDocConItems extends PedidoDocRow {
  items: PedidoDocItemRow[];
}

const BUCKET = 'pedidos-doc-cliente';

// Lista todos los pedidos de un trámite, ordenados por fecha (más recientes
// primero), con sus items embebidos. Útil para gerencia y para el portal.
export async function listPedidosPorTramite(
  tramiteId: string,
): Promise<ApiResponse<PedidoDocConItems[]>> {
  const { data: pedidos, error } = await supabase
    .from('tramite_pedidos_doc')
    .select('*')
    .eq('tramite_id', tramiteId)
    .order('creado_at', { ascending: false });
  if (error) return fail('PEDIDOS_LIST', error.message, error);

  if (!pedidos || pedidos.length === 0) return ok([]);

  const { data: items, error: errItems } = await supabase
    .from('tramite_pedidos_doc_items')
    .select('*')
    .in('pedido_id', pedidos.map(p => p.id))
    .order('orden', { ascending: true });
  if (errItems) return fail('PEDIDOS_ITEMS', errItems.message, errItems);

  const itemsByPedido = new Map<string, PedidoDocItemRow[]>();
  for (const it of items ?? []) {
    const arr = itemsByPedido.get(it.pedido_id) ?? [];
    arr.push(it);
    itemsByPedido.set(it.pedido_id, arr);
  }

  return ok(
    pedidos.map(p => ({ ...p, items: itemsByPedido.get(p.id) ?? [] })),
  );
}

// Crea un pedido nuevo (gerencia). Recibe items como array de descripciones.
export async function crearPedidoDoc(
  tramiteId: string,
  descripcion: string,
  items: string[],
): Promise<ApiResponse<{ pedidoId: string }>> {
  const { data, error } = await rpc('tramite_pedido_doc_crear', {
    p_tramite_id: tramiteId,
    p_descripcion: descripcion,
    p_items: items,
  });
  if (error) return fail('PEDIDO_CREAR', error.message, error);
  return ok({ pedidoId: data as string });
}

// Cliente sube archivo a un item. Devuelve URL pública firmada (1h) tras subir.
// El path es <tramite_id>/<pedido_id>/<item_id>/<filename> para cumplir RLS.
export async function subirArchivoItem(
  itemId: string,
  tramiteId: string,
  pedidoId: string,
  file: File,
): Promise<ApiResponse<{ path: string }>> {
  const ext = file.name.split('.').pop() ?? 'bin';
  const path = `${tramiteId}/${pedidoId}/${itemId}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return fail('UPLOAD_ITEM', upErr.message, upErr);

  const { error: rpcErr } = await rpc('tramite_pedido_doc_subir_item', {
    p_item_id: itemId,
    p_archivo_path: path,
    p_archivo_nombre: file.name,
    p_archivo_mime: file.type || 'application/octet-stream',
    p_archivo_size: file.size,
  });
  if (rpcErr) return fail('ITEM_REGISTRAR', rpcErr.message, rpcErr);

  return ok({ path });
}

// Gerencia aprueba un item subido. Si era el último, cierra el pedido auto.
export async function aprobarItem(
  itemId: string,
): Promise<ApiResponse<true>> {
  const { error } = await rpc('tramite_pedido_doc_aprobar_item', {
    p_item_id: itemId,
  });
  if (error) return fail('ITEM_APROBAR', error.message, error);
  return ok(true);
}

// Gerencia rechaza un item subido (cliente debe subirlo de nuevo).
export async function rechazarItem(
  itemId: string,
  motivo: string,
): Promise<ApiResponse<true>> {
  const { error } = await rpc('tramite_pedido_doc_rechazar_item', {
    p_item_id: itemId,
    p_motivo: motivo,
  });
  if (error) return fail('ITEM_RECHAZAR', error.message, error);
  return ok(true);
}

// Devuelve URL firmada (válida 1h) para descargar el archivo de un item.
// Usada por gerencia para revisar lo subido por el cliente, y por el cliente
// para descargar lo que él mismo subió.
export async function getArchivoUrl(
  path: string,
): Promise<ApiResponse<string>> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error) return fail('SIGN_URL', error.message, error);
  return ok(data.signedUrl);
}
