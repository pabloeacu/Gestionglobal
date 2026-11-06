// LexphSuscripcion · formulario de alta al newsletter (doble opt-in). DGG-244 F2d.
// Vive en la franja del newsletter del home (fondo teal→cian). Alta anon → email de
// confirmación. Respuesta genérica (sin enumeración). R13 (sonner para feedback fugaz).

import { useState } from 'react';
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { suscribirLexph } from '@/services/api/lexphPublic';

// Validación de formato en cliente (la verdad la da el doble opt-in).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LexphSuscripcion() {
  const [email, setEmail] = useState('');
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'ok'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      toast.error('Ingresá un correo válido');
      return;
    }
    setEstado('enviando');
    const res = await suscribirLexph(value);
    if (!res.ok) {
      setEstado('idle');
      toast.error('No pudimos registrarte', { description: humanizeError(res.error) });
      return;
    }
    setEstado('ok');
  }

  if (estado === 'ok') {
    return (
      <div className="flex items-start gap-3 rounded-none border border-white/40 bg-white/10 px-5 py-4 text-white">
        <CheckCircle2 size={22} className="mt-0.5 shrink-0" aria-hidden />
        <div>
          <p className="font-gg-display text-sm font-semibold uppercase tracking-[0.06em]">Revisá tu correo</p>
          <p className="mt-1 text-sm text-white/90">
            Te enviamos un email para <strong>confirmar</strong> tu suscripción. Si no lo ves, mirá en spam.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2.5 sm:flex-row sm:items-center">
      <label htmlFor="lexph-susc-email" className="sr-only">
        Tu correo electrónico
      </label>
      <div className="relative flex-1">
        <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden />
        <input
          id="lexph-susc-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
          disabled={estado === 'enviando'}
          className="w-full border border-white/50 bg-white py-3 pl-9 pr-3 text-sm text-brand-ink outline-none placeholder:text-brand-muted focus:ring-2 focus:ring-white/60 disabled:opacity-60"
        />
      </div>
      <button
        type="submit"
        disabled={estado === 'enviando'}
        className="lexph-cta lexph-cta-ink inline-flex shrink-0 items-center justify-center gap-2 bg-brand-ink px-6 py-3 font-gg-display text-sm font-semibold uppercase tracking-[0.07em] text-white disabled:opacity-70"
      >
        {estado === 'enviando' ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Enviando…
          </>
        ) : (
          'Suscribirme'
        )}
      </button>
    </form>
  );
}
