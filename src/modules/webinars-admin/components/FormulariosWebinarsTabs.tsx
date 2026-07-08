import { Link, useLocation } from 'react-router-dom';
import { FileText, Radio, Users } from 'lucide-react';
import { cn } from '@/lib/cn';

// DGG-11/15: header de tabs compartido entre /gerencia/formularios y los
// nuevos /gerencia/formularios/webinars y /gerencia/formularios/prospectos.
// El usuario decidió que Webinars vive como tab dentro de Formularios
// (coherente con "lo que pasa después de un formulario tipo evento").

const TABS = [
  { to: '/gerencia/formularios', label: 'Formularios', icon: FileText, match: /^\/gerencia\/formularios\/?$|^\/gerencia\/formularios\/[a-f0-9-]{36}/ },
  { to: '/gerencia/formularios/webinars', label: 'Eventos', icon: Radio, match: /^\/gerencia\/formularios\/webinars/ },
  { to: '/gerencia/formularios/prospectos', label: 'Prospectos', icon: Users, match: /^\/gerencia\/formularios\/prospectos/ },
];

export function FormulariosWebinarsTabs() {
  const { pathname } = useLocation();
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {TABS.map((t) => {
        const active = t.match.test(pathname);
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-sm font-medium transition',
              active
                ? 'border-b-2 border-brand-cyan bg-brand-cyan/5 text-brand-ink'
                : 'border-b-2 border-transparent text-brand-muted hover:bg-slate-50 hover:text-brand-ink',
            )}
          >
            <Icon size={14} /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
