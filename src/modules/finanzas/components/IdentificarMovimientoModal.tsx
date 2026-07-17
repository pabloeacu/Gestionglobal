// JL-W8-3 · Identificar un movimiento bancario pendiente (mig 0360).
// La gerencia reconoce de qué cliente es un ingreso que entró a caja sin
// identificar: elige la administración y, opcionalmente, aplica un monto a un
// comprobante con saldo de ese cliente. La caja NO se re-impacta (ya sumó al
// alta); lo no aplicado queda como Saldo a favor del cliente en su cta.cte.
// Regla 4: queries via services/api. Regla 13: toast/confirm, sin window.*.

import { useEffect, useMemo, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { Button, Field, Input, Modal, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  buscarAdministraciones,
  identificarMovimiento,
  type MovimientoListadoRow,
} from '@/services/api/finanzas';
import { listComprobantesConSaldo, type ComprobanteConSaldo } from '@/services/api/cobranzas';
import { listPartnersActivos, type PartnerOpcion } from '@/services/api/partners';
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
  const [adminSearch, setAdminSearch] = useState('');
  const [admins, setAdmins] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [adminNombre, setAdminNombre] = useState<string>('');
  const [comprobantes, setComprobantes] = useState<ComprobanteConSaldo[]>([]);
  const [compId, setCompId] = useState<string>('');
  const [montoImputar, setMontoImputar] = useState<string>('');
  const [partners, setPartners] = useState<PartnerOpcion[]>([]);
  const [partnerId, setPartnerId] = useState<string>('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void listPartnersActivos().then((p) => { if (p.ok) setPartners(p.data); });
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
    if (!adminId) return;
    void listComprobantesConSaldo(adminId).then((r) => {
      if (r.ok) setComprobantes(r.data);
    });
  }, [adminId]);

  const comp = useMemo(
    () => comprobantes.find((c) => c.id === compId) ?? null,
    [comprobantes, compId],
  );
  const montoNum = Number(montoImputar || 0);
  const aplicar = comp
    ? montoNum > 0
      ? Math.min(montoNum, movimiento.monto, Number(comp.saldo_pendiente))
      : Math.min(movimiento.monto, Number(comp.saldo_pendiente))
    : 0;
  const residual = Math.round((movimiento.monto - aplicar) * 100) / 100;

  async function onSubmit() {
    if (!adminId) { toast.error('Elegí el cliente al que pertenece el ingreso'); return; }
    if (comp && montoNum > 0 && montoNum > Number(comp.saldo_pendiente) + 0.001) {
      toast.error('El monto a aplicar supera el saldo del comprobante');
      return;
    }
    if (comp && montoNum > movimiento.monto + 0.001) {
      toast.error('El monto a aplicar supera el importe del movimiento');
      return;
    }
    setEnviando(true);
    const r = await identificarMovimiento({
      movimientoId: movimiento.id,
      administracionId: adminId,
      comprobanteId: compId || null,
      montoImputar: comp && montoNum > 0 ? montoNum : null,
      partnerIdAtribucion: partnerId || null,
    });
    setEnviando(false);
    if (!r.ok) {
      toast.error('No pudimos identificar el movimiento', { description: humanizeError(r.error) });
      return;
    }
    toast.success(
      `Movimiento identificado como ${adminNombre}` +
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
          <Button onClick={() => void onSubmit()} loading={enviando} disabled={!adminId}>
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
                  placeholder={String(aplicar)}
                  min={0}
                  step="0.01"
                />
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
      </div>
    </Modal>
  );
}
