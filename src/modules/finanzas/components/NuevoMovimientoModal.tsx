import { useEffect, useState } from 'react';
import { Paperclip, Plus, X } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  crearMovimientoManual, subirAdjuntoMovimiento, listCategoriasFinanzas, buscarAdministraciones,
  listProveedoresFrecuentes, crearProveedorFrecuente,
  type CajaConSaldoRow, type CategoriaFinanzaRow, type ProveedorFrecuenteRow,
} from '@/services/api/finanzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';

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
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  // DGG-120 · Proveedor frecuente (solo egresos): catálogo informativo cuyo
  // nombre se concatena al inicio de la descripción al guardar. Nada contable.
  const [proveedores, setProveedores] = useState<ProveedorFrecuenteRow[]>([]);
  const [provSel, setProvSel] = useState<ProveedorFrecuenteRow | null>(null);
  const [provSearch, setProvSearch] = useState('');
  const [provOpen, setProvOpen] = useState(false);
  const [provCreating, setProvCreating] = useState(false);
  // JL-W8-3 · ingreso bancario de origen desconocido: entra a la caja como
  // "pendiente de identificar" (suma al saldo, no toca cta.cte de ningún
  // cliente) hasta que la gerencia lo reconozca.
  const [sinIdentificar, setSinIdentificar] = useState(false);
  const [creating, setCreating] = useState(false);

  // §6 E-GG-142: al cambiar a egreso el tilde quedaba oculto pero persistido y
  // reaparecía tildado al volver a ingreso — un pendiente por accidente.
  useEffect(() => {
    if (tipo !== 'ingreso') setSinIdentificar(false);
    // Misma lección para el proveedor: oculto en ingreso NUNCA debe persistir
    // seleccionado (concatenaría en un ingreso sin que se vea).
    if (tipo !== 'egreso') {
      setProvSel(null);
      setProvSearch('');
      setProvOpen(false);
    }
  }, [tipo]);

  useEffect(() => {
    void (async () => {
      const r = await listCategoriasFinanzas();
      if (r.ok) setCategorias(r.data);
      const p = await listPartnersActivos();
      if (p.ok) setPartners(p.data);
      const pf = await listProveedoresFrecuentes();
      if (pf.ok) setProveedores(pf.data);
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

  const provFiltrados = provSearch.trim()
    ? proveedores.filter((p) => p.nombre.toLowerCase().includes(provSearch.trim().toLowerCase()))
    : proveedores;
  const provMatchExacto = proveedores.some(
    (p) => p.nombre.trim().toLowerCase() === provSearch.trim().toLowerCase(),
  );

  async function onAgregarProveedor() {
    const nombre = provSearch.trim();
    if (!nombre || provCreating) return;
    setProvCreating(true);
    const r = await crearProveedorFrecuente(nombre);
    setProvCreating(false);
    if (!r.ok) {
      toast.error('No pudimos agregar el proveedor', { description: humanizeError(r.error) });
      return;
    }
    setProveedores((prev) =>
      prev.some((p) => p.id === r.data.id)
        ? prev
        : [...prev, r.data].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    );
    setProvSel(r.data);
    setProvSearch('');
    setProvOpen(false);
  }

  async function onSubmit() {
    const m = Number(monto.replace(',', '.'));
    if (!cajaId) { toast.error('Elegí una caja'); return; }
    if (!m || m <= 0) { toast.error('Monto inválido'); return; }
    if (!fecha) { toast.error('Falta la fecha'); return; }
    setCreating(true);
    const esSinIdentificar = tipo === 'ingreso' && sinIdentificar;
    // DGG-120 · el proveedor elegido solo antecede la descripción: "ARCA - Pago…".
    const provNombre = tipo === 'egreso' && provSel ? provSel.nombre.trim() : '';
    const descBase = descripcion.trim();
    const descFinal = provNombre ? (descBase ? `${provNombre} - ${descBase}` : provNombre) : descBase;
    const res = await crearMovimientoManual({
      cajaId,
      tipo,
      monto: m,
      fecha,
      categoriaId: categoriaId || null,
      descripcion: descFinal || null,
      referencia: referencia.trim() || null,
      // sin identificar ⇒ sin cliente ni partner (guardas de la RPC · mig 0360)
      administracionId: esSinIdentificar ? null : adminId,
      partnerIdAtribucion: esSinIdentificar ? null : partnerId || null,
      sinIdentificar: esSinIdentificar,
    });
    if (!res.ok) {
      setCreating(false);
      toast.error('No pudimos crear el movimiento', { description: humanizeError(res.error) });
      return;
    }
    // DGG-85 · subir las constancias adjuntas (best-effort; el movimiento ya existe).
    let adjFallos = 0;
    for (const f of adjuntos) {
      const up = await subirAdjuntoMovimiento(res.data, f);
      if (!up.ok) adjFallos++;
    }
    setCreating(false);
    toast.success(
      `${esSinIdentificar ? 'Ingreso sin identificar' : tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado` +
        (adjuntos.length ? ` · ${adjuntos.length - adjFallos}/${adjuntos.length} adjunto(s)` : ''),
    );
    if (adjFallos > 0) toast.warning(`${adjFallos} adjunto(s) no se pudieron subir`);
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

        {/* JL-W8-3 · Ingreso bancario no identificado */}
        {tipo === 'ingreso' && (
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <input
              type="checkbox"
              checked={sinIdentificar}
              onChange={(e) => setSinIdentificar(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="text-sm">
              <span className="font-semibold text-amber-900">Ingreso no identificado</span>
              <span className="mt-0.5 block text-xs text-amber-800">
                Plata que entró a la caja pero no sabemos de qué cliente es. Suma al
                saldo de la caja y NO afecta la cuenta corriente de nadie hasta que
                lo identifiques desde la lista de movimientos.
              </span>
            </span>
          </label>
        )}

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

        {/* DGG-120 · Proveedor frecuente (solo egresos): comodidad de carga.
            El nombre elegido se antepone a la descripción al guardar. */}
        {tipo === 'egreso' && (
          <Field
            label="Proveedor frecuente (opcional)"
            hint="Se agrega al inicio de la descripción, ej. «ARCA - Pago de monotributo»."
          >
            {provSel ? (
              <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-2 text-sm">
                <span className="flex-1 text-brand-ink">{provSel.nombre}</span>
                <button
                  type="button"
                  onClick={() => { setProvSel(null); setProvSearch(''); }}
                  className="text-xs text-brand-muted hover:text-brand-ink"
                >
                  Quitar
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={provSearch}
                  onChange={(e) => { setProvSearch(e.target.value); setProvOpen(true); }}
                  onFocus={() => setProvOpen(true)}
                  onBlur={() => setTimeout(() => setProvOpen(false), 150)}
                  placeholder="Buscar o elegir proveedor…"
                />
                {provOpen && (
                  <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {provFiltrados.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setProvSel(p); setProvSearch(''); setProvOpen(false); }}
                          className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                        >
                          {p.nombre}
                        </button>
                      </li>
                    ))}
                    {provFiltrados.length === 0 && !provSearch.trim() && (
                      <li className="px-3 py-1.5 text-sm text-brand-muted">Sin proveedores cargados</li>
                    )}
                    {provSearch.trim() !== '' && !provMatchExacto && (
                      <li className="border-t border-slate-100">
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void onAgregarProveedor()}
                          disabled={provCreating}
                          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm font-medium text-brand-cyan hover:bg-brand-cyan/5 disabled:opacity-50"
                        >
                          <Plus size={13} /> Agregar «{provSearch.trim()}»
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </Field>
        )}

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

        {/* #145 · Participa partner (opcional) · oculto si es sin identificar */}
        {partners.length > 0 && !(tipo === 'ingreso' && sinIdentificar) && (
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

        {/* Asociar a administración (opcional, autocomplete) · oculto si es sin identificar */}
        {!(tipo === 'ingreso' && sinIdentificar) && (
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
        )}

        {/* DGG-85 · Adjuntar constancias del gasto (factura, transferencia, etc.) */}
        <Field label="Adjuntos (constancias)" hint="Factura, transferencia, recibo… PDF o imagen. Opcional.">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan/5">
            <Paperclip size={15} /> Elegir archivos
            <input
              type="file"
              multiple
              accept="image/*,application/pdf,.xls,.xlsx,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                if (fs.length) setAdjuntos((prev) => [...prev, ...fs]);
                e.target.value = '';
              }}
            />
          </label>
          {adjuntos.length > 0 && (
            <ul className="mt-2 space-y-1">
              {adjuntos.map((f, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-xs">
                  <Paperclip size={12} className="text-brand-muted" />
                  <span className="flex-1 truncate text-brand-ink">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setAdjuntos((prev) => prev.filter((_, j) => j !== i))}
                    className="text-brand-muted hover:text-rose-600"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </div>
    </Modal>
  );
}
