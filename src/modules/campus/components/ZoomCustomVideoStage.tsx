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
  Headphones,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { firmarSdk } from '@/services/api/campus';

// DGG-16 · Custom video stage 16:9 horizontal
//
// El Meeting SDK Embedded (Component View) expone `client.getMediaStream()`
// con métodos `renderVideo()`, `startAudio()`, `startVideo()`, etc. desde
// v2.18+. Eso permite renderear el video del speaker a NUESTRO canvas con
// las dimensiones que querramos (16:9 horizontal), independientemente del
// aspect vertical del Paper interno del SDK.
//
// Arquitectura:
// - SDK Component View renderizado en DOM detrás del canvas (z-index 0,
//   opacity 0). Necesita estar en el DOM con dimensiones reales para que
//   los streams se inicialicen correctamente.
// - Canvas 16:9 (1280×720 internal) cubre el SDK con z-index 10. El SDK
//   draw el speaker activo via stream.renderVideo(canvas, userId, w, h, ...).
// - Toolbar custom React con z-index 20: mic (3 estados), cam, vista,
//   participantes, chat, salir. Todos llaman a stream APIs del SDK.

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
  const [audioJoined, setAudioJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [videoOn, setVideoOn] = useState(false);
  const [participants, setParticipants] = useState(0);
  const [hasSpeaker, setHasSpeaker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let mountedClient: any = null;
    let pollInterval: ReturnType<typeof setInterval> | undefined;

    /**
     * Encuentra al "speaker" activo y lo dibuja en NUESTRO canvas.
     * Estrategia: host con cámara → cualquier otro con cámara → host →
     * cualquiera (excluyendo a mí mismo). Si nadie tiene cámara, limpia.
     */
    async function renderSpeaker(client: any) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const stream: any = client.getMediaStream?.();
      if (!stream) return;

      const users: any[] = client.getAllUser?.() ?? [];
      const me = client.getCurrentUser?.();

      const pick =
        users.find(
          (u) => u.isHost && u.bVideoOn && u.userId !== me?.userId,
        ) ||
        users.find((u) => u.bVideoOn && u.userId !== me?.userId) ||
        users.find((u) => u.isHost && u.userId !== me?.userId) ||
        users.find((u) => u.userId !== me?.userId);

      if (!pick?.userId || !pick.bVideoOn) {
        if (renderedUserRef.current !== null) {
          try {
            await stream.stopRenderVideo?.(canvas, renderedUserRef.current);
          } catch {
            /* opt */
          }
          renderedUserRef.current = null;
        }
        setHasSpeaker(false);
        return;
      }

      if (renderedUserRef.current === pick.userId) {
        setHasSpeaker(true);
        return;
      }

      if (renderedUserRef.current !== null) {
        try {
          await stream.stopRenderVideo?.(canvas, renderedUserRef.current);
        } catch {
          /* opt */
        }
      }

      try {
        // VideoQuality: 0=90p, 1=180p, 2=360p, 3=720p
        await stream.renderVideo(canvas, pick.userId, STAGE_W, STAGE_H, 0, 0, 3);
        renderedUserRef.current = pick.userId;
        setHasSpeaker(true);
      } catch (e) {
        console.warn('[ZoomStage] renderVideo failed', e);
      }
    }

    function syncState(client: any) {
      try {
        const me = client.getCurrentUser?.();
        if (me) {
          const joined = me.audio === 'computer' || me.audio === 'phone';
          setAudioJoined(joined);
          setMicOn(joined && !me.muted);
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

        // Debug: expose for live inspection.
        if (typeof window !== 'undefined') {
          (window as any).__zoomClient = client;
        }

        // Init con viewSizes NORMALES (no microscópicos) — necesario para
        // que el SDK suscriba bien los streams de video del peer.
        await client.init({
          zoomAppRoot: sdkRootRef.current,
          language: 'es-ES',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              isResizable: false,
              viewSizes: {
                default: { width: 720, height: 600 },
                ribbon: { width: 720, height: 80 },
              },
            },
          },
        });

        setState('joining');

        await client.join({
          signature: sig.data.signature,
          meetingNumber: sig.data.meetingNumber,
          // E-GG-145: password de la firma (gateada); prop como fallback.
          password: sig.data.password ?? password ?? '',
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

        const c: any = client;

        // Event subscriptions con sync + render
        c.on?.('user-added', () => {
          syncState(client);
          setTimeout(() => renderSpeaker(client), 400);
        });
        c.on?.('user-removed', () => {
          syncState(client);
          setTimeout(() => renderSpeaker(client), 200);
        });
        c.on?.('peer-video-state-change', () => {
          syncState(client);
          setTimeout(() => renderSpeaker(client), 300);
        });
        c.on?.('video-active-change', () => {
          setTimeout(() => renderSpeaker(client), 200);
        });
        c.on?.('active-speaker', () => {
          setTimeout(() => renderSpeaker(client), 100);
        });
        c.on?.('current-audio-change', () => syncState(client));
        c.on?.('connection-change', (p: any) => {
          if (p?.state === 'Closed' || p?.state === 'Fail') {
            onLeft?.();
          }
        });

        // Initial sync + render attempts con retries (timing del media stream)
        syncState(client);
        setTimeout(() => {
          syncState(client);
          renderSpeaker(client);
        }, 1000);
        setTimeout(() => {
          syncState(client);
          renderSpeaker(client);
        }, 3000);
        setTimeout(() => {
          syncState(client);
          renderSpeaker(client);
        }, 6000);

        pollInterval = setInterval(() => {
          syncState(client);
          // Auto-retry rendering si el speaker se cae
          if (renderedUserRef.current === null) {
            renderSpeaker(client);
          }
        }, 3500);

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
        console.error('[ZoomStage] error', e);
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
      if (pollInterval) clearInterval(pollInterval);
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

  const handleAudio = async () => {
    const client = clientRef.current;
    if (!client) return;
    const stream = client.getMediaStream?.();
    if (!stream) return;
    try {
      if (!audioJoined) {
        // PASO CRÍTICO: en Zoom Web SDK, después de join() hay que llamar
        // startAudio() explícitamente para conectar al audio de la sala
        // (sin esto no se escucha NI se habla).
        await stream.startAudio({ silent: false });
        setAudioJoined(true);
        setMicOn(true);
        toast.success('Audio conectado');
      } else if (micOn) {
        await stream.muteAudio();
        setMicOn(false);
      } else {
        await stream.unmuteAudio();
        setMicOn(true);
      }
    } catch (e: any) {
      console.warn('[ZoomStage] handleAudio error', e);
      const msg = String(e?.message ?? e?.reason ?? e ?? '');
      if (/permission|denied|notallowed/i.test(msg)) {
        toast.error('Permiso de micrófono denegado. Habilitalo en el navegador.');
      } else {
        toast.error('No pudimos conectar el audio.');
      }
    }
  };

  const handleVideo = async () => {
    const client = clientRef.current;
    if (!client) return;
    const stream = client.getMediaStream?.();
    if (!stream) return;
    try {
      if (videoOn) {
        await stream.stopVideo();
        setVideoOn(false);
      } else {
        await stream.startVideo();
        setVideoOn(true);
      }
    } catch (e: any) {
      console.warn('[ZoomStage] handleVideo error', e);
      const msg = String(e?.message ?? e?.reason ?? e ?? '');
      if (/permission|denied|notallowed/i.test(msg)) {
        toast.error('Permiso de cámara denegado. Habilitalo en el navegador.');
      } else {
        toast.error('No pudimos activar la cámara.');
      }
    }
  };

  const showParticipants = () => {
    toast.info(
      `${participants} ${participants === 1 ? 'participante conectado' : 'participantes conectados'}.`,
    );
  };

  const openChat = () => {
    toast.info('Chat próximamente.');
  };

  const toggleView = () => {
    toast.info('Vista speaker fullscreen activa.');
  };

  const showMore = () => {
    toast.info('Más opciones próximamente.');
  };

  const handleLeave = async () => {
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
      {/* SDK Paper renderizado en el DOM con dimensiones reales pero
          invisible (opacity 0, z-index 0, pointer-events: none). Permite
          al SDK inicializar correctamente los streams. */}
      <div
        ref={sdkRootRef}
        aria-hidden
        className="absolute inset-0"
        style={{
          zIndex: 0,
          opacity: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      />

      {/* Canvas 16:9 — cubre el SDK Paper. El SDK draw al speaker activo
          aquí via stream.renderVideo(). object-contain preserva aspect
          ratio del video (letterbox si el host está en portrait). */}
      <canvas
        ref={canvasRef}
        width={STAGE_W}
        height={STAGE_H}
        className="absolute inset-0 h-full w-full"
        style={{ zIndex: 10, objectFit: 'contain', backgroundColor: '#0f172a' }}
      />

      {/* Placeholder cuando nadie tiene cámara prendida */}
      {state === 'ready' && !hasSpeaker && (
        <div
          className="absolute inset-0 grid place-items-center text-white/70"
          style={{ zIndex: 11 }}
        >
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
        <div
          className="absolute inset-0 grid place-items-center bg-slate-950/95 text-white"
          style={{ zIndex: 20 }}
        >
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
        <div
          className="absolute inset-0 grid place-items-center bg-red-50 p-6 text-red-700"
          style={{ zIndex: 20 }}
        >
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
        <div
          className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md backdrop-blur"
          style={{ zIndex: 15 }}
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          En vivo
        </div>
      )}

      {/* Contador participantes arriba a la derecha */}
      {state === 'ready' && participants > 0 && (
        <div
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white shadow-md backdrop-blur"
          style={{ zIndex: 15 }}
        >
          <Users size={12} />
          {participants}
        </div>
      )}

      {/* Toolbar custom siempre visible al fondo del stage */}
      {state === 'ready' && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent px-4 pb-3 pt-8 sm:gap-2"
          style={{ zIndex: 15 }}
        >
          <ToolbarBtn
            onClick={handleAudio}
            active={audioJoined && micOn}
            danger={audioJoined && !micOn}
            icon={!audioJoined ? Headphones : micOn ? Mic : MicOff}
            label={
              !audioJoined
                ? 'Activar audio'
                : micOn
                  ? 'Silenciar'
                  : 'Activar mic'
            }
          />
          <ToolbarBtn
            onClick={handleVideo}
            active={videoOn}
            danger={!videoOn}
            icon={videoOn ? VideoIcon : VideoOff}
            label={videoOn ? 'Apagar cámara' : 'Encender cámara'}
          />
          <ToolbarBtn
            onClick={showParticipants}
            icon={Users}
            label="Participantes"
          />
          <ToolbarBtn onClick={openChat} icon={MessageSquare} label="Chat" />
          <ToolbarBtn onClick={toggleView} icon={LayoutGrid} label="Vista" />
          <ToolbarBtn onClick={showMore} icon={MoreHorizontal} label="Más" />
          <button
            onClick={handleLeave}
            className="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-md transition hover:bg-red-700 sm:px-4 sm:py-2.5"
            title="Salir de la clase"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      )}
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
