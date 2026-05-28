// #148 · Panel "Comprobante + cobranza" para la página de detalle de
// solicitud. Permite (a) generar un comprobante simple (tipo X) con item +
// bonificación %, (b) registrar cobranza si ya hay comprobante con saldo.
//
// Regla 4: queries via services/api/*. Regla 13: usa toast/useConfirm, sin
// window.alert/confirm. Tipo X coherente con #150 (siempre arranca simple).

import { useEffect, useState } from 'react';
import {
  FileText,
  Plus,
  Receipt,
  Banknote,
  Loader2,
  ExternalLink,
  Percent,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Button,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import { toast } from '@/lib/toast';
import {
  emitirComprobanteManual,
  getComprobante,
  type ComprobanteRow,
} from '@/services/api/comprobantes';
import {
  listCajasActivas,
  registrarCobranza,
  type CajaRow,
} from '@/services/api/cobranzas';
import { setSolicitudComprobante } from '@/services/api/solicitudes';

interface Props {
  solicitudId: string;
  administracionId: string | null;
  comprobanteId: string | null;
  servicioNombre: string | null;
  receptorNombre: string;
  receptorDocumento?: string | null;
  onComprobanteCreado: (id: string) => void;
}

export function PanelComprobanteCobranza({
  solicitudId,
  administracionId,
  comprobanteId,
  servicioNombre,
  receptorNombre,
  receptorDocumento,
  onComprobanteCreado,
}: Props) {
  const [comp, setComp] = useState<ComprobanteRow | null>(null);
  const [loadingComp, setLoadingComp] = useState(false);
  const [openGen, setOpenGen] = useState(false);
  const [openCobrar, setOpenCobrar] = useState(false);

  useEffect(() => {
    if (!comprobanteId) {
      setComp(null);
      return;
    }
    setLoadingComp(true);
    void getComprobante(comprobanteId).then((r) => {
      setLoadingComp(false);
      if (r.ok) setComp(r.data.comprobante);
    });
  }, [comprobanteId]);

  const saldo = comp ? Number(comp.saldo_pendiente ?? comp.total ?? 0) : 0;
  const total = comp ? Number(comp.total ?? 0) : 0;

  return (
    <section className="card-premium p-5">
      <p className="kicker mb-3 text-brand-cyan">Comprobante · cobranza</p>

      {!comprobanteId && !comp && (
        <div className="space-y-3">
          <p className="text-sm text-brand-muted">
            Generá el comprobante simple del servicio. Podés aplicar una
            bonificación por convenio y registrar el pago en el mismo paso.
          </p>
          <Button
            onClick={() => setOpenGen(true)}
            disabled={!administracionId}
            title={
              !administracionId
                ? 'La solicitud necesita estar vinculada a un cliente para generar comprobante.'
                : undefined
            }
          >
            <Plus size={15} />
            Generar comprobante
          </Button>
          {!administracionId && (
            <p className="text-xs text-amber-700">
              Asociá un cliente desde el wizard de activación para habilitar la
              generación.
            </p>
          )}
        </div>
      )}

      {comprobanteId && loadingComp && (
        <div className="flex items-center gap-2 text-sm text-brand-muted">
          <Loader2 size={14} className="animate-spin" /> Cargando comprobante…
        </div>
      )}

      {comprobanteId && !loadingComp && comp && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div>
              <p className="text-sm font-medium text-brand-ink">
                <FileText size={14} className="-mt-0.5 mr-1 inline text-brand-cyan" />
                Comprobante {comp.tipo} · PV {String(comp.punto_venta).padStart(4, '0')}
                {comp.numero ? ' · Nº ' + String(comp.numero).padStart(8, '0') : ' · sin número'}
              </p>
              <p className="text-xs text-brand-muted">
                Estado {comp.estado} · cobranza {comp.estado_cobranza}
              </p>
            </div>
            <Link
              to={`/gestion/facturacion/comprobantes/${comp.id}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-cyan hover:underline"
            >
              Abrir <ExternalLink size={12} />
            </Link>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="kicker text-brand-muted">Total</dt>
              <dd className="text-brand-ink">{fmtMoney(total)}</dd>
            </div>
            <div>
              <dt className="kicker text-brand-muted">Saldo pendiente</dt>
              <dd className={saldo > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                {fmtMoney(saldo)}
              </dd>
            </div>
          </dl>

          {saldo > 0 && comp.estado !== 'anulado' && (
            <Button onClick={() => setOpenCobrar(true)}>
              <Banknote size={15} />
              Registrar pago
            </Button>
          )}
        </div>
      )}

      {openGen && administracionId && (
        <ModalGenerarComprobante
          solicitudId={solicitudId}
          administracionId={administracionId}
          servicioNombre={servicioNombre}
          receptorNombre={receptorNombre}
          receptorDocumento={receptorDocumento}
          onClose={() => setOpenGen(false)}
          onCreado={(id) => {
            setOpenGen(false);
            onComprobanteCreado(id);
          }}
        />
      )}

      {openCobrar && comp && (
        <ModalRegistrarPago
          comprobanteId={comp.id}
          saldoSugerido={saldo}
          onClose={() => setOpenCobrar(false)}
          onPagado={() => {
            setOpenCobrar(false);
            // Refrescar el comprobante para actualizar saldo/estado_cobranza
            void getComprobante(comp.id).then((r) => r.ok && setComp(r.data.comprobante));
          }}
        />
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------
// Modal generar
// ----------------------------------------------------------------------------
function ModalGenerarComprobante({
  solicitudId,
  administracionId,
  servicioNombre,
  receptorNombre,
  receptorDocumento,
  onClose,
  onCreado,
}: {
  solicitudId: string;
  administracionId: string;
  servicioNombre: string | null;
  receptorNombre: string;
  receptorDocumento?: string | null;
  onClose: () => void;
  onCreado: (id: string) => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const venceDefault = new Date(Date.now() + 15 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [descripcion, setDescripcion] = useState(
    servicioNombre ?? 'Servicio profesional',
  );
  const [precio, setPrecio] = useState<string>('');
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
      consorcio_id: null,
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
          consorcio_id: null,
        },
      ],
      observaciones:
        observ.trim().length > 0
          ? observ.trim()
          : 'Generado desde solicitud ' + solicitudId.slice(0, 8),
      comprobante_referencia_id: null,
    });
    if (!r.ok) {
      setEnviando(false);
      toast.error(r.error.message);
      return;
    }
    const compId = r.data.id;
    // Vincular a la solicitud (best-effort, no bloquea si falla)
    const v = await setSolicitudComprobante(solicitudId, compId);
    setEnviando(false);
    if (!v.ok) {
      toast.warning('Comprobante creado pero no quedó vinculado a la solicitud');
    } else {
      toast.success('Comprobante generado');
    }
    onCreado(compId);
  }

  return (
    <Modal open onClose={onClose} title="Generar comprobante simple">
      <div className="space-y-4">
        <div className="rounded-lg bg-brand-cyan-pale/30 p-3 text-xs text-brand-muted">
          Receptor: <strong className="text-brand-ink">{receptorNombre}</strong>
          {receptorDocumento ? ' · ' + receptorDocumento : ''}
        </div>

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
            <Receipt size={15} />
            Generar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------------------------
// Modal registrar pago
// ----------------------------------------------------------------------------
function ModalRegistrarPago({
  comprobanteId,
  saldoSugerido,
  onClose,
  onPagado,
}: {
  comprobanteId: string;
  saldoSugerido: number;
  onClose: () => void;
  onPagado: () => void;
}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [cajas, setCajas] = useState<CajaRow[]>([]);
  const [cajaId, setCajaId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [monto, setMonto] = useState<string>(saldoSugerido.toFixed(2));
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void listCajasActivas().then((r) => {
      if (r.ok) {
        setCajas(r.data);
        if (r.data[0]?.id) setCajaId(r.data[0].id);
      }
    });
  }, []);

  async function registrar() {
    const m = Number(monto);
    if (!cajaId) {
      toast.error('Elegí una caja');
      return;
    }
    if (!Number.isFinite(m) || m <= 0) {
      toast.error('Ingresá un monto válido');
      return;
    }
    setEnviando(true);
    const r = await registrarCobranza({
      comprobante_id: comprobanteId,
      caja_id: cajaId,
      fecha,
      monto: m,
      descripcion: descripcion.trim() || 'Cobranza desde solicitud',
    });
    setEnviando(false);
    if (!r.ok) {
      toast.error(r.error.message);
      return;
    }
    toast.success('Pago registrado');
    onPagado();
  }

  return (
    <Modal open onClose={onClose} title="Registrar pago">
      <div className="space-y-4">
        <Field label="Caja">
          <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            <option value="">— elegí —</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>
          <Field label="Monto">
            <Input
              type="number"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              min={0}
              step={0.01}
            />
          </Field>
        </div>
        <Field label="Descripción (opcional)">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Detalle del pago…"
          />
        </Field>
        <p className="text-xs text-brand-muted">
          Saldo sugerido: {fmtMoney(saldoSugerido)}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={registrar} loading={enviando}>
            <Banknote size={15} />
            Registrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(n);
}

export default PanelComprobanteCobranza;
