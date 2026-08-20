import { useState } from 'react';
import { toast } from '@/lib/toast';
import { Drawer, Button, Field, Select, Textarea } from '@/components/common';
import {
  agregarLinea,
  type TrackingCategoriaConfigRow,
  type TrackingEstadoConfigRow,
} from '@/services/api/trackings';
import { crearPedidoDoc } from '@/services/api/tramitePedidosDoc';
import { humanizeError } from '@/lib/errors';
import { addDiasHabiles } from '@/lib/diasHabiles';

export interface AgregarLineaDrawerProps {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  categorias: TrackingCategoriaConfigRow[];
  estados: TrackingEstadoConfigRow[];
  permiteCambiarEstado: boolean;  // staff = true
  onSaved: () => void;
}

export function AgregarLineaDrawer({
  open,
  onClose,
  trackingId,
  categorias,
  estados,
  permiteCambiarEstado,
  onSaved,
}: AgregarLineaDrawerProps) {
  const [categoria, setCategoria] = useState<string>(categorias[0]?.slug ?? 'seguimiento_interno');
  const [descripcion, setDescripcion] = useState('');
  const [estadoAsociado, setEstadoAsociado] = useState<string>('');
  const [archivosTxt, setArchivosTxt] = useState('');
  const [alertaEn, setAlertaEn] = useState('');
  const [visibleCliente, setVisibleCliente] = useState(false);
  // Doc JL 2026-07-12 (hilo "línea de avance" + caso "Número de Legajo"): si
  // la línea le PIDE algo al cliente, el cliente necesita poder responder y/o
  // adjuntar. En vez de inventar otro canal, la línea se convierte en un
  // Pedido de documentación (misma fuente de verdad): la RPC crea la línea
  // visible, avisa al cliente (portal + push + email) y le habilita el panel
  // de respuesta/adjuntos en su gestión.
  const [requiereRespuesta, setRequiereRespuesta] = useState(false);
  // DGG-133 · "la pelota del otro lado": alarma opcional de seguimiento del
  // pedido de documentación — línea INTERNA con alerta futura (el cliente no
  // la ve; aparece en "Alarmas de hoy" si no respondió).
  const [alarmaPedidoDias, setAlarmaPedidoDias] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setCategoria(categorias[0]?.slug ?? 'seguimiento_interno');
    setDescripcion('');
    setEstadoAsociado('');
    setArchivosTxt('');
    setAlertaEn('');
    setVisibleCliente(false);
    setRequiereRespuesta(false);
    setAlarmaPedidoDias('');
  }

  async function handleSave() {
    if (!descripcion.trim()) {
      toast.error('La descripción es obligatoria');
      return;
    }
    setSaving(true);

    // Modo "requiere respuesta": delega TODO en el pedido de documentación
    // (crea su propia línea visible + notifica). No creamos línea duplicada.
    if (requiereRespuesta) {
      // JL-R3 §6 (parity con ModeracionPage): NO pasar el texto como descripción
      // Y como ítem — se veía duplicado en el portal (header del pedido == ítem).
      // El texto va como único ítem; el header queda en el default limpio. El
      // mail/campanita usan el fallback a ítems (mig 0431) para no quedar vacíos.
      const res = await crearPedidoDoc(trackingId, '', [descripcion.trim()]);
      if (!res.ok) {
        setSaving(false);
        toast.error(humanizeError(res.error));
        return;
      }
      // DGG-133 · alarma opcional de seguimiento (línea interna: el cliente
      // no la ve, no dispara ningún aviso — solo entra a "Alarmas de hoy").
      const dias = parseInt(alarmaPedidoDias, 10);
      let alarmaOk = true;
      if (dias >= 1) {
        const alarma = await agregarLinea(trackingId, {
          categoria: 'seguimiento_interno',
          descripcion: `Seguimiento del pedido de documentación: "${descripcion.trim().slice(0, 140)}" — insistir si el cliente no respondió.`,
          visible_cliente: false,
          alerta_en: addDiasHabiles(new Date(), Math.min(90, dias)).toISOString(),
        });
        alarmaOk = alarma.ok;
      }
      setSaving(false);
      // §6 DGG-133: UN solo toast coherente — si la alarma falló, el éxito del
      // pedido no puede prometer el recordatorio que acaba de fallar.
      toast.success('Pedido enviado al cliente', {
        description: dias >= 1
          ? alarmaOk
            ? `Le avisamos por portal, push y email. Te lo recordamos en ${Math.min(90, dias)} días hábiles si no responde.`
            : 'Le avisamos por portal, push y email — pero no pudimos crear la alarma de seguimiento; creala a mano si la necesitás.'
          : 'Le avisamos por portal, push y email. Puede responder y adjuntar desde su gestión.',
      });
      reset();
      onSaved();
      onClose();
      return;
    }

    const urls = archivosTxt
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const res = await agregarLinea(trackingId, {
      categoria,
      descripcion: descripcion.trim(),
      estado_asociado: permiteCambiarEstado && estadoAsociado ? estadoAsociado : null,
      archivos_urls: urls,
      alerta_en: alertaEn ? new Date(alertaEn).toISOString() : null,
      visible_cliente: visibleCliente,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Línea agregada');
    reset();
    onSaved();
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Agregar línea al tracking" width={520}>
      <div className="space-y-4">
        {!requiereRespuesta && (
          <Field label="Categoría" required>
            <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {categorias.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Descripción" required>
          <Textarea
            rows={5}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder={
              requiereRespuesta
                ? 'Qué necesitás que el cliente responda o adjunte… (ej: "El Número de Legajo está mal, reenvialo por favor")'
                : 'Describí el avance, la observación, el contacto realizado…'
            }
          />
        </Field>

        {/* Doc JL: pedirle algo al cliente → se transforma en Pedido de
            documentación (el cliente puede responder texto y/o adjuntar). */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm transition-colors hover:bg-amber-50">
          <input
            type="checkbox"
            checked={requiereRespuesta}
            onChange={(e) => {
              setRequiereRespuesta(e.target.checked);
              // §6 DGG-133: al destildar se limpia el N de días — el drawer no se
              // desmonta al cerrar y un valor viejo re-crearía la alarma sin querer.
              if (!e.target.checked) setAlarmaPedidoDias('');
            }}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-amber-600 focus:ring-amber-500"
          />
          <div className="flex-1">
            <div className="font-semibold text-slate-800">
              El cliente debe responder o adjuntar algo
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-slate-600">
              Se crea un <strong>pedido de documentación</strong>: el cliente recibe
              aviso (portal + push + email) y puede <strong>responder por texto o
              subir archivos</strong> desde su gestión. Cuando envía, te llega el
              aviso y aparece en el Inicio.
            </div>
            {requiereRespuesta && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <span>Alarma de seguimiento en</span>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={alarmaPedidoDias}
                  onChange={(e) => setAlarmaPedidoDias(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="—"
                  className="h-7 w-14 rounded-md border border-slate-300 px-2 text-center text-xs focus:border-amber-500 focus:outline-none"
                />
                <span>días hábiles (opcional — interna, el cliente no la ve).</span>
              </div>
            )}
          </div>
        </label>

        {!requiereRespuesta && permiteCambiarEstado && (
          <Field
            label="Cambiar estado del tracking (opcional)"
            hint="Para CANCELAR el trámite usá el botón “Cancelar trámite” (deja lo pagado como saldo a favor)."
          >
            <Select value={estadoAsociado} onChange={(e) => setEstadoAsociado(e.target.value)}>
              <option value="">No cambiar</option>
              {/* DGG-95 · 'cancelado' se saca de acá: cancelar debe pasar por la cascada
                  (anular comprobante → saldo a favor), no ser un efecto lateral de una línea. */}
              {estados
                .filter((e) => e.slug !== 'cancelado')
                .map((e) => (
                  <option key={e.id} value={e.slug}>
                    {e.label}
                  </option>
                ))}
            </Select>
          </Field>
        )}

        {!requiereRespuesta && (
          <>
            <Field label="Adjuntos (1 URL por línea, opcional)">
              <Textarea
                rows={3}
                value={archivosTxt}
                onChange={(e) => setArchivosTxt(e.target.value)}
                placeholder="https://…"
              />
            </Field>

            <Field
              label="Alerta futura (opcional)"
              hint="Si completás una fecha futura, se enviará un email de recordatorio."
            >
              <input
                type="datetime-local"
                value={alertaEn}
                onChange={(e) => setAlertaEn(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-200"
              />
            </Field>

            {/* ¿El cliente lo ve? — encola push + email al cliente con template
                tracking-avance-cliente. Default false = nota interna. */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-cyan-200 bg-cyan-50/50 p-3 text-sm hover:bg-cyan-50 transition-colors">
              <input
                type="checkbox"
                checked={visibleCliente}
                onChange={(e) => setVisibleCliente(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
              />
              <div className="flex-1">
                <div className="font-semibold text-slate-800">¿El cliente lo ve?</div>
                <div className="mt-0.5 text-xs leading-relaxed text-slate-600">
                  Si lo activás, esta línea aparece en el portal del cliente y le llega
                  <strong> aviso push + email</strong> al instante. Si lo dejás vacío,
                  queda como nota interna del equipo.
                </div>
              </div>
            </label>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving
              ? 'Guardando…'
              : requiereRespuesta
                ? 'Enviar pedido al cliente'
                : 'Agregar línea'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
