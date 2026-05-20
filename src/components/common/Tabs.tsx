import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  hidden?: boolean;
  disabled?: boolean;
  badge?: string | number;
}

interface TabsProps {
  items: TabItem[];
  activeKey?: string;
  onChange?: (key: string) => void;
  className?: string;
}

export function Tabs({ items, activeKey, onChange, className }: TabsProps) {
  const visible = items.filter((i) => !i.hidden);
  const [internal, setInternal] = useState<string>(visible[0]?.key ?? '');
  const active = activeKey ?? internal;
  const setActive = (k: string) => {
    if (onChange) onChange(k);
    else setInternal(k);
  };

  return (
    <div className={cn('border-b border-slate-200', className)}>
      <div className="flex gap-1 overflow-x-auto">
        {visible.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              disabled={t.disabled}
              onClick={() => !t.disabled && setActive(t.key)}
              className={cn(
                'group relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium transition',
                'border-b-2 -mb-px',
                isActive
                  ? 'border-brand-cyan text-brand-ink'
                  : 'border-transparent text-brand-muted hover:text-brand-ink',
                t.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {t.icon && <span className="opacity-80">{t.icon}</span>}
              {t.label}
              {t.badge !== undefined && (
                <span
                  className={cn(
                    'ml-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    isActive
                      ? 'bg-brand-cyan/15 text-brand-cyan'
                      : 'bg-slate-100 text-brand-muted',
                  )}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
