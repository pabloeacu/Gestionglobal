import { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  Users,
  MessageSquare,
  MoreHorizontal,
  LogOut,
  LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { firmarSdk } from '@/services/api/campus';

// DGG-14 · Custom video stage
//
// El Zoom Embedded SDK (Component View) tiene una limitación arquitectónica:
// con un solo speaker con cámara, su "speaker view" muestra un thumbnail
// diminuto en lugar de fullscreen. Su Paper también tiene aspect ratio
// vertical fijo (~0.85), no respeta 16:9 horizontal.
//
// Solución: usamos el SDK SOLO para connectivity (audio + signaling +
// participantes). Renderizamos el video del speaker activo a NUESTRO
// propio canvas 16:9 fullwidth via `client.renderVideo()`. Toolbar
// custom con React garantiza botones grandes y siempre visibles.

interface Props {
  encuentroId: string;
  userName: string;
  password?: string | null;
  asHost?: boolean;
  onLeft?: () => void;
}

const STAGE_W = 1280;
const STAGE_H = 720;

export function ZoomCustomVideoStage({
  encuentroId,
  userName,
  password,
  asHost,
  onLeft,
}: Props) {
  const sdkRootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clientRef = useRef<any>(null);
  const initedRef = useRef(false);
  const renderedUserRef = useRef<number | null>(null);

  const [state, setState] = useState<
    'idle' | 'loading' | 'joining' | 'ready' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const [participants, setParticipants] = useState(0);
  const [hasActiveSpeaker, setHasActiveSpeaker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let mountedClient: any = null;
    let countInterval: ReturnType<typeof setInterval> | undefined;

    async function renderSpeaker(client: any) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const users: any[] = client.getAllUser?.() ?? [];
        const me = client.getCurrentUser?.();
        // Priorizamos: host con cámara → cualquier otro con cámara → host →
        // cualquier user que NO sea yo (para no verme a mí en el stage).
        const pick =
          users.find(
            (u) => u.isHost && u.bVideoOn && u.userId !== me?.userId,
          ) ||
          users.find((u) => u.bVideoOn && u.userId !== me?.userId) ||
          users.find((u) => u.isHost && u.userId !== me?.userId) ||
          users.find((u) => u.userId !== me?.userId);

        if (!pick?.userId || !pick.bVideoOn) {
          // Nadie con cámara prendida — limpiar canvas y mostrar placeholder.
          if (renderedUserRef.current !== null) {
            try {
              await client.stopRenderVideo?.(canvas, renderedUserRef.current);
            } catch {
              /* opt */
            }
            renderedUserRef.current = null;
          }
          setHasActiveSpeaker(false);
          return;
        }

        if (renderedUserRef.current === pick.userId && hasActiveSpeaker) {
          return; // Ya estamos renderizando a este user.
        }

        if (renderedUserRef.current !== null && renderedUserRef.current !== pick.userId) {
          try {
            await client.stopRenderVideo?.(canvas, renderedUserRef.current);
          } catch {
            /* opt */
          }
        }

        await client.renderVideo?.(
          canvas,
          pick.userId,
          STAGE_W,
          STAGE_H,
          0,
          0,
          3,
        );
        renderedUserRef.current = pick.userId;
        setHasActiveSpeaker(true);
      } catch (e) {
        console.warn('renderSpeaker error', e);
      }
    }

    function syncStateFromSdk(client: any) {
      try {
        const me = client.getCurrentUser?.();
        if (me) {
          setAudioOn(!me.muted);
          setVideoOn(!!me.bVideoOn);
        }
        const users = client.getAllUser?.() ?? [];
        setParticipants(users.length);
      } catch {
        /* opt */
      }
    }

    async function start() {
      if (initedRef.current) return;
      initedRef.current = true;
      setState('loading');
      setErrorMsg(null);
      try {
        const sig = await firmarSdk({
          encuentroId,
          role: asHost ? 1 : 0,
        });
        if (!sig.ok) throw new Error(sig.error.message);

        const mod = await import('@zoom/meetingsdk/embedded');
        const ZoomMtgEmbedded = mod.default;

        if (cancelled || !sdkRootRef.current) return;

        const client = ZoomMtgEmbedded.createClient();
        clientRef.current = client;
        mountedClient = client;

        // SDK init con viewSize chico — el SDK Paper queda offscreen, no
        // se ve. Solo usamos su connectivity layer.
        await client.init({
          zoomAppRoot: sdkRootRef.current,
          language: 'es-ES',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              isResizable: false,
              viewSizes: {
                default: { width: 320, height: 180 },
                ribbon: { width: 320, height: 80 },
              },
            },
          },
        });

        setState('joining');

        await client.join({
          signature: sig.data.signature,
          meetingNumber: sig.data.meetingNumber,
          password: password ?? '',
          userName,
          customerKey: sig.data.customerKey ?? undefined,
        });

        if (cancelled) {
          try {
            await client.leaveMeeting();
          } catch {
            /* opt */
          }
          return;
        }

        // Listeners para detectar cambios y re-renderizar.
        try {
          const c: any = client;
          c.on?.('user-added', () => {
            syncStateFromSdk(client);
            setTimeout(() => renderSpeaker(client), 400);
          });
          c.on?.('user-removed', () => {
            syncStateFromSdk(client);
            setTimeout(() => renderSpeaker(client), 200);
          });
          c.on?.('peer-video-state-change', () => {
            syncStateFromSdk(client);
            setTimeout(() => renderSpeaker(client), 250);
          });
          c.on?.('active-speaker', () => {
            setTimeout(() => renderSpeaker(client), 100);
          });
          c.on?.('current-audio-change', () => syncStateFromSdk(client));
          c.on?.('connection-change', (p: any) => {
            if (p?.state === 'Closed' || p?.state === 'Fail') {
              onLeft?.();
            }
          });
        } catch {
          /* opt */
        }

        // Initial sync + renders (con retries por timing del media stream).
        syncStateFromSdk(client);
        setTimeout(() => {
          syncStateFromSdk(client);
          renderSpeaker(client);
        }, 800);
        setTimeout(() => {
          syncStateFromSdk(client);
          renderSpeaker(client);
        }, 2500);

        // Poll participantes / state — barato y robusto.
        countInterval = setInterval(() => {
          syncStateFromSdk(client);
        }, 4000);

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
        console.error('ZoomCustomVideoStage error', e);
        if (!cancelled) {
          setErrorMsg(
            e?.message ?? e?.reason ?? 'No pudimos conectar con Zoom.',
          );
          setState('error');
          initedRef.current = false;
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (countInterval) clearInterval(countInterval);
      const c = mountedClient ?? clientRef.current;
      if (c) {
        try {
          c.leaveMeeting?.();
        } catch {
          /* opt */
        }
        try {
          c.leave?.();
        } catch {
          /* opt */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuentroId]);

  const toggleAudio = async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      if (audioOn) {
        await client.mute?.();
        setAudioOn(false);
      } else {
        await client.unmute?.();
        setAudioOn(true);
      }
    } catch (e) {
      console.warn('toggleAudio', e);
    }
  };

  const toggleVideo = async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      if (videoOn) {
        await client.muteVideo?.();
        setVideoOn(false);
      } else {
        await client.unmuteVideo?.();
        setVideoOn(true);
      }
    } catch (e) {
      console.warn('toggleVideo', e);
    }
  };

  const leave = async () => {
    const client = clientRef.current;
    if (client) {
      try {
        await client.leaveMeeting?.();
      } catch {
        /* opt */
      }
    }
    onLeft?.();
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-slate-950 shadow-xl ring-1 ring-brand-cyan/20">
      {/* Stage 16:9 — el canvas se ESTIRA al tamaño del marco preservando
          aspect ratio (object-contain → letterbox si la cam del speaker
          es portrait). */}
      <canvas
        ref={canvasRef}
        width={STAGE_W}
        height={STAGE_H}
        className="absolute inset-0 h-full w-full object-contain"
      />

      {/* Placeholder cuando nadie tiene cámara prendida */}
      {state === 'ready' && !hasActiveSpeaker && (
        <div className="absolute inset-0 grid place-items-center text-white/70">
          <div className="text-center">
            <VideoOff size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">Esperando que alguien encienda la cámara…</p>
            <p className="mt-1 text-xs opacity-70">
              {participants > 0
                ? `${participants} ${participants === 1 ? 'participante' : 'participantes'} conectado${participants === 1 ? '' : 's'}`
                : 'Conectando…'}
            </p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {state !== 'ready' && state !== 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-slate-950/95 text-white">
          <div className="flex flex-col items-center gap-3 text-sm">
            <Loader2 size={28} className="animate-spin" />
            <span>
              {state === 'loading' && 'Cargando Zoom…'}
              {state === 'joining' && 'Conectando a la sala…'}
              {state === 'idle' && 'Iniciando…'}
            </span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {state === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-red-50 p-6 text-red-700">
          <div className="max-w-md text-center">
            <AlertCircle size={32} className="mx-auto mb-2" />
            <p className="font-semibold">Error de conexión</p>
            <p className="mt-1 text-sm">{errorMsg}</p>
            <button
              onClick={() => {
                initedRef.current = false;
                setState('idle');
                setTimeout(() => setState('loading'), 50);
              }}
              className="mt-4 rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Badge "EN VIVO" arriba a la izquierda */}
      {state === 'ready' && (
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md backdrop-blur">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          En vivo
        </div>
      )}

      {/* Indicador participantes arriba a la derecha */}
      {state === 'ready' && participants > 0 && (
        <div className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white shadow-md backdrop-blur">
          <Users size={12} />
          {participants}
        </div>
      )}

      {/* Toolbar custom siempre visible al fondo del stage */}
      {state === 'ready' && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent px-4 pb-3 pt-8 sm:gap-2">
          <ToolbarBtn
            onClick={toggleAudio}
            active={audioOn}
            danger={!audioOn}
            icon={audioOn ? Mic : MicOff}
            label={audioOn ? 'Silenciar' : 'Activar audio'}
          />
          <ToolbarBtn
            onClick={toggleVideo}
            active={videoOn}
            danger={!videoOn}
            icon={videoOn ? VideoIcon : VideoOff}
            label={videoOn ? 'Apagar cámara' : 'Encender cámara'}
          />
          <ToolbarBtn icon={Users} label={`Participantes`} />
          <ToolbarBtn icon={MessageSquare} label="Chat" />
          <ToolbarBtn icon={LayoutGrid} label="Vista" />
          <ToolbarBtn icon={MoreHorizontal} label="Más" />
          <button
            onClick={leave}
            className="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-red-700 sm:px-4 sm:py-2.5"
            title="Salir de la clase"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      )}

      {/* SDK container offscreen — necesario para que el SDK funcione */}
      <div
        ref={sdkRootRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: -99999,
          top: -99999,
          width: 320,
          height: 180,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

function ToolbarBtn({
  onClick,
  active,
  danger,
  icon: Icon,
  label,
}: {
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  icon: typeof Mic;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'group flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[10px] font-medium transition sm:px-3.5',
        danger
          ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-100'
          : active
            ? 'bg-brand-cyan/90 text-white hover:bg-brand-cyan'
            : 'text-slate-300 hover:bg-slate-800/70 hover:text-white',
      )}
    >
      <Icon size={16} />
      <span className="hidden whitespace-nowrap md:block">{label}</span>
    </button>
  );
}
