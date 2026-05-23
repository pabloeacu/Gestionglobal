import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Maximize2, Minimize2 } from 'lucide-react';
import { firmarSdk } from '@/services/api/campus';

// DGG-14: embed del Web Meeting SDK de Zoom (Component View).
//
// Pide la firma al edge fn zoom-sdk-signature, carga dinámicamente
// `@zoom/meetingsdk/embedded` (≈1.5MB → lazy import por ruta) y monta el
// cliente dentro del contenedor `zoomAppRoot`. El customerKey que va al
// join es el matricula_id (o null para staff/host); eso es lo que el
// webhook lee en participant_joined para registrar asistencia.
//
// Tamaño: por defecto compacto (16:9, max-width 720px ≈ 405px de alto) para
// no romper el flow del campus. Botón "Expandir" permite al alumno ver
// grande puntualmente (modo "ampliado" hasta el ancho útil del main).

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

// Dimensiones internas del SDK por modo. El SDK respeta estos como
// "ideal" para gallery/speaker; el contenedor DOM las constrasta para que
// no exploten visualmente.
const COMPACT_W = 720;
const COMPACT_H = 405; // 16:9
const LARGE_W = 1080;
const LARGE_H = 608;  // 16:9

export function ZoomLiveEmbed(props: ZoomLiveEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<unknown>(null);
  const initedRef = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'joining' | 'ready' | 'error'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

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
              // Compacto por defecto; el botón "Expandir" alterna sin
              // re-inicializar el cliente (el SDK adapta al container).
              isResizable: true,
              viewSizes: {
                default: { width: COMPACT_W, height: COMPACT_H },
                ribbon: { width: COMPACT_W, height: 80 },
              },
            },
            // Dejamos los controles default del SDK (mute/cam/leave) para
            // que el alumno pueda interactuar.
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
        // Eventos NO fatales del SDK que igual entran al catch (el SDK
        // los emite como rejects pero se autorrecupera o representan estados
        // benignos):
        //   - 3008 MEETING_NOT_STARTED → sala de espera, viewport montado.
        //   - RECONNECTING_MEETING → reconexión transitoria; el SDK recupera
        //     solo en pocos segundos.
        //   - NETWORK_DISCONNECTED → idem.
        //   - Mensajes "waiting", "reconnect", "network".
        const code = e?.errorCode ?? e?.reason?.errorCode;
        const msg = String(e?.message ?? e?.reason ?? e?.type ?? '');
        const isTransient =
          code === 3008 ||
          /not.?started|waiting.?for.?host|host.?has.?not.?started|reconnect|network[_ ]?disconnect/i.test(
            msg,
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

  // Cuando cambia "expanded", reconfiguramos el viewSize del SDK
  // dinámicamente (sin recrear el cliente).
  useEffect(() => {
    const client: any = clientRef.current;
    if (!client || state !== 'ready') return;
    const w = expanded ? LARGE_W : COMPACT_W;
    const h = expanded ? LARGE_H : COMPACT_H;
    try {
      // updateVideoOptions existe en Component View v3+
      client.updateVideoOptions?.({ viewSizes: { default: { width: w, height: h } } });
    } catch { /* noop */ }
  }, [expanded, state]);

  return (
    <div className="relative mx-auto" style={{ maxWidth: expanded ? LARGE_W : COMPACT_W }}>
      {/* Loader/joining overlay — sobre el contenedor del embed */}
      {state !== 'ready' && state !== 'error' && (
        <div
          className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-slate-900/70 text-white backdrop-blur-sm"
          style={{ minHeight: expanded ? LARGE_H : COMPACT_H }}
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

      {/* Toggle expandir/contraer — solo cuando ya entró a la sala */}
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

      <div
        ref={containerRef}
        className="overflow-hidden rounded-2xl bg-black"
        style={{
          width: '100%',
          height: expanded ? LARGE_H : COMPACT_H,
          // Transición suave entre tamaños
          transition: 'height 200ms ease-out',
        }}
      />
    </div>
  );
}
