import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  PiggyBank,
  GraduationCap,
  Settings,
  Inbox,
  CalendarDays,
  Menu,
  X,
  Search,
  Plus,
  ChevronDown,
  Command as CommandIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import { LandingCoverBadge } from './LandingCoverBadge';
import { NotificationBell } from '@/components/common/NotificationBell';
import { RealtimeStatus } from '@/components/common/RealtimeStatus';
import { PeriodSelector } from '@/components/common/PeriodSelector';
import { QuickActionsFAB } from '@/components/common/QuickActionsFAB';
import {
  KeyboardShortcutsModal,
  useShortcutsHotkey,
} from '@/components/common/KeyboardShortcutsModal';
import { useAuth } from '@/contexts/AuthContext';
import {
  useCommandPalette,
  useRegisterCommand,
} from '@/contexts/CommandPaletteContext';
import { Keyboard } from 'lucide-react';
import { cn } from '@/lib/cn';
import { UserMenu } from './UserMenu';

// Reorganización 15→9 (DGG-25): el sidebar agrupa por flujo del usuario,
// no por afinidad técnica. "Captación" embudo de entrada. "Facturación"
// concentra el ciclo $ con el cliente (comprobantes → CC → recupero).
// "Finanzas" concentra la caja interna + partners (rendiciones). "Configuración"
// abriga el catálogo de servicios (backstage, se setea una vez).
// Reportes NO va al sidebar — los reportes se entretejen en cada pantalla
// como botones de export (PDF/XLS) — pedido del usuario.

interface NavLeaf {
  to: string;
  label: string;
  end?: boolean;
}

interface NavGroup {
  label: string;
  icon: typeof Users;
  to?: string; // si es directo (sin children)
  end?: boolean;
  children?: NavLeaf[];
}

const NAV: NavGroup[] = [
  { label: 'Inicio', to: '/gerencia', end: true, icon: LayoutDashboard },
  {
    label: 'Captación',
    icon: Inbox,
    children: [
      { label: 'Solicitudes', to: '/gerencia/solicitudes' },
      { label: 'Formularios', to: '/gerencia/formularios', end: true },
      { label: 'Webinars', to: '/gerencia/formularios/webinars' },
      { label: 'Prospectos', to: '/gerencia/formularios/prospectos' },
    ],
  },
  { label: 'Clientes', to: '/gerencia/clientes', icon: Users },
  { label: 'Trámites', to: '/gerencia/tramites', icon: Briefcase },
  { label: 'Agenda', to: '/gerencia/agenda', icon: CalendarDays },
  { label: 'Analítica', to: '/gerencia/analitica', icon: PiggyBank },
  {
    label: 'Facturación',
    icon: FileText,
    children: [
      { label: 'Comprobantes', to: '/gerencia/facturacion', end: true },
      { label: 'Cuenta corriente', to: '/gerencia/cuenta-corriente' },
      { label: 'Recupero', to: '/gerencia/recupero', end: true },
    ],
  },
  {
    label: 'Finanzas',
    icon: PiggyBank,
    children: [
      { label: 'Cajas y movimientos', to: '/gerencia/finanzas', end: true },
      { label: 'Conciliación', to: '/gerencia/finanzas/conciliacion' },
      { label: 'Partners', to: '/gerencia/partners' },
    ],
  },
  { label: 'Campus', to: '/gerencia/campus', icon: GraduationCap },
  {
    label: 'Configuración',
    icon: Settings,
    children: [
      { label: 'Servicios (catálogo)', to: '/gerencia/servicios' },
      { label: 'ARCA · facturación', to: '/gerencia/configuracion/arca', end: true },
      { label: 'Plantillas email', to: '/gerencia/configuracion/emails/templates' },
      { label: 'Bitácora de cambios', to: '/gerencia/configuracion/auditoria' },
      { label: 'Errores en runtime', to: '/gerencia/configuracion/errores' },
      // Datos fiscales (config_global) pendiente · DGG futuro
    ],
  },
];

// Helper: la ruta `pathname` matchea esa hoja del nav
function isLeafActive(pathname: string, leaf: NavLeaf): boolean {
  if (leaf.end) return pathname === leaf.to;
  return pathname === leaf.to || pathname.startsWith(leaf.to + '/');
}

// Helper: este grupo contiene la ruta actual (ya sea directo o por algún child)
function isGroupActive(pathname: string, group: NavGroup): boolean {
  if (group.to) {
    if (group.end) return pathname === group.to;
    return pathname === group.to || pathname.startsWith(group.to + '/');
  }
  return (group.children ?? []).some((leaf) => isLeafActive(pathname, leaf));
}

export function GerenciaLayout() {
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // P2-#12 · hotkey "?" abre cheat sheet de atajos.
  useShortcutsHotkey(setShortcutsOpen);
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

  // P2-#12 · comando "Atajos de teclado" en el palette + shortcutHint "?"
  const cmdAtajos = useMemo(
    () => ({
      id: 'help.shortcuts',
      label: 'Atajos de teclado',
      description: 'Ver todos los shortcuts disponibles',
      group: 'acciones' as const,
      icon: Keyboard,
      shortcutHint: '?',
      action: () => setShortcutsOpen(true),
    }),
    [],
  );

  useRegisterCommand(cmdInicio);
  useRegisterCommand(cmdClientes);
  useRegisterCommand(cmdFacturacion);
  useRegisterCommand(cmdNuevaAdmin);
  useRegisterCommand(cmdNuevoComprobante);
  useRegisterCommand(cmdAtajos);

  return (
    <div className="flex min-h-screen bg-white font-sans">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Link to="/gerencia" className="block">
            <BrandMark variant="light" size={30} />
          </Link>
        </div>
        <SidebarNav />
        <LandingCoverBadge />
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
            <LandingCoverBadge />
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
            {/* P2-#13 · Selector de período global */}
            <PeriodSelector />
            {/* P2-#15 · Indicador Realtime (dot + label) */}
            <RealtimeStatus />
            {/* P2-#12 · Botón "?" para abrir atajos */}
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="hidden h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan sm:inline-flex"
              title="Atajos de teclado (?)"
              aria-label="Atajos de teclado"
            >
              <Keyboard size={14} />
            </button>
            {/* DGG-30 / P5-7.C · Centro de notificaciones in-app. */}
            <NotificationBell />
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

      {/* P2-#12 · Modal cheat sheet de atajos */}
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* P2-#9 · FAB con acciones rápidas en mobile */}
      <QuickActionsFAB onShortcuts={() => setShortcutsOpen(true)} />
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  // Estado de qué grupos están expandidos. Por defecto se expande el grupo
  // que contiene la ruta actual; persiste en localStorage para que un usuario
  // que abre/cierra grupos manualmente conserve su preferencia entre páginas.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('gg.nav.openGroups');
      if (raw) return JSON.parse(raw) as Record<string, boolean>;
    } catch {/* ignore */}
    return {};
  });

  // Auto-expand el grupo cuyo child es la ruta actual.
  useEffect(() => {
    const active = NAV.find(
      (g) => g.children && isGroupActive(location.pathname, g),
    );
    if (active && !openGroups[active.label]) {
      setOpenGroups((prev) => ({ ...prev, [active.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem('gg.nav.openGroups', JSON.stringify(next)); } catch {/* ignore */}
      return next;
    });
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 py-5">
      <ul className="space-y-0.5">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isGroupActive(location.pathname, item);

          // Grupo con sub-items → expandible.
          if (item.children) {
            const expanded = openGroups[item.label] ?? active;
            return (
              <li key={item.label} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(item.label)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    active
                      ? 'bg-brand-cyan/10 text-brand-cyan'
                      : 'text-brand-ink/80 hover:bg-slate-100 hover:text-brand-ink',
                  )}
                  aria-expanded={expanded}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  <ChevronDown
                    size={14}
                    className={cn(
                      'ml-auto transition-transform',
                      expanded ? 'rotate-0' : '-rotate-90',
                    )}
                  />
                </button>
                {expanded && (
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {item.children.map((leaf) => (
                      <li key={leaf.to}>
                        <NavLink
                          to={leaf.to}
                          end={leaf.end}
                          onClick={onNavigate}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-3 rounded-lg border-l border-slate-200 px-3 py-1.5 pl-5 text-[13px] transition',
                              isActive
                                ? 'border-brand-cyan bg-brand-cyan/5 font-medium text-brand-cyan'
                                : 'text-brand-ink/75 hover:bg-slate-100 hover:text-brand-ink',
                            )
                          }
                        >
                          {leaf.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          }

          // Item simple (sin children) → NavLink directo.
          return (
            <li key={item.to}>
              <NavLink
                to={item.to!}
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
