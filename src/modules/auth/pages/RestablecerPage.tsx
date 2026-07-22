import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, ArrowLeft, Loader2, CheckCircle2, ShieldAlert } from 'lucide-react';
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
import { actualizarPasswordConRecovery } from '@/services/api/perfil';

// DGG-93 (reporte JL #5) · Pantalla destino del link de recuperación de
// contraseña. Al llegar desde el email, supabase-js (detectSessionInUrl)
// establece una sesión de recovery; acá el usuario fija su nueva clave con
// updateUser({password}) — sin necesitar la anterior. El servidor nunca ve la
// contraseña. Si no hay sesión de recovery (link vencido/usado o acceso
// directo), mostramos el estado correspondiente.
export function RestablecerPage() {
  const [estado, setEstado] = useState<'verificando' | 'listo' | 'sin_sesion' | 'guardado'>(
    'verificando',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let resuelto = false;
    const marcarListo = () => {
      if (!resuelto) {
        resuelto = true;
        setEstado('listo');
      }
    };

    // Sólo mostramos el form si se llegó por un link de recuperación real
    // (hash type=recovery ó evento PASSWORD_RECOVERY) — NO por una sesión normal
    // ya activa. Así un usuario logueado que entra a /restablecer sin token ve
    // "enlace inválido", y no un form que operaría sobre su propia sesión.
    if (arrivedWithRecoveryHash() || isPasswordRecovery()) {
      marcarListo();
      return;
    }

    // El hash puede tardar en procesarse: esperamos el evento un momento.
    const off = onPasswordRecovery(marcarListo);
    const timer = setTimeout(() => {
      if (!resuelto) {
        resuelto = true;
        setEstado('sin_sesion');
      }
    }, 2500);

    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

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
      // res.error.message ya viene humanizado desde la capa de servicio (weak /
      // link vencido / etc.); no lo pisamos con humanizeError sobre el crudo.
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
    // Salir con reload completo (no navigate SPA): resetea la señal
    // arrivedWithRecoveryHash de la pestaña — si no, el login normal posterior
    // en ESTA pestaña no se persistiría en gg.auth.session (E-GG-144 §6/DGG-93)
    // — y descarta la sesión de recovery que queda en memoria del cliente.
    setTimeout(() => window.location.assign('/ingresar'), 1800);
  }

  return (
    <div className="flex min-h-screen font-sans">
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
              Elegí una contraseña nueva y volvé a tu panel. Este enlace es
              personal y de un solo uso.
            </p>
          </div>
          <p className="text-xs text-white/35">#AliadosDeTuTiempo</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center bg-white px-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <Link
            to="/ingresar"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-brand-muted transition hover:text-brand-ink"
          >
            <ArrowLeft size={15} /> Ir al login
          </Link>

          <BrandMark variant="light" size={42} className="mb-7 lg:hidden" />

          {estado === 'verificando' && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Loader2 size={26} className="animate-spin text-brand-cyan" />
              <p className="text-sm text-brand-muted">Validando tu enlace…</p>
            </div>
          )}

          {estado === 'sin_sesion' && (
            <div className="space-y-4">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">
                <ShieldAlert size={22} />
              </span>
              <h1 className="font-display text-2xl font-bold text-brand-ink">
                El enlace no es válido o venció
              </h1>
              <p className="text-sm text-brand-muted">
                Los enlaces de recuperación son de un solo uso y vencen en 1 hora.
                Pedí uno nuevo desde el login, en{' '}
                <strong>“¿Olvidaste tu contraseña?”</strong>.
              </p>
              <Button
                onClick={() => window.location.assign('/ingresar')}
                className="w-full rounded-xl bg-gradient-to-r from-brand-cyan to-brand-blue py-3"
              >
                Volver al login
              </Button>
            </div>
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
