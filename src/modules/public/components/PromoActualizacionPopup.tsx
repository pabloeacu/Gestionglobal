// Pop-up promocional del Curso de Actualización RPAC (landing pública).
// Reemplaza al viejo pop del Curso de Formación (DGG-239). Cambios de estética
// pedidos por Pablo para que NO se lea como "más de lo mismo":
//   - el teléfono se recuesta sobre la DERECHA (antes izquierda); el mensaje va
//     a la izquierda. En mobile el teléfono queda arriba (el video manda).
//   - gradiente espejado (bottom-left) para que el filo cian mire al mensaje.
// - Se abre automático ~1,5s después de cargar la landing, en cada visita, +
//   botón flotante para reabrirlo si lo cerraron.
// - Video vertical 9:16 en un marco de celular, autoplay MUDO + botón de sonido.
// - CTA "Inscribirme" → /formulario/curso-actualizacion (PBA). Cierra con X, Esc o backdrop.
// - FECHA LÍMITE: desaparece por completo (modal + botón flotante) el 15/12/2026
//   (hora Argentina). A partir de ahí la landing carga sin ningún pop-up.
// Vive dentro del escape data-gg-classic de la landing: el tema gg-brand NO lo toca.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Volume2, VolumeX, Play, ArrowRight } from 'lucide-react';

const VIDEO_SRC = '/landing/promo/curso-actualizacion.mp4';
const POSTER_SRC = '/landing/promo/curso-actualizacion-poster.jpg';
const FORM_HREF = '/formulario/curso-actualizacion';

// Desaparece el 15/12/2026 00:00 America/Argentina/Buenos_Aires (UTC-3).
// (mes 0-indexado → 11 = diciembre). Cambiar una sola línea para correr la fecha.
const CUTOFF_MS = Date.UTC(2026, 11, 15, 3, 0, 0);

export function PromoActualizacionPopup() {
  const expired = Date.now() >= CUTOFF_MS;
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Apertura automática al cargar (con un respiro para no atropellar el hero).
  // Si ya pasó la fecha límite, nunca abre.
  useEffect(() => {
    if (expired) return;
    const t = setTimeout(() => setOpen(true), 1500);
    return () => clearTimeout(t);
  }, [expired]);

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

  // Pasada la fecha límite: ni modal ni botón flotante → la web carga "de una".
  if (expired) return null;

  return (
    <>
      {/* Botón flotante para (re)abrir el pop cuando está cerrado */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-[#009eca] px-5 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-[#0089b0] hover:shadow-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-cyan-300/50"
          aria-label="Ver video del Curso de Actualización"
        >
          <Play size={16} className="fill-current" />
          Curso de Actualización
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Curso de Actualización"
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

            {/* Mobile: teléfono arriba, mensaje abajo (DOM order).
                Desktop: mensaje a la IZQUIERDA (order-1), teléfono a la DERECHA (order-2). */}
            <div className="grid gap-0 sm:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              {/* Teléfono con el video — a la derecha en desktop */}
              <div className="flex items-center justify-center bg-gradient-to-bl from-[#0b1f33] via-[#123a5c] to-[#009eca] p-6 sm:order-2 sm:p-8">
                <div className="relative shrink-0">
                  {/* Bisel del teléfono — envuelve la pantalla a su tamaño real */}
                  <div className="rounded-[2.4rem] bg-slate-950 p-[7px] shadow-2xl ring-1 ring-white/10">
                    {/* Pantalla EXACTAMENTE 9:16 = ratio del video → object-cover no recorta */}
                    <div className="relative w-[206px] overflow-hidden rounded-[2rem] bg-black sm:w-[228px]" style={{ aspectRatio: '9 / 16' }}>
                      <video
                        ref={videoRef}
                        className="absolute inset-0 h-full w-full object-cover"
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
                      {/* Play manual si el navegador frenó el autoplay */}
                      {!playing && (
                        <button
                          type="button"
                          onClick={() => {
                            const v = videoRef.current;
                            if (v) void v.play().then(() => setPlaying(true)).catch(() => {});
                          }}
                          className="absolute inset-0 grid place-items-center focus:outline-none"
                          aria-label="Reproducir video"
                        >
                          <span className="grid h-14 w-14 place-items-center rounded-full bg-white/90 text-[#122230] shadow-lg transition hover:scale-105">
                            <Play size={24} className="ml-0.5 fill-current" />
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Notch sobre el bisel */}
                  <div className="pointer-events-none absolute left-1/2 top-[7px] h-4 w-20 -translate-x-1/2 rounded-b-xl bg-slate-950" />
                  {/* Botón de sonido */}
                  <button
                    type="button"
                    onClick={toggleSound}
                    className="absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={muted ? 'Activar sonido' : 'Silenciar'}
                  >
                    {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                </div>
              </div>

              {/* Mensaje + CTA — a la izquierda en desktop */}
              <div className="flex flex-col justify-center gap-4 p-6 sm:order-1 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#009eca]">
                  Actualizá tu matrícula
                </p>
                <h2 className="font-display text-3xl font-extrabold leading-[1.05] text-[#122230] sm:text-4xl">
                  Curso de <span className="text-[#009eca]">Actualización</span>
                </h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  Curso <strong className="font-semibold text-slate-700">a distancia, de modalidad mixta</strong> —encuentros
                  sincrónicos en vivo + material asincrónico a tu ritmo—, con la máxima
                  calidad académica y una currícula sin precedentes.
                </p>
                <p className="border-l-2 border-[#009eca] pl-3 text-sm font-medium italic leading-relaxed text-[#122230]">
                  No subestimamos tu experiencia como administrador: por eso lo pensamos
                  como una instancia de perfeccionamiento que agrega valor real a tu labor diaria.
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
