import { forwardRef } from 'react';
import type { CertificadoParaPdf } from '@/services/api/campus';

// ============================================================================
// Certificado · diseño corporativo institucional (DGG-13 v2 · 2026-05-26).
//
// Estructura del modelo "FundPlata premium":
//   1. Franja superior azul navy con diagonales + línea dorada + recortes
//   2. Polígonos translúcidos como fondo (logo-fondo.png + formas geométricas)
//   3. Logo emisor (FundPlata) + sigla institucional ("FU.DE.CO.IN.")
//   4. Título "CERTIFICADO" condensed sans-serif
//   5. "OTORGADO A" + Nombre del alumno en script caligráfico
//   6. Texto descriptivo + Nombre del curso (mayúsculas azul oscuro)
//   7. Mes/año en italic
//   8. Dos firmas (con sus imágenes + nombre + cargo)
//   9. Sello dorado holográfico central con CSS/SVG inline
//  10. Franja inferior espejo
//  11. Logo Gestión Global abajo izquierda + código + QR derecha
//
// Estilo inline (sin Tailwind ni oklch) → html2canvas captura fiel al render.
// 4 temas de color que aplican sobre la MISMA estructura (acento + dorado).
// ============================================================================

export const CERT_W = 1123;
export const CERT_H = 794;

interface Tema {
  // Color base de las franjas superior/inferior + acentos institucionales
  accent: string;
  accentDeep: string;
  accentLight: string;
  // Tinta (textos)
  ink: string;
  inkSoft: string;
  // Dorado (líneas finas + sello)
  gold: string;
  goldDeep: string;
  goldSoft: string;
}

// Legacy: los 4 temas predefinidos quedan disponibles para sandbox/compatibilidad
// pero la fuente de verdad es ahora el esquema (color_acento + color_dorado).
export const TEMAS_LEGACY_HEX: Record<number, { acento: string; dorado: string }> = {
  1: { acento: '#0b1f33', dorado: '#c9a961' },  // Navy + dorado
  2: { acento: '#5c440e', dorado: '#c9a961' },  // Dorado profundo
  3: { acento: '#0d4a5c', dorado: '#c9a961' },  // Cyan/teal
  4: { acento: '#3a205c', dorado: '#c9a961' },  // Violeta
};

// Tipografías
const TITLE = "'Bebas Neue', 'Oswald', 'Impact', sans-serif";
const SCRIPT = "'Great Vibes', 'Allura', 'Brush Script MT', cursive";
const SANS = "'Inter', 'Sora', system-ui, sans-serif";
const SERIF = "'Cormorant Garamond', 'Times New Roman', serif";

function fechaLargaMes(iso: string): string {
  const d = new Date(iso);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

// ============================================================================
// Esquema · derivación editable de la plantilla base (DGG-29)
// Cada esquema se vincula a 0..N cursos/webinars desde el editor.
// ============================================================================
export interface EsquemaCert {
  // Paleta
  color_acento: string;          // HEX, ej '#0b1f33'
  color_dorado: string;          // HEX, ej '#c9a961'

  // Logo emisor
  visible_marca_logo: boolean;
  marca_logo_url: string | null;

  // Sigla institucional
  visible_sigla: boolean;
  sigla_texto: string;

  // Texto descriptivo
  visible_texto_descriptivo: boolean;
  texto_descriptivo: string;

  // Leyenda legal
  visible_leyenda_legal: boolean;
  leyenda_legal: string;

  // Firma 1
  visible_firma_1: boolean;
  firma_1_img_url: string | null;
  firma_1_nombre: string;
  firma_1_cargo: string;

  // Firma 2
  visible_firma_2: boolean;
  firma_2_img_url: string | null;
  firma_2_nombre: string;
  firma_2_cargo: string;

  // Sello
  visible_sello: boolean;
  sello_logo_url: string | null;

  // Watermark
  visible_watermark: boolean;
  watermark_url: string | null;
}

// Esquema default — reproduce el certificado hardcoded original (FU.DE.CO.IN.).
export const ESQUEMA_DEFAULT: EsquemaCert = {
  color_acento: '#0b1f33',
  color_dorado: '#c9a961',
  visible_marca_logo: true,
  marca_logo_url: '/cert/logo-fundplata.png',
  visible_sigla: true,
  sigla_texto: 'FU.DE.CO.IN.',
  visible_texto_descriptivo: true,
  texto_descriptivo: 'por haber completado y aprobado satisfactoriamente el curso',
  visible_leyenda_legal: true,
  leyenda_legal:
    'Certificado emitido conforme a la habilitación de FU.DE.CO.IN., Ley N.° 14.701, ' +
    'Decreto N.° 1734/22 y Disposición N.° 27/23. Organizado por Gestión Global.',
  visible_firma_1: true,
  firma_1_img_url: '/cert/firma-acuna.png',
  firma_1_nombre: 'Dr. Pablo E. Acuña',
  firma_1_cargo: 'Coordinador Académico',
  visible_firma_2: true,
  firma_2_img_url: '/cert/firma-parente.png',
  firma_2_nombre: 'Pablo M. Parente',
  firma_2_cargo: 'Presidente · FU.DE.CO.IN.',
  visible_sello: true,
  sello_logo_url: '/logo-white.png',
  visible_watermark: true,
  watermark_url: '/cert/logo-fondo.png',
};

// ============================================================================
// Derivación de paleta desde HEX (HSL manipulation)
// ============================================================================
function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const lum = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: hue = ((b - r) / d + 2) / 6; break;
      case b: hue = ((r - g) / d + 4) / 6; break;
    }
  }
  return [hue * 360, sat * 100, lum * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = (s / 100) * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function paletaFromEsquema(esquema: EsquemaCert): Tema {
  const [h, s, l] = hexToHsl(esquema.color_acento);
  const [gh, gs, gl] = hexToHsl(esquema.color_dorado);
  return {
    accent: esquema.color_acento,
    accentDeep: hslToHex(h, s, Math.max(l - 8, 4)),
    accentLight: hslToHex(h, Math.max(s - 5, 0), Math.min(l + 18, 55)),
    ink: '#0f172a',
    inkSoft: '#475569',
    gold: esquema.color_dorado,
    goldDeep: hslToHex(gh, gs, Math.max(gl - 18, 12)),
    goldSoft: hslToHex(gh, Math.max(gs - 5, 0), Math.min(gl + 18, 88)),
  };
}

// ============================================================================
// Franja superior · navy con recortes angulares + línea dorada
// ============================================================================
function FranjaSuperior({ tema }: { tema: Tema }) {
  return (
    <svg
      width={CERT_W}
      height={130}
      viewBox={`0 0 ${CERT_W} 130`}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
      aria-hidden
    >
      {/* Bloque base */}
      <defs>
        <linearGradient id="franjaTop" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tema.accentDeep} />
          <stop offset="55%" stopColor={tema.accent} />
          <stop offset="100%" stopColor={tema.accentLight} />
        </linearGradient>
      </defs>
      {/* Polígono principal con recorte angular en la parte inferior derecha */}
      <polygon
        points={`0,0 ${CERT_W},0 ${CERT_W},85 ${CERT_W - 220},115 0,80`}
        fill="url(#franjaTop)"
      />
      {/* Diagonal interior más oscura */}
      <polygon
        points={`0,0 580,0 320,90 0,55`}
        fill={tema.accentDeep}
        opacity={0.45}
      />
      {/* Línea dorada siguiendo el borde inferior */}
      <line
        x1={0}
        y1={80}
        x2={CERT_W - 220}
        y2={115}
        stroke={tema.gold}
        strokeWidth={1.5}
      />
      <line
        x1={CERT_W - 220}
        y1={115}
        x2={CERT_W}
        y2={85}
        stroke={tema.gold}
        strokeWidth={1.5}
      />
      {/* Línea dorada fina interna */}
      <line x1={0} y1={70} x2={CERT_W - 240} y2={102} stroke={tema.goldSoft} strokeWidth={0.6} opacity={0.7} />
      {/* Corte angular dorado izquierdo (acento) */}
      <polygon
        points="0,0 0,55 50,30 90,0"
        fill={tema.gold}
        opacity={0.85}
      />
      <polygon
        points="0,30 30,40 50,30 0,55"
        fill={tema.goldDeep}
        opacity={0.7}
      />
    </svg>
  );
}

// ============================================================================
// Franja inferior · espejo de la superior
// ============================================================================
function FranjaInferior({ tema }: { tema: Tema }) {
  return (
    <svg
      width={CERT_W}
      height={130}
      viewBox={`0 0 ${CERT_W} 130`}
      style={{ position: 'absolute', bottom: 0, left: 0, pointerEvents: 'none' }}
      aria-hidden
    >
      <defs>
        <linearGradient id="franjaBot" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor={tema.accentDeep} />
          <stop offset="55%" stopColor={tema.accent} />
          <stop offset="100%" stopColor={tema.accentLight} />
        </linearGradient>
      </defs>
      {/* Polígono base espejado */}
      <polygon
        points={`0,50 220,15 ${CERT_W},45 ${CERT_W},130 0,130`}
        fill="url(#franjaBot)"
      />
      {/* Diagonal interior más oscura */}
      <polygon
        points={`${CERT_W},50 ${CERT_W - 580},50 ${CERT_W - 320},130 ${CERT_W},130`}
        fill={tema.accentDeep}
        opacity={0.45}
      />
      {/* Líneas doradas */}
      <line x1={0} y1={50} x2={220} y2={15} stroke={tema.gold} strokeWidth={1.5} />
      <line x1={220} y1={15} x2={CERT_W} y2={45} stroke={tema.gold} strokeWidth={1.5} />
      <line x1={240} y1={28} x2={CERT_W} y2={60} stroke={tema.goldSoft} strokeWidth={0.6} opacity={0.7} />
      {/* Corte angular dorado derecho (acento espejo) */}
      <polygon
        points={`${CERT_W},130 ${CERT_W},75 ${CERT_W - 50},100 ${CERT_W - 90},130`}
        fill={tema.gold}
        opacity={0.85}
      />
      <polygon
        points={`${CERT_W},100 ${CERT_W - 30},90 ${CERT_W - 50},100 ${CERT_W},75`}
        fill={tema.goldDeep}
        opacity={0.7}
      />
    </svg>
  );
}

// ============================================================================
// Sello dorado holográfico central (CSS/SVG inline)
// ============================================================================
function SelloHolografico({ tema, logoUrl }: { tema: Tema; logoUrl: string }) {
  return (
    <div style={{ position: 'relative', width: 110, height: 110 }}>
      {/* Anillo exterior dorado metálico (gradient conic simula facetas) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: `conic-gradient(from 0deg, ${tema.gold}, ${tema.goldDeep}, ${tema.goldSoft}, ${tema.gold}, ${tema.goldDeep}, ${tema.goldSoft}, ${tema.gold})`,
          boxShadow: `0 4px 16px rgba(138,110,53,0.5), inset 0 1px 2px rgba(255,255,255,0.6), inset 0 -1px 2px rgba(0,0,0,0.2)`,
        }}
      />
      {/* Anillo interior más oscuro */}
      <div
        style={{
          position: 'absolute',
          inset: 8,
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, ${tema.goldSoft} 0%, ${tema.gold} 30%, ${tema.goldDeep} 80%)`,
        }}
      />
      {/* Centro oscuro con facetas multicolor (efecto holográfico) */}
      <div
        style={{
          position: 'absolute',
          inset: 18,
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 30% 30%, rgba(101, 200, 220, 0.4) 0%, transparent 40%),
            radial-gradient(circle at 70% 35%, rgba(255, 200, 100, 0.4) 0%, transparent 40%),
            radial-gradient(circle at 50% 70%, rgba(200, 100, 200, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, rgba(100, 255, 200, 0.3) 0%, transparent 40%),
            linear-gradient(135deg, ${tema.accentDeep}, ${tema.accent})
          `,
          boxShadow: `inset 0 0 6px rgba(0,0,0,0.5)`,
        }}
      />
      {/* Logo Gestión Global centrado (reemplaza texto SELLO OFICIAL) */}
      <div
        style={{
          position: 'absolute',
          inset: 18,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={logoUrl}
          alt=""
          crossOrigin="anonymous"
          style={{
            width: '68%',
            height: '68%',
            objectFit: 'contain',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
          }}
        />
      </div>
      {/* Brillo superior izquierdo */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 12,
          width: 22,
          height: 12,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.4)',
          filter: 'blur(4px)',
        }}
      />
    </div>
  );
}

// ============================================================================
// Componente principal
// ============================================================================
export interface CertificadoPremiumProps {
  cert: CertificadoParaPdf;
  qrDataUrl: string | null;
  verificarUrl: string;
  // Esquema editable — si no se pasa, usa ESQUEMA_DEFAULT (institucional).
  // En producción se cablea desde el curso/webinar vinculado.
  esquema?: EsquemaCert;
}

export const CertificadoPremium = forwardRef<HTMLDivElement, CertificadoPremiumProps>(
  function CertificadoPremium({ cert, qrDataUrl, verificarUrl, esquema = ESQUEMA_DEFAULT }, ref) {
    // La paleta se deriva del color_acento + color_dorado del esquema.
    // El cert.tema (legacy) se ignora cuando hay esquema.
    const tema = paletaFromEsquema(esquema);

    const partes: string[] = [];
    if (cert.duracion_horas) partes.push(`${cert.duracion_horas} horas reloj`);
    if (cert.nota_examen !== null && cert.nota_examen !== undefined) {
      const nota = cert.nota_examen;
      const escala = nota <= 10 ? 10 : 100;
      partes.push(`Calificación ${nota}/${escala}`);
    }

    // Resolver URLs (null → no se muestra el bloque si visible=false, igual)
    const marcaLogo = esquema.marca_logo_url ?? ESQUEMA_DEFAULT.marca_logo_url!;
    const firma1Img = esquema.firma_1_img_url ?? ESQUEMA_DEFAULT.firma_1_img_url!;
    const firma2Img = esquema.firma_2_img_url ?? ESQUEMA_DEFAULT.firma_2_img_url!;
    const watermarkUrl = esquema.watermark_url ?? ESQUEMA_DEFAULT.watermark_url!;
    const selloLogoUrl = esquema.sello_logo_url ?? ESQUEMA_DEFAULT.sello_logo_url!;

    return (
      <div
        ref={ref}
        style={{
          width: CERT_W,
          height: CERT_H,
          position: 'relative',
          boxSizing: 'border-box',
          background: '#f6f7f9',
          fontFamily: SANS,
          overflow: 'hidden',
        }}
      >
        {/* Marca de agua del isologo grande (centro, opacidad baja) */}
        <img
          src={watermarkUrl}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 580,
            height: 'auto',
            opacity: 0.06,
            pointerEvents: 'none',
            visibility: esquema.visible_watermark ? 'visible' : 'hidden',
          }}
          aria-hidden
        />

        {/* Franjas superior e inferior */}
        <FranjaSuperior tema={tema} />
        <FranjaInferior tema={tema} />

        {/* Contenido principal */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            padding: '60px 90px 300px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* ====== Logo emisor ====== */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              marginBottom: 0,
              visibility: esquema.visible_marca_logo ? 'visible' : 'hidden',
            }}
          >
            <img
              src={marcaLogo}
              alt=""
              crossOrigin="anonymous"
              style={{ height: 110, width: 'auto', objectFit: 'contain' }}
            />
          </div>

          {/* ====== Título "CERTIFICADO" ====== */}
          <div
            style={{
              fontFamily: TITLE,
              fontSize: 76,
              fontWeight: 400,
              letterSpacing: 6,
              color: tema.ink,
              lineHeight: 1,
              marginBottom: 2,
            }}
          >
            CERTIFICADO
          </div>

          {/* ====== Sigla institucional con líneas doradas ====== */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              marginTop: 0,
              marginBottom: 10,
              width: 540,
              visibility: esquema.visible_sigla ? 'visible' : 'hidden',
            }}
          >
            <div style={{ flex: 1, height: 1, background: tema.gold }} />
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: 5,
                color: tema.accent,
                whiteSpace: 'nowrap',
              }}
            >
              {esquema.sigla_texto}
            </div>
            <div style={{ flex: 1, height: 1, background: tema.gold }} />
          </div>

          {/* ====== Otorgado a ====== */}
          <div
            style={{
              fontSize: 11,
              letterSpacing: 4,
              color: tema.inkSoft,
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            Otorgado a
          </div>

          {/* ====== Nombre del alumno (script grande) ====== */}
          <div
            style={{
              fontFamily: SCRIPT,
              fontSize: 68,
              color: tema.ink,
              lineHeight: 1,
              marginTop: 0,
              padding: '0 20px',
              maxWidth: '90%',
              textAlign: 'center',
            }}
          >
            {cert.alumno_nombre}
          </div>

          {/* ====== Texto descriptivo ====== */}
          <div
            style={{
              fontSize: 13,
              color: tema.inkSoft,
              marginTop: 10,
              textAlign: 'center',
              maxWidth: 720,
              lineHeight: 1.5,
              visibility: esquema.visible_texto_descriptivo ? 'visible' : 'hidden',
              minHeight: 20,
            }}
          >
            {esquema.texto_descriptivo}
          </div>

          {/* ====== Nombre del curso ====== */}
          <div
            style={{
              fontFamily: SANS,
              fontSize: 22,
              fontWeight: 800,
              color: tema.accent,
              textTransform: 'uppercase',
              letterSpacing: 2,
              marginTop: 6,
              maxWidth: 800,
              textAlign: 'center',
              lineHeight: 1.18,
            }}
          >
            {cert.curso_titulo}
          </div>

          {/* ====== Leyenda legal (debajo del curso, antes de la fecha) ====== */}
          <div
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 11,
              color: tema.inkSoft,
              maxWidth: 780,
              textAlign: 'center',
              lineHeight: 1.45,
              marginTop: 8,
              opacity: 0.95,
              visibility: esquema.visible_leyenda_legal ? 'visible' : 'hidden',
              minHeight: 32,
            }}
          >
            {esquema.leyenda_legal}
          </div>

          {/* ====== Fecha (mes y año) ====== */}
          <div
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 14,
              fontWeight: 600,
              color: tema.ink,
              marginTop: 6,
            }}
          >
            {fechaLargaMes(cert.emitido_at)}
            {partes.length > 0 && (
              <span style={{ color: tema.inkSoft, fontWeight: 400 }}>
                {'   ·   '}{partes.join('   ·   ')}
              </span>
            )}
          </div>

        </div>

        {/* ====== Firmas absolute (coordenadas estables, visibility por toggle) ====== */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 140,
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            width: '100%',
            maxWidth: 900,
            zIndex: 3,
          }}
        >
          <div style={{ visibility: esquema.visible_firma_1 ? 'visible' : 'hidden' }}>
            <Firma
              tema={tema}
              imgSrc={firma1Img}
              nombre={esquema.firma_1_nombre}
              cargo={esquema.firma_1_cargo}
            />
          </div>
          {/* Hueco central donde encaja el sello */}
          <div style={{ width: 160 }} aria-hidden />
          <div style={{ visibility: esquema.visible_firma_2 ? 'visible' : 'hidden' }}>
            <Firma
              tema={tema}
              imgSrc={firma2Img}
              nombre={esquema.firma_2_nombre}
              cargo={esquema.firma_2_cargo}
            />
          </div>
        </div>

        {/* ====== Sello holográfico: absolute, cruza la franja inferior ====== */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 60,
            transform: 'translateX(-50%)',
            zIndex: 4,
            visibility: esquema.visible_sello ? 'visible' : 'hidden',
          }}
        >
          <SelloHolografico tema={tema} logoUrl={selloLogoUrl} />
        </div>

        {/* ====== Pie absoluto: logo GG izquierda + QR derecha ====== */}
        <div
          style={{
            position: 'absolute',
            left: 36,
            bottom: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            zIndex: 3,
          }}
        >
          <img
            src="/logo-h-color.png"
            alt="Gestión Global"
            crossOrigin="anonymous"
            style={{ height: 24, width: 'auto', objectFit: 'contain', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            right: 36,
            bottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            zIndex: 3,
          }}
        >
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontSize: 7.5, letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.85 }}>
              Verificá su autenticidad
            </div>
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              {cert.codigo}
            </div>
            <div style={{ fontSize: 7.5, opacity: 0.75 }}>
              {verificarUrl.replace(/^https?:\/\//, '')}
            </div>
          </div>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR de verificación"
              style={{
                width: 54,
                height: 54,
                background: '#fff',
                padding: 3,
                borderRadius: 4,
                border: `1.5px solid ${tema.goldSoft}`,
              }}
            />
          ) : (
            <div style={{ width: 54, height: 54, border: `1.5px solid ${tema.goldSoft}`, borderRadius: 4 }} />
          )}
        </div>
      </div>
    );
  },
);

// ============================================================================
// Firma · imagen + línea + nombre + cargo
// ============================================================================
function Firma({
  tema,
  imgSrc,
  nombre,
  cargo,
}: {
  tema: Tema;
  imgSrc: string;
  nombre: string;
  cargo: string;
}) {
  return (
    <div style={{ width: 340, textAlign: 'center', position: 'relative' }}>
      {/* Imagen de firma (escaneada) */}
      <div style={{ height: 154, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <img
          src={imgSrc}
          alt=""
          crossOrigin="anonymous"
          style={{ maxHeight: 154, maxWidth: 320, objectFit: 'contain' }}
        />
      </div>
      {/* Línea de firma (cruza la firma, efecto holográfico) */}
      <div
        style={{
          width: 280,
          height: 1,
          background: tema.ink,
          margin: '-34px auto 8px',
          opacity: 0.55,
          position: 'relative',
          zIndex: 1,
        }}
      />
      {/* Nombre */}
      <div style={{ fontSize: 13, fontWeight: 700, color: tema.ink, letterSpacing: 0.3 }}>
        {nombre}
      </div>
      {/* Cargo */}
      <div style={{ fontSize: 9.5, color: tema.inkSoft, marginTop: 2, letterSpacing: 0.5 }}>
        {cargo}
      </div>
    </div>
  );
}
