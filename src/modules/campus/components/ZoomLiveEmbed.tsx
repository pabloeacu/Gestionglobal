import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// El SDK ya trae su propia toolbar nativa (Audio, Cámara, Participantes,
// Compartir pantalla, Más, Salir) + header con Vista de galería, Información
// sobre la reunión, Vista minimizada/ampliada. No duplicamos esos controles.
// Sólo agregamos un botón "Ampliar/Compacto" propio para el toggle de tamaño
// del bloque dentro del campus.
//
// Dimensiones del bloque visible:
//   - Compact: 720 ancho × ~480 alto (cabe sin scroll, video grande)
//   - Ampliado: 1080 ancho × ~720 alto (vista grande)
// El alto total incluye: header del SDK (~50px) + video gallery + toolbar
// inferior del SDK (~64px). Le damos al viewport del SDK el espacio
// completo para que TODO se vea sin recortes.

export interface ZoomLiveEmbedProps {
  encuentroId: string;
  userName: string;
  asHost?: boolean;
  password?: string | null;
  onLeft?: () => void;
}

const COMPACT_W = 720;
const COMPACT_H = 480;
const LARGE_W = 1080;
const LARGE_H = 720;

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);
  const initedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'joining' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const dims = useMemo(
    () => ({
      w: expanded ? LARGE_W : COMPACT_W,
      h: expanded ? LARGE_H : COMPACT_H,
    }),
    [expanded],
  );

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
              // El SDK acomoda header + video + toolbar dentro de este area.
              // En compact: 720 ancho → toolbar visible al fondo.
              viewSizes: {
                default: { width: COMPACT_W, height: COMPACT_H - 50 },
                ribbon: { width: COMPACT_W, height: 80 },
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

        // Forzar vista "active" para que el video del host LLENE el viewport
        // (en lugar de gallery con espacios vacíos cuando hay sólo 1 cámara).
        try {
          const c: any = client;
          await c.changeView?.({ view: 'active' });
        } catch { /* la opción puede no estar disponible */ }

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

  // Toggle Ampliar/Compacto: re-instruye al SDK sobre el viewSize
  // sin recrear el cliente. La conexión + audio + video persisten.
  useEffect(() => {
    const client: any = clientRef.current;
    if (!client || state !== 'ready') return;
    try {
      client.updateVideoOptions?.({
        viewSizes: {
          default: { width: dims.w, height: dims.h - 50 },
          ribbon: { width: dims.w, height: 80 },
        },
      });
    } catch { /* noop */ }
  }, [dims.w, dims.h, state]);

  return (
    <div className="relative mx-auto" style={{ width: dims.w }}>
      {/* Overlay loader */}
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

      {/* Toggle Ampliar/Compacto — único control propio, encima del SDK.
          Posicionado a la izquierda del header del SDK (que tiene icons a
          la derecha) para no taparlos. */}
      {state === 'ready' && (
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Vista compacta' : 'Vista ampliada'}
          className="absolute left-3 top-3 z-20 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm transition hover:bg-black/70"
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

      {/* Viewport del SDK — alto completo con espacio para header + video
          + toolbar nativa del SDK */}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl bg-black"
        style={{
          width: dims.w,
          height: dims.h,
          transition: 'width 200ms ease-out, height 200ms ease-out',
        }}
      />
    </div>
  );
}
