// ============================================================================
// errorReport.ts · captura y envío de errores al servidor propio (P2-#31)
//
// Set up:
//   1. `installGlobalErrorReporter()` se llama una vez en main.tsx.
//   2. Engancha window.onerror + unhandledrejection.
//   3. Cada error: fingerprintea (hash del mensaje+top stack frame),
//      envía vía RPC `errores_capturar`.
//   4. Sample throttle: el mismo fingerprint sólo se manda 1x cada 30s
//      (in-memory) para no inundar la BD.
//
// Privacy: NO incluye location.search ni body de inputs. Sólo pathname.
// ============================================================================

import { supabase } from '@/lib/supabase';

const recentlySent = new Map<string, number>(); // fp → ts
const THROTTLE_MS = 30_000;

function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return Math.abs(h).toString(36);
}

function fingerprintOf(message: string, stack: string | undefined): string {
  // Tomar el primer frame del stack (URL+línea) + mensaje truncado
  const topFrame = (stack ?? '')
    .split('\n')
    .find((l) => l.trim().startsWith('at ')) ?? '';
  const norm = topFrame.replace(/:\d+:\d+\b/g, ':?:?'); // borra números cambiantes
  return djb2(message.slice(0, 100) + '|' + norm.slice(0, 200));
}

async function send(input: {
  message: string;
  stack?: string;
  url?: string;
  ua?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const fp = fingerprintOf(input.message, input.stack);
  // Throttle: si ya mandamos el mismo fingerprint en los últimos 30s, skip.
  const last = recentlySent.get(fp);
  if (last && Date.now() - last < THROTTLE_MS) return;
  recentlySent.set(fp, Date.now());

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('errores_capturar', {
      p_fingerprint: fp,
      p_message: input.message,
      p_stack: input.stack ?? null,
      p_url: input.url ?? null,
      p_user_agent: input.ua ?? null,
      p_payload: input.payload ?? {},
    });
  } catch {
    // No re-throw. El reporter no debe romper la app.
  }
}

let installed = false;

export function installGlobalErrorReporter(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    const err = event.error;
    void send({
      message: event.message || (err && err.message) || 'Unknown error',
      stack: err && err.stack ? String(err.stack) : undefined,
      url: location.pathname,
      ua: navigator.userAgent,
      payload: {
        type: 'window.error',
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    let message = 'Unhandled promise rejection';
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = reason.message;
      stack = reason.stack;
    } else if (typeof reason === 'string') {
      message = reason;
    } else if (reason && typeof reason === 'object') {
      try { message = JSON.stringify(reason).slice(0, 500); } catch { /* */ }
    }
    void send({
      message,
      stack,
      url: location.pathname,
      ua: navigator.userAgent,
      payload: { type: 'unhandledrejection' },
    });
  });
}

/**
 * Reportar un error manualmente desde un try/catch o ErrorBoundary.
 */
export function reportError(
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (err instanceof Error) {
    void send({
      message: err.message,
      stack: err.stack,
      url: location.pathname,
      ua: navigator.userAgent,
      payload: { type: 'manual', ...extra },
    });
  } else {
    void send({
      message: typeof err === 'string' ? err : String(err),
      url: location.pathname,
      ua: navigator.userAgent,
      payload: { type: 'manual', raw: String(err), ...extra },
    });
  }
}
