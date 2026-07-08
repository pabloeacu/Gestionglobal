// Hook compartido: fetch del webinar-acceso por token + countdown.
// Usado por WebinarPublicoPage (standalone) y CampusWebinarPage (G2 · wrapper Campus).

import { useEffect, useState } from 'react';

export interface WebinarAccesoResp {
  ok: true;
  inscripto: {
    id: string;
    nombre: string;
    email: string;
    canal: 'zoom' | 'youtube' | 'presencial';
    es_prospecto: boolean;
    es_cliente: boolean;
    asistio: boolean;
    tiempo_conectado_seg: number;
  };
  webinar: {
    id: string;
    titulo: string;
    descripcion: string | null;
    fecha_hora: string;
    duracion_min: number;
    status: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
    plataforma: 'zoom' | 'webex';
    modalidad: 'online' | 'presencial' | 'mixto';
    tipo: string | null;
    ubicacion_lugar: string | null;
    ubicacion_direccion: string | null;
    ubicacion_localidad: string | null;
    ubicacion_mapa_url: string | null;
    ubicacion_instrucciones: string | null;
    grabacion_url: string | null;
  };
  acceso: {
    canal: 'zoom' | 'youtube' | 'presencial';
    join_url: string | null;
    zoom_password: string | null;
    zoom_meeting_number: string | null;
    in_window: boolean;
    is_future: boolean;
    is_past: boolean;
    vence_at: string;
  };
}

interface ErrResp {
  ok: false;
  error: { code: string; message: string };
}

export type WebinarAccesoState =
  | { state: 'loading' }
  | { state: 'ok'; resp: WebinarAccesoResp }
  | { state: 'error'; message: string };

export function useWebinarAcceso(token: string | undefined): WebinarAccesoState {
  const [s, setS] = useState<WebinarAccesoState>({ state: 'loading' });

  useEffect(() => {
    if (!token) {
      setS({ state: 'error', message: 'Token faltante.' });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webinar-acceso/${token}`;
        const res = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        });
        const j = (await res.json()) as WebinarAccesoResp | ErrResp;
        if (cancelled) return;
        if (!j.ok) {
          setS({ state: 'error', message: j.error?.message ?? 'Acceso no válido' });
          return;
        }
        setS({ state: 'ok', resp: j });
      } catch {
        if (cancelled) return;
        setS({ state: 'error', message: 'No pudimos cargar el webinar. Probá de nuevo en unos minutos.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return s;
}

export function useCountdown(targetIso: string): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const target = new Date(targetIso).getTime();
  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
