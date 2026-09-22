import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getPerfilRegulatorio, type PerfilRegulatorio } from '@/services/api/perfilRegulatorio';
import { contarPendientes, readSnoozed } from './perfil/fichaModel';

// Agenda · progressive profiling — nudge en PortalHome (DGG-197). Aparece SÓLO si la
// completitud < 100 Y hay >=1 dato accionable (no opt-outeado, no snoozeado). Tono
// oportunidad (cyan), NUNCA alarma. Nunca muestra fechas inferidas como ciertas.
// Self-fetch: no toca la lógica de carga de PortalHome (menor riesgo sobre lo vivo).

export function PerfilRegulatorioHotCard() {
  const { user } = useAuth();
  const adminId = user?.administracionId ?? null;
  const [perfil, setPerfil] = useState<PerfilRegulatorio | null>(null);
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    if (!adminId) return;
    let cancel = false;
    void getPerfilRegulatorio(adminId).then((res) => {
      if (cancel || !res.ok) return;
      setPerfil(res.data);
      setPendientes(contarPendientes(res.data, readSnoozed(adminId)));
    });
    return () => {
      cancel = true;
    };
  }, [adminId]);

  if (!perfil || perfil.completitud_pct >= 100 || pendientes < 1) return null;

  return (
    <Link
      to="/portal/mi-ficha"
      data-gg-remind
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-4 shadow-sm ring-1 ring-cyan-100 transition hover:border-brand-cyan hover:shadow-md sm:p-5"
    >
      <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-brand-cyan text-white shadow-sm">
        <ShieldCheck size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="kicker text-brand-cyan">Tu matrícula</p>
        <p className="font-display text-base font-bold leading-tight text-brand-ink sm:text-lg">
          Completá tu perfil regulatorio
        </p>
        <p className="mt-0.5 text-xs text-brand-muted sm:text-sm">
          Te {pendientes === 1 ? 'falta confirmar 1 dato' : `faltan confirmar ${pendientes} datos`} · lleva 2 minutos.
        </p>
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 rounded-md bg-brand-cyan px-3 py-2 text-xs font-semibold text-white shadow-sm transition group-hover:bg-brand-cyan/90 sm:inline-flex">
        Confirmar
        <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
      </span>
      <ArrowRight size={18} className="shrink-0 text-brand-cyan transition group-hover:translate-x-1 sm:hidden" />
    </Link>
  );
}
