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
  listCategoriasIngreso,
  registrarCobranza,
  cobroInicial,
  validarCobroEnEmision,
  registrarCobranzaEnEmision,
  type CajaRow,
  type CategoriaFinanzaRow,
  type CobroAhoraState,
} from '@/services/api/cobranzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { CobrarAhoraSection } from '@/modules/facturacion/components/CobrarAhoraSection';
import { setSolicitudComprobante } from '@/services/api/solicitudes';
import { humanizeError } from '@/lib/errors';

interface Props {
  solicitudId: string;
  administracionId: string | null;
  comprobanteId: string | null;
  servicioNombre: string | null;
  // #161/obs 2: precio referencial del servicio para pre-fill el comprobante.
  // Es solo orientativo — el operador puede editarlo + aplicar bonificación.
  servicioPrecioBase?: number | null;
  receptorNombre: string;
  receptorDocumento?: string | null;
  onComprobanteCreado: (id: string) => void;
}

export function PanelComprobanteCobranza({
  solicitudId,
  administracionId,
  comprobanteId,
  servicioNombre,
  servicioPrecioBase,
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
          servicioPrecioBase={servicioPrecioBase ?? null}
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
  servicioPrecioBase,
  receptorNombre,
  receptorDocumento,
  onClose,
  onCreado,
}: {
  solicitudId: string;
  administracionId: string;
  servicioNombre: string | null;
  servicioPrecioBase: number | null;
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
  // #161/obs 2: pre-fill precio desde el precio_base del servicio. Es
  // referencial — el operador puede editarlo y aplicar bonificación.
  const [precio, setPrecio] = useState<string>(
    servicioPrecioBase && servicioPrecioBase > 0
      ? String(servicioPrecioBase)
      : '',
  );
  const [bonif, setBonif] = useState<string>('0');
  const [fecha, setFecha] = useState(hoy);
  const [vencimiento, setVencimiento] = useState(venceDefault);
  const [observ, setObserv] = useState('');
  const [cobro, setCobro] = useState<CobroAhoraState>(cobroInicial());
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
    const cobroErr = validarCobroEnEmision(cobro, total);
    if (cobroErr) {
      toast.error(cobroErr);
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
      toast.error(humanizeError(r.error));
      return;
    }
    const compId = r.data.id;
    // Cobranza en el mismo acto (si el operador eligió Total/Parcial).
    let cobroWarn = '';
    const cr = await registrarCobranzaEnEmision(compId, cobro);
    if (!cr.ok) {
      cobroWarn =
        ' La cobranza no se registró (' +
        humanizeError(cr.error) +
        '); registrala desde el detalle del comprobante.';
    }
    // Vincular a la solicitud (best-effort, no bloquea si falla)
    const v = await setSolicitudComprobante(solicitudId, compId);
    setEnviando(false);
    if (!v.ok) {
      toast.warning('Comprobante creado pero no quedó vinculado a la solicitud.' + cobroWarn);
    } else if (cobroWarn) {
      toast.warning('Comprobante generado.' + cobroWarn);
    } else {
      toast.success(
        cobro.modo === 'sin_cobro'
          ? 'Comprobante generado'
          : 'Comprobante generado y cobranza registrada',
      );
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

        <CobrarAhoraSection total={total} value={cobro} onChange={setCobro} />

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
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [partnerId, setPartnerId] = useState('');
  // DGG-39 (2026-06-02 · José Luis): emparejar con el wizard de CC que ya
  // tenía Referencia + Categoría. Acá quedaban afuera y el dueño marcó la
  // asimetría entre ambas vías de cobranza.
  const [referencia, setReferencia] = useState('');
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [categoriaId, setCategoriaId] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void listCajasActivas().then((r) => {
      if (r.ok) {
        setCajas(r.data);
        // JL-CAJA #3 (mig 0174) · pre-seleccionar caja favorita
        const favorita = r.data.find(
          (c) => (c as unknown as { es_default?: boolean }).es_default === true,
        );
        if (favorita) setCajaId(favorita.id);
        else if (r.data[0]?.id) setCajaId(r.data[0].id);
      }
    });
    void listPartnersActivos().then((r) => r.ok && setPartners(r.data));
    void listCategoriasIngreso().then((r) => {
      if (r.ok) {
        setCategorias(r.data);
        const cob = r.data.find((c) => /cobranza|honorario|servicio/i.test(c.nombre));
        if (cob) setCategoriaId(cob.id);
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
      referencia: referencia.trim() || undefined,         // DGG-39 (JL)
      categoria_id: categoriaId || null,                  // DGG-39 (JL)
      partner_id_atribucion: partnerId || null,
    });
    setEnviando(false);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
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
        {/* DGG-39: categoría opcional (caja financiera) — emparejado con wizard CC */}
        {categorias.length > 0 && (
          <Field label="Categoría" hint="Opcional. Útil para agrupar en reportes financieros.">
            <Select
              value={categoriaId}
              onChange={(e) => setCategoriaId(e.target.value)}
            >
              <option value="">— Sin categoría —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">
            <Input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </Field>
          <Field label="Monto">
            <div className="flex gap-2">
              <Input
                type="number"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                min={0}
                step={0.01}
                className="flex-1"
              />
              {/* DGG-39: botón "Cobrar todo" — emparejado con wizard CC */}
              <button
                type="button"
                onClick={() => setMonto(saldoSugerido.toFixed(2))}
                className="shrink-0 rounded-lg border border-brand-cyan/40 bg-brand-cyan-pale/30 px-2 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
                title={`Cobrar todo: ${fmtMoney(saldoSugerido)}`}
              >
                Total
              </button>
            </div>
          </Field>
        </div>
        {/* DGG-39: referencia — emparejado con wizard CC */}
        <Field label="Referencia" hint="Ej: nº de transferencia, ID de Mercado Pago, cheque…">
          <Input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Sin referencia"
          />
        </Field>
        <Field label="Descripción (opcional)">
          <Input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Detalle del pago…"
          />
        </Field>
        {partners.length > 0 && (
          <Field
            label="Participa partner"
            hint="Si lo marcás, este pago entra en la rendición del partner."
          >
            <Select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
            >
              <option value="">— No participa —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}
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
