// Paso 4 · Derivación a gestoría externa (OPCIONAL · switch maestro).
// Collect-only: junta email/nombre/observaciones/monto/caja/adjuntos/TTL. El
// correo a la gestoría y el egreso en caja se ejecutan en el ProcesadorFinal
// (diferido, no inmediato como en el wizard viejo). Los adjuntos sí se suben al
// bucket ahora (para tener el path), igual que antes.

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Field, Input, Select, StepPanel, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  uploadAdjuntoGestoria,
  listGestoriaDestinatarios,
  type GestoriaDestinatario,
} from '@/services/api/solicitudes';
import { getCajasConSaldo, type CajaConSaldoRow } from '@/services/api/finanzas';
import { humanizeError } from '@/lib/errors';
import type { GestoriaState, PasoProps } from './types';

export function PasoGestoria({ solicitud, state, set }: PasoProps) {
  const g = state.gestoria;
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  // Finding D (JL): memoria de gestorías usadas antes → autocompletar el email.
  const [destinatarios, setDestinatarios] = useState<GestoriaDestinatario[]>([]);
  // Último nombre que auto-rellenamos: si el nombre actual sigue siendo ese,
  // es "auto" y podemos re-alinearlo al cambiar de gestoría; si el gerente lo
  // editó a mano, quedará distinto y nunca lo pisamos.
  const autoNombreRef = useRef('');

  useEffect(() => {
    void getCajasConSaldo().then((r) => {
      if (!r.ok) return;
      setCajas(r.data);
      set((s) => {
        if (s.gestoria.cajaId) return s;
        const def = r.data.find(
          (c) => (c as unknown as { es_default?: boolean }).es_default === true,
        );
        return def ? { ...s, gestoria: { ...s.gestoria, cajaId: def.caja_id } } : s;
      });
    });
    void listGestoriaDestinatarios().then(setDestinatarios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchG(patch: Partial<GestoriaState>) {
    set((s) => ({ ...s, gestoria: { ...s.gestoria, ...patch } }));
  }

  const montoNum = parseFloat((g.montoGestoria || '').replace(',', '.'));
  const hayMonto = !isNaN(montoNum) && montoNum > 0;

  return (
    <StepPanel
      stepKey="gestoria"
      title="4 · Derivación a gestoría"
      subtitle="Opcional. Si lo activás, al final le mandamos a la gestoría un correo con la documentación y un acceso seguro (sin login). El egreso del pago también se registra al final."
    >
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span>
          <span className="block text-sm font-semibold text-brand-ink">
            <Send size={14} className="mr-1 inline" /> Derivar a una gestoría externa
          </span>
          <span className="mt-0.5 block text-xs text-brand-muted">
            Si no lo activás, este paso se saltea.
          </span>
        </span>
        <input
          type="checkbox"
          checked={g.activa}
          onChange={(e) => patchG({ activa: e.target.checked })}
          className="h-5 w-5 accent-brand-cyan"
        />
      </label>

      {g.activa && (
        <div className="mt-4 space-y-3">
          <Field label="Email del gestor" required>
            <Input
              type="email"
              list="gestoria-destinatarios"
              value={g.email}
              onChange={(e) => {
                const email = e.target.value;
                const hit = destinatarios.find(
                  (d) => d.email.toLowerCase() === email.trim().toLowerCase(),
                );
                // Rellenamos/re-alineamos el nombre si eligió una gestoría
                // conocida y el nombre está vacío o sigue siendo el que
                // pusimos automáticamente. Si lo editó a mano, no lo tocamos.
                const nombreEsAutoOVacio =
                  !g.nombre.trim() || g.nombre === autoNombreRef.current;
                if (hit?.nombre && nombreEsAutoOVacio) {
                  autoNombreRef.current = hit.nombre;
                  patchG({ email, nombre: hit.nombre });
                } else {
                  patchG({ email });
                }
              }}
              placeholder="gestoria@ejemplo.com"
            />
            {destinatarios.length > 0 && (
              <>
                <datalist id="gestoria-destinatarios">
                  {destinatarios.map((d) => (
                    <option key={d.email} value={d.email}>
                      {d.nombre || ''}
                    </option>
                  ))}
                </datalist>
                <p className="mt-1 text-[11px] text-brand-muted">
                  Sugerencias: gestorías que ya usaste antes.
                </p>
              </>
            )}
          </Field>
          <Field label="Nombre del gestor (opcional)">
            <Input
              value={g.nombre}
              onChange={(e) => patchG({ nombre: e.target.value })}
              placeholder="Lic. María Pérez"
            />
          </Field>
          <Field label="Observaciones para la gestoría">
            <Textarea
              rows={3}
              value={g.observaciones}
              onChange={(e) => patchG({ observaciones: e.target.value })}
              placeholder="Detalles del caso, urgencia, foco específico…"
            />
          </Field>

          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              Interno · no visible al cliente
            </p>
            <Field label="Monto que paga la empresa a la gestoría">
              <div className="flex items-center gap-2">
                <span className="text-sm text-brand-muted">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={g.montoGestoria}
                  onChange={(e) => patchG({ montoGestoria: e.target.value })}
                  placeholder="0.00"
                  className="w-40"
                />
                <span className="text-[11px] text-brand-muted">
                  Vacío = no se factura un pago a la gestoría.
                </span>
              </div>
            </Field>
            {hayMonto && (
              <Field label="Caja que paga el egreso">
                <Select value={g.cajaId} onChange={(e) => patchG({ cajaId: e.target.value })}>
                  <option value="">— No imputar a ninguna caja —</option>
                  {cajas.map((c) => (
                    <option key={c.caja_id} value={c.caja_id}>
                      {c.nombre} (saldo: ${Number(c.saldo).toLocaleString('es-AR')})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Adjuntos para la gestoría">
              <input
                type="file"
                multiple
                disabled={subiendo}
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length === 0) return;
                  setSubiendo(true);
                  const subidos = [...g.adjuntos];
                  for (const f of files) {
                    const r = await uploadAdjuntoGestoria(solicitud.id, f);
                    if (r.ok) subidos.push(r.data);
                    else
                      toast.error(`No pudimos subir ${f.name}`, {
                        description: humanizeError(r.error),
                      });
                  }
                  patchG({ adjuntos: subidos });
                  setSubiendo(false);
                }}
                className="text-xs"
              />
              {g.adjuntos.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {g.adjuntos.map((a, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between rounded border border-amber-200 bg-white px-2 py-1 text-[11px]"
                    >
                      <span className="truncate">📎 {a.filename}</span>
                      <button
                        type="button"
                        onClick={() => patchG({ adjuntos: g.adjuntos.filter((_, j) => j !== i) })}
                        className="ml-2 text-brand-muted hover:text-red-600"
                        title="Quitar"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          </div>

          <Field label="Validez del enlace (días)">
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={365}
                value={g.diasValidez}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  patchG({ diasValidez: isNaN(n) ? 14 : Math.min(365, Math.max(1, n)) });
                }}
                className="w-28"
              />
              <span className="text-xs text-brand-muted">Default 14. Rango 1-365.</span>
            </div>
          </Field>
        </div>
      )}
    </StepPanel>
  );
}
