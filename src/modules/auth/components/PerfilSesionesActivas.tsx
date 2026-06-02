// ============================================================================
// PerfilSesionesActivas · listado de sesiones del usuario propio (P2-#35)
//
// Muestra cada device + opción de cerrar (excepto la actual). El usuario
// puede expulsar sesiones viejas o de equipos que no reconoce.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Monitor,
  Smartphone,
  Shield,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Button, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  cerrarMiSesion,
  describeUserAgent,
  listMisSesiones,
  type SesionActiva,
} from '@/services/api/sesiones';
import { humanizeError } from '@/lib/errors';

function tiempoRelativo(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias < 7) return `hace ${dias} d`;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  });
}

export function PerfilSesionesActivas() {
  const confirm = useConfirm();
  const [sesiones, setSesiones] = useState<SesionActiva[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listMisSesiones();
    if (r.ok) setSesiones(r.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCerrar(s: SesionActiva) {
    const meta = describeUserAgent(s.user_agent);
    const ok = await confirm({
      title: 'Cerrar esta sesión',
      message: `Vas a desconectar el ${meta.browser} en ${meta.os}${s.ip ? ` (IP ${s.ip})` : ''}. Si vuelve a usar la plataforma, va a tener que ingresar email y contraseña.`,
      confirmLabel: 'Cerrar sesión',
      danger: true,
    });
    if (!ok) return;
    setBusy(s.id);
    const r = await cerrarMiSesion(s.id);
    setBusy(null);
    if (!r.ok) {
      toast.error('No pudimos cerrar la sesión', { description: humanizeError(r.error) });
      return;
    }
    toast.success('Sesión cerrada');
    void load();
  }

  return (
    <section className="card-premium relative overflow-hidden p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="kicker">Seguridad</p>
          <h3 className="mt-1 font-display text-lg font-bold text-brand-ink">
            Sesiones activas
          </h3>
          <p className="mt-1 text-xs text-brand-muted">
            Cada vez que ingresás desde un equipo nuevo se crea una sesión.
            Si no reconocés alguna, cerrala desde acá.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2.5 py-1 text-[11px] font-semibold text-brand-cyan">
          <Shield size={11} /> {sesiones.length} {sesiones.length === 1 ? 'activa' : 'activas'}
        </span>
      </div>

      <div className="mt-5 space-y-2">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-brand-muted">
            <Loader2 size={12} className="animate-spin" /> Cargando sesiones…
          </p>
        ) : sesiones.length === 0 ? (
          <p className="text-xs text-brand-muted">
            No detectamos otras sesiones activas.
          </p>
        ) : (
          sesiones.map((s) => {
            const meta = describeUserAgent(s.user_agent);
            const Icon = meta.device === 'mobile' ? Smartphone : Monitor;
            return (
              <article
                key={s.id}
                className={cn(
                  'flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-white p-3 transition',
                  s.es_actual
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200',
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                      s.es_actual
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-700',
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-brand-ink">
                        {meta.browser} · {meta.os}
                      </span>
                      {s.es_actual && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Este dispositivo
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-brand-muted">
                      <span>Última actividad {tiempoRelativo(s.refreshed_at ?? s.updated_at ?? s.created_at)}</span>
                      {s.ip && (
                        <>
                          <span>·</span>
                          <span>IP {s.ip}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {!s.es_actual && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleCerrar(s)}
                    disabled={busy === s.id}
                    title="Desconectar este equipo"
                  >
                    {busy === s.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Cerrar
                  </Button>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
