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
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BANNER_TONES, premiumCtaClass, premiumGhostCtaClass } from '@/modules/portal/components/premiumBanner';

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
        const T = BANNER_TONES.brand; // DGG-254 · premium marca-nativa
        return (
          <div
            key={e.encuentro_id}
            className={`relative flex flex-col gap-3 overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white motion-safe:animate-fade-up sm:flex-row sm:items-center sm:justify-between sm:p-5 ${T.grad}`}
          >
            <TrianglesAccent position="top-right" size={120} tone={T.tri} density="rich" className="opacity-20" />
            <div className="relative min-w-0">
              <p className={`kicker inline-flex items-center gap-1.5 ${T.accent}`}>
                <Radio size={13} className="animate-pulse" /> Tu clase es hoy
              </p>
              <h3 className="mt-1 font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
                ¡Hoy se dicta «{e.modulo}»!
              </h3>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-white/75">
                <span className="truncate">{e.curso_titulo}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 font-medium text-white">
                  <Clock size={13} /> {hora} hs · {e.duracion_min} min
                </span>
              </p>
            </div>
            {/* E-GG-145: el CTA SIEMPRE lleva al campus (la página del curso
                ofrece el embed con identidad → asistencia en tiempo real).
                El link crudo de Zoom acá dejaba al alumno invisible para la
                asistencia automática. */}
            {now >= new Date(e.fecha_hora).getTime() - GATE_PREV_MS ? (
              <Link to={`/portal/campus/${e.curso_slug ?? ''}`} className={`relative shrink-0 ${premiumCtaClass('brand')}`}>
                Entrar a la clase <ArrowRight size={15} />
              </Link>
            ) : (
              <Link to={`/portal/campus/${e.curso_slug ?? ''}`} className={`relative shrink-0 ${premiumGhostCtaClass}`}>
                Ver en el campus <ArrowRight size={15} />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
