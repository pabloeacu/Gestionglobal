import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// Pide la firma al edge fn zoom-sdk-signature, carga dinámicamente
// `@zoom/meetingsdk/embedded` (≈1.5MB → lazy import por ruta) y monta el
// cliente dentro del contenedor `zoomAppRoot`. El customerKey que va al
// join es el matricula_id (o null para staff/host); eso es lo que el
// webhook lee en participant_joined para registrar asistencia.
//
// Importante: `client.leaveMeeting()` se invoca en cleanup. Si se vuelve a
// renderizar (StrictMode) o se desmonta, evitamos un init duplicado.

export interface ZoomLiveEmbedProps {
  encuentroId: string;
  userName: string;
  /** Role 1 = host (sólo staff lo recibirá del edge fn); 0 = attendee. */
  asHost?: boolean;
  /** Pasword del meeting (si lo creamos sin password queda null). */
  password?: string | null;
  /** Callback cuando el usuario sale del encuentro o lo cierra. */
  onLeft?: () => void;
}

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<unknown>(null);
  const initedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'joining' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let mountedClient: any = null;

    async function start() {
      if (initedRef.current) return;
      initedRef.current = true;
      setState('loading');
      setErrorMsg(null);
      try {
        // 1) Pedir firma al backend
        const sig = await firmarSdk({
          encuentroId: props.encuentroId,
          role: props.asHost ? 1 : 0,
        });
        if (!sig.ok) throw new Error(sig.error.message);

        // 2) Cargar SDK dinámicamente
        const mod = await import('@zoom/meetingsdk/embedded');
        const ZoomMtgEmbedded = mod.default;

        if (cancelled || !containerRef.current) return;

        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;
        mountedClient = client;

        await client.init({
          zoomAppRoot: containerRef.current,
          language: 'es-ES',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: { isResizable: true, viewSizes: { default: { width: 1000, height: 600 } } },
            toolbar: { buttons: [] },
          },
        });

        setState('joining');

        // v4+: sdkKey ya NO va en joinOptions (vive en la signature). Si lo
        // mandás, Zoom warna y join() tira error como falso positivo.
        await client.join({
          signature: sig.data.signature,
          meetingNumber: sig.data.meetingNumber,
          password: props.password ?? '',
          userName: props.userName,
          customerKey: sig.data.customerKey ?? undefined,
        });

        if (cancelled) {
          try { await client.leaveMeeting(); } catch { /* noop */ }
          return;
        }
        setState('ready');
      } catch (e: any) {
        // Zoom usa errorCode 3008 (MEETING_NOT_STARTED) cuando join_before_host
        // está OFF y el host aún no inició. El SDK igual monta el viewport con
        // "La reunión no ha comenzado" — esto NO es un error real, es la sala
        // de espera. No mostramos toast de error en ese caso.
        const code = e?.errorCode ?? e?.reason?.errorCode;
        const isWaitingHost =
          code === 3008 ||
          /not.?started|waiting.?for.?host|host.?has.?not.?started/i.test(
            String(e?.message ?? e?.reason ?? ''),
          );
        if (isWaitingHost) {
          if (!cancelled) setState('ready');
          return;
        }
        console.error('ZoomLiveEmbed error', e);
        if (!cancelled) {
          setErrorMsg(e?.message ?? e?.reason ?? 'No pudimos conectar con Zoom.');
          setState('error');
          initedRef.current = false;
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      const c = mountedClient ?? clientRef.current;
      if (c) {
        try {
          (c as any).leaveMeeting?.();
        } catch { /* noop */ }
        try {
          (c as any).leave?.();
        } catch { /* noop */ }
      }
      try { props.onLeft?.(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.encuentroId]);

  return (
    <div className="relative">
      {state !== 'ready' && state !== 'error' && (
        <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-slate-900/70 text-white backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-sm">
            <Loader2 size={22} className="animate-spin" />
            <span>
              {state === 'loading' && 'Cargando Zoom…'}
              {state === 'joining' && 'Conectando a la sala…'}
              {state === 'idle' && 'Iniciando…'}
            </span>
          </div>
        </div>
      )}
      {state === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="flex items-center gap-2 font-semibold">
            <AlertCircle size={16} /> Error de conexión
          </p>
          <p className="mt-1">{errorMsg}</p>
          <button
            onClick={() => { initedRef.current = false; setState('idle'); setTimeout(() => setState('loading'), 50); }}
            className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl bg-black"
        style={{ minHeight: 600 }}
      />
    </div>
  );
}
