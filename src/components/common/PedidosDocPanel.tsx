// PedidosDocPanel · N2 · Panel reutilizable para mostrar los pedidos de
// documentación de un trámite con sus items. Variante "gerente" muestra
// botones de aprobar/rechazar por item; variante "cliente" muestra el
// botón de subir archivo. Realtime sobre la tabla — si el cliente sube algo,
// la vista de gerencia se actualiza sola.
//
// Uso:
//   <PedidosDocPanel tramiteId={id} variant="gerente" />
//   <PedidosDocPanel tramiteId={id} variant="cliente" />

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck,
  Upload,
  Check,
  X,
  FileText,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Eye,
  Send,
  MessageSquareText,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { usePrompt } from './DialogProvider';
import { Button } from './Button';
import { Modal } from './Modal';
import { cn } from '@/lib/cn';
import {
  listPedidosPorTramite,
  crearPedidoDoc,
  subirArchivoItem,
  responderTextoItem,
  enviarRevisionPedido,
  aprobarItem,
  rechazarItem,
  getArchivoUrl,
  type PedidoDocConItems,
  type PedidoDocItemRow,
} from '@/services/api/tramitePedidosDoc';
import { humanizeError } from '@/lib/errors';

interface PedidosDocPanelProps {
  tramiteId: string;
  variant: 'gerente' | 'cliente';
  /** Códigos opcionales para mostrar contextual (ej: 'TRM-2026-0099'). */
  tramiteLabel?: string;
}

export function PedidosDocPanel({ tramiteId, variant, tramiteLabel }: PedidosDocPanelProps) {
  const [pedidos, setPedidos] = useState<PedidoDocConItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    const res = await listPedidosPorTramite(tramiteId);
    if (res.ok) setPedidos(res.data);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    void refresh();
    // Realtime: pedidos + items
    const ch = supabase
      .channel(`pedidos-doc-${tramiteId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'tramite_pedidos_doc', filter: `tramite_id=eq.${tramiteId}` },
          () => { void refresh(); })
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'tramite_pedidos_doc_items' },
          () => { void refresh(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tramiteId]);

  const abiertos = useMemo(() => pedidos.filter(p => p.estado === 'abierto'), [pedidos]);
  const cerrados = useMemo(() => pedidos.filter(p => p.estado !== 'abierto'), [pedidos]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-brand-muted">
        <Loader2 size={14} className="animate-spin" />
        Cargando pedidos de documentación…
      </div>
    );
  }

  // Si no hay pedidos y es cliente, no mostramos nada (no tiene nada que hacer)
  if (variant === 'cliente' && pedidos.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="kicker text-amber-600">
            {variant === 'gerente' ? 'Documentación · gerencia' : 'Documentación pendiente'}
          </p>
          <h2 className="font-display text-lg font-bold text-brand-ink">
            Pedidos de documentación
          </h2>
        </div>
        {variant === 'gerente' && (
          <Button onClick={() => setCreating(true)}>
            <Plus size={14} />
            Pedir documentación
          </Button>
        )}
      </header>

      {/* Banner para cliente cuando hay algo abierto */}
      {variant === 'cliente' && abiertos.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 flex-none text-amber-600" />
            <div>
              <p className="font-semibold">Necesitamos documentación adicional</p>
              <p className="mt-0.5 text-xs">
                Para avanzar con este trámite, respondé lo solicitado: subí el archivo o escribí el dato pedido. Una vez aprobado, el equipo continúa el proceso automáticamente.
              </p>
            </div>
          </div>
        </div>
      )}

      {pedidos.length === 0 && variant === 'gerente' && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-brand-muted">
          Sin pedidos de documentación. Crear uno cuando el cliente deba subir o reemplazar archivos.
        </div>
      )}

      {abiertos.map(p => (
        <PedidoCard key={p.id} pedido={p} variant={variant} onChange={refresh} />
      ))}

      {cerrados.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Pedidos cerrados ({cerrados.length})
          </summary>
          <div className="mt-3 space-y-3">
            {cerrados.map(p => (
              <PedidoCard key={p.id} pedido={p} variant={variant} onChange={refresh} closed />
            ))}
          </div>
        </details>
      )}

      <CrearPedidoModal
        open={creating}
        tramiteId={tramiteId}
        tramiteLabel={tramiteLabel}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); void refresh(); }}
      />
    </section>
  );
}

// ----------------------------------------------------------------------------

function PedidoCard({
  pedido,
  variant,
  onChange,
  closed,
}: {
  pedido: PedidoDocConItems;
  variant: 'gerente' | 'cliente';
  onChange: () => Promise<void>;
  closed?: boolean;
}) {
  const [enviando, setEnviando] = useState(false);
  const totales = useMemo(() => {
    let aprobados = 0, subidos = 0, pendientes = 0, rechazados = 0;
    for (const it of pedido.items) {
      if (it.estado === 'aprobado') aprobados++;
      else if (it.estado === 'subido') subidos++;
      else if (it.estado === 'rechazado') rechazados++;
      else pendientes++;
    }
    return { aprobados, subidos, pendientes, rechazados, total: pedido.items.length };
  }, [pedido.items]);

  // M2 · Cliente puede enviar a revisión cuando todos los items tienen archivo
  // y aún no se envió este batch (o gerencia rechazó un item y vuelve a estar
  // disponible). enviado_para_revision_at = NULL → todavía no enviado.
  const yaEnviadoParaRevision = pedido.enviado_para_revision_at != null;
  // DGG-89 · un item está "respondido" si pasó de pendiente (subió archivo O
  // respondió texto → estado 'subido'/'aprobado'/'rechazado').
  const todosRespondidos = totales.pendientes === 0 && totales.total > 0;
  const puedeEnviarRevision =
    variant === 'cliente'
    && !closed
    && todosRespondidos
    && !yaEnviadoParaRevision;

  async function handleEnviarRevision() {
    setEnviando(true);
    const res = await enviarRevisionPedido(pedido.id);
    setEnviando(false);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    toast.success('¡Listo! Recibimos tu documentación.', {
      description: 'Pronto tendremos novedades. Estate atento a tu portal. ¡Gracias!',
      duration: 6000,
    });
    void onChange();
  }

  return (
    <article className={cn(
      'rounded-xl border bg-white shadow-sm',
      closed ? 'border-slate-200 opacity-90' : 'border-amber-200',
    )}>
      <header className={cn(
        'flex items-start justify-between gap-3 border-b px-4 py-3',
        closed ? 'border-slate-200 bg-slate-50' : 'border-amber-100 bg-amber-50/50',
      )}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-brand-ink">{pedido.descripcion}</p>
          <p className="mt-0.5 text-[11px] text-brand-muted">
            Creado el {new Date(pedido.creado_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })}
            {' · '}
            {totales.aprobados}/{totales.total} aprobados
            {totales.rechazados > 0 && (<span className="text-red-600"> · {totales.rechazados} observado{totales.rechazados !== 1 && 's'}</span>)}
          </p>
        </div>
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          pedido.estado === 'completo' && 'bg-emerald-100 text-emerald-700',
          pedido.estado === 'abierto'   && 'bg-amber-100 text-amber-700',
          pedido.estado === 'cancelado' && 'bg-slate-100 text-slate-600',
        )}>
          {pedido.estado === 'completo' && <CheckCircle2 size={11} />}
          {pedido.estado === 'abierto'   && <ClipboardCheck size={11} />}
          {pedido.estado === 'completo' ? 'Completo' : pedido.estado === 'abierto' ? 'Abierto' : 'Cancelado'}
        </span>
      </header>

      <ul className="divide-y divide-slate-100">
        {pedido.items.map(item => (
          <PedidoItem
            key={item.id}
            item={item}
            tramiteId={pedido.tramite_id}
            pedidoId={pedido.id}
            variant={variant}
            onChange={onChange}
          />
        ))}
      </ul>

      {/* M2 · Footer cliente: estado y CTA Enviar a gerencia */}
      {variant === 'cliente' && !closed && (
        <footer className={cn(
          'flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3',
          puedeEnviarRevision ? 'border-amber-200 bg-amber-50/50' :
          yaEnviadoParaRevision ? 'border-emerald-100 bg-emerald-50/50' :
          'border-slate-100 bg-slate-50/50',
        )}>
          {yaEnviadoParaRevision ? (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 size={13} />
              <span>
                <strong>Documentación enviada.</strong> El equipo está revisando los archivos. Te avisamos por email + portal cuando esté listo.
              </span>
            </p>
          ) : todosRespondidos ? (
            <p className="text-xs text-amber-800">
              Ya respondiste todo lo pedido. Hacé click en <strong>Enviar a gerencia</strong> para que el equipo lo revise.
            </p>
          ) : (
            <p className="text-xs text-brand-muted">
              Faltan <strong>{totales.pendientes}</strong> ítem(s) por responder — subí el archivo o escribí el dato. Cuando estén todos, podrás enviar el lote para revisión.
            </p>
          )}
          {puedeEnviarRevision && (
            <button
              type="button"
              onClick={() => void handleEnviarRevision()}
              disabled={enviando}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
            >
              {enviando ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Enviar a gerencia
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

// ----------------------------------------------------------------------------

function PedidoItem({
  item,
  tramiteId,
  pedidoId,
  variant,
  onChange,
}: {
  item: PedidoDocItemRow;
  tramiteId: string;
  pedidoId: string;
  variant: 'gerente' | 'cliente';
  onChange: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [texto, setTexto] = useState(item.respuesta_texto ?? '');
  const [savingTexto, setSavingTexto] = useState(false);
  const prompt = usePrompt();

  async function handleUpload(file: File) {
    setUploading(true);
    const res = await subirArchivoItem(item.id, tramiteId, pedidoId, file);
    if (!res.ok) toast.error(humanizeError(res.error));
    else toast.success('Archivo subido · esperando aprobación');
    setUploading(false);
    void onChange();
  }

  // DGG-89 · responder el item con un dato (texto) en vez de archivo.
  async function handleResponderTexto() {
    const t = texto.trim();
    if (!t) return;
    setSavingTexto(true);
    const res = await responderTextoItem(item.id, t);
    if (!res.ok) toast.error(humanizeError(res.error));
    else toast.success('Respuesta enviada · esperando aprobación');
    setSavingTexto(false);
    void onChange();
  }

  async function handleVerArchivo() {
    if (!item.archivo_path) return;
    const res = await getArchivoUrl(item.archivo_path);
    if (!res.ok) { toast.error(humanizeError(res.error)); return; }
    window.open(res.data, '_blank', 'noopener,noreferrer');
  }

  async function handleAprobar() {
    setBusy(true);
    const res = await aprobarItem(item.id);
    if (!res.ok) toast.error(humanizeError(res.error));
    else toast.success('Item aprobado');
    setBusy(false);
    void onChange();
  }

  async function handleRechazar() {
    const motivo = await prompt({
      title: 'Rechazar este archivo',
      message: '¿Qué tiene que corregir el cliente? El motivo se le muestra y debe volver a subir.',
      placeholder: 'Ej: la foto está borrosa, falta firma, está vencido…',
      confirmLabel: 'Rechazar archivo',
    });
    if (!motivo) return;
    setBusy(true);
    const res = await rechazarItem(item.id, motivo);
    if (!res.ok) toast.error(humanizeError(res.error));
    else toast.success('Archivo rechazado · cliente notificado');
    setBusy(false);
    void onChange();
  }

  const itemBadge = cn(
    'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
    item.estado === 'aprobado' && 'bg-emerald-100 text-emerald-700',
    item.estado === 'subido'   && 'bg-blue-100 text-blue-700',
    item.estado === 'rechazado'&& 'bg-red-100 text-red-700',
    item.estado === 'pendiente'&& 'bg-amber-100 text-amber-700',
  );

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-brand-ink">{item.descripcion}</p>
          {item.archivo_nombre && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-brand-muted">
              <FileText size={11} />
              {item.archivo_nombre}
              {item.archivo_size_bytes && (<span> · {formatBytes(item.archivo_size_bytes)}</span>)}
            </p>
          )}
          {item.respuesta_texto && (
            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-slate-700">
              <MessageSquareText size={11} className="mt-0.5 flex-none text-brand-cyan" />
              <span className="whitespace-pre-wrap break-words">{item.respuesta_texto}</span>
            </p>
          )}
          {item.observaciones_rev && item.estado === 'rechazado' && (
            <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              <strong>Motivo del rechazo:</strong> {item.observaciones_rev}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={itemBadge}>
            {item.estado === 'pendiente' && 'Pendiente'}
            {item.estado === 'subido'    && (item.respuesta_texto && !item.archivo_path ? 'Respondido' : 'Subido')}
            {item.estado === 'aprobado'  && 'Aprobado'}
            {item.estado === 'rechazado' && 'Observado'}
          </span>

          {/* Acciones según variante */}
          <div className="flex items-center gap-1">
            {variant === 'cliente' && item.estado !== 'aprobado' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                >
                  {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  {item.estado === 'pendiente' ? 'Subir' : 'Reemplazar'}
                </button>
              </>
            )}

            {variant === 'gerente' && item.archivo_path && (
              <button
                type="button"
                onClick={handleVerArchivo}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
              >
                <Eye size={11} /> Ver
              </button>
            )}

            {variant === 'gerente' && item.estado === 'subido' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAprobar()}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  <Check size={11} /> Aprobar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRechazar()}
                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  <X size={11} /> Rechazar
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* DGG-89 · El cliente puede responder con un DATO (texto) en vez de —o
          además de— subir un archivo. Nunca queda trabado si le piden un número. */}
      {variant === 'cliente' && item.estado !== 'aprobado' && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleResponderTexto(); } }}
            placeholder="O escribí el dato pedido (ej: número de legajo)"
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
          />
          <button
            type="button"
            disabled={savingTexto || !texto.trim()}
            onClick={() => void handleResponderTexto()}
            className="inline-flex flex-none items-center gap-1 rounded-md border border-brand-cyan/30 bg-brand-cyan-pale/40 px-2.5 py-1.5 text-[11px] font-semibold text-brand-cyan hover:bg-brand-cyan-pale disabled:opacity-50"
          >
            {savingTexto ? <Loader2 size={11} className="animate-spin" /> : <MessageSquareText size={11} />}
            {item.respuesta_texto ? 'Actualizar' : 'Responder'}
          </button>
        </div>
      )}
    </li>
  );
}

// ----------------------------------------------------------------------------

function CrearPedidoModal({
  open,
  tramiteId,
  tramiteLabel,
  onClose,
  onCreated,
}: {
  open: boolean;
  tramiteId: string;
  tramiteLabel?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [descripcion, setDescripcion] = useState('');
  const [items, setItems] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  function reset() {
    setDescripcion('');
    setItems(['']);
  }

  async function handleSave() {
    const itemsLimpios = items.map(s => s.trim()).filter(Boolean);
    if (itemsLimpios.length === 0) {
      toast.error('Agregá al menos un item');
      return;
    }
    setSaving(true);
    const res = await crearPedidoDoc(tramiteId, descripcion, itemsLimpios);
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Pedido de documentación creado · cliente notificado');
    reset();
    onCreated();
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Solicitar documentación al cliente"
      kicker={tramiteLabel ?? 'Trámite'}
      icon={<ClipboardCheck size={18} className="text-amber-600" />}
      width={580}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { reset(); onClose(); }} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Crear pedido y notificar
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Descripción general (opcional)
          </label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Contexto breve, por ejemplo: 'Para iniciar la matriculación necesitamos completar lo siguiente.'"
            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
            rows={2}
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Items requeridos
          </label>
          <p className="mt-0.5 mb-2 text-[11px] text-brand-muted">
            Uno por línea. Sé específico — el cliente puede responder cada uno con un dato (texto) o subiendo un archivo.
          </p>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="mt-2 text-xs font-mono text-brand-muted w-5 text-right">{idx + 1}.</span>
                <input
                  type="text"
                  value={it}
                  onChange={(e) => {
                    const copy = [...items];
                    copy[idx] = e.target.value;
                    setItems(copy);
                  }}
                  placeholder={
                    idx === 0
                      ? 'Ej: Comprobante de pago del servicio'
                      : idx === 1
                        ? 'Ej: DNI del titular (frente y dorso en un solo PDF)'
                        : 'Ej: Última factura de luz como prueba de domicilio'
                  }
                  className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                />
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                    className="mt-1 text-brand-muted hover:text-red-600"
                    title="Quitar item"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setItems([...items, ''])}
              className="text-xs font-medium text-brand-cyan hover:underline"
            >
              + Agregar otro item
            </button>
          </div>
        </div>

        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <strong>Aviso al cliente:</strong> se enviará email + notificación al portal y al push del cliente con el detalle. Mientras haya items pendientes, el trámite queda en estado "esperando docs del cliente".
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
