import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// Estrategia de tamaño:
//   El SDK renderiza el UI completo (header REC + video gallery + toolbar
//   inferior) a un tamaño "natural" de 1280×720. Si achicamos directamente
//   el contenedor, el SDK CLIPEA el contenido (queda toolbar fuera + video
//   recortado). En vez de eso, mantenemos el SDK a 1280×720 y aplicamos
//   `transform: scale()` con CSS para que TODO el UI se vea proporcional
//   en el display más chico. CSS transforms preservan los click coords →
//   los botones del SDK siguen siendo clickeables.
//
// Modos:
//   - Compacto (default): 720×405 (scale 0.5625) → cabe sin scrollear.
//   - Ampliado: 1080×608 (scale 0.84) → más grande, mismo flujo.
//
// El toggle CSS NO toca el SDK ni reconecta. Conexión + stream + asistencia
// auto siguen sin interrupción.

export interface ZoomLiveEmbedProps {
  encuentroId: string;
  userName: string;
  asHost?: boolean;
  password?: string | null;
  onLeft?: () => void;
}

// Tamaño NATURAL al que renderiza el SDK (donde TODO se ve completo).
const SDK_NATURAL_W = 1280;
const SDK_NATURAL_H = 720;

// Tamaño VISIBLE (post-scale CSS) según el modo.
const COMPACT_W = 720;
const COMPACT_H = 405; // 16:9
const LARGE_W = 1080;
const LARGE_H = 608;

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<unknown>(null);
  const initedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'joining' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const dims = useMemo(() => {
    const w = expanded ? LARGE_W : COMPACT_W;
    const h = expanded ? LARGE_H : COMPACT_H;
    const scale = w / SDK_NATURAL_W;
    return { w, h, scale };
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
                // El SDK renderiza el bloque de video a este tamaño; el
                // header + toolbar suman ~150px más → total ≈ 720px.
                default: { width: SDK_NATURAL_W, height: 560 },
                ribbon: { width: SDK_NATURAL_W, height: 100 },
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
        setState('ready');
      } catch (e: any) {
        // Eventos NO fatales del SDK que entran al catch pero el SDK
        // recupera solo o representan estados benignos:
        //   - 3008 MEETING_NOT_STARTED → sala de espera.
        //   - RECONNECTING_MEETING → reconexión transitoria.
        //   - NETWORK_DISCONNECTED → idem.
        const code = e?.errorCode ?? e?.reason?.errorCode ?? e?.code ?? e?.type;
        const codeStr = String(code ?? '').toUpperCase();
        const msg = String(e?.message ?? e?.reason ?? e?.type ?? e ?? '');
        const TRANSIENT_CODES = new Set([
          'RECONNECTING_MEETING',
          'NETWORK_DISCONNECTED',
          'MEETING_NOT_STARTED',
          'WAITING_ROOM',
        ]);
        const isTransient =
          code === 3008 ||
          TRANSIENT_CODES.has(codeStr) ||
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
        try { (c as any).leaveMeeting?.(); } catch { /* noop */ }
        try { (c as any).leave?.(); } catch { /* noop */ }
      }
      try { props.onLeft?.(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.encuentroId]);

  return (
    <div className="relative mx-auto" style={{ width: dims.w }}>
      {/* Overlay loader mientras conecta */}
      {state !== 'ready' && state !== 'error' && (
        <div
          className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-slate-900/80 text-white backdrop-blur-sm"
          style={{ height: dims.h }}
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

      {/* Wrapper que recorta y muestra el SDK escalado */}
      <div
        className="overflow-hidden rounded-2xl bg-black"
        style={{
          width: dims.w,
          height: dims.h,
          // Transición suave entre tamaños
          transition: 'width 200ms ease-out, height 200ms ease-out',
        }}
      >
        <div
          ref={containerRef}
          style={{
            width: SDK_NATURAL_W,
            height: SDK_NATURAL_H,
            transform: `scale(${dims.scale})`,
            transformOrigin: 'top left',
            transition: 'transform 200ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
