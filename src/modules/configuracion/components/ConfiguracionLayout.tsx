// ConfiguracionLayout · sub-layout para /gerencia/configuracion/*.
// Tabs entre "ARCA" y "Cola de emisión". Lo wirea el parent agent en App.tsx.

import { NavLink, Outlet } from 'react-router-dom';
import { ShieldCheck, Layers } from 'lucide-react';
import { cn } from '@/lib/cn';

const TABS = [
  { to: '/gerencia/configuracion/arca', label: 'ARCA', icon: ShieldCheck, end: true },
  { to: '/gerencia/configuracion/arca/cola', label: 'Cola de emisión', icon: Layers },
  // TODO parent agent · cablear cuando se agreguen rutas en App.tsx:
  //   { to: '/gerencia/configuracion/emails/templates', label: 'Plantillas email', icon: Mail (de lucide) },
  //   { to: '/gerencia/configuracion/emails/cola',      label: 'Cola de envíos',   icon: Send (de lucide) },
];

export function ConfiguracionLayout() {
  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'border-brand-cyan text-brand-cyan'
                    : 'border-transparent text-brand-muted hover:text-brand-ink',
                )
              }
            >
              <Icon size={14} />
              {t.label}
            </NavLink>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
