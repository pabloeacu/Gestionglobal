import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  UserRound,
  Volume2,
  VolumeX,
  LogOut,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSounds } from '@/contexts/SoundContext';
import { cn } from '@/lib/cn';

// Menú único de usuario para el panel de gerencia.
// Sustituye al SidebarUser de la barra lateral (era redundante con la
// esquina superior derecha). El popover trae perfil + sonidos + salir.

interface UserMenuProps {
  perfilHref: string; // /gerencia/perfil  ó  /portal/perfil
}

export function UserMenu({ perfilHref }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const { enabled, setEnabled, play } = useSounds();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Cierra al hacer click afuera o pulsar Escape.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const initials = (user.fullName ?? user.email ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleLabel =
    user.role === 'gerente'
      ? 'Gerente'
      : user.role === 'operador'
        ? 'Operador'
        : user.role === 'administrador'
          ? 'Administrador'
          : user.role;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1 rounded-full p-0.5 transition hover:bg-slate-100"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Tu cuenta"
      >
        <Avatar avatarUrl={user.avatarUrl ?? null} initials={initials} size={36} />
        <ChevronDown
          size={13}
          className={cn(
            'text-brand-muted transition group-hover:text-brand-ink',
            open && 'rotate-180 text-brand-ink',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 origin-top-right overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-brand-ink/10 motion-safe:animate-fade-up"
        >
          {/* Encabezado: avatar + nombre + rol */}
          <div className="flex items-center gap-3 border-b border-slate-100 bg-brand-zebra/60 px-4 py-3">
            <Avatar avatarUrl={user.avatarUrl ?? null} initials={initials} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-brand-ink">
                {user.fullName ?? user.email}
              </p>
              <p className="truncate text-xs text-brand-muted">{roleLabel}</p>
            </div>
          </div>

          <ul className="py-1.5">
            <li>
              <Link
                to={perfilHref}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2 text-sm text-brand-ink transition hover:bg-brand-cyan-pale/40"
              >
                <Settings size={15} className="text-brand-muted" />
                Configurar perfil
              </Link>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const next = !enabled;
                  setEnabled(next);
                  if (next) play('click');
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-brand-ink transition hover:bg-brand-cyan-pale/40"
              >
                {enabled ? (
                  <Volume2 size={15} className="text-brand-cyan" />
                ) : (
                  <VolumeX size={15} className="text-brand-muted" />
                )}
                <span className="flex-1">
                  {enabled ? 'Silenciar sonidos' : 'Activar sonidos'}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                    enabled
                      ? 'bg-brand-cyan-pale text-brand-cyan'
                      : 'bg-slate-100 text-brand-muted',
                  )}
                >
                  {enabled ? 'on' : 'off'}
                </span>
              </button>
            </li>
            <li className="my-1 border-t border-slate-100" />
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
              >
                <LogOut size={15} />
                Salir
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

// Avatar reusable: imagen real si existe, sino burbuja con iniciales.
function Avatar({
  avatarUrl,
  initials,
  size,
}: {
  avatarUrl: string | null;
  initials: string;
  size: number;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border-2 border-white bg-white object-cover shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-brand-cyan text-sm font-bold text-white shadow-sm"
      style={{ width: size, height: size }}
    >
      {initials || <UserRound size={size * 0.5} />}
    </span>
  );
}
