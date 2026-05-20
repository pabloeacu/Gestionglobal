import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Sonidos sutiles generados con WebAudio (sin assets pesados).
// Toggle persistente en localStorage. Off por default la primera visita.
// Respeta prefers-reduced-motion (que tradicionalmente también implica
// preferencia por interfaces calmas).

export type SoundEvent = 'open' | 'close' | 'success' | 'error' | 'click';

interface SoundApi {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  play: (event: SoundEvent) => void;
}

const SoundContext = createContext<SoundApi | null>(null);
const STORAGE_KEY = 'gg.ui.sound';

function userPrefersCalmInterface(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  // Cargar preferencia
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === '1') setEnabledState(true);
      else if (stored === '0') setEnabledState(false);
      else setEnabledState(!userPrefersCalmInterface() ? false : false); // off por default
    } catch {
      /* ignore */
    }
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (v) ensureContext(ctxRef);
  }, []);

  const play = useCallback(
    (event: SoundEvent) => {
      if (!enabled) return;
      const ctx = ensureContext(ctxRef);
      if (!ctx) return;
      const t = ctx.currentTime;
      const preset = PRESETS[event];
      preset(ctx, t);
    },
    [enabled],
  );

  return (
    <SoundContext.Provider value={{ enabled, setEnabled, play }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSounds(): SoundApi {
  const ctx = useContext(SoundContext);
  if (!ctx) {
    // Tolerar ausencia del provider (modo gracia): devuelve no-op API
    return {
      enabled: false,
      setEnabled: () => {},
      play: () => {},
    };
  }
  return ctx;
}

// ---------------- internals ----------------

type CtxRef = React.MutableRefObject<AudioContext | null>;

function ensureContext(ref: CtxRef): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ref.current) return ref.current;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ref.current = new Ctor();
    return ref.current;
  } catch {
    return null;
  }
}

type Preset = (ctx: AudioContext, t0: number) => void;

// Cada sonido es muy corto (60–150 ms), suave (gain < 0.12), y usa formas
// sinusoidales / triangulares para sonar "Apple" en lugar de gamer.
const PRESETS: Record<SoundEvent, Preset> = {
  click: (ctx, t0) => tone(ctx, t0, { f1: 880, f2: 880, dur: 0.05, type: 'sine', peak: 0.05 }),
  open: (ctx, t0) => {
    // Sweep ascendente suave 540 → 760 Hz
    tone(ctx, t0, { f1: 540, f2: 760, dur: 0.14, type: 'sine', peak: 0.08 });
  },
  close: (ctx, t0) => {
    // Sweep descendente 720 → 480 Hz
    tone(ctx, t0, { f1: 720, f2: 480, dur: 0.12, type: 'sine', peak: 0.07 });
  },
  success: (ctx, t0) => {
    // Dos notas cortas (E5 → A5)
    tone(ctx, t0, { f1: 659, f2: 659, dur: 0.07, type: 'sine', peak: 0.06 });
    tone(ctx, t0 + 0.07, { f1: 880, f2: 880, dur: 0.11, type: 'sine', peak: 0.08 });
  },
  error: (ctx, t0) => {
    // Triángulo grave con leve bajada (E♭4 → C4)
    tone(ctx, t0, { f1: 311, f2: 262, dur: 0.18, type: 'triangle', peak: 0.09 });
  },
};

function tone(
  ctx: AudioContext,
  t0: number,
  opts: { f1: number; f2: number; dur: number; type: OscillatorType; peak: number },
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.f1, t0);
  if (opts.f2 !== opts.f1) {
    osc.frequency.exponentialRampToValueAtTime(opts.f2, t0 + opts.dur);
  }
  // Envelope: attack rápido, decay suave (ADSR simple A=4ms, D=resto)
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.peak, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}
