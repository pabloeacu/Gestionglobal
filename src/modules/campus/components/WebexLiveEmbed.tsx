import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';

// DGG-19 · Webex Meetings Widget embed.
//
// Usa @webex/widgets. El widget se monta con un accessToken obtenido
// desde nuestra edge function `webex-guest-token`. Soporta:
// - Layout 16:9 horizontal (style prop)
// - Layouts internos: Grid / Focus / Stack / Prominent / Overlay
// - Toolbar nativa: mic, cam, share screen, participants, settings, leave
// - Custom controls via `controls` function prop
//
// Limitaciones del widget vs Webex app oficial:
// - No polls
// - No breakout rooms
// - No chat completo (solo roster)

interface Props {
  encuentroId: string;
  userName: string;
  webexJoinUrl?: string | null;
  /** Disparado cuando el participante abandona */
  onLeft?: () => void;
}

interface WebexCreds {
  token: string;
  meetingId: string;
  meetingNumber: string | null;
  password: string | null;
  displayName: string;
  customerKey: string | null;
}

export function WebexLiveEmbed({ encuentroId, userName, webexJoinUrl, onLeft }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTokenAndMount() {
      setState('loading');
      setErrorMsg(null);
      try {
        // 1) Obtener guest token desde edge function
        const { data: session } = await supabase.auth.getSession();
        const accessToken = session?.session?.access_token;
        if (!accessToken) throw new Error('No estás autenticado.');

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webex-guest-token`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ encuentro_id: encuentroId }),
        });

        const j = await res.json();
        if (!res.ok) {
          const code = j?.error || `http_${res.status}`;
          // Mensajes user-friendly para errores conocidos
          if (code === 'webex_guest_creds_not_configured') {
            throw new Error(
              'Webex no está configurado todavía. Avisale al administrador del campus.',
            );
          }
          if (code === 'not_webex_encuentro') {
            throw new Error('Este encuentro no es Webex.');
          }
          if (code === 'webex_meeting_not_set') {
            throw new Error('El encuentro no tiene meeting de Webex creado aún.');
          }
          if (code === 'not_matriculado') {
            throw new Error('No estás matriculado en este curso.');
          }
          throw new Error(j?.detail || code);
        }

        if (cancelled) return;

        // 2) Importar dinámicamente el widget (es pesado)
        const widgetsMod = await import('@webex/widgets');
        const WebexMeetingsWidget = (widgetsMod as any).WebexMeetingsWidget;
        if (!WebexMeetingsWidget) throw new Error('Webex widget no disponible.');

        if (cancelled || !containerRef.current) return;

        // 3) Render del widget via createRoot (compat React 18)
        const ReactDOM = await import('react-dom/client');
        const root = ReactDOM.createRoot(containerRef.current);
        // @ts-ignore — el widget acepta props que TS no infiere
        root.render(
          <WebexMeetingsWidget
            accessToken={(j as WebexCreds).token}
            meetingDestination={(j as WebexCreds).meetingId}
            meetingPasswordOrPin={(j as WebexCreds).password || undefined}
            participantName={(j as WebexCreds).displayName || userName}
            layout="focus"
            style={{ width: '100%', height: '100%' }}
          />,
        );

        setState('ready');

        return () => {
          try { root.unmount(); } catch { /* opt */ }
        };
      } catch (e: any) {
        if (cancelled) return;
        console.error('WebexLiveEmbed error', e);
        setErrorMsg(e?.message ?? 'No pudimos conectar a Webex.');
        setState('error');
      }
    }

    void fetchTokenAndMount();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuentroId]);

  // Cuando el alumno cierra el widget desde dentro (botón leave nativo),
  // el componente disparará un evento que podemos capturar. Por ahora,
  // confiamos en el cleanup del unmount.
  useEffect(() => {
    return () => {
      onLeft?.();
    };
  }, [onLeft]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-3xl border border-slate-200/70 bg-slate-950 shadow-2xl ring-1 ring-brand-cyan/20">
      {state === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-slate-950 text-white">
          <div className="flex flex-col items-center gap-2 text-sm">
            <Loader2 size={24} className="animate-spin" />
            <span>Conectando a Webex…</span>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="absolute inset-0 grid place-items-center bg-red-50 p-6 text-red-700">
          <div className="max-w-md text-center">
            <AlertCircle size={32} className="mx-auto mb-2" />
            <p className="font-semibold">No pudimos conectar a Webex</p>
            <p className="mt-1 text-xs">{errorMsg}</p>
            {webexJoinUrl && (
              <a
                href={webexJoinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand-cyan px-4 py-2 text-xs font-semibold text-white hover:bg-brand-cyan/90"
              >
                <ExternalLink size={13} /> Abrir Webex oficial
              </a>
            )}
          </div>
        </div>
      )}

      {/* Contenedor donde el widget se monta */}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
