import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, ArrowLeft, Loader2, CheckCircle2, Mail } from 'lucide-react';
import {
  supabase,
  arrivedWithRecoveryHash,
  isPasswordRecovery,
  onPasswordRecovery,
} from '@/lib/supabase';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { BrandBackdrop } from '@/components/brand/BrandBackdrop';
import { BrandMark } from '@/components/brand/BrandMark';
import { actualizarPasswordConRecovery, verificarCodigoRecovery } from '@/services/api/perfil';

// DGG-93 (reporte JL #5) + DGG-229 (E-GG-233) · Pantalla de recuperación de
// contraseña. Flujo con CÓDIGO de 6 dígitos: el email trae un código (no un link
// que se quema al abrirse — ver E-GG-233: los escáneres/webviews de Yahoo pre-
// visitaban el link y consumían el token de un solo uso). Acá el usuario tipea su
// email + el código → verifyOtp establece la sesión de recovery → fija la nueva
// clave con updateUser({password}); el servidor nunca ve la contraseña.
// Compatibilidad: si llega un link VIEJO aún en vuelo (hash type=recovery),
// saltamos directo al form de clave.
export function RestablecerPage() {
  const [estado, setEstado] = useState<'verificando' | 'codigo' | 'listo' | 'guardado'>(
    'verificando',
  );
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Prefill del email desde el link del mail (/restablecer?email=...).
    try {
      const q = new URLSearchParams(window.location.search).get('email');
      if (q) setEmail(q.trim().toLowerCase());
    } catch {
      /* noop */
    }

    let resuelto = false;
    const marcarListo = () => {
      if (!resuelto) {
        resuelto = true;
        setEstado('listo');
      }
    };

    // Compatibilidad con links VIEJOS (hash type=recovery / evento PASSWORD_RECOVERY):
    // si ya hay sesión de recovery, vamos directo al form de clave.
    if (arrivedWithRecoveryHash() || isPasswordRecovery()) {
      marcarListo();
      return;
    }

    // Flujo nuevo (código): si no llega una sesión de recovery por hash enseguida,
    // mostramos el form para ingresar el código de 6 dígitos.
    const off = onPasswordRecovery(marcarListo);
    const timer = setTimeout(() => {
      if (!resuelto) {
        resuelto = true;
        setEstado('codigo');
      }
    }, 1200);

    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  async function onVerificarCodigo(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setVerifying(true);
    const res = await verificarCodigoRecovery(email, codigo);
    setVerifying(false);
    if (!res.ok) {
      setError(res.error.message || humanizeError(res.error));
      return;
    }
    setError(null);
    setEstado('listo');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }
    setSaving(true);
    const res = await actualizarPasswordConRecovery(password);
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message || humanizeError(res.error));
      return;
    }
    setEstado('guardado');
    try {
      await supabase.auth.signOut();
    } catch {
      /* noop */
    }
    toast.success('¡Contraseña actualizada!', {
      description: 'Ya podés ingresar con tu nueva clave.',
    });
    // Salir con reload completo (no navigate SPA): resetea la señal de recovery de
    // la pestaña y descarta la sesión de recovery en memoria (E-GG-144 §6/DGG-93).
    setTimeout(() => window.location.assign('/ingresar'), 1800);
  }

  return (
    <div data-gg="auth" className="flex min-h-screen font-sans">
      <div className="relative hidden w-1/2 overflow-hidden lg:block">
        <BrandBackdrop />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-white">
          <BrandMark variant="dark" size={40} withSlogan />
          <div>
            <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
              Recuperá tu acceso
              <br />
              <span className="bg-gradient-to-r from-brand-cyan-light to-brand-teal bg-clip-text text-transparent">
                en segundos.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-white/60">
              Ingresá el código que te enviamos por correo y elegí una contraseña
              nueva. El código es personal y de un solo uso.
            </p>
          </div>
          <p className="text-xs text-white/35">#AliadosDeTuTiempo</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center bg-white px-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* <a>, no <Link>: TODA salida de /restablecer debe ser reload completo
              para resetear arrivedWithRecoveryHash (snapshot por pestaña). */}
          <a
            href="/ingresar"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
          >
            <ArrowLeft size={15} /> Ir al login
          </a>

          <BrandMark variant="light" size={42} className="mb-7 lg:hidden" />

          {estado === 'verificando' && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 size={26} className="animate-spin text-brand-cyan" />
              <p className="text-sm text-brand-muted">Un momento…</p>
            </div>
          )}

          {estado === 'codigo' && (
            <>
              <p className="kicker">Recuperación de acceso</p>
              <h1 className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-bold text-brand-ink">
                <Mail size={26} className="text-brand-cyan" />
                Ingresá tu código
              </h1>
              <p className="mt-2 text-sm text-brand-muted">
                Te enviamos un código a tu correo. Copialo acá para crear tu
                contraseña nueva. (Por seguridad, ahora usamos un código en vez de
                un enlace.)
              </p>

              <form onSubmit={onVerificarCodigo} className="mt-7 space-y-4">
                <div className="space-y-1.5">
                  <label className="kicker block">Tu email</label>
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
                  <label className="kicker block">Tu código</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={12}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 12))}
                    required
                    placeholder="Pegá el código del correo"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-xl tracking-[0.35em] outline-none transition placeholder:text-sm placeholder:tracking-normal focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <Button
                  type="submit"
                  loading={verifying}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3 shadow-[0_8px_24px_-8px_rgba(0,158,202,0.6)] hover:from-brand-blue hover:to-brand-blue"
                >
                  <KeyRound size={16} /> Continuar
                </Button>
              </form>

              <p className="mt-4 text-center text-sm text-brand-muted">
                ¿No te llegó o venció?{' '}
                <a href="/ingresar" className="font-medium text-brand-cyan hover:underline">
                  Pedí uno nuevo
                </a>
              </p>
            </>
          )}

          {estado === 'guardado' && (
            <div className="space-y-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={22} />
              </span>
              <h1 className="font-display text-2xl font-bold text-brand-ink">
                ¡Listo!
              </h1>
              <p className="text-sm text-brand-muted">
                Tu contraseña quedó actualizada. Te llevamos al login para que
                ingreses con la nueva…
              </p>
            </div>
          )}

          {estado === 'listo' && (
            <>
              <p className="kicker">Recuperación de acceso</p>
              <h1 className="mt-1 inline-flex items-center gap-2 font-display text-3xl font-bold text-brand-ink">
                <KeyRound size={26} className="text-brand-cyan" />
                Nueva contraseña
              </h1>
              <p className="mt-2 text-sm text-brand-muted">
                Elegí una contraseña de al menos 8 caracteres. Combiná mayúsculas,
                minúsculas, números y un símbolo.
              </p>

              <form onSubmit={onSubmit} className="mt-7 space-y-4">
                <div className="space-y-1.5">
                  <label className="kicker block">Nueva contraseña</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="kicker block">Repetir contraseña</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <Button
                  type="submit"
                  loading={saving}
                  className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3 shadow-[0_8px_24px_-8px_rgba(0,158,202,0.6)] hover:from-brand-blue hover:to-brand-blue"
                >
                  <KeyRound size={16} /> Guardar contraseña
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
