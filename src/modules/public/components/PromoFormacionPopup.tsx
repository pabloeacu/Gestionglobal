// Pop-up promocional del Curso de Formación (landing pública).
// - Se abre automático ~1,5s después de cargar la landing, en cada visita
//   (decisión Pablo), + botón flotante para reabrirlo si lo cerraron.
// - Video vertical 9:16 en un marco de celular, autoplay MUDO (los navegadores
//   bloquean autoplay con sonido) + botón de altavoz para activarlo.
// - CTA "Inscribirme" → /formulario/curso-formacion. Cierra con X, Esc o backdrop.
// Vive dentro del escape data-gg-classic de la landing: el tema gg-brand NO lo toca.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Volume2, VolumeX, Play, ArrowRight } from 'lucide-react';

const VIDEO_SRC = '/landing/promo/curso-formacion.mp4';
const POSTER_SRC = '/landing/promo/curso-formacion-poster.jpg';
const FORM_HREF = '/formulario/curso-formacion';

export function PromoFormacionPopup() {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Apertura automática al cargar (con un respiro para no atropellar el hero).
  useEffect(() => {
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Reproducir al abrir, pausar y silenciar al cerrar (no seguir sonando detrás).
  // Si el navegador bloquea el autoplay, reintentamos al primer gesto del usuario.
  useEffect(() => {
    const v = videoRef.current;
    if (!open || !v) {
      v?.pause();
      return;
    }
    v.currentTime = 0;
    v.muted = true;
    setMuted(true);
    const tryPlay = () => v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    void tryPlay();
    const onGesture = () => {
      if (v.paused) void tryPlay();
    };
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [open]);

  // Cerrar con Escape + bloquear scroll del body mientras está abierto.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const toggleSound = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted(next);
    if (!next) void v.play().catch(() => {});
  }, []);

  return (
    <>
      {/* Botón flotante para (re)abrir el pop cuando está cerrado */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#009eca] px-5 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-[#0089b0] hover:shadow-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/50"
          aria-label="Ver video del Curso de Formación"
        >
          <Play size={16} className="fill-current" />
          Curso de Formación
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Curso de Formación"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="relative my-auto w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            {/* Cerrar */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-600 shadow-md transition hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>

            <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
              {/* Columna izquierda: celular con el video */}
              <div className="flex items-center justify-center bg-gradient-to-br from-[#0b1f33] via-[#123a5c] to-[#009eca] p-6 sm:p-8">
                <div className="relative w-[210px] shrink-0 sm:w-[230px]" style={{ aspectRatio: '9 / 19.5' }}>
                  {/* Bisel del teléfono */}
                  <div className="absolute inset-0 rounded-[2.4rem] bg-slate-950 p-[6px] shadow-2xl ring-1 ring-white/10">
                    <video
                      ref={videoRef}
                      className="h-full w-full rounded-[2rem] object-cover"
                      src={VIDEO_SRC}
                      poster={POSTER_SRC}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  </div>
                  {/* Notch */}
                  <div className="pointer-events-none absolute left-1/2 top-[6px] h-4 w-20 -translate-x-1/2 rounded-b-xl bg-slate-950" />
                  {/* Play manual si el navegador frenó el autoplay */}
                  {!playing && (
                    <button
                      type="button"
                      onClick={() => {
                        const v = videoRef.current;
                        if (v) void v.play().then(() => setPlaying(true)).catch(() => {});
                      }}
                      className="absolute inset-0 grid place-items-center rounded-[2.4rem] focus:outline-none"
                      aria-label="Reproducir video"
                    >
                      <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-[#122230] shadow-lg transition hover:scale-105">
                        <Play size={24} className="ml-0.5 fill-current" />
                      </span>
                    </button>
                  )}
                  {/* Botón de sonido */}
                  <button
                    type="button"
                    onClick={toggleSound}
                    className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={muted ? 'Activar sonido' : 'Silenciar'}
                  >
                    {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
              </div>

              {/* Columna derecha: mensaje + CTA */}
              <div className="flex flex-col justify-center gap-4 p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#009eca]">
                  Inscripciones abiertas
                </p>
                <h2 className="font-display text-3xl font-extrabold leading-[1.05] text-[#122230] sm:text-4xl">
                  Curso de <span className="text-[#009eca]">Formación</span>
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Formate para la matriculación en el RPAC con el programa de Gestión Global
                  y FundPlata. Una generación de excelencia: cursada, materiales y acompañamiento
                  hasta tu habilitación.
                </p>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Link
                    to={FORM_HREF}
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#ff8200] px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-[#e67500] hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-300/50"
                  >
                    Inscribirme <ArrowRight size={16} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-medium text-slate-500 transition hover:text-slate-800"
                  >
                    Ahora no
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Certifica <span className="font-semibold text-slate-500">FundPlata</span> · Gestión Global
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
