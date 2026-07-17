// JL-W8-3 · Identificar un movimiento bancario pendiente (migs 0360/0363).
// Dos caminos (decisión Pablo 2026-07-17):
//  · ES DE UN CLIENTE: se asigna la administración y, opcionalmente, se aplica
//    un monto a un comprobante con saldo. El resto queda como saldo a favor.
//  · NO ES DE UN CLIENTE (reintegro bancario, ajuste, etc.): se documenta con
//    categoría y/o descripción y queda como ingreso operativo de la casa —
//    no toca la cuenta corriente de nadie.
// En ningún caso se re-impacta la caja (el ingreso ya sumó al alta).
// Regla 4: queries via services/api. Regla 13: toast/confirm, sin window.*.

import { useEffect, useMemo, useState } from 'react';
import { Landmark, UserCheck } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  buscarAdministraciones,
  identificarMovimiento,
  listCategoriasFinanzas,
  type CategoriaFinanzaRow,
  type MovimientoListadoRow,
} from '@/services/api/finanzas';
import { listComprobantesConSaldo, type ComprobanteConSaldo } from '@/services/api/cobranzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export function IdentificarMovimientoModal({
  movimiento,
  onClose,
  onIdentificado,
}: {
  movimiento: MovimientoListadoRow;
  onClose: () => void;
  onIdentificado: () => void;
}) {
  // modo 'cliente' (default) | 'casa'
  const [modo, setModo] = useState<'cliente' | 'casa'>('cliente');
  const [adminSearch, setAdminSearch] = useState('');
  const [admins, setAdmins] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminNombre, setAdminNombre] = useState<string>('');
  const [comprobantes, setComprobantes] = useState<ComprobanteConSaldo[]>([]);
  const [compId, setCompId] = useState<string>('');
  const [montoImputar, setMontoImputar] = useState<string>('');
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  // modo casa
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [descripcionCasa, setDescripcionCasa] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void listPartnersActivos().then((p) => { if (p.ok) setPartners(p.data); });
    void listCategoriasFinanzas().then((c) => {
      if (c.ok) setCategorias(c.data.filter((x) => x.tipo === 'ingreso' || x.tipo === 'ambos'));
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (adminSearch.trim().length < 2 || adminId) { setAdmins([]); return; }
      const r = await buscarAdministraciones(adminSearch);
      if (r.ok) setAdmins(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [adminSearch, adminId]);

  // Al elegir cliente, traer sus comprobantes con saldo para la aplicación opcional.
  useEffect(() => {
    setCompId('');
    setComprobantes([]);
    setMontoImputar('');
    if (!adminId) return;
    void listComprobantesConSaldo(adminId).then((r) => {
      if (r.ok) setComprobantes(r.data);
    });
  }, [adminId]);

  const comp = useMemo(
    () => comprobantes.find((c) => c.id === compId) ?? null,
    [comprobantes, compId],
  );
  // §6 E-GG-142: el monto se resetea al cambiar de comprobante (evita stale)
  useEffect(() => {
    setMontoImputar('');
  }, [compId]);

  // §6 E-GG-142: normalizar coma decimal; un valor tipeado inválido se RECHAZA —
  // jamás cae en silencio a "aplicar el máximo".
  const montoNum = Number(montoImputar.trim().replace(',', '.'));
  const montoTipeado = montoImputar.trim().length > 0;
  const montoInvalido = montoTipeado && (!Number.isFinite(montoNum) || montoNum <= 0);
  const maxAplicable = comp
    ? Math.min(movimiento.monto, Number(comp.saldo_pendiente))
    : 0;
  const aplicar = comp
    ? montoTipeado && !montoInvalido
      ? Math.min(montoNum, maxAplicable)
      : maxAplicable
    : 0;
  const residual = Math.round((movimiento.monto - aplicar) * 100) / 100;

  const casaValida = categoriaId !== '' || descripcionCasa.trim().length > 0;
  const puedeEnviar = modo === 'cliente' ? !!adminId : casaValida;

  async function onSubmit() {
    if (modo === 'cliente') {
      if (!adminId) { toast.error('Elegí el cliente al que pertenece el ingreso'); return; }
      if (comp && montoInvalido) {
        toast.error('El monto a aplicar no es válido — ingresá un número mayor a 0 o dejalo vacío para aplicar el máximo.');
        return;
      }
      if (comp && montoTipeado && montoNum > Number(comp.saldo_pendiente) + 0.001) {
        toast.error('El monto a aplicar supera el saldo del comprobante');
        return;
      }
      if (comp && montoTipeado && montoNum > movimiento.monto + 0.001) {
        toast.error('El monto a aplicar supera el importe del movimiento');
        return;
      }
    } else if (!casaValida) {
      toast.error('Indicá la categoría o describí qué es este ingreso');
      return;
    }
    setEnviando(true);
    const r = await identificarMovimiento(
      modo === 'cliente'
        ? {
            movimientoId: movimiento.id,
            administracionId: adminId,
            comprobanteId: compId || null,
            montoImputar: comp && montoTipeado ? montoNum : null,
            partnerIdAtribucion: partnerId || null,
          }
        : {
            movimientoId: movimiento.id,
            categoriaId: categoriaId || null,
            descripcion: descripcionCasa.trim() || null,
          },
    );
    setEnviando(false);
    if (!r.ok) {
      toast.error('No pudimos identificar el movimiento', { description: humanizeError(r.error) });
      return;
    }
    toast.success(
      r.data.modo === 'casa'
        ? 'Movimiento identificado como ingreso propio (sin cliente)'
        : `Movimiento identificado como ${adminNombre}` +
            (r.data.imputado > 0 ? ` · ${fmtMoney(r.data.imputado)} aplicados` : '') +
            (r.data.saldo_a_favor_restante > 0
              ? ` · ${fmtMoney(r.data.saldo_a_favor_restante)} quedan como saldo a favor`
              : ''),
    );
    onIdentificado();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Identificar movimiento"
      kicker="Ingreso bancario sin identificar"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button onClick={() => void onSubmit()} loading={enviando} disabled={!puedeEnviar}>
            <UserCheck size={15} /> Identificar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
          <p className="text-brand-ink">
            <strong>{fmtMoney(movimiento.monto)}</strong> · {movimiento.caja_nombre} ·{' '}
            {movimiento.fecha}
          </p>
          {movimiento.descripcion && (
            <p className="mt-0.5 text-xs text-brand-muted">{movimiento.descripcion}</p>
          )}
        </div>

        {/* Decisión Pablo: no todo ingreso desconocido es de un cliente */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-brand-muted">
            ¿Qué es este ingreso?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setModo('cliente')}
              className={cn(
                'rounded-xl border p-3 text-sm font-semibold transition',
                modo === 'cliente'
                  ? 'border-brand-cyan bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/30'
                  : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
              )}
            >
              <UserCheck size={14} className="-mt-0.5 mr-1 inline" /> Pago de un cliente
            </button>
            <button
              type="button"
              onClick={() => setModo('casa')}
              className={cn(
                'rounded-xl border p-3 text-sm font-semibold transition',
                modo === 'casa'
                  ? 'border-brand-cyan bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/30'
                  : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
              )}
            >
              <Landmark size={14} className="-mt-0.5 mr-1 inline" /> No es de un cliente
            </button>
          </div>
        </div>

        {modo === 'cliente' ? (
          <>
            <Field label="¿De qué cliente es este ingreso?" required>
              {adminId ? (
                <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-2 text-sm">
                  <span className="flex-1 text-brand-ink">{adminNombre}</span>
                  <button
                    type="button"
                    onClick={() => { setAdminId(null); setAdminNombre(''); setAdminSearch(''); }}
                    className="text-xs text-brand-muted hover:text-brand-ink"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    value={adminSearch}
                    onChange={(e) => setAdminSearch(e.target.value)}
                    placeholder="Buscar por nombre, código o CUIT"
                  />
                  {admins.length > 0 && (
                    <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200">
                      {admins.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => { setAdminId(a.id); setAdminNombre(a.nombre); setAdmins([]); }}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                          >
                            {a.nombre} {a.codigo && <span className="text-xs text-brand-muted">· {a.codigo}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Field>

            {adminId && comprobantes.length > 0 && (
              <>
                <Field
                  label="Aplicar a un comprobante (opcional)"
                  hint="Si no elegís ninguno, el importe queda como saldo a favor del cliente."
                >
                  <Select value={compId} onChange={(e) => setCompId(e.target.value)}>
                    <option value="">— No aplicar ahora (queda a favor) —</option>
                    {comprobantes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.etiqueta} · saldo {fmtMoney(Number(c.saldo_pendiente))}
                      </option>
                    ))}
                  </Select>
                </Field>
                {comp && (
                  <Field label="Monto a aplicar" hint="Vacío = aplica lo máximo posible.">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={montoImputar}
                      onChange={(e) => setMontoImputar(e.target.value)}
                      placeholder={String(maxAplicable)}
                      min={0}
                      step="0.01"
                    />
                    {montoInvalido && (
                      <p className="mt-1 text-xs text-rose-600">
                        Monto inválido — ingresá un número mayor a 0 o dejá el campo vacío.
                      </p>
                    )}
                  </Field>
                )}
              </>
            )}

            {adminId && partners.length > 0 && (
              <Field label="Participa partner (opcional)">
                <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                  <option value="">— No participa —</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </Select>
              </Field>
            )}

            {adminId && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
                La caja no se vuelve a impactar (este ingreso ya sumó al saldo cuando se cargó).
                {comp
                  ? ` Se aplican ${fmtMoney(aplicar)} al comprobante${residual > 0 ? ` y ${fmtMoney(residual)} quedan como saldo a favor del cliente` : ''}.`
                  : ' El importe completo queda como saldo a favor en la cuenta corriente del cliente.'}
              </div>
            )}
          </>
        ) : (
          <>
            <Field
              label="Categoría del ingreso"
              hint="Ej: reintegro bancario, ajuste, ingreso vario…"
            >
              <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                <option value="">— Elegir categoría —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </Select>
            </Field>
            <Field label="¿Qué es este ingreso?" hint="Obligatorio si no elegís categoría.">
              <Textarea
                rows={2}
                value={descripcionCasa}
                onChange={(e) => setDescripcionCasa(e.target.value)}
                placeholder="Ej: Reintegro del banco por comisión mal cobrada"
              />
            </Field>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900">
              Queda registrado como ingreso propio (reintegro, ajuste, etc.): no toca la
              cuenta corriente de ningún cliente y la caja no se vuelve a impactar
              (ya sumó al saldo cuando se cargó).
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
