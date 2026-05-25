// ============================================================================
// LandingCoverBadge · DGG-28
//
// Indicador siempre-visible del estado de la cortina pública en el sidebar.
// Cuando está activa → chip cyan con switch ON · "Cortina pública activa".
// Cuando está apagada → chip slate con switch OFF · "Sitio público en vivo".
//
// Click → confirmación → flip vía RPC `set_landing_cover` → toast + refresh.
// ============================================================================

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  getLandingCoverStatus,
  setLandingCover,
} from '@/services/api/configGlobal';

export function LandingCoverBadge() {
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const v = await getLandingCoverStatus();
    setEnabled(v);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onToggle() {
    if (enabled === null || busy) return;
    const willActivate = !enabled;
    const ok = await confirm({
      title: willActivate
        ? '¿Volver a poner la cortina pública?'
        : '¿Apagar la cortina pública?',
      message: willActivate
        ? 'Quienes entren a gestionglobal.ar volverán a ver "Proyectando mejoras extraordinarias" en lugar de la landing. Vos seguís viendo todo logueado.'
        : 'La landing institucional pasa a ser visible para todo el mundo. Confirmá solo si estás listo para el lanzamiento público.',
      confirmLabel: willActivate ? 'Volver a cubrir' : 'Apagar cortina',
      danger: !willActivate, // apagarla es la acción "fuerte"
    });
    if (!ok) return;
    setBusy(true);
    const r = await setLandingCover(willActivate);
    setBusy(false);
    if (r.ok) {
      setEnabled(willActivate);
      toast.success(
        willActivate
          ? 'Cortina re-activada · el sitio público está cubierto'
          : '¡Lanzaste! · la landing pública está en vivo',
      );
    } else {
      toast.error('No pudimos cambiar el estado de la cortina', {
        description: r.error.message,
      });
    }
  }

  if (enabled === null) {
    return (
      <div className="border-t border-slate-100 px-4 py-3 text-xs text-brand-muted">
        <span className="inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Cargando estado…
        </span>
      </div>
    );
  }

  const Icon = enabled ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      title={
        enabled
          ? 'La landing pública está cubierta · click para apagar la cortina'
          : 'La landing pública está en vivo · click para volver a cubrirla'
      }
      className={cn(
        'group flex w-full items-center gap-2.5 border-t px-4 py-3 text-left transition',
        enabled
          ? 'border-brand-cyan/20 bg-brand-cyan/5 hover:bg-brand-cyan/10'
          : 'border-emerald-100 bg-emerald-50/60 hover:bg-emerald-50',
        busy && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          enabled
            ? 'bg-brand-cyan/15 text-brand-cyan'
            : 'bg-emerald-100 text-emerald-700',
        )}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[11px] font-semibold uppercase tracking-wider',
            enabled ? 'text-brand-cyan' : 'text-emerald-700',
          )}
        >
          {enabled ? 'Cortina activa' : 'Sitio en vivo'}
        </p>
        <p className="truncate text-[11px] text-brand-muted">
          {enabled ? 'Landing pública cubierta' : 'Landing pública visible'}
        </p>
      </div>
      {/* Switch visual */}
      <span
        className={cn(
          'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition',
          enabled ? 'bg-brand-cyan' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition',
            enabled ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
