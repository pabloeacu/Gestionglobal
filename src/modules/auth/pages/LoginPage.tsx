import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, ArrowLeft, ShieldCheck, Loader2, KeyRound, MailCheck } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { Button } from '@/components/common';
import { BrandBackdrop } from '@/components/brand/BrandBackdrop';
import { BrandMark } from '@/components/brand/BrandMark';
import {
  challengeAndVerify,
  getAuthAal,
  listFactors,
} from '@/services/api/mfa';
import { enviarResetPassword } from '@/services/api/perfil';

// Login único. Tras autenticar, App.tsx redirige según el rol del profile
// (gerente → /gerencia, administrador → /portal).
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // P2-#33 · MFA challenge state: si el user tiene 2FA, mostramos el step
  // de código TOTP en lugar de redirigir directo.
  const [mfaStep, setMfaStep] = useState<{ factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  // DGG-93 (JL #5) · Recuperar contraseña: un usuario bloqueado pide un link.
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function onSubmitForgot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setForgotSending(true);
    await enviarResetPassword(email);
    setForgotSending(false);
    // Respuesta genérica siempre (no revelamos si el email existe).
    setForgotSent(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isSupabaseConfigured) {
      setError('Supabase aún no está configurado (entorno local).');
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setLoading(false);
      setError('Email o contraseña incorrectos.');
      return;
    }
    // ¿Necesita upgradear a AAL2 por tener MFA activo?
    const aal = await getAuthAal();
    if (aal.ok && aal.data.nextLevel === 'aal2' && aal.data.currentLevel === 'aal1') {
      const factors = await listFactors();
      const verified = factors.ok ? factors.data.find((f) => f.status === 'verified') : null;
      if (verified) {
        setMfaStep({ factorId: verified.id });
        setLoading(false);
        return;
      }
    }
    setLoading(false);
    navigate('/');
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    if (!mfaStep) return;
    if (!/^\d{6}$/.test(mfaCode.trim())) {
      setError('Ingresá los 6 dígitos del código.');
      return;
    }
    setError(null);
    setVerifying(true);
    const r = await challengeAndVerify(mfaStep.factorId, mfaCode.trim());
    setVerifying(false);
    if (!r.ok) {
      setError('Código incorrecto · probá con el actual de tu app.');
      return;
    }
    navigate('/');
  }

  async function cancelMfa() {
    await supabase.auth.signOut();
    setMfaStep(null);
    setMfaCode('');
    setError(null);
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

          {mfaStep ? (
            <>
              <p className="kicker">Doble factor</p>
              <h1 className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-bold text-brand-ink">
                <ShieldCheck size={26} className="text-brand-cyan" />
                Verificación 2FA
              </h1>
              <p className="mt-2 text-sm text-brand-muted">
                Abrí tu app autenticadora e ingresá el código de 6 dígitos
                que aparece en pantalla.
              </p>
              <form onSubmit={onSubmitMfa} className="mt-7 space-y-4">
                <div className="space-y-1.5">
                  <label className="kicker block">Código TOTP</label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button
                  type="submit"
                  loading={verifying}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3 shadow-[0_8px_24px_-8px_rgba(0,158,202,0.6)] hover:from-brand-blue hover:to-brand-blue"
                >
                  {verifying ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                  Confirmar e ingresar
                </Button>
                <button
                  type="button"
                  onClick={() => void cancelMfa()}
                  className="block w-full text-center text-xs text-brand-muted hover:text-brand-ink"
                >
                  Cancelar y volver al login
                </button>
              </form>
            </>
          ) : mode === 'forgot' ? (
            <>
              <p className="kicker">Recuperar acceso</p>
              <h1 className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-bold text-brand-ink">
                <KeyRound size={26} className="text-brand-cyan" />
                Restablecer contraseña
              </h1>
              {forgotSent ? (
                <div className="mt-6 space-y-4">
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <MailCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" />
                    <p className="text-sm text-emerald-800">
                      Si <strong>{email || 'ese email'}</strong> está registrado, te enviamos un
                      correo con el enlace para crear una contraseña nueva. Revisá tu bandeja
                      (y la carpeta de spam). El enlace vence en 1 hora.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setForgotSent(false);
                    }}
                    className="block w-full text-center text-xs text-brand-muted transition hover:text-brand-ink"
                  >
                    ← Volver al login
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-2 text-sm text-brand-muted">
                    Ingresá tu email y te mandamos un enlace para crear una contraseña
                    nueva vos mismo.
                  </p>
                  <form onSubmit={onSubmitForgot} className="mt-7 space-y-4">
                    <div className="space-y-1.5">
                      <label className="kicker block">Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        autoFocus
                        className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
                      />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <Button
                      type="submit"
                      loading={forgotSending}
                      className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3 shadow-[0_8px_24px_-8px_rgba(0,158,202,0.6)] hover:from-brand-blue hover:to-brand-blue"
                    >
                      <MailCheck size={16} /> Enviarme el enlace
                    </Button>
                  </form>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className="mt-4 block w-full text-center text-xs text-brand-muted transition hover:text-brand-ink"
                  >
                    ← Volver al login
                  </button>
                </>
              )}
            </>
          ) : (
          <>
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

          <button
            type="button"
            onClick={() => {
              setError(null);
              setForgotSent(false);
              setMode('forgot');
            }}
            className="mt-4 block w-full text-center text-xs font-medium text-brand-cyan transition hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </button>

          <p className="mt-6 text-center text-xs text-brand-muted">
            ¿Todavía no sos cliente?{' '}
            <Link to="/" className="font-medium text-brand-cyan hover:underline">
              Conocé los servicios
            </Link>
          </p>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
