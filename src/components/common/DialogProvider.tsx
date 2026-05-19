import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

// Regla 13: window.confirm/alert/prompt PROHIBIDOS. Estos hooks reemplazan las
// ventanas nativas con look propio y devuelven Promesas.

type ConfirmOpts = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};
type PromptOpts = {
  title?: string;
  message?: ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
};
type AlertOpts = { title?: string; message: ReactNode; okLabel?: string };

interface DialogApi {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  alert: (opts: AlertOpts) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

type State =
  | { kind: 'confirm'; opts: ConfirmOpts }
  | { kind: 'prompt'; opts: PromptOpts }
  | { kind: 'alert'; opts: AlertOpts }
  | null;

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((v: unknown) => void) | null>(null);

  const close = useCallback((result: unknown) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
    setValue('');
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve as (v: unknown) => void;
          setState({ kind: 'confirm', opts });
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve as (v: unknown) => void;
          setValue(opts.defaultValue ?? '');
          setState({ kind: 'prompt', opts });
        }),
      alert: (opts) =>
        new Promise<void>((resolve) => {
          resolver.current = resolve as (v: unknown) => void;
          setState({ kind: 'alert', opts });
        }),
    }),
    [],
  );

  return (
    <DialogContext.Provider value={api}>
      {children}

      <Modal
        open={state?.kind === 'confirm'}
        onClose={() => close(false)}
        title={state?.kind === 'confirm' ? (state.opts.title ?? 'Confirmar') : ''}
        footer={
          state?.kind === 'confirm' && (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? 'Cancelar'}
              </Button>
              <Button
                variant={state.opts.danger ? 'danger' : 'primary'}
                onClick={() => close(true)}
              >
                {state.opts.confirmLabel ?? 'Confirmar'}
              </Button>
            </>
          )
        }
      >
        {state?.kind === 'confirm' && (
          <div className="text-sm text-brand-ink">{state.opts.message}</div>
        )}
      </Modal>

      <Modal
        open={state?.kind === 'prompt'}
        onClose={() => close(null)}
        title={state?.kind === 'prompt' ? (state.opts.title ?? 'Ingresá un valor') : ''}
        footer={
          state?.kind === 'prompt' && (
            <>
              <Button variant="secondary" onClick={() => close(null)}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={() => close(value)}>
                {state.opts.confirmLabel ?? 'Aceptar'}
              </Button>
            </>
          )
        }
      >
        {state?.kind === 'prompt' && (
          <div className="space-y-2">
            {state.opts.message && (
              <p className="text-sm text-brand-ink">{state.opts.message}</p>
            )}
            {state.opts.label && (
              <label className="kicker block">{state.opts.label}</label>
            )}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.opts.placeholder}
              onKeyDown={(e) => e.key === 'Enter' && close(value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-cyan"
            />
          </div>
        )}
      </Modal>

      <Modal
        open={state?.kind === 'alert'}
        onClose={() => close(undefined)}
        title={state?.kind === 'alert' ? (state.opts.title ?? 'Aviso') : ''}
        footer={
          state?.kind === 'alert' && (
            <Button variant="primary" onClick={() => close(undefined)}>
              {state.opts.okLabel ?? 'Entendido'}
            </Button>
          )
        }
      >
        {state?.kind === 'alert' && (
          <div className="text-sm text-brand-ink">{state.opts.message}</div>
        )}
      </Modal>
    </DialogContext.Provider>
  );
}

function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog debe usarse dentro de <DialogProvider>');
  return ctx;
}

export const useConfirm = () => useDialog().confirm;
export const usePrompt = () => useDialog().prompt;
export const useAlert = () => useDialog().alert;
