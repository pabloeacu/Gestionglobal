import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileSpreadsheet,
  Building,
  Receipt,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Users,
  Landmark,
} from 'lucide-react';
import { Drawer, Button, Field, Input, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import { resolverPrecio } from '@/services/api/servicios';
import {
  emitirComprobantesDdjj,
  type DdjjLineaEmision,
  type DdjjEmisionResult,
} from '@/services/api/ddjjCierre';
import { ConsorciosImportDrawer } from '@/modules/clientes/components/ConsorciosImportDrawer';

function formatMoney(n: number): string {
  return '$' + (n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Parser money locale-aware (AR): '.' miles, ',' decimal. Evita que "35.000" → 35
// o "1.234,56" → NaN (bug C-1 de la auditoría). Devuelve NaN si no es un número.
function parseMoneyInput(s: string): number {
  let t = String(s).trim().replace(/[^\d.,-]/g, '');
  const hasComma = t.includes(',');
  const hasDot = t.includes('.');
  if (hasComma && hasDot) {
    t = t.replace(/\./g, '').replace(',', '.'); // '.' miles, ',' decimal
  } else if (hasComma) {
    t = t.replace(',', '.');
  } else if (hasDot) {
    const parts = t.split('.');
    const last = parts[parts.length - 1] ?? '';
    // un solo punto con ≤2 decimales → decimal; si no, puntos de miles.
    if (!(parts.length === 2 && last.length > 0 && last.length <= 2)) {
      t = t.replace(/\./g, '');
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

interface Props {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  administracionId: string;
  servicioId: string | null;
  servicioNombre?: string | null;
  onGenerado?: () => void;
}

type Paso = 'modo' | 'grilla' | 'unico' | 'done';

const ALICUOTAS = ['exento', '21', '10.5', '27', 'no_gravado'] as const;

// Fila de la grilla: datos presumidos del consorcio (read-only) + línea del comprobante.
// La condición IVA se muestra (presumida) pero NO se edita acá — es dato maestro del
// consorcio (se edita en su ficha); editarla inline mutaría el maestro para siempre,
// no tendría efecto si factura con CUIT del admin, y dejaría drift si la emisión falla
// (hallazgos B5/C-3/C-4 de la auditoría §6). Editable acá: precio y alícuota (línea).
interface GridRow {
  consorcioId: string;
  nombre: string;
  documento: string;
  tipoDocumento: string;
  condicionIva: string; // presumida, read-only
  precio: string;       // editable
  alicuota: string;     // editable
  incluir: boolean;
}

export function WizardCierreDdjj({
  open,
  onClose,
  tramiteId,
  administracionId,
  servicioId,
  servicioNombre,
  onGenerado,
}: Props) {
  const [paso, setPaso] = useState<Paso>('modo');
  const [loading, setLoading] = useState(false);
  const [emitiendo, setEmitiendo] = useState(false);
  const [rows, setRows] = useState<GridRow[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [result, setResult] = useState<DdjjEmisionResult | null>(null);

  // Modo único
  const [unicoDesc, setUnicoDesc] = useState('Declaración jurada anual (RPAC)');
  const [unicoPrecio, setUnicoPrecio] = useState('');
  const [unicoAlic, setUnicoAlic] = useState('exento');

  function reset() {
    setPaso('modo');
    setRows([]);
    setResult(null);
    setUnicoPrecio('');
    setLoading(false);
    setEmitiendo(false);
  }

  function handleClose() {
    // D3/C-5: si ya se emitió, refrescar la ficha aunque cierre con "Cerrar"/X
    // (evita que el chip "comprobante pendiente" quede viejo y se re-emita).
    if (result) onGenerado?.();
    reset();
    onClose();
  }

  function reportarEmision(d: DdjjEmisionResult) {
    if (d.emitidos === 0) {
      toast.error('No se emitió ningún comprobante', { description: `${d.errores} fila(s) con error` });
      return;
    }
    const extra = d.errores > 0 ? ` · ${d.errores} con error` : '';
    toast.success(`Emitidos ${d.emitidos} comprobante(s) · ${formatMoney(d.monto_total)}${extra}`);
  }

  // merge=true (al importar rendición): preserva las ediciones de precio/alícuota/incluir
  // de las filas ya presentes (C-8), sumando los consorcios nuevos con defaults.
  const cargarConsorcios = useCallback(
    async (merge = false) => {
      setLoading(true);
      const [resC, resP] = await Promise.all([
        listConsorciosByAdministracion(administracionId, false),
        servicioId
          ? resolverPrecio(servicioId, { administracionId })
          : Promise.resolve({ ok: false as const, error: { code: 'NO_SERV', message: '' } }),
      ]);
      const base = resP.ok ? resP.data.precio_total : 0;
      if (resC.ok) {
        setRows((prev) => {
          const prevById = new Map(prev.map((r) => [r.consorcioId, r]));
          return resC.data.map((c: ConsorcioRow): GridRow => {
            const ex = merge ? prevById.get(c.id) : undefined;
            return {
              consorcioId: c.id,
              nombre: c.nombre,
              documento: c.numero_documento,
              tipoDocumento: c.tipo_documento,
              condicionIva: c.condicion_iva,
              precio: ex ? ex.precio : String(base || 0),
              alicuota: ex ? ex.alicuota : 'exento',
              incluir: ex ? ex.incluir : true,
            };
          });
        });
      }
      setLoading(false);
    },
    [administracionId, servicioId],
  );

  // Al elegir por-consorcio entro a la grilla y cargo.
  async function irAGrilla() {
    setPaso('grilla');
    await cargarConsorcios();
  }

  function irAUnico() {
    setPaso('unico');
    if (servicioId && !unicoPrecio) {
      void resolverPrecio(servicioId, { administracionId }).then((r) => {
        if (r.ok) setUnicoPrecio(String(r.data.precio_total || 0));
      });
    }
  }

  function setRow(idx: number, patch: Partial<GridRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const incluidas = rows.filter((r) => r.incluir);
  const totalGrilla = useMemo(
    () => incluidas.reduce((acc, r) => acc + (parseMoneyInput(r.precio) || 0), 0),
    [incluidas],
  );

  async function emitirGrilla() {
    if (incluidas.length === 0) {
      toast.error('Elegí al menos un consorcio para facturar');
      return;
    }
    // B2/C-2: precio > 0 por cada fila incluida (el server también lo valida por fila).
    const invalida = incluidas.find((r) => !(parseMoneyInput(r.precio) > 0));
    if (invalida) {
      toast.error(`Revisá el precio de ${invalida.nombre} (debe ser mayor a 0)`);
      return;
    }
    setEmitiendo(true);
    const lineas: DdjjLineaEmision[] = incluidas.map((r) => ({
      consorcio_id: r.consorcioId,
      tipo: 'simple',
      precio: parseMoneyInput(r.precio),
      alicuota_iva: r.alicuota,
      descripcion: `Declaración jurada anual (RPAC) · ${r.nombre}`,
    }));
    const res = await emitirComprobantesDdjj(tramiteId, 'por_consorcio', lineas);
    setEmitiendo(false);
    if (!res.ok) {
      toast.error('No se pudo emitir', { description: humanizeError(res.error) });
      return;
    }
    setResult(res.data);
    setPaso('done');
    reportarEmision(res.data);
  }

  async function emitirUnico() {
    const precio = parseMoneyInput(unicoPrecio);
    if (!(precio > 0)) {
      toast.error('Ingresá un monto mayor a 0');
      return;
    }
    setEmitiendo(true);
    const res = await emitirComprobantesDdjj(tramiteId, 'unico', [
      { tipo: 'simple', precio, alicuota_iva: unicoAlic, descripcion: unicoDesc.trim() || undefined },
    ]);
    setEmitiendo(false);
    if (!res.ok) {
      toast.error('No se pudo emitir', { description: humanizeError(res.error) });
      return;
    }
    setResult(res.data);
    setPaso('done');
    reportarEmision(res.data);
  }

  useEffect(() => {
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={980}
      kicker="Declaración jurada"
      title="Facturar la presentación"
      description={servicioNombre ? `${servicioNombre} · emitir los comprobantes del trámite` : 'Emitir los comprobantes del trámite'}
      icon={<Receipt size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            {paso === 'grilla' && `${incluidas.length} consorcios · ${formatMoney(totalGrilla)}`}
          </div>
          <div className="flex items-center gap-2">
            {paso === 'grilla' && (
              <>
                <Button variant="secondary" onClick={() => setPaso('modo')} disabled={emitiendo}>
                  <ArrowLeft size={14} /> Atrás
                </Button>
                <Button onClick={() => void emitirGrilla()} loading={emitiendo} disabled={incluidas.length === 0}>
                  Emitir {incluidas.length} <ArrowRight size={14} />
                </Button>
              </>
            )}
            {paso === 'unico' && (
              <>
                <Button variant="secondary" onClick={() => setPaso('modo')} disabled={emitiendo}>
                  <ArrowLeft size={14} /> Atrás
                </Button>
                <Button onClick={() => void emitirUnico()} loading={emitiendo}>
                  Emitir comprobante <ArrowRight size={14} />
                </Button>
              </>
            )}
            {(paso === 'modo' || paso === 'done') && (
              <Button variant="secondary" onClick={handleClose}>
                {paso === 'done' ? 'Cerrar' : 'Cancelar'}
              </Button>
            )}
            {paso === 'done' && (
              <Button
                onClick={() => {
                  onGenerado?.();
                  handleClose();
                }}
              >
                <CheckCircle2 size={14} /> Listo
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* ── Paso: elegir modo ── */}
      {paso === 'modo' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void irAGrilla()}
            className="group flex flex-col items-start gap-2 rounded-2xl border-2 border-brand-cyan-pale/70 bg-gradient-to-br from-brand-cyan-pale/20 to-white p-5 text-left transition hover:border-brand-cyan"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-cyan-pale/50 text-brand-cyan">
              <Users size={20} />
            </span>
            <h3 className="font-display text-lg font-bold text-brand-ink">Uno por consorcio</h3>
            <p className="text-sm text-brand-muted">
              Un comprobante por cada consorcio declarado (destinatario = consorcio, deuda del
              administrador). Grilla editable con los datos de la rendición.
            </p>
          </button>
          <button
            type="button"
            onClick={irAUnico}
            className="group flex flex-col items-start gap-2 rounded-2xl border-2 border-slate-200 bg-white p-5 text-left transition hover:border-brand-ink/40"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-brand-ink">
              <Landmark size={20} />
            </span>
            <h3 className="font-display text-lg font-bold text-brand-ink">Único a la administración</h3>
            <p className="text-sm text-brand-muted">
              Un solo comprobante a nombre de la administración por el total de la presentación.
            </p>
          </button>
        </div>
      )}

      {/* ── Paso: grilla por consorcio ── */}
      {paso === 'grilla' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-brand-muted">
              Datos presumidos de la rendición — revisá y ajustá cada fila antes de emitir.
            </p>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={15} /> Importar rendición
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-brand-muted">
              <Loader2 size={16} className="animate-spin" /> Cargando consorcios…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 py-10 text-center">
              <Building size={22} className="text-brand-muted" />
              <p className="max-w-sm text-sm text-brand-muted">
                Este cliente todavía no tiene consorcios cargados. Importá el Excel de rendición
                (nombre, domicilio y CUIT por consorcio) para armar la grilla.
              </p>
              <Button onClick={() => setImportOpen(true)}>
                <FileSpreadsheet size={15} /> Importar rendición
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-brand-zebra/60 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">Consorcio</th>
                    <th className="px-3 py-2">Documento</th>
                    <th className="px-3 py-2">Cond. IVA</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2">Alícuota</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.consorcioId}
                      className={`border-t border-slate-100 ${r.incluir ? '' : 'opacity-45'}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={r.incluir}
                          onChange={(e) => setRow(idx, { incluir: e.target.checked })}
                          className="accent-brand-cyan"
                          aria-label={`Incluir ${r.nombre}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-brand-ink">{r.nombre}</td>
                      <td className="px-3 py-2 tabular text-xs text-brand-muted">
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] uppercase">
                          {r.tipoDocumento === 'cuit' ? 'CUIT' : 'DNI'}
                        </span>{' '}
                        {r.documento}
                      </td>
                      <td className="px-3 py-2 text-xs text-brand-muted">
                        {r.condicionIva === 'responsable_inscripto' ? 'Resp. inscripto' : 'Consumidor final'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          inputMode="decimal"
                          value={r.precio}
                          onChange={(e) => setRow(idx, { precio: e.target.value })}
                          disabled={!r.incluir}
                          className="w-28 text-right tabular"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={r.alicuota}
                          onChange={(e) => setRow(idx, { alicuota: e.target.value })}
                          disabled={!r.incluir}
                        >
                          {ALICUOTAS.map((a) => (
                            <option key={a} value={a}>
                              {a === 'exento' ? 'Exento' : a === 'no_gravado' ? 'No gravado' : `${a}%`}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-brand-cyan-pale/50 bg-brand-cyan-pale/10 p-3 text-xs leading-relaxed text-brand-ink/80">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-brand-cyan" />
            <span>
              Los comprobantes salen <strong>simples</strong> (sin ARCA). El comprobante fiscal por
              línea se habilita cuando se active ARCA. El precio pre-cargado es el del tabulador del
              servicio; editalo si corresponde.
            </span>
          </div>
        </div>
      )}

      {/* ── Paso: único ── */}
      {paso === 'unico' && (
        <div className="max-w-lg space-y-4">
          <Field label="Descripción">
            <Input value={unicoDesc} onChange={(e) => setUnicoDesc(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monto (neto)">
              <Input
                inputMode="decimal"
                value={unicoPrecio}
                onChange={(e) => setUnicoPrecio(e.target.value)}
                placeholder="0"
              />
            </Field>
            <Field label="Alícuota IVA">
              <Select value={unicoAlic} onChange={(e) => setUnicoAlic(e.target.value)}>
                {ALICUOTAS.map((a) => (
                  <option key={a} value={a}>
                    {a === 'exento' ? 'Exento' : a === 'no_gravado' ? 'No gravado' : `${a}%`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-xs text-brand-muted">
            Un comprobante simple a nombre de la administración. La deuda queda en su cuenta
            corriente; el trámite se cierra cuando esté cobrado.
          </p>
        </div>
      )}

      {/* ── Paso: resultado ── */}
      {paso === 'done' && result && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Emitidos</div>
              <div className="mt-1 font-display text-2xl font-bold tabular-nums text-emerald-700">
                {result.emitidos}
              </div>
            </div>
            <div className="rounded-xl border border-brand-cyan-pale/60 bg-brand-cyan-pale/20 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-cyan">Total</div>
              <div className="mt-1 font-display text-2xl font-bold tabular-nums text-brand-cyan">
                {formatMoney(result.monto_total)}
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                result.errores > 0 ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div
                className={`text-[11px] font-semibold uppercase tracking-wider ${
                  result.errores > 0 ? 'text-amber-700' : 'text-slate-500'
                }`}
              >
                Errores
              </div>
              <div
                className={`mt-1 font-display text-2xl font-bold tabular-nums ${
                  result.errores > 0 ? 'text-amber-700' : 'text-slate-500'
                }`}
              >
                {result.errores}
              </div>
            </div>
          </div>
          {result.detalle.some((d) => d.resultado === 'error') && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">Filas con error</p>
              <ul className="space-y-1 text-xs text-amber-800">
                {result.detalle
                  .filter((d) => d.resultado === 'error')
                  .slice(0, 30)
                  .map((d) => (
                    <li key={d.fila}>
                      <span className="font-mono">#{d.fila}</span> — {d.motivo}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <p className="text-sm text-brand-muted">
            Los comprobantes quedaron en la cuenta corriente del administrador. El trámite se cierra
            cuando estén cobrados (el cierre queda bloqueado mientras haya saldo pendiente).
          </p>
        </div>
      )}

      <ConsorciosImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        administracionId={administracionId}
        onImported={() => void cargarConsorcios(true)}
      />
    </Drawer>
  );
}
