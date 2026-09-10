// ============================================================================
// CargarOtorgamientoModal · DGG-161 (pedido Pablo)
//
// Carga MANUAL por gerencia del otorgamiento de matrícula RPAC, cuando no vino
// por moderación de gestoría. Espeja los 4 campos del otorgamiento de la gestoría
// (matrícula, legajo, emisión, vencimiento) y los guarda en la ficha del cliente
// vía la RPC tracking_cargar_otorgamiento (mig 0466), con la misma semántica
// COALESCE. Setear el vencimiento arma sola la alarma de renovación {45,30,15}.
//
//   · Matriculación (inscripción): matrícula + legajo se cargan por PRIMERA vez
//     acá (obligatorios), más emisión + vencimiento.
//   · Renovación: la matrícula + el legajo YA están en la ficha (sin eso el
//     trámite no se puede iniciar) → se muestran de solo-lectura; lo nuevo es la
//     emisión y el vencimiento del nuevo ciclo.
//   · El vencimiento es SIEMPRE obligatorio.
//
// Al guardar, el padre encadena: (3) ofrecer avisar al cliente (avance visible),
// (4) ofrecer cerrar + programar los próximos vencimientos con estas fechas.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Award, Check } from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import { hoyISO } from '@/lib/dates';
import { cargarOtorgamiento, type OtorgamientoFicha } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

interface CargarOtorgamientoModalProps {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  /** 'matricula' (inscripción, carga por primera vez) | 'renovacion' (matrícula/legajo ya en ficha). */
  categoria: 'matricula' | 'renovacion';
  trackingTitulo?: string;
  /** Valores actuales de la ficha (para pre-llenar/mostrar en renovación). */
  fichaMatricula?: string | null;
  fichaLegajo?: string | null;
  /** Se llama tras guardar OK, con la ficha resultante y las fechas ingresadas. */
  onCargado: (ficha: OtorgamientoFicha, fechas: { emision: string; vencimiento: string }) => void;
}

export function CargarOtorgamientoModal({
  open,
  onClose,
  trackingId,
  categoria,
  trackingTitulo,
  fichaMatricula,
  fichaLegajo,
  onCargado,
}: CargarOtorgamientoModalProps) {
  const esRenovacion = categoria === 'renovacion';

  const [matricula, setMatricula] = useState('');
  const [legajo, setLegajo] = useState('');
  const [emision, setEmision] = useState('');
  const [vencimiento, setVencimiento] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMatricula(esRenovacion ? (fichaMatricula ?? '') : '');
    setLegajo(esRenovacion ? (fichaLegajo ?? '') : '');
    setEmision('');
    setVencimiento('');
    setSubmitting(false);
  }, [open, esRenovacion, fichaMatricula, fichaLegajo]);

  const fechasIncoherentes = useMemo(
    () => !!emision && !!vencimiento && vencimiento < emision,
    [emision, vencimiento],
  );

  const puedeGuardar =
    !submitting &&
    vencimiento !== '' &&
    !fechasIncoherentes &&
    (esRenovacion || (matricula.trim() !== '' && legajo.trim() !== ''));

  async function handleGuardar() {
    if (!puedeGuardar) {
      if (!vencimiento) toast.error('La fecha de vencimiento es obligatoria.');
      else if (fechasIncoherentes) toast.error('El vencimiento no puede ser anterior a la emisión.');
      else toast.error('Cargá el número de matrícula y el legajo.');
      return;
    }
    setSubmitting(true);
    const res = await cargarOtorgamiento({
      trackingId,
      // En renovación la matrícula/legajo ya están en la ficha → no se re-cargan.
      matricula: esRenovacion ? null : matricula.trim(),
      legajo: esRenovacion ? null : legajo.trim(),
      fechaEmision: emision || null,
      fechaVencimiento: vencimiento,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Otorgamiento guardado en la ficha del cliente');
    onCargado(res.data, { emision, vencimiento });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cargar otorgamiento"
      kicker={trackingTitulo ? `Trámite · ${trackingTitulo}` : 'Trámite'}
      icon={<Award className="h-5 w-5 text-brand-cyan" />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleGuardar()} disabled={!puedeGuardar}>
            <Check className="h-4 w-4" /> {submitting ? 'Guardando…' : 'Guardar en la ficha'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-brand-muted">
          {esRenovacion
            ? 'La matrícula y el legajo ya están en la ficha; cargá la emisión y el vencimiento del nuevo período.'
            : 'Cargá el otorgamiento que informa el organismo. Se asienta en la ficha del cliente.'}
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nº de matrícula" hint={esRenovacion ? 'Ya cargado en la ficha' : 'Obligatorio'}>
            <Input
              value={matricula}
              onChange={(e) => setMatricula(e.target.value)}
              maxLength={40}
              disabled={esRenovacion}
              placeholder="Ej.: 1454"
            />
          </Field>
          <Field label="Nº de legajo" hint={esRenovacion ? 'Ya cargado en la ficha' : 'Obligatorio'}>
            <Input
              value={legajo}
              onChange={(e) => setLegajo(e.target.value)}
              maxLength={40}
              disabled={esRenovacion}
              placeholder="Ej.: 284328"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Fecha de emisión" hint="Opcional · desde acá se calcula el cronograma.">
            <Input type="date" value={emision} min="1990-01-01" max="2100-12-31" onChange={(e) => setEmision(e.target.value)} />
          </Field>
          <Field label="Fecha de vencimiento" hint="Obligatorio · arma la alarma de renovación.">
            <Input
              type="date"
              value={vencimiento}
              min={emision || '1990-01-01'}
              max="2100-12-31"
              onChange={(e) => setVencimiento(e.target.value)}
            />
          </Field>
        </div>

        {fechasIncoherentes && (
          <p className="text-xs font-medium text-rose-600">
            El vencimiento no puede ser anterior a la emisión.
          </p>
        )}
        {!!vencimiento && vencimiento <= hoyISO() && (
          <p className="text-xs text-amber-600">
            Ojo: el vencimiento es hoy o pasado → la matrícula quedaría vencida y no se agenda alarma futura.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default CargarOtorgamientoModal;
