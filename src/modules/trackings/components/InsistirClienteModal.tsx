// InsistirClienteModal · DGG-133 "poder de insistencia".
// Le recuerda al CLIENTE lo que está pendiente de su lado: crea una línea
// VISIBLE categoría 'recordatorio' (el trigger existente manda un único email
// con este texto + push + aviso del portal — la línea queda en su tracking) y,
// opcionalmente, una línea interna con alerta futura para que la card
// "Alarmas de hoy" nos lo recuerde si sigue sin responder.
// Regla neurálgica: esto es SOLO para el cliente. Las comunicaciones con la
// gestoría van por su propio canal y son siempre internas.
// §6 DGG-133: si se abre DESDE una alarma (alarmaLineaId), la re-alarma
// reprograma ESA alarma (postergar) en vez de crear una línea nueva — si no,
// en N días sonarían dos alarmas por el mismo reclamo y la vieja seguiría
// venciendo todos los días.

import { useState } from 'react';
import { Send, BellPlus } from 'lucide-react';
import { Modal, Button, Field, Textarea, Input } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { insistirCliente, postergarAlarmaLinea } from '@/services/api/trackings';
import { addDiasHabiles } from '@/lib/diasHabiles';

interface Props {
  open: boolean;
  onClose: () => void;
  tramiteId: string;
  tramiteTitulo?: string;
  defaultTexto?: string;
  /** Línea cuya alarma disparó este insistir (desde "Alarmas de hoy"):
   *  la re-alarma posterga ESA línea en vez de crear una nueva. */
  alarmaLineaId?: string;
  onDone?: () => void;
}

export function InsistirClienteModal({
  open, onClose, tramiteId, tramiteTitulo, defaultTexto, alarmaLineaId, onDone,
}: Props) {
  const [texto, setTexto] = useState(defaultTexto ?? '');
  const [reAlarma, setReAlarma] = useState(true);
  const [dias, setDias] = useState('5');
  const [sending, setSending] = useState(false);

  async function handleEnviar() {
    const t = texto.trim();
    if (!t) { toast.error('Escribí el recordatorio para el cliente'); return; }
    // "0"/negativo clampa a 1; solo vacío/no-numérico cae al default 5.
    const nParsed = parseInt(dias, 10);
    const nDias = reAlarma
      ? Math.min(90, Math.max(1, Number.isFinite(nParsed) ? nParsed : 5))
      : null;
    setSending(true);
    const res = await insistirCliente(
      tramiteId,
      t,
      nDias && !alarmaLineaId ? addDiasHabiles(new Date(), nDias).toISOString() : null,
    );
    if (!res.ok) {
      setSending(false);
      toast.error('No pudimos enviar el recordatorio', { description: humanizeError(res.error) });
      return;
    }
    let alarmaFallo = res.data.alarmaFallo;
    if (nDias && alarmaLineaId) {
      const post = await postergarAlarmaLinea(alarmaLineaId, nDias);
      if (!post.ok) alarmaFallo = true;
    }
    setSending(false);
    // El mail YA salió: siempre es éxito (reintentar lo duplicaría). Si la
    // re-alarma falló, se avisa en el mismo toast — nunca dos contradictorios.
    toast.success('Recordatorio enviado al cliente', {
      description: alarmaFallo
        ? 'Pero no pudimos programar la re-alarma — reprogramala a mano desde "Alarmas de hoy" si la necesitás.'
        : nDias
          ? alarmaLineaId
            ? `Le llegó por email, push y portal. La alarma se reprogramó +${nDias} días hábiles.`
            : `Le llegó por email, push y portal. Te lo recordamos de nuevo en ${nDias} días hábiles si no responde.`
          : 'Le llegó por email, push y portal, y quedó en el tracking de su trámite.',
    });
    setTexto('');
    onDone?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="INSISTIR AL CLIENTE"
      title={tramiteTitulo ?? 'Recordatorio al cliente'}
      icon={<Send size={18} />}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Cancelar</Button>
          <Button onClick={() => void handleEnviar()} loading={sending}>
            <Send size={14} /> Enviar recordatorio
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Qué le recordás"
          required
          hint="El cliente lo recibe por email + push y queda como avance visible en el tracking de su trámite."
        >
          <Textarea
            rows={4}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej: Te recordamos que seguimos esperando el Certificado del Curso de Formación para poder avanzar con tu inscripción."
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm transition-colors hover:bg-amber-50">
          <input
            type="checkbox"
            checked={reAlarma}
            onChange={(e) => setReAlarma(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-amber-600 focus:ring-amber-500"
          />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <BellPlus size={13} className="text-amber-600" />
              {alarmaLineaId ? 'Reprogramar la alarma si no responde' : 'Recordármelo si no responde'}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
              <span>{alarmaLineaId ? 'Esta misma alarma suena de nuevo en' : 'Alarma interna en'}</span>
              <Input
                type="number"
                min={1}
                max={90}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                disabled={!reAlarma}
                className="h-7 w-16 px-2 py-1 text-center text-xs"
              />
              <span>
                {alarmaLineaId
                  ? 'días hábiles (no suma otra alarma — el cliente no la ve).'
                  : 'días hábiles (aparece en "Alarmas de hoy" — el cliente no la ve).'}
              </span>
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}
