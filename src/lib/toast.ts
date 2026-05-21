// Toast store minimalista. La API es compatible con la de sonner para no
// tocar callers existentes (toast.success / toast.error / toast.info).
// El render lo hace src/components/common/ToastViewport.tsx.

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  createdAt: number;
  durationMs: number;
  /** Acción opcional (botón en el toast) — 3.C / 1.F · undo / restaurar. */
  action?: ToastAction;
}

type Listener = (toasts: ToastItem[]) => void;

class ToastStore {
  private items: ToastItem[] = [];
  private listeners = new Set<Listener>();

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.items);
    return () => {
      this.listeners.delete(l);
    };
  }

  private emit(): void {
    const snapshot = [...this.items];
    this.listeners.forEach((l) => l(snapshot));
  }

  push(item: Omit<ToastItem, 'id' | 'createdAt' | 'durationMs'> & { durationMs?: number }): string {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const t: ToastItem = {
      id,
      kind: item.kind,
      message: item.message,
      description: item.description,
      action: item.action,
      createdAt: Date.now(),
      durationMs: item.durationMs ?? 4200,
    };
    this.items = [...this.items, t];
    this.emit();
    return id;
  }

  dismiss(id: string): void {
    if (!this.items.some((t) => t.id === id)) return;
    this.items = this.items.filter((t) => t.id !== id);
    this.emit();
  }

  clear(): void {
    this.items = [];
    this.emit();
  }
}

export const toastStore = new ToastStore();

interface ToastOptions {
  description?: string;
  durationMs?: number;
  /** Compatibilidad con API sonner-like (segundos vs ms es indistinto en este codebase). */
  duration?: number;
  action?: ToastAction;
}

function make(kind: ToastKind) {
  return (message: string, opts?: ToastOptions): string => {
    const durationMs = opts?.durationMs ?? opts?.duration;
    return toastStore.push({
      kind,
      message,
      description: opts?.description,
      action: opts?.action,
      durationMs,
    });
  };
}

export const toast = {
  success: make('success'),
  error: make('error'),
  info: make('info'),
  warning: make('warning'),
  dismiss: (id: string) => toastStore.dismiss(id),
  clear: () => toastStore.clear(),
};
