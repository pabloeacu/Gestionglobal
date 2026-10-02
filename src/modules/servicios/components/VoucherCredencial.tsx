// ============================================================================
// Credencial de VOUCHER de cortesía · tarjeta apaisada (DGG-210).
//
// Capa de PRESENTACIÓN pura: no cambia la lógica del voucher. Es la pieza
// "con glamour" que gerencia descarga (PNG/PDF) para pasarle al cliente que se
// quiere beneficiar.
//
// Hereda las LECCIONES del diploma/constancia (CertificadoPremium /
// ConstanciaPremium), porque la rasteriza el mismo pipeline (html-to-image):
//   · dimensiones exactas como constantes (ratio estable)
//   · estilos 100% inline (sin Tailwind/oklch) → html-to-image captura fiel
//   · posiciones con `top`, nunca `bottom` (bug de rasterizado conocido)
//   · <img crossOrigin="anonymous"> en el logo
//   · el generador lo monta bajo data-gg-classic (escapa el tema gg-brand)
// ============================================================================

export const VOUCHER_W = 1080;
export const VOUCHER_H = 648;

const SANS = "'Inter', 'Sora', system-ui, sans-serif";
const DISPLAY = "'Oswald', 'GG Oswald', 'Archivo Narrow', 'Arial Narrow', 'Inter', system-ui, sans-serif";

// Paleta de marca (inline; equivalentes a los tokens brand-*/gg-*).
const NAVY = '#0B1F33';   // gg.ink / brand.night
const NAVY2 = '#102a44';  // navy un punto más claro para el degradé
const CYAN = '#009ECA';   // gg.cyan / brand.cyan (acción/acento)
const DORADO = '#D8B45A'; // dorado de realce sobre navy
const WHITE = '#ffffff';
const WHITE_SOFT = 'rgba(255,255,255,0.74)';
const WHITE_FAINT = 'rgba(255,255,255,0.45)';

export interface VoucherCredencialDatos {
  codigo: string;
  es100: boolean; // descuento_pct === 100 → "GRATIS"
  descuentoPct: number; // 1..100
  servicioNombre: string;
  venceLabel: string; // "15 de octubre de 2026" | "Sin vencimiento"
}

export interface VoucherCredencialEsquema {
  logo_url: string | null; // logo horizontal blanco (pre-embebido por el generador)
}

export const ESQUEMA_VOUCHER_DEFAULT: VoucherCredencialEsquema = {
  logo_url: '/logo-h-white.png',
};

// Chamfer (bisel) de marca: corta esquina sup-izq + inf-der.
function chamfer(px: number): string {
  return `polygon(${px}px 0, 100% 0, 100% calc(100% - ${px}px), calc(100% - ${px}px) 100%, 0 100%, 0 ${px}px)`;
}

export function VoucherCredencial({
  datos,
  esquema,
}: {
  datos: VoucherCredencialDatos;
  esquema?: VoucherCredencialEsquema;
}) {
  const e = { ...ESQUEMA_VOUCHER_DEFAULT, ...(esquema ?? {}) };
  const logoUrl = e.logo_url ?? ESQUEMA_VOUCHER_DEFAULT.logo_url;

  const beneficioNumero = datos.es100 ? '100%' : `${datos.descuentoPct}%`;
  const beneficioLeyenda = datos.es100 ? 'BONIFICACIÓN TOTAL' : 'DE DESCUENTO';

  return (
    <div
      style={{
        width: VOUCHER_W,
        height: VOUCHER_H,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: SANS,
        color: WHITE,
        background: `linear-gradient(135deg, ${NAVY} 0%, ${NAVY2} 55%, ${NAVY} 100%)`,
      }}
    >
      {/* Motivo triangular de marca (impronta) · esquinas, baja opacidad */}
      <div
        style={{
          position: 'absolute', top: -120, right: -80, width: 460, height: 460,
          background: CYAN, opacity: 0.1,
          clipPath: 'polygon(100% 0, 100% 100%, 0 0)',
        }}
      />
      <div
        style={{
          position: 'absolute', top: 300, right: 120, width: 320, height: 320,
          background: DORADO, opacity: 0.08,
          clipPath: 'polygon(100% 100%, 0 100%, 100% 0)',
        }}
      />
      <div
        style={{
          position: 'absolute', top: 340, left: -90, width: 300, height: 300,
          background: CYAN, opacity: 0.07,
          clipPath: 'polygon(0 0, 0 100%, 100% 100%)',
        }}
      />

      {/* Marco dorado inset */}
      <div
        style={{
          position: 'absolute', top: 26, left: 26, right: 26, bottom: 26,
          border: `1px solid rgba(216,180,90,0.45)`,
          pointerEvents: 'none',
        }}
      />
      {/* Regla cyan superior (acento de marca) */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: VOUCHER_W, height: 7, background: CYAN }} />

      {/* ================= Header: logo + eyebrow ================= */}
      <div
        style={{
          position: 'absolute', top: 56, left: 64, right: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        {logoUrl ? (
          <img src={logoUrl} crossOrigin="anonymous" alt="Gestión Global" style={{ height: 96, display: 'block' }} />
        ) : (
          <span style={{ fontFamily: DISPLAY, fontSize: 44, fontWeight: 700, letterSpacing: 1, color: WHITE }}>
            GESTIÓN GLOBAL
          </span>
        )}
        <div
          style={{
            fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, letterSpacing: 3,
            color: CYAN, textTransform: 'uppercase',
          }}
        >
          Voucher de cortesía
        </div>
      </div>

      {/* ================= Cuerpo: beneficio (hero) ================= */}
      <div style={{ position: 'absolute', top: 188, left: 64, width: 560 }}>
        <div
          style={{
            fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, letterSpacing: 4,
            color: WHITE_SOFT, textTransform: 'uppercase', marginBottom: 2,
          }}
        >
          Tu beneficio
        </div>
        <div
          style={{
            fontFamily: DISPLAY, fontWeight: 700, color: WHITE,
            fontSize: datos.es100 ? 190 : 196, lineHeight: 0.92,
            letterSpacing: -2, fontVariantNumeric: 'tabular-nums',
            textShadow: '0 6px 30px rgba(0,158,202,0.35)',
          }}
        >
          {beneficioNumero}
        </div>
        <div
          style={{
            fontFamily: DISPLAY, fontSize: 34, fontWeight: 600, letterSpacing: 6,
            color: DORADO, textTransform: 'uppercase', marginTop: 6,
          }}
        >
          {beneficioLeyenda}
        </div>
        <div style={{ fontSize: 22, color: WHITE_SOFT, marginTop: 20, maxWidth: 520 }}>
          Válido para <strong style={{ color: WHITE, fontWeight: 700 }}>{datos.servicioNombre}</strong>
        </div>
      </div>

      {/* ================= Código (chip a la derecha) ================= */}
      <div style={{ position: 'absolute', top: 214, right: 64, width: 352 }}>
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: `2px dashed ${DORADO}`,
            clipPath: chamfer(18),
            padding: '30px 26px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, letterSpacing: 4,
              color: CYAN, textTransform: 'uppercase', marginBottom: 14,
            }}
          >
            Código
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', 'Menlo', 'Consolas', monospace",
              fontSize: 40, fontWeight: 700, color: WHITE,
              letterSpacing: 2, wordBreak: 'break-all', lineHeight: 1.05,
            }}
          >
            {datos.codigo}
          </div>
        </div>
        <div style={{ fontSize: 15, color: WHITE_SOFT, textAlign: 'center', marginTop: 16, lineHeight: 1.4 }}>
          Ingresá este código en el campo
          <br />
          <span style={{ color: WHITE, fontWeight: 600 }}>"Tengo un voucher"</span> del formulario.
        </div>
      </div>

      {/* ================= Footer ================= */}
      <div
        style={{
          position: 'absolute', top: VOUCHER_H - 92, left: 64, right: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 14, letterSpacing: 2, color: WHITE_FAINT, textTransform: 'uppercase' }}>
            Validez
          </span>
          <span style={{ fontSize: 20, color: WHITE, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {datos.venceLabel}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, color: WHITE, fontWeight: 600, letterSpacing: 0.5 }}>gestionglobal.ar</div>
          <div style={{ fontSize: 13, color: WHITE_FAINT, letterSpacing: 1 }}>Aliados de tu tiempo</div>
        </div>
      </div>
    </div>
  );
}
