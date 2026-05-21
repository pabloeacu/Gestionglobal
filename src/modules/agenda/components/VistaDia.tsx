// VistaDia — reusa VistaSemana con modo='dia'.
import { VistaSemana } from './VistaSemana';
import type {
  AgendaCategoria,
  AgendaEvento,
  AgendaOverride,
  OcurrenciaUnificada,
} from '@/services/api/agenda';
import type { Ocurrencia } from '@/lib/agendaRecurrencia';

interface Props {
  anchor: Date;
  eventos: AgendaEvento[];
  overrides: AgendaOverride[];
  categorias: AgendaCategoria[];
  proyectadas?: OcurrenciaUnificada[];
  onAbrirAcciones: (oc: Ocurrencia, x: number, y: number) => void;
  onToggleDone: (oc: Ocurrencia) => void;
  onMover: (oc: Ocurrencia, newStart: Date, newEnd: Date | null) => void;
  onCrearEnFranja: (startISO: string, endISO: string) => void;
  onAbrirProyectada?: (p: OcurrenciaUnificada) => void;
}

export function VistaDia(props: Props) {
  return <VistaSemana {...props} modo="dia" />;
}
