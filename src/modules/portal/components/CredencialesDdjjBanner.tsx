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
import { KeyRound, X, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { getCredencialDdjjMeta, descartarBannerDdjj } from '@/services/api/ddjj';

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
    <section
      className="relative overflow-hidden gg-chamfer bg-gradient-to-br from-brand-night via-brand-night-2 to-brand-teal p-4 text-white motion-safe:animate-fade-up sm:p-5"
      aria-label="Tus credenciales de DDJJ ya están cargadas"
    >
      <TrianglesAccent position="top-right" size={132} tone="cyan" density="rich" className="opacity-20" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-cyan/20 blur-2xl" />

      <button
        type="button"
        onClick={() => void cerrar()}
        disabled={dismissing}
        aria-label="Cerrar"
        className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
      >
        <X size={16} />
      </button>

      <div className="relative flex items-start gap-3 pr-7">
        <div className="grid h-11 w-11 shrink-0 place-items-center gg-chamfer-sm bg-white/10 text-brand-cyan-light ring-1 ring-white/25">
          <KeyRound size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="kicker text-brand-cyan-light">Accesos listos · DDJJ</p>
          <h3 className="font-display text-base uppercase leading-tight tracking-tight sm:text-lg">
            Tus credenciales de DDJJ ya están cargadas
          </h3>
          <p className="mt-1 text-sm text-white/80">
            Usuario y contraseña listos en tu ficha, con el acceso directo al Portal de Declaraciones Juradas y el instructivo paso a paso.
          </p>
          <button
            type="button"
            onClick={irAlPortal}
            className="mt-3 inline-flex items-center gap-1.5 gg-chamfer-sm bg-brand-cyan px-4 py-2 font-display text-xs uppercase tracking-wider text-white transition hover:bg-brand-cyan-light hover:text-brand-ink"
          >
            Ir a mis accesos <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

export default CredencialesDdjjBanner;
