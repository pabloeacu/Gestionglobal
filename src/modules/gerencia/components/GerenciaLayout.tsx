import { useMemo, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Wallet,
  PiggyBank,
  AlertCircle,
  GraduationCap,
  BarChart3,
  Settings,
  Inbox,
  CalendarClock,
  Handshake,
  ClipboardList,
  Menu,
  X,
  Search,
  Plus,
  Command as CommandIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCommandPalette,
  useRegisterCommand,
} from '@/contexts/CommandPaletteContext';
import { cn } from '@/lib/cn';
import { UserMenu } from './UserMenu';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  end?: boolean;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { to: '/gerencia', label: 'Inicio', icon: LayoutDashboard, end: true },
  { to: '/gerencia/clientes', label: 'Clientes', icon: Users },
  { to: '/gerencia/servicios', label: 'Servicios', icon: Briefcase },
  { to: '/gerencia/facturacion', label: 'Facturación', icon: FileText },
  { to: '/gerencia/tramites', label: 'Trámites', icon: Inbox },
  { to: '/gerencia/vencimientos', label: 'Vencimientos', icon: CalendarClock },
  { to: '/gerencia/cuenta-corriente', label: 'Cuenta corriente', icon: Wallet },
  { to: '/gerencia/recupero', label: 'Recupero', icon: AlertCircle },
  { to: '/gerencia/partners', label: 'Partners', icon: Handshake },
  { to: '/gerencia/finanzas', label: 'Finanzas', icon: PiggyBank, disabled: true },
  { to: '/gerencia/formularios', label: 'Formularios', icon: ClipboardList },
  { to: '/gerencia/campus', label: 'Campus', icon: GraduationCap },
  { to: '/gerencia/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/gerencia/configuracion', label: 'Configuración', icon: Settings },
];

export function GerenciaLayout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const palette = useCommandPalette();

  // Comandos base del palette (re-creados solo si cambia navigate)
  const cmdInicio = useMemo(
    () => ({
      id: 'nav.inicio',
      label: 'Ir a Inicio',
      description: 'Atajos y resumen del panel',
      group: 'navegar' as const,
      icon: LayoutDashboard,
      action: () => navigate('/gerencia'),
    }),
    [navigate],
  );
  const cmdClientes = useMemo(
    () => ({
      id: 'nav.clientes',
      label: 'Ir a Clientes',
      description: 'Administraciones y consorcios',
      group: 'navegar' as const,
      icon: Users,
      action: () => navigate('/gerencia/clientes'),
    }),
    [navigate],
  );
  const cmdNuevaAdmin = useMemo(
    () => ({
      id: 'action.new-admin',
      label: 'Nueva administración',
      description: 'Crear un cliente desde cero',
      group: 'acciones' as const,
      icon: Plus,
      action: () => navigate('/gerencia/clientes?new=1'),
    }),
    [navigate],
  );

  const cmdFacturacion = useMemo(
    () => ({
      id: 'nav.facturacion',
      label: 'Ir a Facturación',
      description: 'Comprobantes emitidos, pendientes y vencidos',
      group: 'navegar' as const,
      icon: FileText,
      action: () => navigate('/gerencia/facturacion'),
    }),
    [navigate],
  );
  const cmdNuevoComprobante = useMemo(
    () => ({
      id: 'action.new-comprobante',
      label: 'Nuevo comprobante',
      description: 'Emitir un comprobante simple (tipo X)',
      group: 'acciones' as const,
      icon: Plus,
      action: () => navigate('/gerencia/facturacion?new=1'),
    }),
    [navigate],
  );

  useRegisterCommand(cmdInicio);
  useRegisterCommand(cmdClientes);
  useRegisterCommand(cmdFacturacion);
  useRegisterCommand(cmdNuevaAdmin);
  useRegisterCommand(cmdNuevoComprobante);

  return (
    <div className="flex min-h-screen bg-brand-zebra/40 font-sans">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Link to="/gerencia" className="block">
            <BrandMark variant="light" size={30} />
          </Link>
        </div>
        <SidebarNav />
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
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
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
          <div className="hidden md:block">
            <p className="kicker text-brand-cyan">Panel de gerencia</p>
            <p className="text-sm font-medium text-brand-ink">
              {greeting()}, {user?.fullName?.split(' ')[0] ?? user?.email}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => palette.open()}
              className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-brand-muted transition hover:border-brand-cyan hover:text-brand-ink sm:inline-flex"
              title="Buscar en la plataforma (⌘ K)"
            >
              <Search size={13} /> Buscar
              <kbd className="ml-1 inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-muted">
                <CommandIcon size={9} />K
              </kbd>
            </button>
            <UserMenu perfilHref="/gerencia/perfil" />
          </div>
        </header>

        <main className="flex-1 px-5 py-8 md:px-8">
          {/* Route transition: re-mount con animate-route-in en cada cambio */}
          <div
            key={location.pathname}
            className="motion-safe:animate-route-in"
          >
            <Outlet />
          </div>
        </main>

        {/* Footer mini institucional */}
        <footer className="mt-auto border-t border-slate-200 bg-white/60 px-5 py-3 text-xs text-brand-muted md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              © {new Date().getFullYear()} Gestión Global · Aliados de tu
              tiempo
            </p>
            <p className="flex items-center gap-3">
              <a
                href="mailto:contacto@gestionglobal.ar"
                className="hover:text-brand-cyan"
              >
                Soporte
              </a>
              <span className="opacity-30">·</span>
              <span title="Versión del deploy" className="font-mono">
                v{import.meta.env.VITE_APP_VERSION ?? 'dev'}
              </span>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5">
      <ul className="space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          if (item.disabled) {
            return (
              <li key={item.to}>
                <span
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-muted/70"
                  title="Próximamente"
                >
                  <Icon size={17} />
                  {item.label}
                  <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-brand-muted">
                    pronto
                  </span>
                </span>
              </li>
            );
          }
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

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buen día';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
