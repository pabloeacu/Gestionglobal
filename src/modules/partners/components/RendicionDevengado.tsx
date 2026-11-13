// ============================================================================
// DGG-250 · Exposición premium "devengado vs pagado" de la rendición del partner.
//
// La participación del partner es DEVENGADA: se calcula sobre el costo incurrido
// (el servicio se prestó), no sobre lo que GG ya desembolsó. Este panel lo expone
// con honestidad y claridad: cuánto de los costos imputados ya pagó GG y cuánto
// queda pendiente, + dos gráficos marca-nativos (dona Ingresos/Costos y barra
// Pagado/Pendiente). Estilos inline → se ve idéntico en pantalla y en el PDF
// (html2canvas captura el mismo DOM). Sin dependencias de charting.
// ============================================================================

import type { RendicionResumenPago } from '@/services/api/partners';
import { fmtMoneda } from '@/services/api/partners';

const COLOR = {
  cyan: '#0e9bc8',
  amber: '#f59e0b',
  amberText: '#b45309',
  emerald: '#10b981',
  emeraldText: '#047857',
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  paper: '#f8fafc',
};

interface Props {
  resumen: RendicionResumenPago;
  /** 'screen' agrega una tarjeta con sombra suave; 'pdf' va plano para html2canvas. */
  variant?: 'screen' | 'pdf';
}

export function RendicionDevengado({ resumen, variant = 'screen' }: Props) {
  const {
    ingresos_atribuidos: ing,
    costos_atribuidos: cos,
    costo_pagado_atribuido: pagado,
    costo_pendiente_atribuido: pendiente,
    neto,
    tiene_pendiente,
  } = resumen;

  const wrapStyle: React.CSSProperties =
    variant === 'screen'
      ? {
          border: `1px solid ${COLOR.line}`,
          borderRadius: 14,
          background: '#ffffff',
          padding: 20,
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }
      : { border: `1px solid ${COLOR.line}`, background: '#ffffff', padding: 16 };

  return (
    <section style={wrapStyle}>
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: COLOR.cyan,
          margin: 0,
        }}
      >
        Cómo leer tu rendición
      </p>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: COLOR.ink, margin: '4px 0 2px 0' }}>
        Tu participación es sobre el costo incurrido (devengado)
      </h3>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: COLOR.muted, margin: '0 0 16px 0' }}>
        Se calcula sobre el costo <b style={{ color: COLOR.ink }}>incurrido</b> en el período —
        porque el servicio ya se prestó — y <b style={{ color: COLOR.ink }}>no</b> sobre lo que
        Gestión Global ya pagó. {tiene_pendiente
          ? 'Parte de ese costo todavía está pendiente de pago por GG; ya está rendido y se abonará según el flujo de caja.'
          : 'A la fecha, todos esos costos ya fueron pagados por GG.'}
      </p>

      {/* Cifras clave devengado vs pagado */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <Figure label="Costo imputado (afecta tu participación)" value={fmtMoneda(cos)} tone="ink" />
        <Figure label="De eso, GG ya pagó" value={fmtMoneda(pagado)} tone="emerald" />
        <Figure
          label="Pendiente de pago por GG"
          value={fmtMoneda(pendiente)}
          tone={tiene_pendiente ? 'amber' : 'muted'}
        />
      </div>

      {/* Gráficos */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 18,
          alignItems: 'center',
        }}
      >
        <DonaIngresoCosto ingresos={ing} costos={cos} neto={neto} />
        <BarraPagadoPendiente pagado={pagado} pendiente={pendiente} />
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ink' | 'emerald' | 'amber' | 'muted';
}) {
  const color =
    tone === 'emerald'
      ? COLOR.emeraldText
      : tone === 'amber'
        ? COLOR.amberText
        : tone === 'muted'
          ? COLOR.muted
          : COLOR.ink;
  const bg =
    tone === 'emerald'
      ? '#10b9810f'
      : tone === 'amber'
        ? '#f59e0b12'
        : COLOR.paper;
  return (
    <div style={{ border: `1px solid ${COLOR.line}`, borderRadius: 10, background: bg, padding: '10px 12px' }}>
      <p style={{ fontSize: 10.5, color: COLOR.muted, margin: 0, lineHeight: 1.25 }}>{label}</p>
      <p
        style={{
          fontSize: 17,
          fontWeight: 700,
          color,
          margin: '3px 0 0 0',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </p>
    </div>
  );
}

/** Dona Ingresos (cyan) vs Costos (amber), con el Neto en el centro. */
function DonaIngresoCosto({
  ingresos,
  costos,
  neto,
}: {
  ingresos: number;
  costos: number;
  neto: number;
}) {
  const total = Math.max(0, ingresos) + Math.max(0, costos);
  const r = 52;
  const cx = 66;
  const cy = 66;
  const C = 2 * Math.PI * r;
  const fi = total > 0 ? Math.max(0, ingresos) / total : 0;
  const fc = total > 0 ? Math.max(0, costos) / total : 0;
  const netoColor = neto >= 0 ? COLOR.emeraldText : '#e11d48';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label="Ingresos versus costos atribuidos">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={COLOR.line} strokeWidth="18" />
        {total > 0 && (
          <>
            <circle
              cx={cx} cy={cy} r={r} fill="none" stroke={COLOR.cyan} strokeWidth="18"
              strokeDasharray={`${fi * C} ${C}`}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
            <circle
              cx={cx} cy={cy} r={r} fill="none" stroke={COLOR.amber} strokeWidth="18"
              strokeDasharray={`${fc * C} ${C}`}
              strokeDashoffset={`${-fi * C}`}
              transform={`rotate(-90 ${cx} ${cy})`}
              strokeLinecap="butt"
            />
          </>
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: 9, fill: COLOR.muted, letterSpacing: '0.08em' }}>
          NETO
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" style={{ fontSize: 14, fontWeight: 700, fill: netoColor }}>
          {fmtMoneda(neto)}
        </text>
      </svg>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: COLOR.muted }}>
        <Legend color={COLOR.cyan} label={`Ingresos ${fmtMoneda(ingresos)}`} />
        <Legend color={COLOR.amber} label={`Costos ${fmtMoneda(costos)}`} />
      </div>
    </div>
  );
}

/** Barra apilada horizontal: de los costos, cuánto está pagado (emerald) vs pendiente (amber). */
function BarraPagadoPendiente({ pagado, pendiente }: { pagado: number; pendiente: number }) {
  const total = Math.max(0, pagado) + Math.max(0, pendiente);
  const pctPag = total > 0 ? Math.round((pagado / total) * 100) : 100;
  const pctPend = total > 0 ? 100 - pctPag : 0;
  const barW = 300;
  const pagW = total > 0 ? (pagado / total) * barW : barW;
  const pendW = total > 0 ? (pendiente / total) * barW : 0;
  const h = 30;
  return (
    <div style={{ width: '100%' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: COLOR.muted, margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Costos imputados · pagado vs pendiente
      </p>
      <svg width="100%" viewBox={`0 0 ${barW} ${h}`} preserveAspectRatio="none" height={h} role="img" aria-label="Proporción de costos pagados y pendientes">
        <rect x="0" y="0" width={barW} height={h} fill={COLOR.paper} />
        {pagW > 0 && <rect x="0" y="0" width={pagW} height={h} fill={COLOR.emerald} />}
        {pendW > 0 && <rect x={pagW} y="0" width={pendW} height={h} fill={COLOR.amber} />}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
        <span style={{ color: COLOR.emeraldText, fontWeight: 600 }}>
          <span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR.emerald, marginRight: 5, verticalAlign: 'middle' }} />
          Pagado {pctPag}% · {fmtMoneda(pagado)}
        </span>
        <span style={{ color: COLOR.amberText, fontWeight: 600 }}>
          <span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR.amber, marginRight: 5, verticalAlign: 'middle' }} />
          Pendiente {pctPend}% · {fmtMoneda(pendiente)}
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-block', width: 9, height: 9, background: color }} />
      {label}
    </span>
  );
}
