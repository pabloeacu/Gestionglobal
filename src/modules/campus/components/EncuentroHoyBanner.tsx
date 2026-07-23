// DGG-112 · Banner informativo "HOY tenés clase" en el portal del alumno.
// Visible solo el día del encuentro (la RPC filtra por fecha AR) y se
// auto-oculta cuando la clase termina (inicio + duración) — chequeo por
// minuto del lado del cliente además del filtro del server. Meramente
// informativo: no se puede descartar, desaparece solo.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clock, Radio } from 'lucide-react';
import {
  fetchAlumnoEncuentrosHoy,
  type EncuentroHoy,
} from '@/services/api/campus';

// F9-ter: el join directo a la sala recién se habilita 10 min antes del inicio
// (mismo criterio que EncuentrosEnVivoAlumno y la HotCard de PortalHome — "no
// dos botones con criterios distintos"). Antes de eso, el CTA lleva al campus.
const GATE_PREV_MS = 10 * 60_000;

export function EncuentroHoyBanner() {
  const [items, setItems] = useState<EncuentroHoy[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void fetchAlumnoEncuentrosHoy().then((r) => {
      if (r.ok) setItems(r.data);
    });
  }, []);

  // Re-evalúa cada minuto: desaparece al terminar la clase y habilita el join
  // directo al entrar en la ventana F9-ter.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const vivos = useMemo(
    () =>
      items.filter(
        (e) => new Date(e.fecha_hora).getTime() + e.duracion_min * 60_000 > now,
      ),
    [items, now],
  );

  if (vivos.length === 0) return null;

  return (
    <div className="space-y-3">
      {vivos.map((e) => {
        const hora = new Date(e.fecha_hora).toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Argentina/Buenos_Aires',
        });
        return (
          <div
            key={e.encuentro_id}
            className="flex flex-col gap-3 rounded-3xl border border-brand-cyan/30 bg-gradient-to-r from-brand-cyan-pale/50 via-white to-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between motion-safe:animate-fade-up"
          >
            <div className="min-w-0">
              <p className="kicker inline-flex items-center gap-1.5 text-brand-cyan">
                <Radio size={13} className="animate-pulse" /> Tu clase es hoy
              </p>
              <p className="mt-1 font-display text-lg font-bold leading-tight text-brand-ink">
                ¡Hoy se dicta «{e.modulo}»!
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-brand-muted">
                <span className="truncate">{e.curso_titulo}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-brand-ink">
                  <Clock size={13} /> {hora} hs · {e.duracion_min} min
                </span>
              </p>
            </div>
            {/* E-GG-145: el CTA SIEMPRE lleva al campus (la página del curso
                ofrece el embed con identidad → asistencia en tiempo real).
                El link crudo de Zoom acá dejaba al alumno invisible para la
                asistencia automática. */}
            {now >= new Date(e.fecha_hora).getTime() - GATE_PREV_MS ? (
              <Link
                to={`/portal/campus/${e.curso_slug ?? ''}`}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-cyan px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-brand-teal"
              >
                Entrar a la clase <ArrowRight size={15} />
              </Link>
            ) : (
              <Link
                to={`/portal/campus/${e.curso_slug ?? ''}`}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-cyan/40 bg-white px-4 py-2.5 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan-pale/40"
              >
                Ver en el campus <ArrowRight size={15} />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
