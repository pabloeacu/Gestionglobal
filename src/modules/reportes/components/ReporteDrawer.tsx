import { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, Filter as FilterIcon, Loader2 } from 'lucide-react';
import { Drawer, Button, Field, Input, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import { KpiPreviewStrip, type KpiItem } from './KpiPreviewStrip';
import {
  previewComprobantes,
  descargarComprobantesPdf,
  descargarComprobantesXlsx,
  descargarCtaCtePdf,
  descargarCtaCteXlsx,
  descargarRecuperoPdf,
  descargarTabuladorXlsx,
} from '@/services/api/reportes';
import { listAdministraciones, type AdministracionListItem } from '@/services/api/administraciones';
import { humanizeError } from '@/lib/errors';

// ============================================================================
// ReporteDrawer · drawer con filtros dinámicos + acciones PDF/Excel.
// Tipo del reporte se pasa como prop; el shape de filtros se adapta.
// ============================================================================

export type ReporteTipo =
  | 'comprobantes'
  | 'cuenta_corriente'
  | 'recupero'
  | 'tabulador';

interface Props {
  open: boolean;
  tipo: ReporteTipo;
  onClose: () => void;
}

const TITULOS: Record<ReporteTipo, { titulo: string; kicker: string; description: string }> = {
  comprobantes: {
    titulo: 'Reporte de comprobantes',
    kicker: 'Reporte',
    description: 'Filtrá por rango de fechas, cliente, tipo y estado. Exportá en PDF o Excel.',
  },
  cuenta_corriente: {
    titulo: 'Cuenta corriente',
    kicker: 'Extracto',
    description: 'Extracto detallado por cliente con saldo corrido.',
  },
  recupero: {
    titulo: 'Acciones de recupero',
    kicker: 'Reporte',
    description: 'Listado de acciones R1/R2/R3 con KPIs.',
  },
  tabulador: {
    titulo: 'Tabulador de servicios',
    kicker: 'Catálogo',
    description: 'Exportá el catálogo completo de servicios con precios vigentes.',
  },
};

export function ReporteDrawer({ open, tipo, onClose }: Props) {
  // Filtros comunes
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [administracionId, setAdministracionId] = useState('');
  const [estado, setEstado] = useState('todos');
  const [comprTipo, setComprTipo] = useState('todos');
  const [nivel, setNivel] = useState<'R1' | 'R2' | 'R3' | 'todos'>('todos');

  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<KpiItem[]>([]);
  const [downloading, setDownloading] = useState<'pdf' | 'xlsx' | null>(null);

  // Cargar lista de administraciones (para filtro Cliente)
  useEffect(() => {
    if (!open) return;
    if (admins.length > 0) return;
    setLoadingAdmins(true);
    listAdministraciones({ limit: 500 }).then((res) => {
      if (res.ok) setAdmins(res.data.rows);
      setLoadingAdmins(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-preview de comprobantes cuando los filtros cambian
  useEffect(() => {
    if (!open || tipo !== 'comprobantes') return;
    let cancelled = false;
    setPreviewLoading(true);
    previewComprobantes({
      desde: desde || undefined,
      hasta: hasta || undefined,
      administracionId: administracionId || undefined,
      estado: estado === 'todos' ? undefined : estado,
      tipo: comprTipo === 'todos' ? undefined : comprTipo,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setPreview([
          { label: 'Comprobantes', value: res.data.cantidad, format: 'number', accent: 'ink' },
          { label: 'Facturado', value: res.data.totalFacturado, format: 'money', accent: 'cyan' },
          { label: 'Cobrado', value: res.data.totalCobrado, format: 'money', accent: 'teal' },
          { label: 'Pendiente', value: res.data.totalPendiente, format: 'money', accent: 'cyan' },
        ]);
      }
      setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, tipo, desde, hasta, administracionId, estado, comprTipo]);

  const guardClienteRequerido = (): boolean => {
    if (tipo === 'cuenta_corriente' && !administracionId) {
      toast.error('Elegí un cliente para generar el extracto');
      return false;
    }
    return true;
  };

  const onPdf = async () => {
    if (!guardClienteRequerido()) return;
    setDownloading('pdf');
    try {
      if (tipo === 'comprobantes') {
        const res = await descargarComprobantesPdf({
          desde: desde || undefined, hasta: hasta || undefined,
          administracionId: administracionId || undefined,
          tipo: comprTipo === 'todos' ? undefined : comprTipo,
          estado: estado === 'todos' ? undefined : estado,
        });
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`PDF generado: ${res.data.filename}`);
      } else if (tipo === 'cuenta_corriente') {
        const res = await descargarCtaCtePdf({
          administracionId,
          desde: desde || undefined,
          hasta: hasta || undefined,
        });
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`PDF generado: ${res.data.filename}`);
      } else if (tipo === 'recupero') {
        const res = await descargarRecuperoPdf({
          desde: desde || undefined,
          hasta: hasta || undefined,
          nivel: nivel === 'todos' ? undefined : nivel,
        });
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`PDF generado: ${res.data.filename}`);
      } else {
        toast.info('Este reporte sólo se exporta en Excel.');
      }
    } finally {
      setDownloading(null);
    }
  };

  const onXlsx = async () => {
    if (!guardClienteRequerido()) return;
    setDownloading('xlsx');
    try {
      if (tipo === 'comprobantes') {
        const res = await descargarComprobantesXlsx({
          desde: desde || undefined, hasta: hasta || undefined,
          administracionId: administracionId || undefined,
          tipo: comprTipo === 'todos' ? undefined : comprTipo,
          estado: estado === 'todos' ? undefined : estado,
        });
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`Excel generado: ${res.data.filename}`);
      } else if (tipo === 'cuenta_corriente') {
        const res = await descargarCtaCteXlsx({
          administracionId,
          desde: desde || undefined,
          hasta: hasta || undefined,
        });
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`Excel generado: ${res.data.filename}`);
      } else if (tipo === 'tabulador') {
        const res = await descargarTabuladorXlsx();
        if (!res.ok) toast.error(humanizeError(res.error));
        else toast.success(`Excel generado: ${res.data.filename}`);
      } else {
        toast.info('Este reporte sólo se exporta en PDF.');
      }
    } finally {
      setDownloading(null);
    }
  };

  const meta = TITULOS[tipo];
  const supportsPdf = tipo !== 'tabulador';
  const supportsXlsx = tipo !== 'recupero';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={meta.titulo}
      kicker={meta.kicker}
      description={meta.description}
      icon={<FilterIcon size={18} />}
      width={640}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          {supportsPdf && (
            <Button
              variant="secondary"
              onClick={onPdf}
              loading={downloading === 'pdf'}
              disabled={downloading !== null}
            >
              <FileDown size={16} /> PDF
            </Button>
          )}
          {supportsXlsx && (
            <Button
              onClick={onXlsx}
              loading={downloading === 'xlsx'}
              disabled={downloading !== null}
            >
              <FileSpreadsheet size={16} /> Excel
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6 p-1">
        {/* Filtros comunes — fechas */}
        {tipo !== 'tabulador' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Desde">
              <Input
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </Field>
            <Field label="Hasta">
              <Input
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </Field>
          </div>
        )}

        {/* Cliente (administración) — para comprobantes opcional, ctacte obligatorio */}
        {(tipo === 'comprobantes' || tipo === 'cuenta_corriente') && (
          <Field
            label={tipo === 'cuenta_corriente' ? 'Cliente *' : 'Cliente'}
            hint={loadingAdmins ? 'Cargando administraciones…' : undefined}
          >
            <Select
              value={administracionId}
              onChange={(e) => setAdministracionId(e.target.value)}
            >
              <option value="">
                {tipo === 'cuenta_corriente' ? '— Seleccioná un cliente —' : 'Todos los clientes'}
              </option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </Select>
          </Field>
        )}

        {tipo === 'comprobantes' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select value={comprTipo} onChange={(e) => setComprTipo(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="X">X · simple</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
              </Select>
            </Field>
            <Field label="Estado cobranza">
              <Select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="parcial">Parcial</option>
                <option value="pagado">Pagado</option>
                <option value="vencido">Vencido</option>
                <option value="en_recupero">En recupero</option>
              </Select>
            </Field>
          </div>
        )}

        {tipo === 'recupero' && (
          <Field label="Nivel">
            <Select
              value={nivel}
              onChange={(e) => setNivel(e.target.value as typeof nivel)}
            >
              <option value="todos">Todos</option>
              <option value="R1">R1 — Aviso</option>
              <option value="R2">R2 — Intimación</option>
              <option value="R3">R3 — Legal</option>
            </Select>
          </Field>
        )}

        {/* Preview */}
        {tipo === 'comprobantes' && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                Vista previa
              </p>
              {previewLoading && (
                <Loader2 size={12} className="animate-spin text-brand-cyan" />
              )}
            </div>
            <KpiPreviewStrip items={preview} loading={previewLoading} />
          </div>
        )}
      </div>
    </Drawer>
  );
}
