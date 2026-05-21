import { useEffect, useState } from 'react';
import { Drawer, Button, Field, Input, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  crearEvento,
  AGENDA_CATEGORIAS,
  AGENDA_CATEGORIA_LABEL,
  AGENDA_PRIORIDADES,
  AGENDA_PRIORIDAD_LABEL,
  type AgendaCategoria,
  type AgendaPrioridad,
} from '@/services/api/agenda';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultDate: Date;
  onCreated: () => void;
}

function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function CrearEventoDrawer({ open, onClose, defaultDate, onCreated }: Props) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(() => toLocalInput(defaultDate));
  const [todoElDia, setTodoElDia] = useState(false);
  const [categoria, setCategoria] = useState<AgendaCategoria>('general');
  const [prioridad, setPrioridad] = useState<AgendaPrioridad>('normal');
  const [recordatorio, setRecordatorio] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setFecha(toLocalInput(defaultDate));
  }, [open, defaultDate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) {
      toast.error('Poné un título.');
      return;
    }
    setSaving(true);
    const res = await crearEvento({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      fechaInicio: new Date(fecha),
      todoElDia,
      categoria,
      prioridad,
      recordatorioMinutosAntes: recordatorio,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Evento creado');
    setTitulo('');
    setDescripcion('');
    setRecordatorio(0);
    onCreated();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      kicker="Agenda"
      title="Nuevo evento"
      description="Agendá vencimientos, seguimientos, reuniones o tareas."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button form="form-crear-evento" type="submit" loading={saving}>
            Crear evento
          </Button>
        </div>
      }
    >
      <form id="form-crear-evento" onSubmit={onSubmit} className="space-y-4">
        <Field label="Título" required>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: Renovar matrícula RPAC"
            required
          />
        </Field>
        <Field label="Descripción">
          <Textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={3}
            placeholder="Detalles del evento (opcional)"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fecha y hora" required>
            <Input
              type="datetime-local"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </Field>
          <Field label="Todo el día">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={todoElDia}
                onChange={(e) => setTodoElDia(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
              />
              <span>Sin hora específica</span>
            </label>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoría">
            <Select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as AgendaCategoria)}
            >
              {AGENDA_CATEGORIAS.map((c) => (
                <option key={c} value={c}>{AGENDA_CATEGORIA_LABEL[c]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as AgendaPrioridad)}
            >
              {AGENDA_PRIORIDADES.map((p) => (
                <option key={p} value={p}>{AGENDA_PRIORIDAD_LABEL[p]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Recordatorio (minutos antes)"
          hint="Si > 0, te enviamos una notificación push antes del evento."
        >
          <Select
            value={String(recordatorio)}
            onChange={(e) => setRecordatorio(Number(e.target.value))}
          >
            <option value="0">Sin recordatorio</option>
            <option value="10">10 minutos antes</option>
            <option value="30">30 minutos antes</option>
            <option value="60">1 hora antes</option>
            <option value="1440">1 día antes</option>
          </Select>
        </Field>
      </form>
    </Drawer>
  );
}
