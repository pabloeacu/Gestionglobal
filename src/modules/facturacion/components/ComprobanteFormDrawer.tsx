import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import {
  Receipt,
  Save,
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  GripVertical,
  Sparkles,
} from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Stepper,
  StepPanel,
  AnimatedNumber,
  type Step,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  emitirComprobanteManual,
  peekProximoNumero,
  type AlicuotaIva,
  type ItemDraft,
} from '@/services/api/comprobantes';
import {
  listAdministraciones,
  type AdministracionListItem,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import {
  listServiciosActivos,
  type ServicioListItem,
} from '@/services/api/servicios';

interface ComprobanteFormDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

type StepKey = 'receptor' | 'items' | 'totales' | 'confirmar';

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'receptor', label: 'Receptor' },
  { key: 'items', label: 'Items' },
  { key: 'totales', label: 'Totales' },
  { key: 'confirmar', label: 'Confirmar' },
];

type Tipo = 'X' | 'NC_X' | 'ND_X';
type Concepto = 'servicios' | 'productos' | 'productos_servicios';

interface ItemRow extends ItemDraft {
  id: string; // local key (drag-reorder)
}

function newItem(): ItemRow {
  return {
    id: crypto.randomUUID(),
    descripcion: '',
    cantidad: 1,
    precio_unitario: 0,
    bonificacion_porc: 0,
    alicuota_iva: '21',
    servicio_id: null,
    consorcio_id: null,
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDaysISO(d: number): string {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString().slice(0, 10);
}

export function ComprobanteFormDrawer({
  open,
  onClose,
  onSaved,
}: ComprobanteFormDrawerProps) {
  // -------- form state --------
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [administracionId, setAdministracionId] = useState('');
  const [consorcioId, setConsorcioId] = useState('');
  const [tipo, setTipo] = useState<Tipo>('X');
  const [puntoVenta, setPuntoVenta] = useState(1);
  const [fecha, setFecha] = useState(todayISO());
  const [vencimiento, setVencimiento] = useState(inDaysISO(10));
  const [concepto, setConcepto] = useState<Concepto>('servicios');
  const [observaciones, setObservaciones] = useState('');
  const [items, setItems] = useState<ItemRow[]>([newItem()]);

  // -------- data sources --------
  const [administraciones, setAdministraciones] = useState<AdministracionListItem[]>([]);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [servicios, setServicios] = useState<ServicioListItem[]>([]);
  const [proxNumero, setProxNumero] = useState<number | null>(null);

  // -------- errors --------
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setAdministracionId('');
    setConsorcioId('');
    setTipo('X');
    setPuntoVenta(1);
    setFecha(todayISO());
    setVencimiento(inDaysISO(10));
    setConcepto('servicios');
    setObservaciones('');
    setItems([newItem()]);
    setErrors({});
    void loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadSources() {
    const [admins, servs] = await Promise.all([
      listAdministraciones({ estado: 'activo', limit: 100 }),
      listServiciosActivos(),
    ]);
    if (admins.ok) setAdministraciones(admins.data.rows);
    if (servs.ok) setServicios(servs.data);
  }

  // Cargar consorcios cuando cambia la administración
  useEffect(() => {
    if (!administracionId) {
      setConsorcios([]);
      setConsorcioId('');
      return;
    }
    void (async () => {
      const res = await listConsorciosByAdministracion(administracionId, false);
      if (res.ok) setConsorcios(res.data);
    })();
  }, [administracionId]);

  // Peek del próximo número
  useEffect(() => {
    void (async () => {
      const res = await peekProximoNumero(puntoVenta, tipo);
      if (res.ok) setProxNumero(res.data);
    })();
  }, [puntoVenta, tipo]);

  // -------- totales calculados (preview live) --------
  const totales = useMemo(() => {
    let neto = 0;
    let exento = 0;
    let no_gravado = 0;
    let iva = 0;
    for (const it of items) {
      const sub =
        Number(it.cantidad) *
        Number(it.precio_unitario) *
        (1 - Number(it.bonificacion_porc) / 100);
      const factor =
        it.alicuota_iva === '21'
          ? 0.21
          : it.alicuota_iva === '10.5'
            ? 0.105
            : it.alicuota_iva === '27'
              ? 0.27
              : 0;
      const ivaItem = sub * factor;
      if (it.alicuota_iva === 'exento') exento += sub;
      else if (it.alicuota_iva === 'no_gravado') no_gravado += sub;
      else neto += sub;
      iva += ivaItem;
    }
    const total = neto + exento + no_gravado + iva;
    return {
      neto: round2(neto),
      exento: round2(exento),
      no_gravado: round2(no_gravado),
      iva: round2(iva),
      total: round2(total),
    };
  }, [items]);

  // -------- items helpers --------
  function setItem(i: number, patch: Partial<ItemRow>) {
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((arr) => [...arr, newItem()]);
  }
  function removeItem(i: number) {
    setItems((arr) =>
      arr.length === 1 ? [newItem()] : arr.filter((_, idx) => idx !== i),
    );
  }
  function pickServicio(i: number, servicioId: string) {
    const s = servicios.find((x) => x.id === servicioId);
    if (!s) return;
    setItem(i, {
      servicio_id: s.id,
      descripcion: s.nombre,
      precio_unitario: Number(s.precio_base),
      alicuota_iva: s.iva_alicuota as AlicuotaIva,
    });
  }
  function moveItem(i: number, dir: -1 | 1) {
    setItems((arr) => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const a = next[i];
      const b = next[j];
      if (!a || !b) return arr;
      next[i] = b;
      next[j] = a;
      return next;
    });
  }

  // -------- validation per step --------
  function validateStep(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!administracionId) e['administracion_id'] = 'Elegí una administración';
      if (!fecha) e['fecha'] = 'Fecha requerida';
      if (!vencimiento) e['vencimiento'] = 'Vencimiento requerido';
      if (vencimiento < fecha) e['vencimiento'] = 'Vencimiento no puede ser anterior a la fecha';
      if (puntoVenta <= 0) e['punto_venta'] = 'Punto de venta inválido';
    }
    if (s === 1) {
      items.forEach((it, idx) => {
        if (!it.descripcion.trim()) e[`item_${idx}_descripcion`] = 'Descripción requerida';
        if (Number(it.cantidad) <= 0) e[`item_${idx}_cantidad`] = 'Cantidad > 0';
        if (Number(it.precio_unitario) < 0) e[`item_${idx}_precio`] = 'Precio no negativo';
      });
    }
    return e;
  }

  function next() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error('Revisá los campos marcados antes de avanzar');
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Validar todos los pasos
    const all = { ...validateStep(0), ...validateStep(1) };
    setErrors(all);
    if (Object.keys(all).length > 0) {
      toast.error('Revisá los campos marcados antes de emitir');
      return;
    }
    setSaving(true);
    const res = await emitirComprobanteManual({
      administracion_id: administracionId,
      consorcio_id: consorcioId || null,
      tipo,
      punto_venta: puntoVenta,
      fecha,
      vencimiento,
      concepto,
      items: items.map((it) => ({
        descripcion: it.descripcion.trim(),
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        bonificacion_porc: Number(it.bonificacion_porc),
        alicuota_iva: it.alicuota_iva,
        servicio_id: it.servicio_id,
        consorcio_id: it.consorcio_id ?? consorcioId ?? null,
      })),
      observaciones: observaciones.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos emitir el comprobante', { description: res.error.message });
      return;
    }
    toast.success(`Comprobante #${proxNumero ?? '?'} emitido`);
    onSaved?.(res.data.id);
    onClose();
  }

  const stepsWithStatus: Step[] = STEPS.map((s, i) => ({
    ...s,
    invalid:
      i !== step &&
      Object.keys(errors).some((k) =>
        i === 0
          ? ['administracion_id', 'fecha', 'vencimiento', 'punto_venta'].includes(k)
          : i === 1
            ? k.startsWith('item_')
            : false,
      ),
  }));

  const isLast = step === STEPS.length - 1;
  const stepKey: StepKey = (STEPS[step]?.key ?? 'receptor') as StepKey;
  const selectedAdmin = administraciones.find((a) => a.id === administracionId);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={960}
      kicker="Nuevo comprobante"
      title="Emitir comprobante manual"
      description="Comprobante simple (tipo X) sin ARCA. Para facturas A/B/C, esperá a Phase 2A-3."
      icon={<Receipt size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            Paso {step + 1} de {STEPS.length}
            {proxNumero !== null && (
              <span className="ml-3 inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
                <Sparkles size={11} /> Próx. #{String(proxNumero).padStart(8, '0')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            {step > 0 && (
              <Button variant="secondary" onClick={back} disabled={saving}>
                <ArrowLeft size={14} /> Atrás
              </Button>
            )}
            {!isLast ? (
              <Button onClick={next} disabled={saving}>
                Siguiente <ArrowRight size={14} />
              </Button>
            ) : (
              <Button type="submit" form="comp-form" loading={saving}>
                <Save size={15} /> Emitir
              </Button>
            )}
          </div>
        </div>
      }
    >
      <form id="comp-form" onSubmit={onSubmit} className="relative">
        <TrianglesAccent
          position="top-right"
          size={170}
          tone="cyan"
          density="soft"
          className="opacity-50"
        />
        <TrianglesAccent
          position="bottom-left"
          size={140}
          tone="teal"
          density="soft"
          className="opacity-40"
        />

        <div className="relative">
          <div className="mb-7">
            <Stepper steps={stepsWithStatus} current={step} onJump={setStep} />
          </div>

          {/* ---- PASO 1: Receptor ---- */}
          {stepKey === 'receptor' && (
            <StepPanel
              stepKey="receptor"
              title="A quién facturás"
              subtitle="Elegí administración y opcionalmente un consorcio. El snapshot del receptor se congela en el comprobante."
            >
              <Field
                label="Administración"
                required
                error={errors['administracion_id']}
              >
                <Select
                  value={administracionId}
                  onChange={(e) => {
                    setAdministracionId(e.target.value);
                    setConsorcioId('');
                  }}
                  required
                >
                  <option value="">— Elegí una administración —</option>
                  {administraciones.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre} {a.cuit ? `· ${a.cuit}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>

              {administracionId && (
                <Field
                  label="Consorcio"
                  hint="Vacío = servicio personal del administrador (matrícula RPAC, capacitación, etc.)"
                >
                  <Select
                    value={consorcioId}
                    onChange={(e) => setConsorcioId(e.target.value)}
                  >
                    <option value="">— Sin consorcio (servicio del admin) —</option>
                    {consorcios.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ·{' '}
                        {c.facturar_con_cuit_administracion
                          ? 'factura admin'
                          : c.numero_documento}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Tipo" required>
                  <Select
                    value={tipo}
                    onChange={(e) => setTipo(e.target.value as Tipo)}
                  >
                    <option value="X">X · Comprobante simple</option>
                    <option value="NC_X">NC X · Nota de crédito</option>
                    <option value="ND_X">ND X · Nota de débito</option>
                  </Select>
                </Field>
                <Field label="Punto de venta" required error={errors['punto_venta']}>
                  <Input
                    type="number"
                    min={1}
                    value={puntoVenta}
                    onChange={(e) => setPuntoVenta(Number(e.target.value))}
                    required
                  />
                </Field>
                <Field label="Concepto">
                  <Select
                    value={concepto}
                    onChange={(e) => setConcepto(e.target.value as Concepto)}
                  >
                    <option value="servicios">Servicios</option>
                    <option value="productos">Productos</option>
                    <option value="productos_servicios">Productos y servicios</option>
                  </Select>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Fecha" required error={errors['fecha']}>
                  <Input
                    type="date"
                    value={fecha}
                    onChange={(e) => setFecha(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Vencimiento" required error={errors['vencimiento']}>
                  <Input
                    type="date"
                    value={vencimiento}
                    onChange={(e) => setVencimiento(e.target.value)}
                    required
                  />
                </Field>
              </div>

              {selectedAdmin && (
                <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-4 text-xs">
                  <p className="kicker text-brand-cyan">Snapshot del receptor</p>
                  <p className="mt-1 text-brand-ink">
                    <span className="font-medium">{selectedAdmin.nombre}</span>
                  </p>
                  <p className="text-brand-muted">
                    {selectedAdmin.cuit
                      ? `CUIT ${selectedAdmin.cuit}`
                      : 'Sin CUIT — se facturará como consumidor final'}
                    {selectedAdmin.condicion_iva &&
                      ` · ${selectedAdmin.condicion_iva.replaceAll('_', ' ')}`}
                  </p>
                </div>
              )}
            </StepPanel>
          )}

          {/* ---- PASO 2: Items ---- */}
          {stepKey === 'items' && (
            <StepPanel
              stepKey="items"
              title="Detalle del comprobante"
              subtitle="Cargá las líneas. Podés autocompletar desde el catálogo de servicios o escribir libre."
            >
              <div className="space-y-3">
                {items.map((it, idx) => (
                  <div
                    key={it.id}
                    className="relative rounded-xl border border-slate-200 bg-white p-3 motion-safe:animate-fade-up"
                    style={{ animationDelay: `${Math.min(idx, 6) * 30}ms` }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col items-center gap-0.5 pt-1">
                        <button
                          type="button"
                          onClick={() => moveItem(idx, -1)}
                          disabled={idx === 0}
                          className="rounded p-0.5 text-brand-muted hover:bg-slate-100 disabled:opacity-30"
                          aria-label="Subir"
                        >
                          <GripVertical size={14} />
                        </button>
                        <span className="text-[10px] font-mono text-brand-muted">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="grid flex-1 gap-3 sm:grid-cols-12">
                        <Field
                          label="Servicio del catálogo"
                          className="sm:col-span-4"
                        >
                          <Select
                            value={it.servicio_id ?? ''}
                            onChange={(e) =>
                              e.target.value
                                ? pickServicio(idx, e.target.value)
                                : setItem(idx, { servicio_id: null })
                            }
                          >
                            <option value="">— Libre —</option>
                            {servicios.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.categoria_nombre} · {s.nombre}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field
                          label="Descripción"
                          required
                          className="sm:col-span-8"
                          error={errors[`item_${idx}_descripcion`]}
                        >
                          <Input
                            value={it.descripcion}
                            onChange={(e) =>
                              setItem(idx, { descripcion: e.target.value })
                            }
                            placeholder="Ej: Renovación matrícula RPAC"
                            required
                          />
                        </Field>
                        <Field label="Cantidad" className="sm:col-span-2">
                          <Input
                            type="number"
                            step="0.01"
                            min={0.01}
                            value={it.cantidad}
                            onChange={(e) =>
                              setItem(idx, { cantidad: Number(e.target.value) })
                            }
                          />
                        </Field>
                        <Field
                          label="Precio unitario"
                          className="sm:col-span-3"
                          error={errors[`item_${idx}_precio`]}
                        >
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={it.precio_unitario}
                            onChange={(e) =>
                              setItem(idx, {
                                precio_unitario: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Bonif. %" className="sm:col-span-2">
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            max={100}
                            value={it.bonificacion_porc}
                            onChange={(e) =>
                              setItem(idx, {
                                bonificacion_porc: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="IVA" className="sm:col-span-2">
                          <Select
                            value={it.alicuota_iva}
                            onChange={(e) =>
                              setItem(idx, {
                                alicuota_iva: e.target.value as AlicuotaIva,
                              })
                            }
                          >
                            <option value="21">21%</option>
                            <option value="10.5">10.5%</option>
                            <option value="27">27%</option>
                            <option value="0">0%</option>
                            <option value="exento">Exento</option>
                            <option value="no_gravado">No gravado</option>
                          </Select>
                        </Field>
                        <div className="sm:col-span-3 flex items-end justify-end text-right text-xs text-brand-muted">
                          <span className="tabular">
                            Subtotal{' '}
                            <span className="font-semibold text-brand-ink">
                              {formatMoney(
                                Number(it.cantidad) *
                                  Number(it.precio_unitario) *
                                  (1 - Number(it.bonificacion_porc) / 100),
                              )}
                            </span>
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="rounded-md p-1.5 text-brand-muted hover:bg-red-50 hover:text-red-600"
                        aria-label="Eliminar línea"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" onClick={addItem} type="button">
                  <Plus size={14} /> Agregar línea
                </Button>
              </div>
            </StepPanel>
          )}

          {/* ---- PASO 3: Totales ---- */}
          {stepKey === 'totales' && (
            <StepPanel
              stepKey="totales"
              title="Resumen de totales"
              subtitle="Estos totales los recalcula el backend al emitir; acá es preview live."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <TotalRow label="Neto gravado" value={totales.neto} />
                <TotalRow label="Exento" value={totales.exento} dim />
                <TotalRow label="No gravado" value={totales.no_gravado} dim />
                <TotalRow label="IVA" value={totales.iva} />
                <div className="sm:col-span-2 rounded-2xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan-pale/30 to-brand-teal/10 p-5">
                  <p className="kicker text-brand-cyan">Total</p>
                  <p className="mt-1 font-display text-3xl font-bold tabular text-brand-ink">
                    $<AnimatedNumber value={Math.round(totales.total)} />
                  </p>
                  <p className="mt-1 text-xs text-brand-muted">
                    {items.length} {items.length === 1 ? 'línea' : 'líneas'} ·{' '}
                    Saldo pendiente inicial: {formatMoney(totales.total)}
                  </p>
                </div>
              </div>
              <Field label="Observaciones" hint="Quedan en la ficha del comprobante (no aparecen en el PDF público)">
                <Textarea
                  rows={3}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Notas internas, condición especial, etc."
                />
              </Field>
            </StepPanel>
          )}

          {/* ---- PASO 4: Confirmar ---- */}
          {stepKey === 'confirmar' && (
            <StepPanel
              stepKey="confirmar"
              title="Confirmar emisión"
              subtitle="Una vez emitido, el comprobante queda autorizado y consume un número del talonario."
            >
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="kicker text-brand-cyan">Cabecera</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <KV k="Administración" v={selectedAdmin?.nombre ?? '—'} />
                    <KV
                      k="Consorcio"
                      v={
                        consorcios.find((c) => c.id === consorcioId)?.nombre ??
                        '(servicio del admin)'
                      }
                    />
                    <KV k="Tipo" v={tipo} />
                    <KV
                      k="Numeración"
                      v={`PV ${String(puntoVenta).padStart(5, '0')} · #${
                        proxNumero
                          ? String(proxNumero).padStart(8, '0')
                          : '(prox.)'
                      }`}
                    />
                    <KV k="Fecha" v={fecha} />
                    <KV k="Vencimiento" v={vencimiento} />
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="kicker text-brand-cyan">Detalle</p>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {items.map((it, idx) => (
                      <li
                        key={it.id}
                        className="flex items-baseline justify-between py-1.5"
                      >
                        <span className="truncate text-brand-ink">
                          {idx + 1}. {it.descripcion || '(sin descripción)'}
                        </span>
                        <span className="tabular text-brand-muted">
                          {Number(it.cantidad)} ×{' '}
                          {formatMoney(Number(it.precio_unitario))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center justify-between rounded-xl border-2 border-brand-cyan/40 bg-gradient-to-br from-brand-cyan-pale/40 to-brand-teal/10 p-4">
                  <p className="font-display font-bold uppercase tracking-wider text-brand-ink">
                    Total a emitir
                  </p>
                  <p className="font-display text-2xl font-bold tabular text-brand-cyan">
                    {formatMoney(totales.total)}
                  </p>
                </div>
              </div>
            </StepPanel>
          )}
        </div>
      </form>
    </Drawer>
  );
}

function TotalRow({
  label,
  value,
  dim,
}: {
  label: string;
  value: number;
  dim?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm ${
        dim ? 'opacity-60' : ''
      }`}
    >
      <span className="text-brand-muted">{label}</span>
      <span className="tabular font-semibold text-brand-ink">
        {formatMoney(value)}
      </span>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="kicker text-brand-muted">{k}</p>
      <p className="text-sm text-brand-ink">{v}</p>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
