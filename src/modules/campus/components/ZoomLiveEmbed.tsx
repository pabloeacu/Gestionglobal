import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// El SDK trae su UI nativa completa (header con info + video gallery +
// toolbar con audio, cámara, chat, participantes, compartir, levantar mano,
// salir). Nuestro container respeta el tamaño natural del SDK (~720×850)
// para que TODA esa UI sea visible y funcional, igual que en zoom.us.
// El padre (CursoDetalleAlumnoPage) acomoda la página alrededor.

export interface ZoomLiveEmbedProps {
  encuentroId: string;
  userName: string;
  asHost?: boolean;
  password?: string | null;
  /** Disparado cuando el SDK confirma que el participante abandonó. */
  onLeft?: () => void;
}

// SDK Component View natural ~720×874. Proporciones que el SDK respeta
// bien y rinden video + toolbar legibles.
const SDK_W = 720;
const SDK_H = 874;

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);
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
        const sig = await firmarSdk({
          encuentroId: props.encuentroId,
          role: props.asHost ? 1 : 0,
        });
        if (!sig.ok) throw new Error(sig.error.message);

        const mod = await import('@zoom/meetingsdk/embedded');
        const ZoomMtgEmbedded = mod.default;

        if (cancelled || !containerRef.current) return;

        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;
        mountedClient = client;
        // Expose para que el custom toolbar (en EncuentrosEnVivoAlumno)
        // pueda llamar a métodos del SDK (mute, leaveMeeting).
        if (typeof window !== 'undefined') {
          (window as any).__zoomClient = client;
        }

        await client.init({
          zoomAppRoot: containerRef.current,
          language: 'es-ES',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              isResizable: false,
              defaultViewType: 'speaker' as any,
              viewSizes: {
                default: { width: SDK_W, height: SDK_H - 120 },
                ribbon: { width: SDK_W, height: 80 },
              },
            },
          },
        });

        setState('joining');

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

        // Vista por defecto: "speaker" — el hablante (host) llena el
        // embed. Si el alumno enciende su cámara, queda en el ribbon
        // strip. Toggle disponible desde los controles nativos del SDK.
        try {
          const c: any = client;
          await c.changeView?.({ view: 'speaker' });
        } catch { /* opt */ }

        // Force-pin al host como active speaker para que llene el video
        // stage (sin esto, con un solo participante con cámara, el SDK
        // muestra un thumbnail diminuto). Re-aplicamos en cada
        // user-added por si el host se reconecta.
        const pinHost = () => {
          try {
            const c: any = client;
            const users: any[] = c.getAllUser?.() ?? [];
            const host = users.find((u) => u.isHost) || users.find((u) => u.bVideoOn) || users[0];
            if (host?.userId) {
              c.setActiveSpeaker?.(host.userId);
              try { c.pinVideo?.(host.userId, true); } catch { /* opt */ }
            }
          } catch { /* opt */ }
        };
        setTimeout(pinHost, 1000);
        setTimeout(pinHost, 2500);
        try {
          const c: any = client;
          c.on?.('user-added', () => setTimeout(pinHost, 500));
          c.on?.('peer-video-state-change', () => setTimeout(pinHost, 300));
        } catch { /* opt */ }

        // Listener para detectar cuando el alumno realmente sale (vía botón
        // nativo del SDK) → notificamos al padre para que cierre el modo.
        try {
          const c: any = client;
          c.on?.('connection-change', (p: any) => {
            if (p?.state === 'Closed' || p?.state === 'Fail') {
              props.onLeft?.();
            }
          });
        } catch { /* noop */ }

        setState('ready');
      } catch (e: any) {
        const code = e?.errorCode ?? e?.reason?.errorCode ?? e?.code ?? e?.type;
        const codeStr = String(code ?? '').toUpperCase();
        const msg = String(e?.message ?? e?.reason ?? e?.type ?? e ?? '');
        const TRANSIENT = new Set([
          'RECONNECTING_MEETING',
          'NETWORK_DISCONNECTED',
          'MEETING_NOT_STARTED',
          'WAITING_ROOM',
        ]);
        const isTransient =
          code === 3008 ||
          TRANSIENT.has(codeStr) ||
          /not.?started|waiting.?for.?host|reconnect|network[_ ]?disconnect|waiting.?room/i.test(
            msg + ' ' + codeStr,
          );
        if (isTransient) {
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
        try { c.leaveMeeting?.(); } catch { /* noop */ }
        try { c.leave?.(); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.encuentroId]);

  return (
    <div className="relative mx-auto" style={{ width: SDK_W, maxWidth: '100%' }}>
      {state !== 'ready' && state !== 'error' && (
        <div
          className="grid place-items-center rounded-2xl bg-slate-900 text-white"
          style={{ width: SDK_W, height: SDK_H, maxWidth: '100%' }}
        >
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
            onClick={() => {
              initedRef.current = false;
              setState('idle');
              setTimeout(() => setState('loading'), 50);
            }}
            className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl bg-black"
        style={{
          width: SDK_W,
          height: SDK_H,
          maxWidth: '100%',
          display: state === 'ready' ? 'block' : 'none',
        }}
      />
    </div>
  );
}
