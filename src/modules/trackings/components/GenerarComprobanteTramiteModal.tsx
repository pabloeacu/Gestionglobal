// JL 2 · obs 1 (2026-06-12): atajo para emitir el comprobante de un trámite que
// muestra "Comprobante pendiente", SIN volver a Solicitudes a buscar el cliente.
// Emite un comprobante simple (tipo X) prefilleado desde el servicio del trámite
// y lo vincula con updateTramite({comprobante_id}) → el computed column
// `comprobante_pendiente` (mig 0207) se limpia y el chip desaparece. La cobranza
// queda en su flujo existente (el comprobante queda en Facturación).
//
// Adaptado de ModalGenerarComprobante (PanelComprobanteCobranza, lado solicitud):
// misma emisión, pero (a) pasa el consorcio_id del trámite (el comprobante y una
// cobranza posterior lo heredan), y (b) linkea al trámite en vez de a la solicitud.
// Regla 4: queries via services/api/*. Regla 13: toast, sin window.*.

import { useState } from 'react';
import { Percent, Receipt } from 'lucide-react';
import { Button, Field, Input, Modal, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { emitirComprobanteManual } from '@/services/api/comprobantes';
import { updateTramite } from '@/services/api/tramites';
import { humanizeError } from '@/lib/errors';

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  });
}

export function GenerarComprobanteTramiteModal({
  open,
  tramiteId,
  tramiteCodigo,
  administracionId,
  consorcioId,
  servicioNombre,
  servicioPrecioBase,
  receptorNombre,
  esDDJJ,
  onClose,
  onGenerado,
}: {
  open: boolean;
  tramiteId: string;
  tramiteCodigo: string | null;
  administracionId: string | null;
  consorcioId: string | null;
  servicioNombre: string | null;
  servicioPrecioBase: number | null;
  receptorNombre: string;
  esDDJJ: boolean;
  onClose: () => void;
  onGenerado: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const venceDefault = new Date(Date.now() + 15 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [descripcion, setDescripcion] = useState(
    servicioNombre ?? 'Servicio profesional',
  );
  // Pre-fill del precio desde el precio_base del servicio (referencial; el
  // operador lo edita y puede aplicar bonificación). Para DDJJ no hay precio
  // base → arranca vacío y el operador ingresa el monto del consorcio.
  const [precio, setPrecio] = useState<string>(
    servicioPrecioBase && servicioPrecioBase > 0 ? String(servicioPrecioBase) : '',
  );
  const [bonif, setBonif] = useState<string>('0');
  const [fecha, setFecha] = useState(hoy);
  const [vencimiento, setVencimiento] = useState(venceDefault);
  const [observ, setObserv] = useState('');
  const [enviando, setEnviando] = useState(false);

  const precioNum = Number(precio || 0);
  const bonifNum = Number(bonif || 0);
  const total = Math.max(
    0,
    Math.round(precioNum * (1 - bonifNum / 100) * 100) / 100,
  );

  async function generar() {
    if (!administracionId) {
      toast.error(
        'El trámite no tiene cliente vinculado; no se puede emitir el comprobante',
      );
      return;
    }
    if (precioNum <= 0) {
      toast.error('Ingresá un precio mayor a 0');
      return;
    }
    if (bonifNum < 0 || bonifNum > 100) {
      toast.error('La bonificación debe estar entre 0 y 100%');
      return;
    }
    setEnviando(true);
    const r = await emitirComprobanteManual({
      administracion_id: administracionId,
      consorcio_id: consorcioId ?? null,
      tipo: 'X',
      punto_venta: 1,
      fecha,
      vencimiento,
      concepto: 'servicios',
      items: [
        {
          descripcion,
          cantidad: 1,
          precio_unitario: precioNum,
          bonificacion_porc: bonifNum,
          alicuota_iva: 'exento',
          servicio_id: null,
          consorcio_id: consorcioId ?? null,
        },
      ],
      observaciones:
        observ.trim().length > 0
          ? observ.trim()
          : 'Generado desde trámite ' + (tramiteCodigo ?? tramiteId.slice(0, 8)),
      comprobante_referencia_id: null,
    });
    if (!r.ok) {
      setEnviando(false);
      toast.error(humanizeError(r.error));
      return;
    }
    const compId = r.data.id;
    // Vincular al trámite → limpia el computed column comprobante_pendiente.
    const v = await updateTramite(tramiteId, { comprobante_id: compId });
    setEnviando(false);
    if (!v.ok) {
      toast.warning('Comprobante creado pero no quedó vinculado al trámite');
    } else {
      toast.success('Comprobante generado');
    }
    onGenerado();
  }

  return (
    <Modal open={open} onClose={onClose} title="Generar comprobante del trámite">
      <div className="space-y-4">
        <div className="rounded-lg bg-brand-cyan-pale/30 p-3 text-xs text-brand-muted">
          Receptor: <strong className="text-brand-ink">{receptorNombre}</strong>
        </div>

        {esDDJJ && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            DDJJ: el importe se define según la cantidad de consorcios declarados.
            Ingresá el monto acordado.
          </div>
        )}

        <Field label="Descripción">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio">
            <Input
              type="number"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0,00"
              min={0}
              step={0.01}
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                <Percent size={11} /> Bonificación %
              </span>
            }
          >
            <Input
              type="number"
              value={bonif}
              onChange={(e) => setBonif(e.target.value)}
              min={0}
              max={100}
              step={0.5}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>
          <Field label="Vencimiento">
            <Input
              type="date"
              value={vencimiento}
              onChange={(e) => setVencimiento(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Observaciones (opcional)">
          <Textarea
            rows={2}
            value={observ}
            onChange={(e) => setObserv(e.target.value)}
          />
        </Field>

        <div className="flex items-baseline justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="text-brand-muted">Total</span>
          <strong className="text-brand-ink">{fmtMoney(total)}</strong>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={generar} loading={enviando}>
            <Receipt size={15} /> Generar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
