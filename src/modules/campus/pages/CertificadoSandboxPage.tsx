import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  CertificadoPremium,
  CERT_W,
  CERT_H,
} from '../components/CertificadoPremium';
import { verificacionUrl, type CertificadoParaPdf } from '@/services/api/campus';

const CURSOS_EJEMPLO: Array<{ titulo: string; tema: number; duracion: number; nota: number | null }> = [
  { titulo: 'Curso inicial de formación · Administradores RPAC', tema: 1, duracion: 40, nota: 9 },
  { titulo: 'Curso de Actualización para Administradores RPAC', tema: 2, duracion: 20, nota: 8.5 },
  { titulo: 'Diplomatura en Administración de Consorcios', tema: 3, duracion: 80, nota: 10 },
  { titulo: 'Seminario · Reforma de la Ley 13.512', tema: 4, duracion: 12, nota: null },
];

export function CertificadoSandboxPage() {
  const [variante, setVariante] = useState(0);
  const [qr, setQr] = useState<string | null>(null);

  const cert: CertificadoParaPdf = useMemo(() => {
    const c = CURSOS_EJEMPLO[variante] ?? CURSOS_EJEMPLO[0]!;
    return {
      id: 'sandbox',
      codigo: `GG-${new Date().getFullYear()}-DEMO-${variante + 1}`,
      tema: c.tema,
      alumno_nombre: 'María Soledad López Etchart',
      curso_titulo: c.titulo,
      instructor_nombre: 'Dr. Pablo E. Acuña',
      nota_examen: c.nota,
      emitido_at: new Date().toISOString(),
      duracion_horas: c.duracion,
    };
  }, [variante]);

  const url = verificacionUrl(cert.codigo);

  useEffect(() => {
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1f33', light: '#ffffff' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="kicker text-brand-cyan">Sandbox visual</p>
          <h1 className="text-2xl font-semibold text-brand-ink">Certificado · paso 1</h1>
          <p className="text-sm text-brand-muted">
            Vista previa con datos hardcoded para iterar visualmente. No persiste en BD.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {CURSOS_EJEMPLO.map((c, i) => (
            <button
              key={c.tema}
              type="button"
              onClick={() => setVariante(i)}
              className={
                'rounded-lg border px-3 py-1.5 text-xs font-semibold transition ' +
                (variante === i
                  ? 'border-brand-cyan bg-brand-cyan text-white'
                  : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40 hover:text-brand-ink')
              }
            >
              Tema {c.tema}
            </button>
          ))}
        </div>
      </header>

      <div className="rounded-2xl bg-slate-100 p-6 shadow-inner">
        <div className="mx-auto" style={{ width: CERT_W, maxWidth: '100%' }}>
          <div
            style={{ width: CERT_W, height: CERT_H }}
            className="origin-top-left shadow-xl ring-1 ring-black/10"
          >
            <CertificadoPremium cert={cert} qrDataUrl={qr} verificarUrl={url} />
          </div>
        </div>
      </div>
    </div>
  );
}
