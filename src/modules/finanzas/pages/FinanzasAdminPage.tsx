import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Wallet, Tag, Edit2, Archive, ArchiveRestore, ArrowLeft,
  CheckCircle2, XCircle, Landmark, Smartphone, PiggyBank, Banknote,
  Star, Trash2,
} from 'lucide-react';
import { Button, Field, Input, Select, Modal, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  listarCajasAdmin, crearCaja, actualizarCaja, archivarCaja, reactivarCaja,
  eliminarCaja, marcarCajaDefault,
  listarCategoriasAdmin, crearCategoria, actualizarCategoria,
  archivarCategoria, reactivarCategoria,
  type CajaAdminRow, type CajaTipo,
  type CategoriaAdminRow, type CategoriaTipo,
} from '@/services/api/finanzas-admin';
import { humanizeError } from '@/lib/errors';

// E-GG-154: saldos de caja exactos al centavo (conciliación), centavos en
// superíndice para no ensanchar el card.
import { MoneySup } from '../components/MoneySup';

const TIPO_CAJA_LABEL: Record<CajaTipo, string> = {
  banco: 'Banco',
  billetera_virtual: 'Billetera virtual',
  plazo_fijo: 'Plazo fijo',
  efectivo: 'Efectivo',
};

const TIPO_CAJA_ICON: Record<CajaTipo, typeof Landmark> = {
  banco: Landmark,
  billetera_virtual: Smartphone,
  plazo_fijo: PiggyBank,
  efectivo: Banknote,
};

const TIPO_CATEGORIA_LABEL: Record<CategoriaTipo, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  ambos: 'Ambos',
};

const TIPO_CATEGORIA_COLOR: Record<CategoriaTipo, string> = {
  ingreso: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  egreso: 'bg-rose-50 text-rose-700 border-rose-200',
  ambos: 'bg-slate-50 text-slate-700 border-slate-200',
};

export function FinanzasAdminPage() {
  const [tab, setTab] = useState<'cajas' | 'categorias'>('cajas');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/gerencia/finanzas"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-brand-ink/70 hover:bg-slate-100 hover:text-brand-ink"
        >
          <ArrowLeft size={16} /> Finanzas
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-ink">
            Administración
          </h1>
          <p className="text-sm text-brand-muted">
            Cajas y categorías personalizadas para tu gestión.
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('cajas')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
            tab === 'cajas'
              ? 'border-brand-cyan text-brand-ink'
              : 'border-transparent text-brand-muted hover:text-brand-ink',
          )}
        >
          <Wallet size={16} /> Cajas
        </button>
        <button
          type="button"
          onClick={() => setTab('categorias')}
          className={cn(
            'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
            tab === 'categorias'
              ? 'border-brand-cyan text-brand-ink'
              : 'border-transparent text-brand-muted hover:text-brand-ink',
          )}
        >
          <Tag size={16} /> Categorías
        </button>
      </div>

      {tab === 'cajas' ? <CajasTab /> : <CategoriasTab />}
    </div>
  );
}

// ====================================================================
// CAJAS TAB
// ====================================================================

function CajasTab() {
  const confirm = useConfirm();
  const [cajas, setCajas] = useState<CajaAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CajaAdminRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);

  async function recargar() {
    setLoading(true);
    const r = await listarCajasAdmin(true);
    setLoading(false);
    if (r.ok) setCajas(r.data);
    else toast.error('Error al cargar cajas');
  }

  useEffect(() => { void recargar(); }, []);

  async function onArchivar(caja: CajaAdminRow) {
    const ok = await confirm({
      title: `Archivar "${caja.nombre}"`,
      message: 'La caja archivada deja de aparecer en los selectores de nuevos movimientos pero su historial se preserva. Podés reactivarla más adelante.',
      confirmLabel: 'Archivar',
      danger: true,
    });
    if (!ok) return;
    const r = await archivarCaja(caja.caja_id);
    if (r.ok) { toast.success('Caja archivada'); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  async function onReactivar(caja: CajaAdminRow) {
    const r = await reactivarCaja(caja.caja_id);
    if (r.ok) { toast.success('Caja reactivada'); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  // JL-CAJA #2 · Eliminar caja (hard delete). El RPC bloquea si saldo ≠ 0
  // o si tiene movimientos históricos. En esos casos la BD devuelve un
  // mensaje accionable que mostramos directamente en el toast.
  async function onEliminar(caja: CajaAdminRow) {
    const ok = await confirm({
      title: `Eliminar "${caja.nombre}"`,
      message: caja.cantidad_movimientos > 0
        ? `Esta caja tiene ${caja.cantidad_movimientos} movimiento(s) histórico(s). Para preservar el balance histórico, sólo se permite eliminar cajas sin movimientos. Si querés ocultarla, usá Archivar.`
        : 'La caja se eliminará de forma permanente. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const r = await eliminarCaja(caja.caja_id);
    if (r.ok) { toast.success('Caja eliminada'); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  // JL-CAJA #3 · Marcar como favorita (default para cobranzas).
  async function onMarcarDefault(caja: CajaAdminRow) {
    if (caja.es_default) return; // ya es default, no hace nada
    const r = await marcarCajaDefault(caja.caja_id);
    if (r.ok) { toast.success(`"${caja.nombre}" es ahora la caja favorita`); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  // JL-CAJA #4 · Sort por orden ASC, nombre ASC (activas primero).
  const visibles = useMemo(() => {
    const filtered = mostrarArchivadas ? cajas : cajas.filter((c) => c.activo);
    return [...filtered].sort((a, b) => {
      // Activas antes que archivadas (consistente con la RPC).
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      // Favorita arriba del todo entre las activas.
      if (a.es_default !== b.es_default) return a.es_default ? -1 : 1;
      // Luego por orden, luego por nombre.
      if (a.orden !== b.orden) return a.orden - b.orden;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [cajas, mostrarArchivadas]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-brand-muted">
          <input
            type="checkbox"
            checked={mostrarArchivadas}
            onChange={(e) => setMostrarArchivadas(e.target.checked)}
            className="rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
          />
          Mostrar archivadas
        </label>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Nueva caja
        </Button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-brand-muted">
          Cargando…
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50">
          <IllustratedEmpty
            illustration="lista"
            title={mostrarArchivadas ? 'No hay cajas archivadas' : 'No hay cajas activas'}
            description={
              mostrarArchivadas
                ? 'Las cajas archivadas se guardan acá para consulta histórica.'
                : 'Creá la primera caja para empezar a registrar movimientos.'
            }
            action={
              !mostrarArchivadas && (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} /> Nueva caja
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((caja) => {
            const Icon = TIPO_CAJA_ICON[caja.tipo] ?? Wallet;
            return (
              <div
                key={caja.caja_id}
                className={cn(
                  'group relative rounded-2xl border bg-white p-5 transition',
                  caja.activo
                    ? 'border-slate-200 hover:border-brand-cyan/40 hover:shadow-md'
                    : 'border-slate-200 opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: caja.color ? `${caja.color}22` : '#0e9bc81a',
                      color: caja.color ?? '#0e9bc8',
                    }}
                  >
                    <Icon size={22} />
                  </div>
                  <div className="flex gap-1">
                    {/* JL-CAJA #3 · estrella para marcar como favorita */}
                    {caja.activo && (
                      <button
                        type="button"
                        onClick={() => void onMarcarDefault(caja)}
                        className={cn(
                          'rounded-lg p-1.5 transition',
                          caja.es_default
                            ? 'text-amber-500'
                            : 'text-brand-muted hover:bg-amber-50 hover:text-amber-500',
                        )}
                        title={caja.es_default ? 'Caja favorita (se pre-selecciona en cobranza)' : 'Marcar como favorita'}
                      >
                        <Star
                          size={15}
                          fill={caja.es_default ? 'currentColor' : 'none'}
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(caja)}
                      className="rounded-lg p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                      title="Editar"
                    >
                      <Edit2 size={15} />
                    </button>
                    {caja.activo ? (
                      <button
                        type="button"
                        onClick={() => onArchivar(caja)}
                        className="rounded-lg p-1.5 text-brand-muted hover:bg-rose-50 hover:text-rose-600"
                        title="Archivar (preserva historial)"
                      >
                        <Archive size={15} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onReactivar(caja)}
                        className="rounded-lg p-1.5 text-brand-muted hover:bg-emerald-50 hover:text-emerald-600"
                        title="Reactivar"
                      >
                        <ArchiveRestore size={15} />
                      </button>
                    )}
                    {/* JL-CAJA #2 · papelera = hard delete (solo cajas sin movimientos) */}
                    {caja.activo && caja.cantidad_movimientos === 0 && (
                      <button
                        type="button"
                        onClick={() => void onEliminar(caja)}
                        className="rounded-lg p-1.5 text-brand-muted hover:bg-rose-50 hover:text-rose-600"
                        title="Eliminar (definitivamente — sólo para cajas sin movimientos)"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <p className="font-medium text-brand-ink">{caja.nombre}</p>
                  {caja.es_default && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                      <Star size={10} fill="currentColor" /> Favorita
                    </span>
                  )}
                  {!caja.activo && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-600">
                      Archivada
                    </span>
                  )}
                </div>
                <p className="text-xs uppercase tracking-wider text-brand-muted">
                  {TIPO_CAJA_LABEL[caja.tipo]} · {caja.moneda}
                </p>

                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-xs text-brand-muted">Saldo</p>
                    <p className="text-xl font-bold tabular-nums text-brand-ink">
                      <MoneySup value={caja.saldo} />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-brand-muted">Movs.</p>
                    <p className="text-sm font-medium tabular-nums text-brand-ink">
                      {caja.cantidad_movimientos}
                    </p>
                  </div>
                </div>

                {(caja.cbu || caja.alias || caja.banco_entidad) && (
                  <div className="mt-3 border-t border-slate-100 pt-2 text-xs text-brand-muted">
                    {caja.banco_entidad && <p>Banco: {caja.banco_entidad}</p>}
                    {caja.alias && <p>Alias: {caja.alias}</p>}
                    {caja.cbu && <p className="truncate">CBU: {caja.cbu}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(creating || editing) && (
        <CajaFormModal
          caja={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void recargar(); }}
        />
      )}
    </div>
  );
}

interface CajaFormProps {
  caja: CajaAdminRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function CajaFormModal({ caja, onClose, onSaved }: CajaFormProps) {
  const isEditing = caja !== null;
  const [nombre, setNombre] = useState(caja?.nombre ?? '');
  // JL-CAJA #1 · tipo es editable también en modo edit (mig 0174).
  const [tipo, setTipo] = useState<CajaTipo>(caja?.tipo ?? 'banco');
  const [color, setColor] = useState(caja?.color ?? '#0e9bc8');
  const [cbu, setCbu] = useState(caja?.cbu ?? '');
  const [alias, setAlias] = useState(caja?.alias ?? '');
  const [numeroCuenta, setNumeroCuenta] = useState(caja?.numero_cuenta ?? '');
  const [bancoEntidad, setBancoEntidad] = useState(caja?.banco_entidad ?? '');
  // JL-CAJA #4 · orden de la card (entre cajas activas, menor primero).
  const [orden, setOrden] = useState<number>(caja?.orden ?? 0);
  // JL-CAJA #3 · favorita: se pre-selecciona en cobranza.
  const [esDefault, setEsDefault] = useState<boolean>(caja?.es_default ?? false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSaving(true);
    const r = isEditing && caja
      ? await actualizarCaja({
          cajaId: caja.caja_id, nombre, tipo, color, orden, es_default: esDefault,
          cbu: cbu || null, alias: alias || null,
          numero_cuenta: numeroCuenta || null, banco_entidad: bancoEntidad || null,
        })
      : await crearCaja({
          nombre, tipo, color,
          cbu: cbu || null, alias: alias || null,
          numero_cuenta: numeroCuenta || null, banco_entidad: bancoEntidad || null,
        });
    setSaving(false);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    // Si es alta y marcó favorita, hacer un segundo call al RPC marcar_default
    // (la creación inicial no expone p_es_default; lo hacemos post-create).
    if (!isEditing && esDefault && r.data) {
      const r2 = await marcarCajaDefault(String(r.data));
      if (!r2.ok) toast.error(humanizeError(r2.error));
    }
    toast.success(isEditing ? 'Caja actualizada' : 'Caja creada');
    onSaved();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? 'Editar caja' : 'Nueva caja'}
      width={560}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nombre" required>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Banco Galicia · Cta. 4321"
            required
          />
        </Field>

        {/* JL-CAJA #1 · tipo editable en alta y edición */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as CajaTipo)}>
              <option value="banco">Banco</option>
              <option value="billetera_virtual">Billetera virtual</option>
              <option value="plazo_fijo">Plazo fijo</option>
              <option value="efectivo">Efectivo</option>
            </Select>
          </Field>
          {/* JL-CAJA #4 · orden (menor primero) */}
          <Field label="Orden">
            <Input
              type="number"
              inputMode="numeric"
              value={String(orden)}
              onChange={(e) => setOrden(Number(e.target.value) || 0)}
              placeholder="0"
              title="Las cajas con menor orden aparecen primero en la lista."
            />
          </Field>
        </div>

        <Field label="Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color ?? '#0e9bc8'}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-slate-300"
            />
            <Input value={color ?? ''} onChange={(e) => setColor(e.target.value)} className="flex-1" />
          </div>
        </Field>

        {(tipo === 'banco' || tipo === 'billetera_virtual' || tipo === 'plazo_fijo') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entidad / Banco">
              <Input
                value={bancoEntidad}
                onChange={(e) => setBancoEntidad(e.target.value)}
                placeholder="Ej: Banco Galicia"
              />
            </Field>
            <Field label="Nº de cuenta">
              <Input
                value={numeroCuenta}
                onChange={(e) => setNumeroCuenta(e.target.value)}
              />
            </Field>
            <Field label="CBU">
              <Input value={cbu} onChange={(e) => setCbu(e.target.value)} />
            </Field>
            <Field label="Alias">
              <Input value={alias} onChange={(e) => setAlias(e.target.value)} />
            </Field>
          </div>
        )}

        {/* JL-CAJA #3 · favorita */}
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
          <input
            type="checkbox"
            checked={esDefault}
            onChange={(e) => setEsDefault(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
          />
          <span className="text-sm text-brand-ink">
            <span className="inline-flex items-center gap-1 font-medium">
              <Star size={13} fill="currentColor" className="text-amber-500" />
              Caja favorita
            </span>
            <span className="block text-xs text-brand-muted">
              Se pre-selecciona en el modal de cobranza. Si marcás esta como
              favorita, las otras dejan de serlo automáticamente.
            </span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isEditing ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ====================================================================
// CATEGORÍAS TAB
// ====================================================================

function CategoriasTab() {
  const confirm = useConfirm();
  const [categorias, setCategorias] = useState<CategoriaAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CategoriaAdminRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState<'' | CategoriaTipo>('');
  const [mostrarArchivadas, setMostrarArchivadas] = useState(false);

  async function recargar() {
    setLoading(true);
    const r = await listarCategoriasAdmin(true);
    setLoading(false);
    if (r.ok) setCategorias(r.data);
  }

  useEffect(() => { void recargar(); }, []);

  async function onArchivar(cat: CategoriaAdminRow) {
    const ok = await confirm({
      title: `Archivar "${cat.nombre}"`,
      message: cat.cantidad_movimientos > 0
        ? `Esta categoría tiene ${cat.cantidad_movimientos} movimientos imputados. Archivarla la quita de los selectores nuevos pero conserva el historial.`
        : 'La categoría se ocultará de los selectores nuevos.',
      confirmLabel: 'Archivar',
      danger: true,
    });
    if (!ok) return;
    const r = await archivarCategoria(cat.categoria_id);
    if (r.ok) { toast.success('Categoría archivada'); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  async function onReactivar(cat: CategoriaAdminRow) {
    const r = await reactivarCategoria(cat.categoria_id);
    if (r.ok) { toast.success('Categoría reactivada'); void recargar(); }
    else toast.error(humanizeError(r.error));
  }

  const visibles = useMemo(() => {
    return categorias.filter((c) => {
      if (!mostrarArchivadas && !c.activo) return false;
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      return true;
    });
  }, [categorias, filtroTipo, mostrarArchivadas]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as '' | CategoriaTipo)}
          >
            <option value="">Todos los tipos</option>
            <option value="ingreso">Solo ingresos</option>
            <option value="egreso">Solo egresos</option>
            <option value="ambos">Ambos</option>
          </Select>
          <label className="inline-flex items-center gap-2 text-sm text-brand-muted">
            <input
              type="checkbox"
              checked={mostrarArchivadas}
              onChange={(e) => setMostrarArchivadas(e.target.checked)}
              className="rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
            />
            Mostrar archivadas
          </label>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus size={16} /> Nueva categoría
        </Button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-brand-muted">
          Cargando…
        </div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <Tag size={32} className="mx-auto mb-3 text-slate-400" />
          <p className="text-brand-muted">Sin categorías que mostrar.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-brand-muted">
                <th className="px-4 py-3 text-left">Nombre</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-right">Movs.</th>
                <th className="px-4 py-3 text-right">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((cat) => (
                <tr key={cat.categoria_id} className={cn(!cat.activo && 'opacity-60')}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: cat.color ?? '#94a3b8' }}
                      />
                      <span className="font-medium text-brand-ink">{cat.nombre}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                      TIPO_CATEGORIA_COLOR[cat.tipo],
                    )}>
                      {TIPO_CATEGORIA_LABEL[cat.tipo]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">
                    {cat.cantidad_movimientos}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {cat.activo ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 size={14} /> Activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <XCircle size={14} /> Archivada
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(cat)}
                        className="rounded p-1.5 text-brand-muted hover:bg-slate-100 hover:text-brand-ink"
                        title="Editar"
                      >
                        <Edit2 size={14} />
                      </button>
                      {cat.activo ? (
                        <button
                          type="button"
                          onClick={() => onArchivar(cat)}
                          className="rounded p-1.5 text-brand-muted hover:bg-rose-50 hover:text-rose-600"
                          title="Archivar"
                        >
                          <Archive size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReactivar(cat)}
                          className="rounded p-1.5 text-brand-muted hover:bg-emerald-50 hover:text-emerald-600"
                          title="Reactivar"
                        >
                          <ArchiveRestore size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <CategoriaFormModal
          categoria={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); void recargar(); }}
        />
      )}
    </div>
  );
}

interface CategoriaFormProps {
  categoria: CategoriaAdminRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function CategoriaFormModal({ categoria, onClose, onSaved }: CategoriaFormProps) {
  const isEditing = categoria !== null;
  const [nombre, setNombre] = useState(categoria?.nombre ?? '');
  const [tipo, setTipo] = useState<CategoriaTipo>(categoria?.tipo ?? 'ambos');
  const [color, setColor] = useState(categoria?.color ?? '#0e9bc8');
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) { toast.error('El nombre es obligatorio'); return; }
    setSaving(true);
    const r = isEditing && categoria
      ? await actualizarCategoria({
          categoriaId: categoria.categoria_id, nombre, tipo, color,
        })
      : await crearCategoria({ nombre, tipo, color });
    setSaving(false);
    if (r.ok) {
      toast.success(isEditing ? 'Categoría actualizada' : 'Categoría creada');
      onSaved();
    } else {
      toast.error(humanizeError(r.error));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEditing ? 'Editar categoría' : 'Nueva categoría'}
      width={420}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nombre" required>
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Honorarios profesionales"
            required
          />
        </Field>
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as CategoriaTipo)}>
            <option value="ingreso">Solo ingresos</option>
            <option value="egreso">Solo egresos</option>
            <option value="ambos">Ambos</option>
          </Select>
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color ?? '#0e9bc8'}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border border-slate-300"
            />
            <Input value={color ?? ''} onChange={(e) => setColor(e.target.value)} className="flex-1" />
          </div>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : isEditing ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
