import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3,
  FileText,
  Wallet,
  AlertCircle,
  ListChecks,
  Upload,
  ArrowRight,
} from 'lucide-react';
import { ReporteDrawer, type ReporteTipo } from '../components/ReporteDrawer';

// ============================================================================
// ReportesHubPage · pantalla central de Reportes.
// Tarjetas grandes por reporte; cada una abre un drawer con filtros + export.
// ============================================================================

interface Card {
  tipo: ReporteTipo;
  icon: typeof FileText;
  titulo: string;
  bajada: string;
  formatos: string[];
  accent: 'cyan' | 'teal';
}

const CARDS: Card[] = [
  {
    tipo: 'comprobantes',
    icon: FileText,
    titulo: 'Comprobantes',
    bajada:
      'Listado de comprobantes emitidos con KPIs ejecutivos y tabla detallada.',
    formatos: ['PDF', 'Excel'],
    accent: 'cyan',
  },
  {
    tipo: 'cuenta_corriente',
    icon: Wallet,
    titulo: 'Cuenta corriente',
    bajada:
      'Extracto detallado por cliente con saldo corrido. Ideal para enviar al administrador.',
    formatos: ['PDF', 'Excel'],
    accent: 'teal',
  },
  {
    tipo: 'recupero',
    icon: AlertCircle,
    titulo: 'Acciones de recupero',
    bajada:
      'Listado de acciones R1/R2/R3 con totales en recupero vs. recuperado.',
    formatos: ['PDF'],
    accent: 'cyan',
  },
  {
    tipo: 'tabulador',
    icon: ListChecks,
    titulo: 'Tabulador de servicios',
    bajada:
      'Catálogo completo de servicios con precios vigentes. Multi-hoja por categoría.',
    formatos: ['Excel'],
    accent: 'teal',
  },
];

export function ReportesHubPage() {
  const [openTipo, setOpenTipo] = useState<ReporteTipo | null>(null);

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-cyan">
            Reportes
          </p>
          <h1 className="font-display text-3xl font-bold text-brand-ink">
            Exportá lo que importa
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            PDFs con la marca Gestión Global y planillas Excel listas para
            contabilidad. También podés importar comprobantes históricos.
          </p>
        </div>
        <Link
          to="/gerencia/reportes/importador"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-brand-ink hover:bg-slate-50"
        >
          <Upload size={16} /> Importar histórico
          <ArrowRight size={14} className="text-brand-muted" />
        </Link>
      </header>

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {CARDS.map((c) => {
          const Icon = c.icon;
          const accentBg =
            c.accent === 'cyan' ? 'bg-brand-cyan/10' : 'bg-brand-teal/10';
          const accentText =
            c.accent === 'cyan' ? 'text-brand-cyan' : 'text-brand-teal';
          return (
            <button
              key={c.tipo}
              onClick={() => setOpenTipo(c.tipo)}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span
                className={`absolute inset-x-0 top-0 h-1 ${
                  c.accent === 'cyan' ? 'bg-brand-cyan' : 'bg-brand-teal'
                }`}
              />
              <div className="flex items-start gap-4">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${accentBg} ${accentText}`}
                >
                  <Icon size={22} />
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-lg font-semibold text-brand-ink">
                    {c.titulo}
                  </h3>
                  <p className="mt-1 text-sm text-brand-muted">{c.bajada}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.formatos.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight
                  size={18}
                  className="text-brand-muted transition group-hover:translate-x-1 group-hover:text-brand-cyan"
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer informativo */}
      <div className="rounded-xl border border-slate-200 bg-brand-zebra/40 p-4">
        <div className="flex items-start gap-3">
          <BarChart3 className="mt-0.5 text-brand-cyan" size={18} />
          <div className="text-sm text-brand-muted">
            <p>
              <strong className="text-brand-ink">Tip ARCH-REVIEW:</strong>{' '}
              los reportes corren del lado del cliente (no consultan más que
              tablas con índice en {' '}
              <code className="rounded bg-white px-1 py-0.5 text-xs">
                administracion_id, fecha
              </code>
              ). Si el período supera 12 meses, considerá segmentar la consulta.
            </p>
          </div>
        </div>
      </div>

      {openTipo && (
        <ReporteDrawer
          open
          tipo={openTipo}
          onClose={() => setOpenTipo(null)}
        />
      )}
    </div>
  );
}
