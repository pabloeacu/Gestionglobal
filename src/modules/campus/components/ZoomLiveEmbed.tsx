import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Hand,
  MessageSquare,
  LogOut,
} from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// Estrategia de tamaño:
//   Component View NO trae toolbar por default (sólo header + video gallery).
//   Para que el usuario tenga la "experiencia Zoom" (mute, cam, mano, chat,
//   salir) construimos NOSOTROS una toolbar propia debajo del viewport del
//   SDK, que llama a los métodos del client.
//
//   El SDK renderiza a su tamaño natural — sin CSS scale — y le pasamos
//   viewSizes específicos para cada modo. Compact y Ampliado son tamaños
//   distintos del SDK, no escalados visualmente. El SDK al re-rendizar
//   ajusta TODO (header, video, gallery) al nuevo tamaño correctamente.

export interface ZoomLiveEmbedProps {
  encuentroId: string;
  userName: string;
  asHost?: boolean;
  password?: string | null;
  onLeft?: () => void;
}

// Compact: cabe sin scroll, el video del host se ve grande en el centro.
const COMPACT_W = 720;
const COMPACT_VIDEO_H = 320; // gallery; header ~40px, total ≈ 360.
// Ampliado: más espacio para gallery + thumbnails.
const LARGE_W = 1080;
const LARGE_VIDEO_H = 540;

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);
  const initedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'joining' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [handUp, setHandUp] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ from: string; text: string }>>([]);

  const dims = useMemo(() => {
    const w = expanded ? LARGE_W : COMPACT_W;
    const h = expanded ? LARGE_VIDEO_H : COMPACT_VIDEO_H;
    return { w, h };
  }, [expanded]);

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

        await client.init({
          zoomAppRoot: containerRef.current,
          language: 'es-ES',
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: {
              isResizable: false,
              viewSizes: {
                default: { width: COMPACT_W, height: COMPACT_VIDEO_H },
                ribbon: { width: COMPACT_W, height: 80 },
              },
            },
          },
        });

        // Listeners para mantener el estado UI alineado con el SDK.
        // Cast a any porque el typing del SDK es estricto con event names.
        try {
          const c: any = client;
          c.on?.('current-audio-change', (p: any) => {
            if (typeof p?.muted === 'boolean') setMicOn(!p.muted);
          });
          c.on?.('chat-on-message', (m: any) => {
            const from = m?.sender?.name ?? 'Anfitrión';
            const text = m?.message ?? '';
            if (text) setChatLog((prev) => [...prev.slice(-30), { from, text }]);
          });
        } catch { /* SDK puede no exponer on() en todas las versiones */ }

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
      try { props.onLeft?.(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.encuentroId]);

  // Cambio de tamaño: invoca updateVideoOptions del SDK (no recrea cliente).
  useEffect(() => {
    const client = clientRef.current;
    if (!client || state !== 'ready') return;
    try {
      client.updateVideoOptions?.({
        viewSizes: {
          default: { width: dims.w, height: dims.h },
          ribbon: { width: dims.w, height: 80 },
        },
      });
    } catch { /* noop */ }
  }, [dims.w, dims.h, state]);

  // Helpers de toolbar — llaman al SDK client directamente
  async function toggleMic() {
    const c = clientRef.current; if (!c) return;
    try {
      if (micOn) { await c.mute?.(true); setMicOn(false); }
      else { await c.mute?.(false); setMicOn(true); }
    } catch (e) { console.warn('mic', e); }
  }
  async function toggleCam() {
    const c = clientRef.current; if (!c) return;
    try {
      if (camOn) { await c.muteVideo?.(true); setCamOn(false); }
      else { await c.muteVideo?.(false); setCamOn(true); }
    } catch (e) { console.warn('cam', e); }
  }
  async function toggleHand() {
    const c = clientRef.current; if (!c) return;
    try {
      if (handUp) { await c.lowerHand?.(); setHandUp(false); }
      else { await c.raiseHand?.(); setHandUp(true); }
    } catch (e) { console.warn('hand', e); }
  }
  async function leaveMeeting() {
    const c = clientRef.current; if (!c) return;
    try { await c.leaveMeeting?.(); } catch { /* noop */ }
    props.onLeft?.();
  }
  async function sendChat() {
    const c = clientRef.current; if (!c || !chatText.trim()) return;
    try {
      await c.sendChat?.({ message: chatText.trim() });
      setChatLog((prev) => [...prev.slice(-30), { from: 'Vos', text: chatText.trim() }]);
      setChatText('');
    } catch (e) { console.warn('chat', e); }
  }

  return (
    <div className="relative mx-auto" style={{ width: dims.w }}>
      {/* Overlay loader */}
      {state !== 'ready' && state !== 'error' && (
        <div
          className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-slate-900/80 text-white backdrop-blur-sm"
          style={{ height: dims.h + 56 }}
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

      {/* Toggle Ampliar/Compacto */}
      {state === 'ready' && (
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Vista compacta' : 'Vista ampliada'}
          className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm transition hover:bg-black/70"
        >
          {expanded ? (
            <>
              <Minimize2 size={12} /> Compacto
            </>
          ) : (
            <>
              <Maximize2 size={12} /> Ampliar
            </>
          )}
        </button>
      )}

      {/* Container que aloja el SDK — sin scale CSS */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-t-2xl bg-black"
        style={{
          width: dims.w,
          height: dims.h + 56, // espacio para header del SDK
          transition: 'width 200ms ease-out, height 200ms ease-out',
        }}
      />

      {/* Toolbar propia con controles Zoom-like (Component View no trae default) */}
      {state === 'ready' && (
        <div
          className="flex items-center justify-between gap-2 rounded-b-2xl bg-slate-900 px-3 py-2 text-white"
          style={{ width: dims.w }}
        >
          <div className="flex items-center gap-1.5">
            <ToolbarBtn onClick={() => void toggleMic()} active={micOn} label={micOn ? 'Silenciar' : 'Activar audio'}>
              {micOn ? <Mic size={14} /> : <MicOff size={14} />}
            </ToolbarBtn>
            <ToolbarBtn onClick={() => void toggleCam()} active={camOn} label={camOn ? 'Apagar cámara' : 'Encender cámara'}>
              {camOn ? <Video size={14} /> : <VideoOff size={14} />}
            </ToolbarBtn>
            <ToolbarBtn onClick={() => void toggleHand()} active={handUp} label={handUp ? 'Bajar mano' : 'Levantar mano'}>
              <Hand size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              onClick={() => setShowChat((v) => !v)}
              active={showChat}
              label="Chat"
            >
              <MessageSquare size={14} />
            </ToolbarBtn>
          </div>
          <button
            onClick={() => void leaveMeeting()}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-red-700"
            title="Salir de la sala"
          >
            <LogOut size={12} /> Salir
          </button>
        </div>
      )}

      {/* Mini chat lateral debajo de la toolbar */}
      {state === 'ready' && showChat && (
        <div
          className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
          style={{ width: dims.w }}
        >
          <div className="mb-2 max-h-32 overflow-y-auto text-sm">
            {chatLog.length === 0 ? (
              <p className="text-xs text-brand-muted">Sin mensajes todavía.</p>
            ) : (
              chatLog.map((m, i) => (
                <p key={i} className="mb-0.5">
                  <span className="font-semibold text-brand-ink">{m.from}:</span>{' '}
                  <span className="text-brand-ink">{m.text}</span>
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void sendChat(); }}
              placeholder="Escribí un mensaje…"
              className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-brand-cyan focus:outline-none"
            />
            <button
              onClick={() => void sendChat()}
              className="rounded-md bg-brand-cyan px-3 py-1 text-xs font-semibold text-white hover:bg-brand-cyan/90"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarBtn({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-md transition ' +
        (active
          ? 'bg-brand-cyan text-white shadow-sm'
          : 'bg-slate-700 text-white hover:bg-slate-600')
      }
    >
      {children}
    </button>
  );
}
