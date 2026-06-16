// CobrarAhoraSection (JL · 2026-06-16): bloque reusable para imputar una cobranza
// —total o PARCIAL— en el MISMO acto de emitir un comprobante. Se usa en las tres
// superficies de emisión (modal del trámite, Nuevo comprobante de Facturación, y
// el panel de Solicitud). Espeja los campos del flujo de cobranza canónico
// (RegistrarCobranzaDrawer): caja, fecha, categoría, partner, referencia.
//
// Controlado: el padre tiene el estado (CobroAhoraState) y lo pasa por value/onChange.
// La validación vive en validarCobroEnEmision() y el alta en
// registrarCobranzaEnEmision() (ambas en services/api/cobranzas).
import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Field, Input, Select } from '@/components/common';
import {
  listCajasActivas,
  listCategoriasIngreso,
  type CajaRow,
  type CategoriaFinanzaRow,
  type CobroAhoraState,
  type CobroModo,
} from '@/services/api/cobranzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';

function fmtMoney(n: number): string {
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const MODOS: { k: CobroModo; label: string }[] = [
  { k: 'sin_cobro', label: 'Sin cobro' },
  { k: 'total', label: 'Cobrar total' },
  { k: 'parcial', label: 'Cobrar parcial' },
];

export function CobrarAhoraSection({
  total,
  value,
  onChange,
}: {
  total: number;
  value: CobroAhoraState;
  onChange: (v: CobroAhoraState) => void;
}) {
  const [cajas, setCajas] = useState<CajaRow[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);

  const set = (patch: Partial<CobroAhoraState>) => onChange({ ...value, ...patch });

  // Carga catálogos una vez + prefill de caja favorita y categoría sugerida.
  useEffect(() => {
    void (async () => {
      const [c, g, p] = await Promise.all([
        listCajasActivas(),
        listCategoriasIngreso(),
        listPartnersActivos(),
      ]);
      if (p.ok) setPartners(p.data);
      const patch: Partial<CobroAhoraState> = {};
      if (c.ok) {
        setCajas(c.data);
        const fav =
          c.data.find(
            (x) => (x as unknown as { es_default?: boolean }).es_default === true,
          ) ?? (c.data.length === 1 ? c.data[0] : undefined);
        if (fav && !value.cajaId) patch.cajaId = fav.id;
      }
      if (g.ok) {
        setCategorias(g.data);
        const sug = g.data.find((x) => /cobranza|honorario|servicio/i.test(x.nombre));
        if (sug && !value.categoriaId) patch.categoriaId = sug.id;
      }
      if (Object.keys(patch).length) onChange({ ...value, ...patch });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si el total baja por debajo del parcial ya elegido (ej. el operador edita el
  // precio tras elegir "parcial"), re-clampeamos el monto → evita el error
  // "supera el total" y mantiene el monto coherente con el comprobante.
  useEffect(() => {
    if (value.modo === 'parcial' && value.montoParcial > total) {
      onChange({ ...value, montoParcial: total });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const activo = value.modo !== 'sin_cobro';
  const montoEfectivo =
    value.modo === 'total' ? total : Math.min(value.montoParcial || 0, total);
  const restante = Math.max(0, total - montoEfectivo);

  return (
    <div className="rounded-xl border border-slate-200 bg-brand-zebra/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-ink">
        <Wallet size={15} className="text-brand-cyan" /> Cobrar ahora{' '}
        <span className="text-xs font-normal text-brand-muted">(opcional)</span>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {MODOS.map((m) => (
          <button
            key={m.k}
            type="button"
            onClick={() =>
              set({
                modo: m.k,
                ...(m.k === 'parcial' && !value.montoParcial
                  ? { montoParcial: total }
                  : {}),
              })
            }
            className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${
              value.modo === m.k
                ? 'bg-brand-cyan text-white shadow-sm'
                : 'text-brand-muted hover:text-brand-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {activo && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Caja" required>
              <Select value={value.cajaId} onChange={(e) => set({ cajaId: e.target.value })}>
                <option value="">— Elegí una caja —</option>
                {cajas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.tipo ? ` · ${c.tipo}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha del pago" required>
              <Input
                type="date"
                value={value.fecha}
                onChange={(e) => set({ fecha: e.target.value })}
              />
            </Field>
          </div>

          {value.modo === 'parcial' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Monto a cobrar" required className="col-span-2">
                <Input
                  type="number"
                  step="0.01"
                  min={0.01}
                  max={total}
                  value={value.montoParcial}
                  onChange={(e) => set({ montoParcial: Number(e.target.value) })}
                />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => set({ montoParcial: total })}
                  className="w-full rounded-lg border border-brand-cyan/40 bg-brand-cyan-pale/30 px-2 py-2 text-xs font-medium text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
                >
                  Todo: {fmtMoney(total)}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Categoría" hint="Para agrupar en reportes.">
              <Select
                value={value.categoriaId}
                onChange={(e) => set({ categoriaId: e.target.value })}
              >
                <option value="">— Sin categoría —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            {partners.length > 0 && (
              <Field label="Participa partner" hint="Entra en la rendición del partner.">
                <Select
                  value={value.partnerId}
                  onChange={(e) => set({ partnerId: e.target.value })}
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
          </div>

          <Field label="Referencia" hint="Nº de transferencia, ID Mercado Pago, cheque…">
            <Input
              value={value.referencia}
              onChange={(e) => set({ referencia: e.target.value })}
              placeholder="Sin referencia"
            />
          </Field>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
            <span className="text-brand-muted">
              Cobrás ahora{' '}
              <strong className="text-brand-cyan">{fmtMoney(montoEfectivo)}</strong>
            </span>
            <span className="text-brand-muted">
              Queda pendiente{' '}
              <strong className="text-brand-ink">{fmtMoney(restante)}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
