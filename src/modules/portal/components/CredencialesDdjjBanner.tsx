// ============================================================================
// CredencialesDdjjBanner · DGG-253 — aviso premium "tus credenciales de DDJJ ya
// están cargadas" en el dashboard del cliente.
//
// Se muestra SÓLO cuando (server-side, credencial_reg_meta.banner_pendiente):
//   · el circuito está ARMADO (config_global.ddjj_avisos_habilitados), y
//   · la credencial DDJJ está publicada con usuario + password, y
//   · el cliente todavía no lo cerró (X ni primer ingreso a /portal/ddjj).
// Mientras el circuito está OFF, el server devuelve banner_pendiente=false → no aparece.
//
// Dismiss cross-device: credencial_ddjj_banner_descartar (X del banner). El "primer
// ingreso" lo marca PortalDdjjPage al montar. NUNCA expone usuario/contraseña.
//
// Estilo marca-nativa (skill gestionglobal-ui): degradé tinta→petróleo, chamfer,
// Oswald MAYÚSCULAS, motivo triangular. MISMO tamaño/footprint que el resto de los
// banners del dashboard (p-4 sm:p-5), responsive. Regla 4 (API en services/).
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getCredencialDdjjMeta, descartarBannerDdjj } from '@/services/api/ddjj';
import { PremiumBanner, premiumCtaClass } from './premiumBanner';

export function CredencialesDdjjBanner() {
  const { user } = useAuth();
  const adminId = user?.administracionId ?? null;
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    if (!adminId) return;
    const r = await getCredencialDdjjMeta(adminId);
    // Banner opcional: ante error no molestamos al cliente (sólo log).
    if (r.ok) setVisible(r.data.bannerPendiente);
    else console.warn('[CredencialesDdjjBanner] meta no disponible:', r.error);
  }, [adminId]);

  useEffect(() => { void load(); }, [load]);

  async function cerrar() {
    if (!adminId) return;
    setDismissing(true);
    setVisible(false); // optimista
    const r = await descartarBannerDdjj(adminId);
    setDismissing(false);
    if (!r.ok) { setVisible(true); return; } // revertir si falló
  }

  function irAlPortal() {
    // PortalDdjjPage marca el "primer ingreso" al montar; acá sólo navegamos.
    navigate('/portal/ddjj');
  }

  if (!visible) return null;

  return (
    <PremiumBanner
      tone="ddjj"
      ariaLabel="Tus credenciales de DDJJ ya están cargadas"
      kicker="Accesos listos · DDJJ"
      title="Tus credenciales de DDJJ ya están cargadas"
      icon={<KeyRound size={20} />}
      onDismiss={() => void cerrar()}
      dismissing={dismissing}
      actions={
        <button type="button" onClick={irAlPortal} className={premiumCtaClass('ddjj')}>
          Ir a mis accesos <ArrowRight size={14} />
        </button>
      }
    >
      Usuario y contraseña listos en tu ficha, con el acceso directo al Portal de Declaraciones Juradas y el instructivo paso a paso.
    </PremiumBanner>
  );
}

export default CredencialesDdjjBanner;
