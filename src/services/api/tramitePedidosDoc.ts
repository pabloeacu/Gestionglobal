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

// DGG-89 · Cliente (o gerencia) responde un item con TEXTO en vez de archivo
// (ej. "número de legajo"). Deja el item en 'subido' igual que una subida de
// archivo, para que entre en el flujo de aprobación. Cualquier item acepta
// texto o archivo — el cliente nunca queda trabado.
export async function responderTextoItem(
  itemId: string,
  texto: string,
): Promise<ApiResponse<true>> {
  const { error } = await rpc('tramite_pedido_doc_responder_texto_item', {
    p_item_id: itemId,
    p_texto: texto,
  });
  if (error) return fail('ITEM_RESPONDER_TEXTO', error.message, error);
  return ok(true);
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

// M2 · Cliente confirma y envía el batch de docs a gerencia. Recién aquí
// gerencia recibe notif (push + bell + email) y cliente recibe email
// "Recibimos tu documentación · pronto tendremos novedades".
export async function enviarRevisionPedido(
  pedidoId: string,
): Promise<ApiResponse<{ itemsEnviados: number }>> {
  const { data, error } = await rpc('tramite_pedido_doc_enviar_revision', {
    p_pedido_id: pedidoId,
  });
  if (error) return fail('PEDIDO_ENVIAR_REV', error.message, error);
  const result = data as { ok?: boolean; items_enviados?: number } | null;
  return ok({ itemsEnviados: result?.items_enviados ?? 0 });
}

// ============================================================================
// DGG-41 (2026-06-02 · José Luis): inventario unificado de adjuntos del
// trámite — incluye los archivos de pedidos_doc_items que antes quedaban
// invisibles en la tab Documentación.
//
// La tab leía solo `tracking_lineas.archivos_urls`, perdiendo los archivos
// que el cliente sube vía el flujo de Pedido de Documentación (bucket
// privado `pedidos-doc-cliente`, path en `archivo_path`). Esta función
// devuelve los items que tienen archivo subido con signed URL para que
// gerencia pueda verlos/descargarlos desde la tab.
// ============================================================================
export interface PedidoDocAdjunto {
  itemId: string;
  pedidoId: string;
  descripcion: string;      // descripción del item ("Comprobante de pago", etc)
  estado: string;            // 'pendiente' | 'subido' | 'aprobado' | 'rechazado'
  archivoNombre: string;     // nombre original del archivo
  archivoPath: string;       // path en el bucket privado
  url: string;               // signed URL (60 min)
  subidoAt: string | null;
  size: number | null;
  mime: string | null;
}

/**
 * Lista todos los items con archivo subido para un trámite, ya con
 * signed URL lista para descarga. Para la tab Documentación.
 */
export async function listAdjuntosPedidosDocDeTramite(
  tramiteId: string,
): Promise<ApiResponse<PedidoDocAdjunto[]>> {
  const { data: pedidos, error: ePed } = await supabase
    .from('tramite_pedidos_doc')
    .select('id')
    .eq('tramite_id', tramiteId);
  if (ePed) return fail('PEDIDOS_LIST', ePed.message, ePed);
  if (!pedidos || pedidos.length === 0) return ok([]);

  const { data: items, error: eItems } = await supabase
    .from('tramite_pedidos_doc_items')
    .select('id, pedido_id, descripcion, estado, archivo_nombre, archivo_path, archivo_mime, archivo_size_bytes, subido_at')
    .in('pedido_id', pedidos.map(p => p.id))
    .not('archivo_path', 'is', null);
  if (eItems) return fail('ITEMS_LIST', eItems.message, eItems);
  if (!items || items.length === 0) return ok([]);

  const out: PedidoDocAdjunto[] = [];
  for (const it of items) {
    if (!it.archivo_path) continue;
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(it.archivo_path, 3600);
    out.push({
      itemId: it.id,
      pedidoId: it.pedido_id,
      descripcion: it.descripcion,
      estado: it.estado,
      archivoNombre: it.archivo_nombre ?? 'archivo',
      archivoPath: it.archivo_path,
      url: signed?.signedUrl ?? '',
      subidoAt: it.subido_at,
      size: it.archivo_size_bytes,
      mime: it.archivo_mime,
    });
  }
  return ok(out);
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

// M1 · Para el cliente: lista pedidos abiertos en sus tramites (donde aún hay
// items pendientes O hay items rechazados a corregir). Si esto devuelve > 0,
// mostramos banner urgente en PortalHome.
export interface PedidoAbiertoResumen {
  pedido_id: string;
  tramite_id: string;
  tramite_codigo: string | null;
  tramite_titulo: string | null;
  descripcion: string;
  items_pendientes: number;
  items_rechazados: number;
  enviado_para_revision_at: string | null;
}
// E-GG-46 (2026-06-04 · auditoría E-GG-45): patrón estado-derivado-vs-propagado.
// El cierre del trámite (`tracking_cerrar`, DGG-38) NO marca como cerrados los
// pedidos de documentación que estaban abiertos para ese trámite — es por
// diseño (los pedidos quedan como registro histórico). Si no filtramos acá,
// el cliente ve el banner urgente "Necesitamos documentación" en PortalHome
// para un trámite que ya está cerrado/cancelado. Misma raíz que E-GG-45.
const TRAMITE_TERMINAL_PARA_BANNER = new Set(['cerrado', 'cancelado']);

export async function listPedidosAbiertosCliente(): Promise<ApiResponse<PedidoAbiertoResumen[]>> {
  // RLS ya filtra por administración del cliente. Sólo pedidos abiertos.
  const { data: pedidos, error } = await supabase
    .from('tramite_pedidos_doc')
    .select('id, tramite_id, descripcion, enviado_para_revision_at')
    .eq('estado', 'abierto')
    .order('creado_at', { ascending: false });
  if (error) return fail('PEDIDOS_ABIERTOS_LIST', error.message, error);
  if (!pedidos || pedidos.length === 0) return ok([]);

  const tramiteIds = Array.from(new Set(pedidos.map(p => p.tramite_id)));
  // E-GG-46: traemos también el estado del trámite para filtrar los que ya
  // están en estado terminal.
  const { data: tramites } = await supabase
    .from('tramites')
    .select('id, codigo, titulo, estado')
    .in('id', tramiteIds);
  const tmap = new Map<
    string,
    { codigo: string | null; titulo: string | null; estado: string }
  >();
  for (const t of tramites ?? []) {
    tmap.set(t.id, { codigo: t.codigo, titulo: t.titulo, estado: t.estado });
  }

  const { data: items } = await supabase
    .from('tramite_pedidos_doc_items')
    .select('pedido_id, estado')
    .in('pedido_id', pedidos.map(p => p.id));

  const stats = new Map<string, { pen: number; rej: number }>();
  for (const it of items ?? []) {
    const s = stats.get(it.pedido_id) ?? { pen: 0, rej: 0 };
    if (it.estado === 'pendiente') s.pen++;
    else if (it.estado === 'rechazado') s.rej++;
    stats.set(it.pedido_id, s);
  }

  // E-GG-46: filtramos los pedidos cuyo trámite ya está en estado terminal.
  // Si el cliente terminó su gestión, no le mostramos "te falta documentación".
  const resumen: PedidoAbiertoResumen[] = pedidos.flatMap(p => {
    const t = tmap.get(p.tramite_id);
    if (t && TRAMITE_TERMINAL_PARA_BANNER.has(t.estado)) return [];
    const st = stats.get(p.id) ?? { pen: 0, rej: 0 };
    return [{
      pedido_id: p.id,
      tramite_id: p.tramite_id,
      tramite_codigo: t?.codigo ?? null,
      tramite_titulo: t?.titulo ?? null,
      descripcion: p.descripcion,
      items_pendientes: st.pen,
      items_rechazados: st.rej,
      enviado_para_revision_at: p.enviado_para_revision_at,
    }];
  });
  return ok(resumen);
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
