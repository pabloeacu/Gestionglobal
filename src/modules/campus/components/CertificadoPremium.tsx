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

const TEMAS: Record<number, Tema> = {
  // 1 · Navy + dorado (default · Curso de Formación / Integral)
  1: {
    accent: '#0b1f33',
    accentDeep: '#06121f',
    accentLight: '#1a3a5c',
    ink: '#0f172a',
    inkSoft: '#475569',
    gold: '#c9a961',
    goldDeep: '#8a6e35',
    goldSoft: '#e8d6a6',
  },
  // 2 · Dorado profundo (Actualización 2024)
  2: {
    accent: '#5c440e',
    accentDeep: '#3d2c08',
    accentLight: '#8a6a1d',
    ink: '#0f172a',
    inkSoft: '#475569',
    gold: '#c9a961',
    goldDeep: '#8a6e35',
    goldSoft: '#e8d6a6',
  },
  // 3 · Cyan / teal (Actualización 2025)
  3: {
    accent: '#0d4a5c',
    accentDeep: '#072d3a',
    accentLight: '#1b9da8',
    ink: '#0f172a',
    inkSoft: '#475569',
    gold: '#c9a961',
    goldDeep: '#8a6e35',
    goldSoft: '#e8d6a6',
  },
  // 4 · Violeta (Actualización 2026)
  4: {
    accent: '#3a205c',
    accentDeep: '#21113b',
    accentLight: '#6d40a8',
    ink: '#0f172a',
    inkSoft: '#475569',
    gold: '#c9a961',
    goldDeep: '#8a6e35',
    goldSoft: '#e8d6a6',
  },
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

// Defaults institucionales (mientras no estén configurables por curso)
const DEFAULT_MARCA_TITULO = 'FU.DE.CO.IN.';
const DEFAULT_MARCA_LOGO = '/cert/logo-fundplata.png';
const DEFAULT_FIRMA1_IMG = '/cert/firma-acuna.png';
const DEFAULT_FIRMA1_NOMBRE = 'Dr. Pablo E. Acuña';
const DEFAULT_FIRMA1_CARGO = 'Coordinador Académico';
const DEFAULT_FIRMA2_IMG = '/cert/firma-parente.png';
const DEFAULT_FIRMA2_NOMBRE = 'Pablo M. Parente';
const DEFAULT_FIRMA2_CARGO = 'Presidente · FU.DE.CO.IN.';

const LEYENDA_LEGAL =
  'Certificado emitido conforme a la habilitación de FU.DE.CO.IN., Ley N.° 14.701, ' +
  'Decreto N.° 1734/22 y Disposición N.° 27/23. Organizado por Gestión Global.';

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
// Polígonos translúcidos de fondo (geometría facetada diagonal)
// ============================================================================
function PoligonosFondo({ tema }: { tema: Tema }) {
  return (
    <svg
      width={CERT_W}
      height={CERT_H}
      viewBox={`0 0 ${CERT_W} ${CERT_H}`}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 1 }}
      aria-hidden
    >
      {/* Polígonos grandes diagonales, baja opacidad */}
      <polygon points="120,180 380,260 280,540 80,420" fill={tema.accent} opacity={0.045} />
      <polygon points="380,260 620,200 600,500 280,540" fill={tema.accentLight} opacity={0.04} />
      <polygon points="620,200 880,300 820,580 600,500" fill={tema.accent} opacity={0.05} />
      <polygon points="880,300 1080,240 1050,520 820,580" fill={tema.accentLight} opacity={0.035} />
      <polygon points="200,520 480,580 420,720 180,680" fill={tema.accent} opacity={0.04} />
      <polygon points="600,540 880,600 820,720 580,700" fill={tema.accent} opacity={0.035} />
    </svg>
  );
}

// ============================================================================
// Sello dorado holográfico central (CSS/SVG inline)
// ============================================================================
function SelloHolografico({ tema }: { tema: Tema }) {
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
      {/* Texto central */}
      <div
        style={{
          position: 'absolute',
          inset: 18,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: tema.goldSoft,
          textAlign: 'center',
          fontFamily: TITLE,
          fontSize: 10,
          letterSpacing: 1.5,
          lineHeight: 1.1,
          textShadow: '0 1px 2px rgba(0,0,0,0.7)',
        }}
      >
        SELLO<br />OFICIAL
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
}

export const CertificadoPremium = forwardRef<HTMLDivElement, CertificadoPremiumProps>(
  function CertificadoPremium({ cert, qrDataUrl, verificarUrl }, ref) {
    const tema = TEMAS[cert.tema] ?? TEMAS[1]!;
    const partes: string[] = [];
    if (cert.duracion_horas) partes.push(`${cert.duracion_horas} horas reloj`);
    if (cert.nota_examen !== null && cert.nota_examen !== undefined) {
      const nota = cert.nota_examen;
      const escala = nota <= 10 ? 10 : 100;
      partes.push(`Calificación ${nota}/${escala}`);
    }

    // Variables del modelo (defaults institucionales — Paso 2 las hace
    // configurables por curso).
    const marcaTitulo = DEFAULT_MARCA_TITULO;
    const marcaLogo = DEFAULT_MARCA_LOGO;
    const firma1Img = DEFAULT_FIRMA1_IMG;
    const firma1Nombre = DEFAULT_FIRMA1_NOMBRE;
    const firma1Cargo = DEFAULT_FIRMA1_CARGO;
    const firma2Img = DEFAULT_FIRMA2_IMG;
    const firma2Nombre = DEFAULT_FIRMA2_NOMBRE;
    const firma2Cargo = DEFAULT_FIRMA2_CARGO;

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
          src="/cert/logo-fondo.png"
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
          }}
          aria-hidden
        />

        {/* Polígonos facetados translúcidos diagonales */}
        <PoligonosFondo tema={tema} />

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
            padding: '140px 90px 165px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {/* ====== Logo emisor + sigla institucional ====== */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              marginBottom: 14,
            }}
          >
            <img
              src={marcaLogo}
              alt=""
              crossOrigin="anonymous"
              style={{ height: 78, width: 'auto', objectFit: 'contain' }}
            />
          </div>

          {/* ====== Título "CERTIFICADO" ====== */}
          <div
            style={{
              fontFamily: TITLE,
              fontSize: 92,
              fontWeight: 400,
              letterSpacing: 8,
              color: tema.ink,
              lineHeight: 1,
              marginBottom: 4,
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
              marginTop: 2,
              marginBottom: 16,
              width: 540,
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
              {marcaTitulo}
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
              marginBottom: 4,
            }}
          >
            Otorgado a
          </div>

          {/* ====== Nombre del alumno (script grande) ====== */}
          <div
            style={{
              fontFamily: SCRIPT,
              fontSize: 76,
              color: tema.ink,
              lineHeight: 1.05,
              marginTop: 2,
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
              marginTop: 14,
              textAlign: 'center',
              maxWidth: 720,
              lineHeight: 1.5,
            }}
          >
            por haber completado y aprobado satisfactoriamente el curso
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
              marginTop: 8,
              maxWidth: 800,
              textAlign: 'center',
              lineHeight: 1.18,
            }}
          >
            {cert.curso_titulo}
          </div>

          {/* ====== Fecha (mes y año) ====== */}
          <div
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 14,
              fontWeight: 600,
              color: tema.ink,
              marginTop: 8,
            }}
          >
            {fechaLargaMes(cert.emitido_at)}
            {partes.length > 0 && (
              <span style={{ color: tema.inkSoft, fontWeight: 400 }}>
                {'   ·   '}{partes.join('   ·   ')}
              </span>
            )}
          </div>

          {/* Espaciador */}
          <div style={{ flex: 1 }} />

          {/* ====== Sello + firmas ====== */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              width: '100%',
              maxWidth: 880,
              marginBottom: 16,
            }}
          >
            {/* Firma izquierda */}
            <Firma
              tema={tema}
              imgSrc={firma1Img}
              nombre={firma1Nombre}
              cargo={firma1Cargo}
            />

            {/* Sello central */}
            <div style={{ textAlign: 'center', position: 'relative', top: -8 }}>
              <SelloHolografico tema={tema} />
            </div>

            {/* Firma derecha */}
            <Firma
              tema={tema}
              imgSrc={firma2Img}
              nombre={firma2Nombre}
              cargo={firma2Cargo}
            />
          </div>

          {/* ====== Leyenda legal ====== */}
          <div
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontSize: 10,
              color: tema.inkSoft,
              maxWidth: 760,
              textAlign: 'center',
              lineHeight: 1.55,
              opacity: 0.85,
              marginTop: -2,
              marginBottom: 12,
            }}
          >
            {LEYENDA_LEGAL}
          </div>
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
    <div style={{ width: 240, textAlign: 'center', position: 'relative' }}>
      {/* Imagen de firma (escaneada) */}
      <div style={{ height: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
        <img
          src={imgSrc}
          alt=""
          crossOrigin="anonymous"
          style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain' }}
        />
      </div>
      {/* Línea de firma */}
      <div
        style={{
          width: 200,
          height: 1,
          background: tema.ink,
          margin: '4px auto 6px',
          opacity: 0.55,
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
