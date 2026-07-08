// Paso 3 · Comprobante y registro de cobranza (collect-only).
// Junta: descripción + precio + bonificación (→ total), modo de cobro
// (total/parcial/sin cobro), caja, categoría y partner. Nada se emite hasta el
// ProcesadorFinal. Q3: DDJJ → omitido; gratuito/100% bonif → $0 sin cobranza.

import { useEffect, useState } from 'react';
import { Banknote, Receipt, PiggyBank } from 'lucide-react';
import { Field, Input, Select, StepPanel } from '@/components/common';
import {
  listCajasActivas,
  listCategoriasIngreso,
  listarCreditosAdministracion,
  type CajaRow,
  type CategoriaFinanzaRow,
} from '@/services/api/cobranzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
import { totalComprobante, type ComprobanteState, type PagoModo, type PasoProps } from './types';

function fmtMoney(n: number) {
  return `$${n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function PasoComprobante({ state, set }: PasoProps) {
  const c = state.comprobante;
  const [cajas, setCajas] = useState<CajaRow[]>([]);
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  // E-GG-91 (f · reporte JL): si el cliente ya existe y tiene saldo a favor, se
  // lo avisamos acá — al cobrar un trámite nuevo antes no se reflejaba (audio 1).
  const [saldoAFavor, setSaldoAFavor] = useState(0);

  useEffect(() => {
    const adminId = state.clienteIdExistente;
    if (!adminId) {
      setSaldoAFavor(0);
      return;
    }
    let cancel = false;
    void listarCreditosAdministracion(adminId).then((r) => {
      if (cancel || !r.ok) return;
      setSaldoAFavor(
        r.data.reduce((a, c) => a + Number(c.saldo_disponible ?? 0), 0),
      );
    });
    return () => { cancel = true; };
  }, [state.clienteIdExistente]);

  useEffect(() => {
    void listCajasActivas().then((r) => {
      if (!r.ok) return;
      setCajas(r.data);
      // JL-CAJA: pre-seleccionar la caja favorita si no hay una elegida.
      set((s) => {
        if (s.comprobante.cajaId) return s;
        const def = r.data.find(
          (x) => (x as unknown as { es_default?: boolean }).es_default === true,
        );
        return def ? { ...s, comprobante: { ...s.comprobante, cajaId: def.id } } : s;
      });
    });
    void listCategoriasIngreso().then((r) => {
      if (r.ok) setCategorias(r.data);
    });
    void listPartnersActivos().then((r) => {
      if (r.ok) setPartners(r.data);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchC(patch: Partial<ComprobanteState>) {
    set((s) => ({ ...s, comprobante: { ...s.comprobante, ...patch } }));
  }

  // DDJJ → omitido (Q3).
  if (c.omitir) {
    return (
      <StepPanel
        stepKey="comprobante"
        title="3 · Comprobante y cobranza"
        subtitle="En las DDJJ el comprobante se emite al cerrar el trámite."
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Receipt size={14} className="mr-1 inline" />
          <strong>Se omite el comprobante.</strong> Es una DDJJ: el importe se conoce al
          concluir el trámite, así que el comprobante se emite al cerrarlo.
        </div>
      </StepPanel>
    );
  }

  const total = totalComprobante(c);
  const esCero = c.gratuito || total === 0;

  return (
    <StepPanel
      stepKey="comprobante"
      title="3 · Comprobante y cobranza"
      subtitle="Configurá el comprobante del servicio y, si corresponde, la cobranza. Nada se emite hasta el paso final."
    >
      {/* E-GG-91 (f) · aviso de saldo a favor del cliente al cobrar. */}
      {saldoAFavor > 0 && (
        <div className="mb-4 rounded-xl border-2 border-violet-300/70 bg-violet-50 p-3">
          <p className="text-sm font-semibold text-brand-ink">
            <PiggyBank size={14} className="mr-1 inline text-violet-600" />
            Este cliente tiene {fmtMoney(saldoAFavor)} a favor
          </p>
          <p className="mt-0.5 text-xs text-brand-muted">
            Podés aplicarlo a este comprobante desde su detalle, apenas se cree (botón
            "Aplicar saldo a favor").
          </p>
        </div>
      )}

      {/* Comprobante */}
      <div className="space-y-3">
        <Field label="Descripción del servicio" required>
          <Input
            value={c.descripcion}
            onChange={(e) => patchC({ descripcion: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Precio">
            <Input
              type="number"
              min={0}
              step={0.01}
              value={c.precio}
              onChange={(e) => patchC({ precio: e.target.value })}
            />
          </Field>
          <Field label="Bonificación (%)" hint="0 a 100. Voucher / convenio.">
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={c.bonifPorc}
              onChange={(e) => patchC({ bonifPorc: e.target.value })}
            />
          </Field>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <span className="text-brand-muted">Total del comprobante: </span>
          <strong className="text-brand-ink">{fmtMoney(total)}</strong>
        </div>
      </div>

      {/* Cobranza */}
      {esCero ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <strong>Comprobante en $0.</strong> Servicio gratuito o 100% bonificado: queda en
          el historial del cliente, sin registrar cobranza.
        </div>
      ) : (
        <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-brand-ink">
            <Banknote size={14} className="mr-1 inline" /> Cobranza
          </p>
          <Field label="¿Cómo se cobra?">
            <Select
              value={c.pagoModo}
              onChange={(e) => patchC({ pagoModo: e.target.value as PagoModo })}
            >
              <option value="total">Pago total ({fmtMoney(total)})</option>
              <option value="parcial">Pago parcial</option>
              <option value="ninguno">Sin cobro ahora (queda impago)</option>
            </Select>
          </Field>

          {c.pagoModo === 'parcial' && (
            <Field label="Monto cobrado" required>
              <Input
                type="number"
                min={0}
                max={total}
                step={0.01}
                value={c.montoCobrado}
                onChange={(e) => patchC({ montoCobrado: e.target.value })}
              />
            </Field>
          )}

          {c.pagoModo !== 'ninguno' && (
            <>
              <Field label="Caja" required>
                <Select value={c.cajaId} onChange={(e) => patchC({ cajaId: e.target.value })}>
                  <option value="">— elegí —</option>
                  {cajas.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              {categorias.length > 0 && (
                <Field label="Categoría" hint="Opcional. Para agrupar en reportes.">
                  <Select
                    value={c.categoriaId}
                    onChange={(e) => patchC({ categoriaId: e.target.value })}
                  >
                    <option value="">— Sin categoría —</option>
                    {categorias.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}

          {partners.length > 0 && (
            <Field
              label="Participa partner"
              hint="Si lo marcás, el pago entra en la rendición del partner y lo habilita a facturar."
            >
              <Select
                value={c.partnerId ?? ''}
                onChange={(e) =>
                  patchC({
                    partnerId: e.target.value || null,
                    compartePartner: !!e.target.value,
                  })
                }
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
      )}
    </StepPanel>
  );
}
