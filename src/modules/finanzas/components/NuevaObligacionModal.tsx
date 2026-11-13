import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { hoyISO } from '@/lib/dates';
import { humanizeError } from '@/lib/errors';
import { cn } from '@/lib/cn';
import {
  getCajasConSaldo, listCategoriasFinanzas, listProveedoresFrecuentes, buscarAdministraciones,
  type CajaConSaldoRow, type CategoriaFinanzaRow, type ProveedorFrecuenteRow,
} from '@/services/api/finanzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { emitirEgreso } from '@/services/api/egresos';

// DGG-249 chunk 3 · Alta de una OBLIGACIÓN de egreso (pasivo de GG), con pago
// opcional en el mismo acto (total/parcial) o dejándola impaga. Espejo del alta
// de comprobante de ingreso + cobrar-ahora. "Total interno": sin IVA/ARCA.
type PagoModo = 'impaga' | 'total' | 'parcial';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function NuevaObligacionModal({ onClose, onCreated }: Props) {
  const [proveedor, setProveedor] = useState('');
  const [concepto, setConcepto] = useState('');
  const [total, setTotal] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [vencimiento, setVencimiento] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorFrecuenteRow[]>([]);
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);

  const [adminSearch, setAdminSearch] = useState('');
  const [admins, setAdmins] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [adminId, setAdminId] = useState<string | null>(null);

  const [pagoModo, setPagoModo] = useState<PagoModo>('impaga');
  const [pagoCajaId, setPagoCajaId] = useState('');
  const [pagoMonto, setPagoMonto] = useState('');

  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      const [c, p, pf, cj] = await Promise.all([
        listCategoriasFinanzas(), listPartnersActivos(), listProveedoresFrecuentes(), getCajasConSaldo(),
      ]);
      if (c.ok) setCategorias(c.data);
      if (p.ok) setPartners(p.data);
      if (pf.ok) setProveedores(pf.data);
      if (cj.ok) { setCajas(cj.data); setPagoCajaId(cj.data[0]?.caja_id ?? ''); }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (adminSearch.trim().length < 2 || adminId) { setAdmins([]); return; }
      const r = await buscarAdministraciones(adminSearch);
      if (r.ok) setAdmins(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [adminSearch, adminId]);

  const categoriasEgreso = categorias.filter((c) => c.tipo === 'egreso' || c.tipo === 'ambos');
  const totalNum = Number(total.replace(',', '.'));

  async function onSubmit() {
    const m = Number(total.replace(',', '.'));
    if (!proveedor.trim()) { toast.error('Falta el proveedor / acreedor'); return; }
    if (!concepto.trim()) { toast.error('Falta el concepto'); return; }
    if (!m || m <= 0) { toast.error('Total inválido'); return; }
    if (!fecha) { toast.error('Falta la fecha'); return; }

    let pagoCaja: string | null = null;
    let pagoMontoNum: number | null = null;
    if (pagoModo !== 'impaga') {
      if (!pagoCajaId) { toast.error('Elegí la caja del pago'); return; }
      pagoCaja = pagoCajaId;
      if (pagoModo === 'total') {
        pagoMontoNum = m;
      } else {
        const pm = Number(pagoMonto.replace(',', '.'));
        if (!pm || pm <= 0) { toast.error('Monto del pago parcial inválido'); return; }
        if (pm >= m) { toast.error('Para pagar el total elegí «Pagar total»'); return; }
        pagoMontoNum = pm;
      }
    }

    setCreating(true);
    const res = await emitirEgreso({
      proveedorNombre: proveedor.trim(),
      concepto: concepto.trim(),
      total: m,
      fecha,
      vencimiento: vencimiento || null,
      categoriaId: categoriaId || null,
      partnerIdAtribucion: partnerId || null,
      administracionId: adminId,
      observaciones: observaciones.trim() || null,
      pagoCajaId: pagoCaja,
      pagoMonto: pagoMontoNum,
      pagoFecha: pagoCaja ? fecha : null,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos registrar la obligación', { description: humanizeError(res.error) });
      return;
    }
    toast.success(
      pagoModo === 'impaga'
        ? 'Obligación registrada (impaga)'
        : pagoModo === 'total'
          ? 'Obligación registrada y pagada'
          : 'Obligación registrada con pago parcial',
    );
    onCreated();
  }

  const modoBtn = (modo: PagoModo, label: string, cls: string) => (
    <button
      type="button"
      onClick={() => setPagoModo(modo)}
      className={cn(
        'rounded-xl border p-2.5 text-sm font-semibold transition',
        pagoModo === modo ? cls : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
      )}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Nueva obligación de pago"
      kicker="Egreso"
      width={540}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSubmit} loading={creating}>Registrar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Proveedor / acreedor" required hint="A quién le debemos (docente, proveedor…).">
          <Input
            value={proveedor}
            onChange={(e) => setProveedor(e.target.value)}
            placeholder="Ej. Juan Pérez (docente)"
            list="obligacion-proveedores"
          />
          <datalist id="obligacion-proveedores">
            {proveedores.map((p) => <option key={p.id} value={p.nombre} />)}
          </datalist>
        </Field>

        <Field label="Concepto" required>
          <Input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej. Clase RPAC noviembre" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Total" required>
            <Input type="number" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="0.00" min={0} step="0.01" />
          </Field>
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Vence" hint="Opcional">
            <Input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría">
            <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
              <option value="">— Sin categoría —</option>
              {categoriasEgreso.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          </Field>
          {partners.length > 0 && (
            <Field label="Atribuir a partner" hint="El costo entra en SU rentabilidad (aun impago).">
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">— No —</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Select>
            </Field>
          )}
        </div>

        <Field label="Asociar a administración (opcional)">
          {adminId ? (
            <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-2 text-sm">
              <span className="flex-1 text-brand-ink">{admins.find((a) => a.id === adminId)?.nombre ?? 'Administración'}</span>
              <button type="button" onClick={() => { setAdminId(null); setAdminSearch(''); }} className="text-xs text-brand-muted hover:text-brand-ink">Quitar</button>
            </div>
          ) : (
            <>
              <Input value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} placeholder="Buscar por nombre, código o CUIT" />
              {admins.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200">
                  {admins.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => { setAdminId(a.id); setAdminSearch(a.nombre); setAdmins([]); }} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50">
                        {a.nombre} {a.codigo && <span className="text-xs text-brand-muted">· {a.codigo}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Field>

        {/* Pagar ahora */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-brand-muted">¿Pagar ahora?</p>
          <div className="grid grid-cols-3 gap-2">
            {modoBtn('impaga', 'Dejar impaga', 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-200')}
            {modoBtn('total', 'Pagar total', 'border-green-400 bg-green-50 text-green-700 ring-1 ring-green-200')}
            {modoBtn('parcial', 'Pago parcial', 'border-sky-400 bg-sky-50 text-sky-700 ring-1 ring-sky-200')}
          </div>
          {pagoModo !== 'impaga' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Caja del pago" required>
                <Select value={pagoCajaId} onChange={(e) => setPagoCajaId(e.target.value)}>
                  {cajas.map((c) => <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>)}
                </Select>
              </Field>
              {pagoModo === 'parcial' && (
                <Field label="Monto a pagar" required hint={totalNum > 0 ? `De $${totalNum.toLocaleString('es-AR')}` : undefined}>
                  <Input type="number" inputMode="decimal" value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} placeholder="0.00" min={0} step="0.01" />
                </Field>
              )}
            </div>
          )}
          <p className="mt-2 text-[11px] text-brand-muted">
            El pago sale de la caja (lo ven los reportes financieros). Lo impago queda como pasivo.
          </p>
        </div>

        <Field label="Observaciones (opcional)">
          <Textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Nota interna" />
        </Field>
      </div>
    </Modal>
  );
}
