import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, ArrowLeft } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { Button } from '@/components/common';
import { BrandBackdrop } from '@/components/brand/BrandBackdrop';
import { BrandMark } from '@/components/brand/BrandMark';

// Login único. Tras autenticar, App.tsx redirige según el rol del profile
// (gerente → /gerencia, administrador → /portal).
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSupabaseConfigured) {
      setError('Supabase aún no está configurado (entorno local).');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) {
      setError('Email o contraseña incorrectos.');
      return;
    }
    navigate('/');
  }

  return (
    <div className="flex min-h-screen font-sans">
      {/* panel de marca */}
      <div className="relative hidden w-1/2 overflow-hidden lg:block">
        <BrandBackdrop />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <BrandMark variant="dark" size={40} withSlogan />
          <div>
            <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
              Todo fluye
              <br />
              <span className="bg-gradient-to-r from-brand-cyan-light to-brand-teal bg-clip-text text-transparent">
                cuando todo está conectado.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-white/60">
              Clientes, trámites, facturación, cuenta corriente, campus y
              reportes — desde un único lugar.
            </p>
          </div>
          <p className="text-xs text-white/35">#AliadosDeTuTiempo</p>
        </div>
      </div>

      {/* formulario */}
      <div className="flex w-full flex-col items-center justify-center bg-white px-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <Link
            to="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
          >
            <ArrowLeft size={15} /> Volver al inicio
          </Link>

          <BrandMark variant="light" size={42} className="mb-7 lg:hidden" />

          <p className="kicker">Acceso a la plataforma</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink">
            Ingresá a tu cuenta
          </h1>
          <p className="mt-2 text-sm text-brand-muted">
            Un único acceso · te llevamos a tu panel según tu perfil.
          </p>

          {!isSupabaseConfigured && (
            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
              Entorno local: el backend Supabase todavía no está conectado.
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <label className="kicker block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
              />
            </div>
            <div className="space-y-1.5">
              <label className="kicker block">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              type="submit"
              loading={loading}
              className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3 shadow-[0_8px_24px_-8px_rgba(0,158,202,0.6)] hover:from-brand-blue hover:to-brand-blue"
            >
              <LogIn size={16} /> Ingresar
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-brand-muted">
            ¿Todavía no sos cliente?{' '}
            <Link to="/" className="font-medium text-brand-cyan hover:underline">
              Conocé los servicios
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
