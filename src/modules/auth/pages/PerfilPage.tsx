import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Bell,
  BellOff,
  Camera,
  LogOut,
  Mail,
  Shield,
  Trash2,
  UserRound,
  KeyRound,
  Loader2,
  Send,
} from 'lucide-react';
import { useAuth, type Role } from '@/contexts/AuthContext';
import { useSounds } from '@/contexts/SoundContext';
import {
  Button,
  CopyButton,
  Field,
  InlineEdit,
  Input,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import {
  changeMyPassword,
  deleteAvatar,
  updateMyProfile,
  uploadAvatar,
} from '@/services/api/perfil';
import {
  desuscribirPush,
  encolarPushDePrueba,
  estadoSuscripcion,
  pedirPermisoYSuscribir,
  pushSoportado,
} from '@/services/api/push';
import { AvatarEditor } from '@/modules/auth/components/AvatarEditor';
import { PerfilSesionesActivas } from '@/modules/auth/components/PerfilSesionesActivas';
import { Perfil2FA } from '@/modules/auth/components/Perfil2FA';
import { cn } from '@/lib/cn';

// "Mi perfil" — único lugar donde el usuario edita su propio nombre/avatar/
// password. El layout es deliberadamente editorial (cover + 3 tarjetas) para
// alinearse con la ficha de Administración (premium, no formulario plano).

const ROLE_LABEL: Record<Role, string> = {
  gerente: 'Gerente',
  operador: 'Operador',
  administrador: 'Administrador',
  partner: 'Partner',
};

const ROLE_TONE: Record<Role, string> = {
  gerente: 'bg-brand-cyan-pale/40 text-brand-cyan border-brand-cyan/30',
  operador: 'bg-brand-teal/10 text-brand-teal border-brand-teal/30',
  administrador: 'bg-amber-50 text-amber-700 border-amber-200',
  partner: 'bg-violet-50 text-violet-700 border-violet-200',
};

export function PerfilPage() {
  const { user, signOut, reloadProfile } = useAuth();
  const confirm = useConfirm();
  const { play } = useSounds();

  if (!user) {
    return (
      <div className="grid place-items-center p-16 text-sm text-brand-muted">
        Cargando tu perfil…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PerfilCover user={user} onReload={() => void reloadProfile()} play={play} />

      <PerfilDatos user={user} onReload={() => void reloadProfile()} play={play} />

      <PerfilPassword play={play} />

      <PerfilNotificacionesPush userId={user.id} play={play} />

      {/* P2-#33 · 2FA TOTP opcional */}
      <Perfil2FA />

      {/* P2-#35 · Sesiones activas (multi-device + cerrar otras) */}
      <PerfilSesionesActivas />

      <PerfilSesion
        onSignOut={async () => {
          const ok = await confirm({
            title: 'Cerrar sesión',
            message:
              'Si cerrás sesión vas a tener que volver a ingresar con tu email y contraseña.',
            confirmLabel: 'Cerrar sesión',
            cancelLabel: 'Quedarme',
            danger: true,
          });
          if (!ok) return;
          await signOut();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cover (gradient + triángulos + avatar sobresaliendo)
// ---------------------------------------------------------------------------

function PerfilCover({
  user,
  onReload,
  play,
}: {
  user: ReturnType<typeof useAuth>['user'] & {};
  onReload: () => void;
  play: (e: 'success' | 'error' | 'click' | 'open' | 'close') => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const confirm = useConfirm();

  const initials = (user!.fullName ?? user!.email ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset así el mismo archivo vuelve a disparar onChange
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Tiene que ser una imagen.');
      play('error');
      return;
    }
    // No bloqueamos por tamaño: el editor procesa cualquier original y
    // exporta un JPEG cuadrado liviano.
    setPendingFile(file);
  }

  async function onEditorConfirm(blob: Blob) {
    setUploading(true);
    setPendingFile(null);
    // El blob trae su mime real (webp o jpeg según soporte del browser).
    // Derivo la extensión para el path en Storage.
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const res = await uploadAvatar(blob, ext);
    setUploading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      return;
    }
    toast.success('Foto actualizada');
    play('success');
    onReload();
  }

  async function onRemoveAvatar() {
    const ok = await confirm({
      title: 'Quitar foto de perfil',
      message: 'Vas a volver a las iniciales. Podés subir otra cuando quieras.',
      confirmLabel: 'Quitar foto',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteAvatar();
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      return;
    }
    toast.success('Foto eliminada');
    play('success');
    onReload();
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm motion-safe:animate-fade-up">
      <div className="relative h-32 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal md:h-40">
        <TrianglesAccent
          position="top-right"
          size={240}
          tone="cyan"
          density="rich"
          className="opacity-60"
        />
        <TrianglesAccent
          position="bottom-left"
          size={170}
          tone="teal"
          density="soft"
          className="opacity-40"
        />
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.35),transparent_55%)]"
        />
      </div>

      <div className="relative px-6 pb-6 pt-0 sm:px-8">
        <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="relative">
              {user!.avatarUrl ? (
                <img
                  src={user!.avatarUrl}
                  alt={user!.fullName ?? 'Avatar'}
                  className="h-24 w-24 rounded-2xl border-4 border-white bg-white object-cover shadow-lg sm:h-28 sm:w-28"
                />
              ) : (
                <span className="grid h-24 w-24 place-items-center rounded-2xl border-4 border-white bg-gradient-to-br from-brand-cyan to-brand-teal font-display text-3xl font-bold text-white shadow-lg sm:h-28 sm:w-28">
                  {initials || <UserRound size={32} />}
                </span>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className={cn(
                  'absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-brand-ink text-white shadow-md transition hover:bg-brand-cyan',
                  uploading && 'cursor-wait opacity-80',
                )}
                aria-label="Cambiar foto"
                title="Cambiar foto"
              >
                {uploading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Camera size={14} />
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onFileSelected}
              />
              <AvatarEditor
                file={pendingFile}
                onCancel={() => setPendingFile(null)}
                onConfirm={onEditorConfirm}
              />
            </div>
            <div className="min-w-0 pb-1">
              <p className="kicker text-brand-cyan">Mi perfil</p>
              <h1 className="break-words font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
                {user!.fullName ?? 'Sin nombre'}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-semibold',
                    ROLE_TONE[user!.role],
                  )}
                >
                  <Shield size={11} />
                  {ROLE_LABEL[user!.role]}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-brand-muted">
                  <Mail size={11} />
                  <span className="text-brand-ink">{user!.email}</span>
                </span>
              </div>
            </div>
          </div>
          {user!.avatarUrl && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void onRemoveAvatar()}>
                <Trash2 size={14} /> Quitar foto
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Datos personales (InlineEdit en nombre + teléfono, email read-only con copy)
// ---------------------------------------------------------------------------

function PerfilDatos({
  user,
  onReload,
  play,
}: {
  user: NonNullable<ReturnType<typeof useAuth>['user']>;
  onReload: () => void;
  play: (e: 'success' | 'error') => void;
}) {
  async function patchFullName(v: string | null): Promise<void> {
    const res = await updateMyProfile({ full_name: v });
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      throw new Error(res.error.message);
    }
    toast.success('Nombre actualizado');
    play('success');
    onReload();
  }

  async function patchPhone(v: string | null): Promise<void> {
    const res = await updateMyProfile({ phone: v });
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      throw new Error(res.error.message);
    }
    toast.success('Teléfono actualizado');
    play('success');
    onReload();
  }

  return (
    <section className="card-premium relative overflow-hidden p-5 motion-safe:animate-fade-up">
      <TrianglesAccent
        position="top-right"
        size={150}
        tone="cyan"
        density="soft"
        className="opacity-25"
      />
      <div className="relative">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-cyan-pale/40 text-brand-cyan">
            <UserRound size={16} />
          </span>
          <h2 className="font-display text-base font-bold text-brand-ink">
            Datos personales
          </h2>
        </div>

        <dl className="divide-y divide-slate-100">
          <DataRow label="Nombre completo">
            <InlineEdit
              value={user.fullName}
              placeholder="Tu nombre"
              onSave={patchFullName}
            />
          </DataRow>
          <DataRow label="Email">
            <CopyButton value={user.email} label="Email" />
          </DataRow>
          <DataRow label="Teléfono">
            <InlineEdit
              value={user.phone}
              placeholder="agregar teléfono"
              type="tel"
              onSave={patchPhone}
            />
          </DataRow>
          <DataRow label="Rol">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                ROLE_TONE[user.role],
              )}
            >
              <Shield size={11} />
              {ROLE_LABEL[user.role]}
            </span>
          </DataRow>
        </dl>
      </div>
    </section>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-1 py-3 sm:grid-cols-3">
      <dt className="kicker">{label}</dt>
      <dd className="text-sm text-brand-ink sm:col-span-2">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cambio de contraseña
// ---------------------------------------------------------------------------

function PerfilPassword({
  play,
}: {
  play: (e: 'success' | 'error') => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [loading, setLoading] = useState(false);

  const showLengthHint = next.length > 0 && next.length < 8;
  const showMismatch = confirmNext.length > 0 && next !== confirmNext;
  const canSubmit =
    current.length > 0 &&
    next.length >= 8 &&
    confirmNext.length >= 8 &&
    next === confirmNext &&
    !loading;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    const res = await changeMyPassword(current, next);
    setLoading(false);
    if (!res.ok) {
      if (res.error.code === 'CONTRASEÑA_ACTUAL_INVALIDA') {
        toast.error('La contraseña actual no es correcta');
      } else {
        toast.error(res.error.message);
      }
      play('error');
      return;
    }
    toast.success('Contraseña actualizada');
    play('success');
    setCurrent('');
    setNext('');
    setConfirmNext('');
  }

  return (
    <section className="card-premium relative overflow-hidden p-5 motion-safe:animate-fade-up">
      <TrianglesAccent
        position="bottom-left"
        size={140}
        tone="teal"
        density="soft"
        className="opacity-25"
      />
      <div className="relative">
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-teal/10 text-brand-teal">
            <KeyRound size={16} />
          </span>
          <h2 className="font-display text-base font-bold text-brand-ink">
            Cambiar contraseña
          </h2>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Field label="Contraseña actual" required>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </Field>
          <Field
            label="Nueva contraseña"
            required
            hint={showLengthHint ? undefined : 'Mínimo 8 caracteres.'}
            error={showLengthHint ? 'Debe tener al menos 8 caracteres.' : null}
          >
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              placeholder="Tu nueva contraseña"
              invalid={showLengthHint}
              required
            />
          </Field>
          <Field
            label="Confirmar nueva contraseña"
            required
            error={showMismatch ? 'No coincide con la nueva contraseña.' : null}
          >
            <Input
              type="password"
              value={confirmNext}
              onChange={(e) => setConfirmNext(e.target.value)}
              autoComplete="new-password"
              placeholder="Repetí la nueva contraseña"
              invalid={showMismatch}
              required
            />
          </Field>
          <div className="flex justify-end pt-1">
            <Button type="submit" disabled={!canSubmit} loading={loading}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Notificaciones push (web push VAPID)
// ---------------------------------------------------------------------------

function PerfilNotificacionesPush({
  userId,
  play,
}: {
  userId: string;
  play: (e: 'success' | 'error' | 'click' | 'open' | 'close') => void;
}) {
  const [soportado, setSoportado] = useState<boolean>(true);
  const [activas, setActivas] = useState<boolean>(false);
  const [actuando, setActuando] = useState<boolean>(false);

  async function refresh() {
    setSoportado(pushSoportado());
    const res = await estadoSuscripcion();
    if (res.ok) setActivas(res.data.activa);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onActivar() {
    setActuando(true);
    const res = await pedirPermisoYSuscribir();
    setActuando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      return;
    }
    toast.success('Notificaciones activadas');
    play('success');
    setActivas(true);
  }

  async function onDesactivar() {
    setActuando(true);
    const res = await desuscribirPush();
    setActuando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      return;
    }
    toast.success('Notificaciones desactivadas');
    play('success');
    setActivas(false);
  }

  async function onProbar() {
    setActuando(true);
    const res = await encolarPushDePrueba(userId);
    setActuando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      play('error');
      return;
    }
    toast.success('Push de prueba en cola. Llegará en hasta 2 min.');
    play('success');
  }

  return (
    <section className="card-premium relative overflow-hidden p-5 motion-safe:animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-brand-ink">
            <Bell size={14} className="text-brand-cyan" /> Notificaciones push
          </h2>
          <p className="mt-1 text-sm text-brand-muted">
            Recibí avisos en tiempo real de vencimientos, trámites y recordatorios — incluso con la pestaña cerrada.
          </p>
          {!soportado && (
            <p className="mt-2 text-xs text-amber-700">
              Este browser no soporta notificaciones push.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {soportado && !activas && (
            <Button onClick={() => void onActivar()} loading={actuando}>
              <Bell size={14} /> Activar
            </Button>
          )}
          {soportado && activas && (
            <>
              <Button variant="ghost" onClick={() => void onProbar()} loading={actuando}>
                <Send size={14} /> Probar
              </Button>
              <Button variant="ghost" onClick={() => void onDesactivar()} loading={actuando}>
                <BellOff size={14} /> Desactivar
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sesión (cerrar sesión con confirmación)
// ---------------------------------------------------------------------------

function PerfilSesion({ onSignOut }: { onSignOut: () => void | Promise<void> }) {
  return (
    <section className="card-premium relative overflow-hidden p-5 motion-safe:animate-fade-up">
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-base font-bold text-brand-ink">Sesión</h2>
          <p className="mt-1 text-sm text-brand-muted">
            Si cerrás sesión vas a tener que volver a ingresar tu contraseña.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void onSignOut()}>
          <LogOut size={14} /> Cerrar sesión
        </Button>
      </div>
    </section>
  );
}

export default PerfilPage;
