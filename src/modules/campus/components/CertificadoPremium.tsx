import { forwardRef } from 'react';
import type { CertificadoParaPdf } from '@/services/api/campus';

// ============================================================================
// Certificado ULTRA PREMIUM (DGG-13) — render HTML/CSS.
//
// Reemplaza el PDF jsPDF-vector "berreta". Este componente es la ÚNICA fuente de
// verdad del diseño: lo usa tanto la "Vista previa" (modal en gerencia / portal)
// como el generador de PDF (`generateCertificadoPdf` lo monta offscreen y lo
// captura con html2canvas → jsPDF). Por eso TODO el estilado va inline: garantiza
// que html2canvas capture exactamente lo que se ve, sin depender de Tailwind ni
// de funciones de color modernas (oklch) que html2canvas no entiende.
//
// Estética: misma identidad que la web (gradiente navy→cyan, acentos
// triangulares, sello dorado con el isotipo GG, logos reales). 4 temas de color
// según `cert.tema` (1=marino+dorado · 2=dorado · 3=cyan/teal · 4=violeta),
// alineados a los 4 modelos FUNDPLATA (DGG-10bis) pero con refinamiento premium.
//
// Lienzo: 1123×794 px = ratio A4 apaisado. El PDF se arma 297×210 mm.
// ============================================================================

export const CERT_W = 1123;
export const CERT_H = 794;

interface Tema {
  // gradiente del marco/banda exterior
  bgFrom: string;
  bgVia: string;
  bgTo: string;
  // tinta de títulos y cuerpo institucional
  ink: string;
  inkSoft: string;
  // acento dorado (curso, sello, filetes)
  gold: string;
  goldDeep: string;
  goldSoft: string;
  // acento de marca (triángulos, detalles)
  accent: string;
  triangle: string; // color de los triángulos sobre fondo claro
}

const TEMAS: Record<number, Tema> = {
  // 1 · Marino + dorado (Curso de Formación / Integral)
  1: {
    bgFrom: '#0b1f33',
    bgVia: '#0e2a45',
    bgTo: '#102a4a',
    ink: '#102a4a',
    inkSoft: '#3c587a',
    gold: '#c79a3e',
    goldDeep: '#9c7423',
    goldSoft: '#e8d6a6',
    accent: '#009eca',
    triangle: '#102a4a',
  },
  // 2 · Dorado (Actualización 2024)
  2: {
    bgFrom: '#5c440e',
    bgVia: '#8a6a1d',
    bgTo: '#6e5316',
    ink: '#5c440e',
    inkSoft: '#7a6230',
    gold: '#b48a26',
    goldDeep: '#8a6618',
    goldSoft: '#ecd8a0',
    accent: '#b48a26',
    triangle: '#8a6a1d',
  },
  // 3 · Cyan / teal (Actualización 2025)
  3: {
    bgFrom: '#0d4a5c',
    bgVia: '#0e6f86',
    bgTo: '#1b9da8',
    ink: '#0d4a5c',
    inkSoft: '#3a6f7e',
    gold: '#c79a3e',
    goldDeep: '#9c7423',
    goldSoft: '#e8d6a6',
    accent: '#009eca',
    triangle: '#0d4a5c',
  },
  // 4 · Violeta (Actualización 2026)
  4: {
    bgFrom: '#3a205c',
    bgVia: '#542c87',
    bgTo: '#6d40a8',
    ink: '#3a205c',
    inkSoft: '#5c4480',
    gold: '#c79a3e',
    goldDeep: '#9c7423',
    goldSoft: '#e8d6a6',
    accent: '#6d40a8',
    triangle: '#3a205c',
  },
};

const SERIF = "'Cormorant Garamond', 'Times New Roman', serif";
const SCRIPT = "'Great Vibes', 'Brush Script MT', cursive";
const SANS = "'Sora', 'Inter', system-ui, sans-serif";

function fechaLarga(iso: string): string {
  const d = new Date(iso);
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

const LEYENDA_LEGAL =
  'Certificado emitido conforme a la habilitación de FU.DE.CO.IN, Ley N.° 14.701, ' +
  'Decreto N.° 1734/22 y Disposición N.° 27/23. Organizado por Gestión Global.';

// Cluster de triángulos (lenguaje gráfico GG) como nodo HTML para que
// html2canvas lo capture sin depender del SVG <currentColor>.
function Triangulos({
  color,
  size,
  style,
  flip,
}: {
  color: string;
  size: number;
  style?: React.CSSProperties;
  flip?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      style={{ position: 'absolute', transform: flip ? 'scale(-1,-1)' : undefined, ...style }}
      aria-hidden
    >
      <g fill={color}>
        <path d="M40 10 L90 10 L40 60 Z" opacity={0.5} />
        <path d="M100 10 L150 10 L100 60 Z" opacity={0.3} />
        <path d="M40 70 L90 70 L40 120 Z" opacity={0.22} />
        <path d="M155 30 L185 30 L155 60 Z" opacity={0.32} />
        <path d="M105 75 L135 75 L105 105 Z" opacity={0.16} />
      </g>
    </svg>
  );
}

export interface CertificadoPremiumProps {
  cert: CertificadoParaPdf;
  qrDataUrl: string | null;
  verificarUrl: string;
}

// `forwardRef` para que el generador tome el nodo DOM y lo pase a html2canvas.
export const CertificadoPremium = forwardRef<HTMLDivElement, CertificadoPremiumProps>(
  function CertificadoPremium({ cert, qrDataUrl, verificarUrl }, ref) {
    const tema = TEMAS[cert.tema] ?? TEMAS[1]!;
    const partes: string[] = [];
    if (cert.duracion_horas) partes.push(`${cert.duracion_horas} horas reloj`);
    if (cert.nota_examen !== null && cert.nota_examen !== undefined) {
      partes.push(`Calificación ${cert.nota_examen}/100`);
    }

    return (
      <div
        ref={ref}
        style={{
          width: CERT_W,
          height: CERT_H,
          position: 'relative',
          boxSizing: 'border-box',
          padding: 18,
          background: `linear-gradient(135deg, ${tema.bgFrom} 0%, ${tema.bgVia} 55%, ${tema.bgTo} 100%)`,
          fontFamily: SANS,
          overflow: 'hidden',
        }}
      >
        {/* Lámina interior color crema (el "papel") */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background:
              'linear-gradient(180deg, #fffdf8 0%, #fcf8ee 60%, #faf3e2 100%)',
            borderRadius: 2,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.6)',
            overflow: 'hidden',
          }}
        >
          {/* Doble filete dorado */}
          <div
            style={{
              position: 'absolute',
              inset: 16,
              border: `2px solid ${tema.gold}`,
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 22,
              border: `1px solid ${tema.goldSoft}`,
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />

          {/* Acentos triangulares (marca) en esquinas */}
          <Triangulos color={tema.triangle} size={210} style={{ top: -4, left: -4, opacity: 0.1 }} />
          <Triangulos
            color={tema.triangle}
            size={210}
            style={{ bottom: -4, right: -4, opacity: 0.1 }}
            flip
          />

          {/* Contenido */}
          <div
            style={{
              position: 'relative',
              height: '100%',
              boxSizing: 'border-box',
              padding: '46px 78px 38px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* ====== Encabezado: FUNDPLATA wordmark + sello dorado ====== */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 18,
                marginBottom: 6,
              }}
            >
              <div style={{ textAlign: 'center', lineHeight: 1 }}>
                <div
                  style={{
                    fontFamily: SERIF,
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: 6,
                    color: tema.gold,
                  }}
                >
                  FUNDPLATA
                </div>
                <div
                  style={{
                    fontSize: 8.5,
                    letterSpacing: 3,
                    color: tema.inkSoft,
                    marginTop: 3,
                    textTransform: 'uppercase',
                  }}
                >
                  Fundación para el Desarrollo
                </div>
              </div>
            </div>

            {/* Filete corto bajo el wordmark */}
            <div
              style={{
                width: 120,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${tema.gold}, transparent)`,
                marginBottom: 18,
              }}
            />

            {/* ====== Título ====== */}
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 62,
                fontWeight: 600,
                letterSpacing: 14,
                color: tema.ink,
                lineHeight: 1,
              }}
            >
              CERTIFICADO
            </div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: 5,
                color: tema.inkSoft,
                textTransform: 'uppercase',
                marginTop: 6,
              }}
            >
              de aprobación
            </div>

            {/* ====== Cuerpo ====== */}
            <div style={{ fontSize: 13, color: tema.inkSoft, marginTop: 22 }}>
              Se otorga el presente a
            </div>

            {/* Nombre del alumno (script) */}
            <div
              style={{
                fontFamily: SCRIPT,
                fontSize: 58,
                color: tema.ink,
                lineHeight: 1,
                marginTop: 4,
                padding: '0 20px',
              }}
            >
              {cert.alumno_nombre}
            </div>
            <div
              style={{
                width: 340,
                maxWidth: '70%',
                height: 1,
                background: tema.gold,
                marginTop: 8,
                opacity: 0.7,
              }}
            />

            <div style={{ fontSize: 13, color: tema.inkSoft, marginTop: 18 }}>
              por haber completado y aprobado satisfactoriamente
            </div>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 26,
                fontWeight: 700,
                color: tema.goldDeep,
                marginTop: 6,
                maxWidth: 760,
                textAlign: 'center',
                lineHeight: 1.15,
              }}
            >
              {cert.curso_titulo}
            </div>

            {/* Datos */}
            {(partes.length > 0 || cert.emitido_at) && (
              <div
                style={{
                  fontSize: 11.5,
                  color: tema.inkSoft,
                  marginTop: 14,
                  letterSpacing: 0.3,
                }}
              >
                {[fechaLarga(cert.emitido_at), ...partes].join('   ·   ')}
              </div>
            )}

            {/* Espaciador */}
            <div style={{ flex: 1 }} />

            {/* Leyenda legal */}
            <div
              style={{
                fontFamily: SERIF,
                fontStyle: 'italic',
                fontSize: 10,
                color: tema.inkSoft,
                maxWidth: 680,
                textAlign: 'center',
                lineHeight: 1.4,
                marginBottom: 14,
              }}
            >
              {LEYENDA_LEGAL}
            </div>

            {/* ====== Pie: firmas + sello central + QR ====== */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                width: '100%',
              }}
            >
              {/* Firma izquierda */}
              <Firma
                tema={tema}
                nombre="Pablo M. Parente"
                cargo="Presidente · FU.DE.CO.IN"
              />

              {/* Sello dorado central con isotipo GG */}
              <div style={{ position: 'relative', width: 104, textAlign: 'center' }}>
                <div
                  style={{
                    position: 'relative',
                    width: 96,
                    height: 96,
                    margin: '0 auto',
                    borderRadius: '50%',
                    background: `radial-gradient(circle at 35% 30%, ${tema.goldSoft}, ${tema.gold} 55%, ${tema.goldDeep} 100%)`,
                    boxShadow: `0 4px 14px ${tema.goldDeep}55`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 78,
                      height: 78,
                      borderRadius: '50%',
                      background: '#fffdf8',
                      border: `2px solid ${tema.goldDeep}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img
                      src="/logo-color.png"
                      alt="Gestión Global"
                      crossOrigin="anonymous"
                      style={{ width: 50, height: 50, objectFit: 'contain' }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 7.5,
                    letterSpacing: 2,
                    color: tema.goldDeep,
                    marginTop: 6,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  Certificado oficial
                </div>
              </div>

              {/* Firma derecha */}
              <Firma
                tema={tema}
                nombre="Dr. Pablo E. Acuña"
                cargo="Coordinador Académico"
              />
            </div>

            {/* Barra inferior: organizado por GG + código + QR */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                marginTop: 18,
                paddingTop: 12,
                borderTop: `1px solid ${tema.goldSoft}`,
              }}
            >
              {/* Organizado por Gestión Global */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span
                  style={{
                    fontSize: 8,
                    letterSpacing: 1.5,
                    color: tema.inkSoft,
                    textTransform: 'uppercase',
                  }}
                >
                  Organizado por
                </span>
                <img
                  src="/logo-h-color.png"
                  alt="Gestión Global"
                  crossOrigin="anonymous"
                  style={{ height: 30, objectFit: 'contain' }}
                />
              </div>

              {/* Código + QR */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: 1,
                      color: tema.inkSoft,
                      textTransform: 'uppercase',
                    }}
                  >
                    Verificá su autenticidad
                  </div>
                  <div
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11,
                      fontWeight: 700,
                      color: tema.ink,
                      letterSpacing: 0.5,
                    }}
                  >
                    {cert.codigo}
                  </div>
                  <div style={{ fontSize: 8, color: tema.inkSoft }}>
                    {verificarUrl.replace(/^https?:\/\//, '')}
                  </div>
                </div>
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR de verificación"
                    style={{
                      width: 58,
                      height: 58,
                      border: `2px solid ${tema.goldSoft}`,
                      borderRadius: 4,
                      background: '#fff',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 58,
                      height: 58,
                      border: `2px solid ${tema.goldSoft}`,
                      borderRadius: 4,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

function Firma({
  tema,
  nombre,
  cargo,
}: {
  tema: Tema;
  nombre: string;
  cargo: string;
}) {
  return (
    <div style={{ width: 220, textAlign: 'center' }}>
      <div
        style={{
          width: 180,
          height: 1,
          background: tema.ink,
          margin: '0 auto 7px',
          opacity: 0.55,
        }}
      />
      <div style={{ fontSize: 13, fontWeight: 700, color: tema.ink }}>{nombre}</div>
      <div style={{ fontSize: 9.5, color: tema.inkSoft, marginTop: 2 }}>{cargo}</div>
    </div>
  );
}
