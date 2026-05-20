import { useEffect, useState } from 'react';
import {
  NavLink,
  Outlet,
  Link,
  useLocation,
} from 'react-router-dom';
import {
  Home,
  Receipt,
  Wallet,
  Building2,
  UserRound,
  LogOut,
  Menu,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { useAuth } from '@/contexts/AuthContext';
import { useSounds } from '@/contexts/SoundContext';
import { getAdministracion } from '@/services/api/administraciones';
import { cn } from '@/lib/cn';

// Portal del administrador (cliente). Diseño tipo Stripe/Linear customer
// portal: sidebar estrecha con íconos + topbar minimal con nombre de
// administración + dropdown del usuario.

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/portal', label: 'Inicio', icon: Home, end: true },
  { to: '/portal/comprobantes', label: 'Comprobantes', icon: Receipt },
  { to: '/portal/cuenta-corriente', label: 'Cuenta corriente', icon: Wallet },
  { to: '/portal/consorcios', label: 'Consorcios', icon: Building2 },
  { to: '/portal/perfil', label: 'Mi perfil', icon: UserRound },
];

export function PortalLayout() {
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminNombre, setAdminNombre] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    let mounted = true;
    if (!user?.administracionId) {
      setAdminNombre(null);
      return;
    }
    void getAdministracion(user.administracionId).then((res) => {
      if (!mounted) return;
      if (res.ok) setAdminNombre(res.data.nombre);
    });
    return () => {
      mounted = false;
    };
  }, [user?.administracionId]);

  // Cerrar sidebar mobile al navegar
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const initials = (user?.fullName ?? user?.email ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-brand-zebra/40 font-sans">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-[72px] shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex h-16 items-center justify-center border-b border-slate-100">
          <Link
            to="/portal"
            className="block transition hover:opacity-80"
            aria-label="Inicio"
            title="Gestión Global"
          >
            <BrandMark variant="light" size={28} />
          </Link>
        </div>
        <SidebarNavCompact />
        <SidebarFootCompact onSignOut={signOut} />
      </aside>

      {/* Sidebar (mobile) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-brand-ink/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <BrandMark variant="light" size={30} />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1 text-brand-muted hover:bg-slate-100"
                aria-label="Cerrar menú"
              >
                <X size={20} />
              </button>
            </div>
            <SidebarNavExpanded onNavigate={() => setMobileOpen(false)} />
            <SidebarFootMobile onSignOut={signOut} initials={initials} user={user} />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/85 px-5 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-brand-ink hover:bg-slate-100 md:hidden"
            aria-label="Abrir menú"
          >
            <Menu size={20} />
          </button>
          <div className="hidden min-w-0 md:block">
            <p className="kicker text-brand-cyan">Portal del administrador</p>
            <p className="truncate text-sm font-medium text-brand-ink">
              {adminNombre ?? user?.email}
            </p>
          </div>

          <div className="relative flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-1.5 py-1 transition hover:border-brand-cyan"
              aria-label="Menú usuario"
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-cyan text-xs font-bold text-white">
                  {initials}
                </span>
              )}
              <span className="hidden pr-1 text-xs font-medium text-brand-ink sm:inline">
                {user?.fullName?.split(' ')[0] ?? user?.email?.split('@')[0]}
              </span>
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl motion-safe:animate-fade-up">
                  <div className="border-b border-slate-100 bg-brand-zebra/30 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-brand-ink">
                      {user?.fullName ?? user?.email}
                    </p>
                    <p className="truncate text-xs text-brand-muted">
                      {user?.email}
                    </p>
                  </div>
                  <ul className="py-1">
                    <li>
                      <Link
                        to="/portal/perfil"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-brand-ink hover:bg-slate-100"
                      >
                        <UserRound size={14} /> Mi perfil
                      </Link>
                    </li>
                    <li>
                      <SoundToggleRow />
                    </li>
                    <li className="border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => void signOut()}
                        className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <LogOut size={14} /> Cerrar sesión
                      </button>
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-5 py-8 md:px-8">
          <div
            key={location.pathname}
            className="motion-safe:animate-route-in"
          >
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarNavCompact() {
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-4">
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    'group relative grid h-11 w-full place-items-center rounded-xl transition',
                    isActive
                      ? 'bg-brand-cyan/10 text-brand-cyan'
                      : 'text-brand-muted hover:bg-slate-100 hover:text-brand-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} />
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-brand-cyan"
                      />
                    )}
                    {/* Tooltip al hover */}
                    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-brand-ink px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarNavExpanded({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5">
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-cyan/10 text-brand-cyan'
                      : 'text-brand-ink/80 hover:bg-slate-100 hover:text-brand-ink',
                  )
                }
              >
                <Icon size={17} />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarFootCompact({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { enabled, setEnabled, play } = useSounds();
  return (
    <div className="border-t border-slate-100 p-2">
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            if (next) play('click');
          }}
          className={cn(
            'grid h-10 w-10 place-items-center rounded-lg transition',
            enabled
              ? 'text-brand-cyan hover:bg-brand-cyan-pale/40'
              : 'text-brand-muted hover:bg-slate-100 hover:text-brand-ink',
          )}
          aria-label={enabled ? 'Silenciar sonidos' : 'Activar sonidos'}
          title={enabled ? 'Sonidos activados' : 'Sonidos silenciados'}
        >
          {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="grid h-10 w-10 place-items-center rounded-lg text-brand-muted transition hover:bg-slate-100 hover:text-brand-ink"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}

function SidebarFootMobile({
  onSignOut,
  initials,
  user,
}: {
  onSignOut: () => Promise<void>;
  initials: string;
  user: ReturnType<typeof useAuth>['user'];
}) {
  const { enabled, setEnabled, play } = useSounds();
  return (
    <div className="border-t border-slate-100 p-3">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-cyan text-sm font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1 text-xs">
          <p className="truncate font-semibold text-brand-ink">
            {user?.fullName ?? user?.email}
          </p>
          <p className="truncate text-brand-muted">Administrador</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !enabled;
            setEnabled(next);
            if (next) play('click');
          }}
          className={cn(
            'rounded-md p-2 transition',
            enabled
              ? 'text-brand-cyan hover:bg-brand-cyan-pale/40'
              : 'text-brand-muted hover:bg-slate-100 hover:text-brand-ink',
          )}
          aria-label={enabled ? 'Silenciar sonidos' : 'Activar sonidos'}
        >
          {enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="rounded-md p-2 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
          aria-label="Cerrar sesión"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}

function SoundToggleRow() {
  const { enabled, setEnabled, play } = useSounds();
  return (
    <button
      type="button"
      onClick={() => {
        const next = !enabled;
        setEnabled(next);
        if (next) play('click');
      }}
      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-brand-ink hover:bg-slate-100"
    >
      {enabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
      <span>{enabled ? 'Sonidos activados' : 'Sonidos silenciados'}</span>
    </button>
  );
}
