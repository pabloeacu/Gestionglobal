import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { getPerfilRegulatorio, type PerfilRegulatorio } from '@/services/api/perfilRegulatorio';
import { contarPendientes, readSnoozed } from './perfil/fichaModel';
import { BANNER_TONES } from './premiumBanner';

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

  // DGG-254 · premium marca-nativa (tono 'brand', nudge no-alarma).
  const T = BANNER_TONES.brand;
  return (
    <Link
      to="/portal/mi-ficha"
      data-gg-remind
      className={`group relative flex items-center gap-4 overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white transition sm:p-5 ${T.grad}`}
    >
      <TrianglesAccent position="top-right" size={120} tone={T.tri} density="rich" className="opacity-20" />
      <span className={`relative grid h-11 w-11 flex-shrink-0 place-items-center gg-chamfer-sm bg-white/10 ring-1 ring-white/25 ${T.accent}`}>
        <ShieldCheck size={20} />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className={`kicker ${T.accent}`}>Tu agenda profesional</p>
        <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
          Completá tu agenda de vencimientos
        </h3>
        <p className="mt-0.5 text-xs text-white/75 sm:text-sm">
          Te {pendientes === 1 ? 'falta confirmar 1 dato' : `faltan confirmar ${pendientes} datos`} · 2 minutos y te avisamos antes de cada vencimiento.
        </p>
      </div>
      <span className={`relative hidden shrink-0 items-center gap-1.5 gg-chamfer-sm px-3 py-2 font-display text-xs uppercase tracking-wider transition sm:inline-flex ${T.cta}`}>
        Confirmar
        <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
      </span>
      <ArrowRight size={18} className="relative shrink-0 text-brand-cyan-light transition group-hover:translate-x-1 sm:hidden" />
    </Link>
  );
}
