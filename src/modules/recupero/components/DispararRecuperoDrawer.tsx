import { useState } from 'react';
import { Send, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Drawer, Button, Field, Textarea } from '@/components/common';
import { cn } from '@/lib/cn';
import { formatMoney, comprobanteLabel } from '../lib/format';
import {
  dispararRecuperoManual,
  RECUPERO_NIVEL_LABEL,
  RECUPERO_NIVEL_TONO,
  type MorosoRow,
  type RecuperoNivel,
} from '@/services/api/recupero';

interface Props {
  open: boolean;
  moroso: MorosoRow | null;
  nivelInicial?: RecuperoNivel;
  onClose: () => void;
  onDispatched?: () => void;
}

const TONE_BG: Record<'cyan' | 'amber' | 'red', string> = {
  cyan: 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan',
  amber: 'border-amber-300 bg-amber-50 text-amber-700',
  red: 'border-red-300 bg-red-50 text-red-700',
};

export function DispararRecuperoDrawer({
  open,
  moroso,
  nivelInicial,
  onClose,
  onDispatched,
}: Props) {
  const [nivel, setNivel] = useState<RecuperoNivel>(
    nivelInicial ?? (moroso?.nivel_sugerido ?? 1),
  );
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  // Resync cuando cambia el moroso seleccionado.
  if (open && moroso && nivel == null) {
    setNivel(moroso.nivel_sugerido ?? 1);
  }

  async function handleSubmit() {
    if (!moroso) return;
    setSaving(true);
    const res = await dispararRecuperoManual(
      moroso.comprobante_id,
      nivel,
      obs.trim() || undefined,
    );
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo disparar el recupero: ${res.error.message}`);
      return;
    }
    toast.success(`Recupero ${RECUPERO_NIVEL_LABEL[nivel]} disparado`);
    setObs('');
    onDispatched?.();
    onClose();
  }

  if (!moroso) {
    return (
      <Drawer open={open} onClose={onClose} title="Disparar recupero">
        <p className="text-sm text-brand-muted">Seleccioná un comprobante moroso.</p>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      kicker="Recupero"
      title={`Disparar ${RECUPERO_NIVEL_LABEL[nivel]}`}
      description="Persistirá la acción y encolará el email al cliente."
      icon={<Send className="text-brand-cyan" size={18} />}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            <Send size={14} /> {saving ? 'Disparando…' : 'Disparar recupero'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="card-premium space-y-3 p-4">
          <header>
            <p className="kicker text-brand-cyan">Comprobante moroso</p>
            <h3 className="font-display text-lg font-semibold text-brand-ink">
              {moroso.administracion_nombre}
            </h3>
            {moroso.consorcio_nombre && (
              <p className="text-xs text-brand-muted">{moroso.consorcio_nombre}</p>
            )}
          </header>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Comprobante
              </dt>
              <dd className="font-medium text-brand-ink">
                {comprobanteLabel(moroso.comprobante_tipo, moroso.punto_venta, moroso.comprobante_numero)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Saldo
              </dt>
              <dd className="font-display text-base font-bold text-red-600">
                {formatMoney(Number(moroso.saldo_pendiente))}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Vencimiento
              </dt>
              <dd className="font-medium text-brand-ink">{moroso.vencimiento}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Días vencido
              </dt>
              <dd className="font-medium text-red-600">{moroso.dias_vencido}</dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="kicker mb-2 text-brand-cyan">Nivel a disparar</p>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((n) => {
              const lvl = n as RecuperoNivel;
              const tone = RECUPERO_NIVEL_TONO[lvl];
              const isActive = nivel === lvl;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNivel(lvl)}
                  className={cn(
                    'rounded-2xl border px-3 py-3 text-left text-xs transition',
                    isActive
                      ? TONE_BG[tone]
                      : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/40',
                  )}
                >
                  <p className="font-semibold">{RECUPERO_NIVEL_LABEL[lvl]}</p>
                  <p className="mt-1 text-[10px] text-brand-muted">
                    {n === 1 && 'Tono amistoso.'}
                    {n === 2 && 'Tono firme.'}
                    {n === 3 && 'Intimación / prejudicial.'}
                  </p>
                </button>
              );
            })}
          </div>
          {nivel === 3 && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5" />
              Estás a punto de enviar una intimación prejudicial. Confirmá la deuda
              y los datos antes de continuar.
            </p>
          )}
        </section>

        <Field label="Observaciones (opcional)">
          <Textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            placeholder="Notas internas que quedan en el log de la acción…"
            rows={3}
          />
        </Field>
      </div>
    </Drawer>
  );
}
