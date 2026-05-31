// ============================================================================
// NotificationBell · centro de notificaciones in-app (DGG-30 / P5-7.C)
//
// Campana en el header. Estado:
//   • Badge con count de no leídas (rojo + animate-bounce-soft).
//   • Click → dropdown 380px con lista de las últimas 20.
//   • Items: ícono por tipo, título, cuerpo, tiempo relativo, indicador
//            "no leído" (dot cyan), action "marcar como leído" (hover).
//   • Click en item → navegar (si tiene url) + marcar leído.
//   • Footer: "Marcar todas como leídas" + "Ver todas" (futuro deeplink).
//
// Realtime: suscripción a INSERT/UPDATE en `notificaciones_internas` para que
// el badge se actualice sin reload (la tabla ya está en la publication).
//
// Reglas 4 (sin .from() acá) + 13 (sin window.confirm; sólo toasts).
// ============================================================================

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellRing,
  Check,
  Inbox,
  Loader2,
  Sparkles,
  Briefcase,
  CalendarClock,
  FileText,
  Info,
  NotebookPen,
  Trash2,
  X,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  notifListar,
  notifMarcarLeida,
  notifArchivar,
  notifArchivarTodas,
  notifNoLeidasCount,
  type NotifItem,
} from '@/services/api/notificaciones';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Modal } from './Modal';

// Mapeo tipo → ícono + tinte del avatar.
interface TipoMeta { icon: LucideIcon; chip: string }
const FALLBACK_META: TipoMeta = { icon: Info, chip: 'bg-slate-100 text-slate-700' };
const TIPO_META: Record<string, TipoMeta> = {
  solicitud_nueva:     { icon: Sparkles,      chip: 'bg-cyan-50 text-cyan-700'      },
  tracking_cerrado:    { icon: Briefcase,     chip: 'bg-violet-50 text-violet-700'  },
  vencimiento_proximo: { icon: CalendarClock, chip: 'bg-rose-50 text-rose-700'      },
  comprobante_pagado:  { icon: FileText,      chip: 'bg-amber-50 text-amber-700'    },
  frase_dia:           { icon: NotebookPen,   chip: 'bg-amber-50 text-amber-700'    },
  sistema:             { icon: Info,          chip: 'bg-slate-100 text-slate-700'   },
};

function metaFor(tipo: string): TipoMeta {
  return TIPO_META[tipo] ?? FALLBACK_META;
}

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  });
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  // UX-CAMP-01 · Si el cuerpo está truncado en el listado, al hacer click
  // abrimos un modal con título + cuerpo completos (en vez de marcarlo leído
  // y perder la info). Detección via scrollWidth > clientWidth de cada cuerpo.
  const cuerpoRefs = useRef<Map<string, HTMLParagraphElement | null>>(new Map());
  const [truncatedIds, setTruncatedIds] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<NotifItem | null>(null);

  // Recalcular truncados después de que los items rendericen.
  // Depende también de anchorRect: el dropdown sólo se monta cuando anchorRect
  // existe (createPortal), y los refs se attachan en ese momento. Sin esta
  // dep, en el primer open la medición corre antes de tener los refs en el
  // DOM y el Set queda vacío para siempre.
  useLayoutEffect(() => {
    if (!open || !anchorRect) return;
    const truncated = new Set<string>();
    cuerpoRefs.current.forEach((el, id) => {
      if (el && el.scrollWidth > el.clientWidth + 1) truncated.add(id);
    });
    setTruncatedIds(truncated);
  }, [open, items, anchorRect]);

  // Refresca count + items.
  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, l] = await Promise.all([
      notifNoLeidasCount(),
      notifListar(20),
    ]);
    if (c.ok) setCount(c.data);
    if (l.ok) setItems(l.data);
    setLoading(false);
  }, []);

  // Carga inicial + cuando llega un user nuevo.
  useEffect(() => {
    if (!user) return;
    void refresh();
  }, [user, refresh]);

  // Realtime: cualquier INSERT/UPDATE en notificaciones_internas refresca.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notificaciones-internas-' + user.id)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones_internas',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refresh]);

  // Posicionar el dropdown debajo de la campana cuando se abre.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setAnchorRect(r);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Cierre por click fuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        buttonRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Marca leído + cierra panel + navega si hay url (acción "consumir").
  function consumirItem(it: NotifItem) {
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, leido_at: x.leido_at ?? new Date().toISOString() } : x)),
    );
    if (!it.leido_at) setCount((c) => Math.max(0, c - 1));
    void notifMarcarLeida(it.id);
    setOpen(false);
    if (it.url) {
      window.history.pushState({}, '', it.url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  async function handleClickItem(it: NotifItem) {
    // UX-CAMP-01 · Si el cuerpo está truncado en el listado, abrimos un modal
    // con el contenido completo (independientemente de si hay URL — el modal
    // tiene un botón "Ir" cuando aplica). Si no está truncado, comportamiento
    // anterior: marcamos leída, cerramos y navegamos.
    const isTrunc = truncatedIds.has(it.id);
    if (isTrunc) {
      setPreviewItem(it);
      // Marcamos leído pero NO cerramos el panel — el modal queda encima.
      if (!it.leido_at) {
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, leido_at: new Date().toISOString() } : x)),
        );
        setCount((c) => Math.max(0, c - 1));
        void notifMarcarLeida(it.id);
      }
      return;
    }
    consumirItem(it);
  }

  async function handleLimpiarTodas() {
    const r = await notifArchivarTodas();
    if (!r.ok) {
      toast.error('No pudimos limpiar', { description: r.error.message });
      return;
    }
    // Optimistic UI: vaciamos el panel localmente.
    setItems([]);
    setCount(0);
    toast.success(
      r.data > 0
        ? `Campanita limpiada · ${r.data} notificación${r.data === 1 ? '' : 'es'} archivada${r.data === 1 ? '' : 's'}`
        : 'No había nada que limpiar',
    );
  }

  async function handleArchivarUna(id: string, evt: React.MouseEvent) {
    evt.stopPropagation();
    const item = items.find((x) => x.id === id);
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (item && !item.leido_at) setCount((c) => Math.max(0, c - 1));
    const r = await notifArchivar(id);
    if (!r.ok) {
      toast.error('No pudimos archivar', { description: r.error.message });
      // Rollback en caso de error
      void refresh();
    }
  }

  const hasUnread = count > 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-ink transition hover:border-brand-cyan/40 hover:bg-brand-cyan/5',
          open && 'border-brand-cyan/40 bg-brand-cyan/5',
        )}
        title={hasUnread ? `${count} notificación${count === 1 ? '' : 'es'} sin leer` : 'Notificaciones'}
        aria-label={hasUnread ? `${count} notificaciones sin leer` : 'Notificaciones'}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {hasUnread ? (
          <BellRing size={16} className="text-brand-cyan motion-safe:animate-wiggle" />
        ) : (
          <Bell size={16} />
        )}
        {hasUnread && (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open &&
        anchorRect &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Centro de notificaciones"
            // Mobile (<640px): full-width con margen 8px a ambos lados para no
            // salirse de pantalla. Desktop: 380px anclado al borde del botón.
            className="fixed z-[80] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_-15px_rgba(18,34,48,0.35)] motion-safe:animate-spring-in"
            style={
              window.innerWidth < 640
                ? {
                    top: anchorRect.bottom + 8,
                    left: 8,
                    right: 8,
                  }
                : {
                    top: anchorRect.bottom + 8,
                    right: Math.max(8, window.innerWidth - anchorRect.right),
                    width: 380,
                  }
            }
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-brand-ink">
                  Notificaciones
                </p>
                <p className="text-[11px] text-brand-muted">
                  {items.length === 0
                    ? 'Sin novedades'
                    : hasUnread
                      ? `${count} sin leer · ${items.length} en total`
                      : `Todas leídas · ${items.length} en la lista`}
                </p>
              </div>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleLimpiarTodas()}
                  title="Archiva todas las notificaciones — la campanita queda vacía"
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-brand-muted transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={11} /> Limpiar
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {loading && items.length === 0 && (
                <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-brand-muted">
                  <Loader2 size={14} className="animate-spin" /> Cargando…
                </div>
              )}
              {!loading && items.length === 0 && (
                <div className="px-4 py-10 text-center">
                  <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-slate-50 text-slate-400">
                    <Inbox size={20} />
                  </span>
                  <p className="text-sm font-medium text-brand-ink">
                    Sin notificaciones
                  </p>
                  <p className="mt-1 text-xs text-brand-muted">
                    Las alertas del sistema van a aparecer acá.
                  </p>
                </div>
              )}
              {items.map((it) => {
                const meta = metaFor(it.tipo);
                const Icon = meta.icon;
                const unread = !it.leido_at;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => void handleClickItem(it)}
                    className={cn(
                      'group flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition last:border-b-0',
                      unread
                        ? 'bg-brand-cyan/5 hover:bg-brand-cyan/10'
                        : 'bg-white hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                        meta.chip,
                      )}
                    >
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate text-[13px]',
                          unread ? 'font-semibold text-brand-ink' : 'font-medium text-brand-ink/85',
                        )}
                      >
                        {it.titulo}
                      </p>
                      {it.cuerpo && (
                        <p
                          ref={(el) => {
                            if (el) cuerpoRefs.current.set(it.id, el);
                            else cuerpoRefs.current.delete(it.id);
                          }}
                          className="mt-0.5 truncate text-[11.5px] text-brand-muted"
                        >
                          {it.cuerpo}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-brand-muted/70">
                        {relativeTime(it.created_at)}
                      </p>
                    </div>
                    <div className="ml-1 flex shrink-0 flex-col items-end gap-1">
                      {unread ? (
                        <span
                          className="mt-1 h-2 w-2 rounded-full bg-brand-cyan"
                          title="Sin leer"
                        />
                      ) : (
                        <span
                          className="mt-1 hidden h-5 w-5 place-items-center text-emerald-500 opacity-60 group-hover:hidden sm:grid"
                          title="Leída"
                        >
                          <Check size={11} />
                        </span>
                      )}
                      {/* Botón X para archivar — visible en hover (desktop) y
                          siempre en mobile (donde no hay hover). */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => void handleArchivarUna(it.id, e)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            void handleArchivarUna(it.id, e as unknown as React.MouseEvent);
                          }
                        }}
                        title="Quitar de la campanita"
                        className="grid h-5 w-5 place-items-center rounded text-brand-muted/60 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <X size={11} />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-4 py-2 text-[11px] text-brand-muted">
              <span>
                {hasUnread ? `${count} pendiente${count === 1 ? '' : 's'}` : 'Sin pendientes'}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 rounded text-brand-muted hover:text-brand-ink"
              >
                <X size={11} /> Cerrar
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* UX-CAMP-01 · Modal con el contenido completo cuando el cuerpo no entra
          en el listado. */}
      <Modal
        open={!!previewItem}
        onClose={() => setPreviewItem(null)}
        title={previewItem?.titulo}
        kicker={previewItem ? relativeTime(previewItem.created_at) : undefined}
        icon={
          previewItem ? (() => {
            const M = metaFor(previewItem.tipo);
            const I = M.icon;
            return <I size={18} />;
          })() : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreviewItem(null)}>
              Cerrar
            </Button>
            {previewItem?.url && (
              <Button
                onClick={() => {
                  const it = previewItem;
                  if (!it) return;
                  setPreviewItem(null);
                  consumirItem(it);
                }}
              >
                Ir <ArrowRight size={14} className="ml-1" />
              </Button>
            )}
          </>
        }
        width={520}
      >
        {previewItem?.cuerpo ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-brand-ink">
            {previewItem.cuerpo}
          </p>
        ) : (
          <p className="text-sm text-brand-muted">Sin contenido adicional.</p>
        )}
      </Modal>
    </>
  );
}
