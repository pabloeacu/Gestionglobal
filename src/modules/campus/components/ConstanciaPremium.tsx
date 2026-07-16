// ============================================================================
// Constancia de inscripción · carta A4 VERTICAL (chunk CONST).
//
// GEMELA de CertificadoPremium — NO comparte código con el diploma (mandato
// Pablo: no tocar la emisión de certificados que "funciona perfecto"). Hereda
// las LECCIONES capitalizadas del diploma:
//   · dimensiones exactas con ratio A4 (794×1123 = los mismos números del
//     diploma intercambiados → A4 portrait exacto para jsPDF 210×297mm)
//   · estilos 100% inline (sin Tailwind/oklch) → html-to-image captura fiel
//   · posiciones calculadas con top, nunca bottom (bug de rasterizado conocido)
//   · <img crossOrigin="anonymous"> en todas las imágenes
//
// Estructura (modelo RPAC de Pablo, 2026-07-15):
//   1. Banda superior finita acento→dorado + motivo de triángulos (identidad)
//   2. Logo emisor centrado (banco de imágenes compartido con el diploma)
//   3. "{lugar}, {fecha larga}" alineado a la derecha
//   4. Bloque del destinatario (multilínea, editable al emitir)
//   5. Cuerpo de la carta (párrafos justificados, **negrita** inline)
//   6. Firmas 1/2 del banco (imagen + línea + nombre + cargo)
//   7. Pie: código de emisión + "Gestión Global · gestionglobal.ar"
// Sin QR ni código de verificación (decisión Pablo).
// ============================================================================

export const CONST_W = 794;
export const CONST_H = 1123;

const SANS = "'Inter', 'Sora', system-ui, sans-serif";

export interface EsquemaConstancia {
  color_acento: string;
  color_dorado: string;
  visible_marca_logo: boolean;
  marca_logo_url: string | null;
  visible_firma_1: boolean;
  firma_1_img_url: string | null;
  firma_1_nombre: string;
  firma_1_cargo: string;
  visible_firma_2: boolean;
  firma_2_img_url: string | null;
  firma_2_nombre: string;
  firma_2_cargo: string;
  visible_watermark: boolean;
  watermark_url: string | null;
}

export const ESQUEMA_CONST_DEFAULT: EsquemaConstancia = {
  color_acento: '#0b1f33',
  color_dorado: '#a87f3c',
  visible_marca_logo: true,
  marca_logo_url: '/cert/logo-fundplata.png',
  visible_firma_1: true,
  firma_1_img_url: '/cert/firma-parente.png',
  firma_1_nombre: 'Pablo M. Parente',
  firma_1_cargo: 'Presidente FU.DE.CO.IN.',
  visible_firma_2: true,
  firma_2_img_url: '/cert/firma-acuna.png',
  firma_2_nombre: 'Dr. Pablo E. Acuña',
  firma_2_cargo: 'Director Académico',
  visible_watermark: false,
  watermark_url: null,
};

export interface ConstanciaDatosRender {
  codigo: string;
  lugar: string;            // ej "Buenos Aires"
  fecha_larga: string;      // ej "15 de julio de 2026"
  destinatario: string | null; // bloque multilínea (o null si se ocultó)
  texto: string;            // cuerpo FINAL (variables ya reemplazadas), párrafos \n\n, **negrita**
}

/** Render de un texto con negritas mínimas: los segmentos entre ** van bold. */
function TextoConNegritas({ texto }: { texto: string }) {
  const partes = texto.split('**');
  return (
    <>
      {partes.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} style={{ fontWeight: 700 }}>
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ConstanciaPremium({
  datos,
  esquema,
}: {
  datos: ConstanciaDatosRender;
  esquema?: EsquemaConstancia;
}) {
  const e = { ...ESQUEMA_CONST_DEFAULT, ...(esquema ?? {}) };
  const acento = e.color_acento || '#0b1f33';
  const dorado = e.color_dorado || '#a87f3c';
  const ink = '#0f172a';
  const inkSoft = '#475569';

  const parrafos = (datos.texto ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const firmas = [
    e.visible_firma_1
      ? { img: e.firma_1_img_url, nombre: e.firma_1_nombre, cargo: e.firma_1_cargo }
      : null,
    e.visible_firma_2
      ? { img: e.firma_2_img_url, nombre: e.firma_2_nombre, cargo: e.firma_2_cargo }
      : null,
  ].filter(Boolean) as Array<{ img: string | null; nombre: string; cargo: string }>;

  return (
    <div
      style={{
        width: CONST_W,
        height: CONST_H,
        background: '#ffffff',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: SANS,
        color: ink,
      }}
    >
      {/* Banda superior acento→dorado */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CONST_W,
          height: 8,
          background: `linear-gradient(90deg, ${acento} 0%, ${acento} 55%, ${dorado} 100%)`,
        }}
      />
      {/* Motivo de triángulos (identidad de la plataforma) */}
      <svg
        width={120}
        height={60}
        viewBox="0 0 120 60"
        style={{ position: 'absolute', top: 26, left: CONST_W - 150, pointerEvents: 'none' }}
        aria-hidden
      >
        <polygon points="0,60 30,10 60,60" fill={acento} opacity={0.14} />
        <polygon points="35,60 62,18 89,60" fill={dorado} opacity={0.35} />
        <polygon points="70,60 92,26 114,60" fill={acento} opacity={0.55} />
      </svg>

      {/* Watermark opcional */}
      {e.visible_watermark && e.watermark_url && (
        <img
          src={e.watermark_url}
          crossOrigin="anonymous"
          alt=""
          style={{
            position: 'absolute',
            top: 360,
            left: (CONST_W - 480) / 2,
            width: 480,
            opacity: 0.05,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Contenido (columna carta) */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 0,
          width: CONST_W,
          height: CONST_H - 8,
          padding: '54px 86px 0',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* Logo emisor */}
        {e.visible_marca_logo && e.marca_logo_url && (
          <div style={{ textAlign: 'center' }}>
            <img
              src={e.marca_logo_url}
              crossOrigin="anonymous"
              alt=""
              style={{ maxHeight: 96, maxWidth: 250, objectFit: 'contain' }}
            />
          </div>
        )}

        {/* Lugar y fecha */}
        <p
          style={{
            margin: '52px 0 0',
            textAlign: 'right',
            fontSize: 15,
            color: ink,
          }}
        >
          {datos.lugar}, {datos.fecha_larga}
        </p>

        {/* Destinatario */}
        {datos.destinatario && (
          <p
            style={{
              margin: '44px 0 0',
              fontSize: 14.5,
              fontWeight: 600,
              lineHeight: 1.62,
              whiteSpace: 'pre-line',
              color: ink,
            }}
          >
            {datos.destinatario}
          </p>
        )}

        {/* Cuerpo */}
        <div style={{ marginTop: 40 }}>
          {parrafos.map((p, i) => (
            <p
              key={i}
              style={{
                margin: i === 0 ? 0 : '26px 0 0',
                fontSize: 15.5,
                lineHeight: 2.0,
                textAlign: p.length > 90 ? 'justify' : 'left',
                textIndent: p.length > 90 ? 46 : 0,
                color: '#1e293b',
              }}
            >
              <TextoConNegritas texto={p} />
            </p>
          ))}
        </div>

        {/* Espaciador flexible: empuja las firmas hacia el tercio inferior */}
        <div style={{ flexGrow: 1 }} />

        {/* Firmas */}
        {firmas.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: firmas.length === 1 ? 'center' : 'space-evenly',
              alignItems: 'flex-end',
              marginBottom: 96,
            }}
          >
            {firmas.map((f, i) => (
              <div key={i} style={{ textAlign: 'center', width: 250 }}>
                {f.img && (
                  <img
                    src={f.img}
                    crossOrigin="anonymous"
                    alt=""
                    style={{
                      height: 78,
                      maxWidth: 230,
                      objectFit: 'contain',
                      display: 'block',
                      margin: '0 auto -8px',
                    }}
                  />
                )}
                <div
                  style={{
                    borderTop: `1.4px solid ${inkSoft}`,
                    width: 210,
                    margin: '0 auto',
                    paddingTop: 7,
                  }}
                >
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12.5,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: ink,
                    }}
                  >
                    {f.nombre}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: inkSoft }}>{f.cargo}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pie institucional (top calculado, nunca bottom) */}
      <div
        style={{
          position: 'absolute',
          top: CONST_H - 46,
          left: 0,
          width: CONST_W,
          padding: '0 86px',
          boxSizing: 'border-box',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <p style={{ margin: 0, fontSize: 9.5, color: '#94a3b8' }}>
          Documento emitido por <span style={{ fontWeight: 600, color: inkSoft }}>Gestión Global</span> · gestionglobal.ar
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 9.5,
            color: '#94a3b8',
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
          }}
        >
          {datos.codigo}
        </p>
      </div>
      <div
        style={{
          position: 'absolute',
          top: CONST_H - 8,
          left: 0,
          width: CONST_W,
          height: 8,
          background: `linear-gradient(90deg, ${dorado} 0%, ${acento} 45%, ${acento} 100%)`,
        }}
      />
    </div>
  );
}
