import { useEffect, useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  crearMovimientoManual, listCategoriasFinanzas, buscarAdministraciones,
  type CajaConSaldoRow, type CategoriaFinanzaRow,
} from '@/services/api/finanzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { cn } from '@/lib/cn';

interface Props {
  cajas: CajaConSaldoRow[];
  onClose: () => void;
  onCreated: () => void;
}

export function NuevoMovimientoModal({ cajas, onClose, onCreated }: Props) {
  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso');
  const [cajaId, setCajaId] = useState<string>(cajas[0]?.caja_id ?? '');
  const [monto, setMonto] = useState<string>('');
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState('');
  const [referencia, setReferencia] = useState('');
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [adminSearch, setAdminSearch] = useState('');
  const [admins, setAdmins] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  // #145 · participa partner
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await listCategoriasFinanzas();
      if (r.ok) setCategorias(r.data);
      const p = await listPartnersActivos();
      if (p.ok) setPartners(p.data);
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (adminSearch.trim().length < 2 || adminId) {
        setAdmins([]);
        return;
      }
      const r = await buscarAdministraciones(adminSearch);
      if (r.ok) setAdmins(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [adminSearch, adminId]);

  const categoriasFiltradas = categorias.filter((c) => c.tipo === tipo || c.tipo === 'ambos');

  async function onSubmit() {
    const m = Number(monto.replace(',', '.'));
    if (!cajaId) { toast.error('Elegí una caja'); return; }
    if (!m || m <= 0) { toast.error('Monto inválido'); return; }
    if (!fecha) { toast.error('Falta la fecha'); return; }
    setCreating(true);
    const res = await crearMovimientoManual({
      cajaId,
      tipo,
      monto: m,
      fecha,
      categoriaId: categoriaId || null,
      descripcion: descripcion.trim() || null,
      referencia: referencia.trim() || null,
      administracionId: adminId,
      partnerIdAtribucion: partnerId || null,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos crear el movimiento', { description: res.error.message });
      return;
    }
    toast.success(`${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado`);
    onCreated();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo movimiento"
      kicker="Alta manual"
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onSubmit} loading={creating}>Crear movimiento</Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Tipo (toggle) */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-brand-muted">Tipo</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => { setTipo('ingreso'); setCategoriaId(''); }}
              className={cn(
                'rounded-xl border p-3 text-sm font-semibold transition',
                tipo === 'ingreso'
                  ? 'border-green-400 bg-green-50 text-green-700 ring-1 ring-green-200'
                  : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
              )}
            >
              ↓ Ingreso
            </button>
            <button
              type="button"
              onClick={() => { setTipo('egreso'); setCategoriaId(''); }}
              className={cn(
                'rounded-xl border p-3 text-sm font-semibold transition',
                tipo === 'egreso'
                  ? 'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-200'
                  : 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50',
              )}
            >
              ↑ Egreso
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Caja" required>
            <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
              {cajas.map((c) => (
                <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha" required>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
        </div>

        <Field label="Monto" required hint="Solo positivos. El tipo determina si suma o resta.">
          <Input
            type="number"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.01"
          />
        </Field>

        <Field label="Categoría">
          <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">— Sin categoría —</option>
            {categoriasFiltradas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>

        <Field label="Descripción">
          <Textarea
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Concepto del movimiento"
          />
        </Field>

        <Field label="Referencia externa (opcional)" hint="Número de transacción, CBU, recibo, etc.">
          <Input value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </Field>

        {/* #145 · Participa partner (opcional) */}
        {partners.length > 0 && (
          <Field
            label="Participa partner"
            hint="Si lo marcás, este movimiento entra en la rendición del partner con su % diferencial."
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

        {/* Asociar a administración (opcional, autocomplete) */}
        <Field label="Asociar a administración (opcional)">
          {adminId ? (
            <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-2 text-sm">
              <span className="flex-1 text-brand-ink">
                {admins.find((a) => a.id === adminId)?.nombre ?? 'Administración seleccionada'}
              </span>
              <button
                type="button"
                onClick={() => { setAdminId(null); setAdminSearch(''); }}
                className="text-xs text-brand-muted hover:text-brand-ink"
              >
                Quitar
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
                        onClick={() => { setAdminId(a.id); setAdminSearch(a.nombre); setAdmins([]); }}
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
      </div>
    </Modal>
  );
}
