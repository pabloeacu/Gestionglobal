// ============================================================================
// ProgramarVencimientosRpacModal · DGG-159 (pedido Pablo)
//
// Al cerrar una inscripción/renovación RPAC, JL carga la FECHA DE MATRICULACIÓN
// (la fecha en que el organismo otorgó/renovó la matrícula) y el sistema propone
// automáticamente las fechas de los 3 vencimientos, cada una EDITABLE:
//   · Renovación de matrícula — anual (matriculación + 12 meses).
//   · DDJJ anual — vence en MARZO (para todos); aviso desde 60 días antes.
//   · Curso de actualización — anual (matriculación + 12 meses).
//
// Al confirmar → RPC tracking_programar_vencimientos_rpac (mig 0465), que valida
// que las 3 fechas sean futuras y persiste atómico (renovación vía la ficha; DDJJ
// y curso como filas tipadas). Las alarmas de cada tipo son automáticas (canon):
// renovación/curso {45,30,15}, DDJJ {60,30,15}. El offset por-vencimiento se puede
// ajustar luego desde el panel "Próximas alarmas" del detalle.
// ============================================================================
import { useEffect, useState } from 'react';
import { CalendarClock, Check, RefreshCw, FileText, GraduationCap } from 'lucide-react';
import { Button, Field, Input, Modal } from '@/components/common';
import { toast } from '@/lib/toast';
import { hoyISO, toISODate } from '@/lib/dates';
import { programarVencimientosRpac } from '@/services/api/trackings';
import { humanizeError } from '@/lib/errors';

interface ProgramarVencimientosRpacModalProps {
  open: boolean;
  onClose: () => void;
  trackingId: string;
  trackingTitulo?: string;
  onProgramado?: () => void;
}

// Suma meses conservando el día (mediodía para no cruzar de día por zona horaria).
function sumarMeses(iso: string, meses: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setMonth(d.getMonth() + meses);
  return toISODate(d);
}

// Próximo 31 de marzo estrictamente posterior a la fecha base (DDJJ vence en marzo).
function proximoMarzo(iso: string): string {
  const base = new Date(iso + 'T12:00:00');
  let target = new Date(base.getFullYear(), 2, 31, 12, 0, 0);
  if (target <= base) target = new Date(base.getFullYear() + 1, 2, 31, 12, 0, 0);
  return toISODate(target);
}

function fmtLarga(iso: string): string {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-AR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

export function ProgramarVencimientosRpacModal({
  open,
  onClose,
  trackingId,
  trackingTitulo,
  onProgramado,
}: ProgramarVencimientosRpacModalProps) {
  const [fechaMatric, setFechaMatric] = useState<string>(() => hoyISO());
  const [fechaReno, setFechaReno] = useState<string>('');
  const [fechaDdjj, setFechaDdjj] = useState<string>('');
  const [fechaCurso, setFechaCurso] = useState<string>('');
  const [notificar, setNotificar] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Al abrir: matriculación = hoy y recalcular las 3 sugeridas.
  useEffect(() => {
    if (!open) return;
    const base = hoyISO();
    setFechaMatric(base);
    setFechaReno(sumarMeses(base, 12));
    setFechaDdjj(proximoMarzo(base));
    setFechaCurso(sumarMeses(base, 12));
    setNotificar(true);
    setSubmitting(false);
  }, [open]);

  // Cambiar la fecha de matriculación recalcula las 3 sugerencias (JL puede
  // después editar cada una a mano con su propio campo).
  function onChangeMatric(v: string) {
    setFechaMatric(v);
    if (v) {
      setFechaReno(sumarMeses(v, 12));
      setFechaDdjj(proximoMarzo(v));
      setFechaCurso(sumarMeses(v, 12));
    }
  }

  async function handleProgramar() {
    if (!fechaMatric) {
      toast.error('Cargá la fecha de matriculación.');
      return;
    }
    const hoy = hoyISO();
    const futuras: Array<[string, string]> = [
      ['renovación', fechaReno],
      ['DDJJ', fechaDdjj],
      ['curso de actualización', fechaCurso],
    ];
    for (const [nombre, f] of futuras) {
      if (!f) {
        toast.error(`Falta la fecha de ${nombre}.`);
        return;
      }
      if (f <= hoy) {
        toast.error(`La fecha de ${nombre} debe ser futura.`);
        return;
      }
    }
    setSubmitting(true);
    const res = await programarVencimientosRpac({
      trackingId,
      fechaMatriculacion: fechaMatric,
      fechaRenovacion: fechaReno,
      fechaDdjj,
      fechaCurso,
      notificar,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Vencimientos RPAC programados · renovación, DDJJ y curso en la agenda');
    onProgramado?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Programar vencimientos RPAC"
      kicker={trackingTitulo ? `Trámite · ${trackingTitulo}` : 'Trámite'}
      icon={<CalendarClock className="h-5 w-5 text-brand-cyan" />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={() => void handleProgramar()} disabled={submitting}>
            <Check className="h-4 w-4" /> {submitting ? 'Programando…' : 'Programar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field
          label="Fecha de matriculación"
          hint="La fecha en que el organismo otorgó/renovó la matrícula. Desde acá se calculan las alarmas."
        >
          <Input type="date" value={fechaMatric} onChange={(e) => onChangeMatric(e.target.value)} />
        </Field>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-brand-ink">Alarmas a programar</p>
          <p className="-mt-1 text-xs text-brand-muted">
            Sugeridas automáticamente desde la matriculación. Editá la fecha que quieras.
          </p>

          <VencFila
            icon={<RefreshCw size={15} className="text-brand-cyan" />}
            titulo="Renovación de matrícula"
            regla="Anual · aviso 45/30/15 días antes"
            value={fechaReno}
            min={hoyISO()}
            onChange={setFechaReno}
          />
          <VencFila
            icon={<FileText size={15} className="text-brand-cyan" />}
            titulo="DDJJ anual"
            regla="Vence en marzo · aviso desde 60 días antes"
            value={fechaDdjj}
            min={hoyISO()}
            onChange={setFechaDdjj}
          />
          <VencFila
            icon={<GraduationCap size={15} className="text-brand-cyan" />}
            titulo="Curso de actualización"
            regla="Anual · aviso 45/30/15 días antes"
            value={fechaCurso}
            min={hoyISO()}
            onChange={setFechaCurso}
          />
        </div>

        <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={notificar}
            onChange={(e) => setNotificar(e.target.checked)}
            className="h-4 w-4 accent-brand-cyan"
          />
          <span className="flex-1">
            <span className="font-medium text-brand-ink">Notificar al administrador</span>
            <span className="block text-xs text-brand-muted">
              Cada alarma envía push interno + aviso al cliente cuando corresponda.
            </span>
          </span>
        </label>

        <p className="text-xs text-brand-muted">
          Se van a programar 3 alarmas: renovación el {fmtLarga(fechaReno)}, DDJJ el{' '}
          {fmtLarga(fechaDdjj)} y curso el {fmtLarga(fechaCurso)}. Podés ajustar cada
          cronograma después desde “Próximas alarmas”.
        </p>
      </div>
    </Modal>
  );
}

function VencFila({
  icon,
  titulo,
  regla,
  value,
  min,
  onChange,
}: {
  icon: React.ReactNode;
  titulo: string;
  regla: string;
  value: string;
  min: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-cyan/10">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-brand-ink">{titulo}</p>
        <p className="truncate text-xs text-brand-muted">{regla}</p>
      </div>
      <Input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="!w-40"
      />
    </div>
  );
}

export default ProgramarVencimientosRpacModal;
