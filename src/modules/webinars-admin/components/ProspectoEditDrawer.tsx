import { useEffect, useState, type FormEvent } from 'react';
import { UserPen, Save } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  actualizarProspecto,
  type ProspectoRow,
} from '@/services/api/webinars';

// DEEP-2 · Drawer para editar nombre/email/teléfono de un prospecto.
// Cierra el GAP detectado en la auditoría: si un prospecto entra desde un
// formulario público con email mal escrito, hasta acá no había forma de
// corregirlo sin tocar la BD.

interface ProspectoEditDrawerProps {
  open: boolean;
  prospecto: ProspectoRow | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  nombre: string;
  email: string;
  telefono: string;
}

const EMPTY: FormState = { nombre: '', email: '', telefono: '' };

function rowToForm(r: ProspectoRow): FormState {
  return {
    nombre: r.nombre,
    email: r.email,
    telefono: r.telefono ?? '',
  };
}

function isDirty(form: FormState, original: FormState): boolean {
  return (
    form.nombre.trim() !== original.nombre.trim() ||
    form.email.trim() !== original.email.trim() ||
    form.telefono.trim() !== original.telefono.trim()
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ProspectoEditDrawer({
  open,
  prospecto,
  onClose,
  onSaved,
}: ProspectoEditDrawerProps) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [original, setOriginal] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});

  // Reset form on open / when prospecto changes
  useEffect(() => {
    if (open && prospecto) {
      const initial = rowToForm(prospecto);
      setForm(initial);
      setOriginal(initial);
      setErrors({});
    }
  }, [open, prospecto?.id]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {};
    if (!form.nombre.trim()) errs.nombre = 'Requerido';
    // Email puede quedar vacío (si lo borran), pero si tiene valor debe ser válido
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
      errs.email = 'Email inválido';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleClose() {
    if (saving) return;
    if (isDirty(form, original)) {
      const okBtn = await confirm({
        title: '¿Descartar cambios?',
        message: 'Vas a perder los cambios que hiciste en este prospecto.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        danger: true,
      });
      if (!okBtn) return;
    }
    onClose();
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!prospecto) return;
    if (!validate()) return;

    setSaving(true);
    const res = await actualizarProspecto(prospecto.id, {
      nombre: form.nombre.trim(),
      email: form.email.trim(),
      telefono: form.telefono.trim() || null,
    });
    setSaving(false);

    if (!res.ok) {
      toast.error('No pudimos actualizar el prospecto', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Prospecto actualizado');
    onSaved();
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={520}
      kicker="Editar"
      title={prospecto?.nombre ?? 'Prospecto'}
      description="Corregí los datos de contacto si entraron mal desde el formulario."
      icon={<UserPen size={20} />}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="prospecto-edit-form" loading={saving}>
            <Save size={15} /> Guardar
          </Button>
        </>
      }
    >
      <form id="prospecto-edit-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Nombre" required error={errors.nombre}>
          <Input
            value={form.nombre}
            onChange={(e) => setField('nombre', e.target.value)}
            placeholder="Nombre y apellido"
            autoFocus
            required
          />
        </Field>

        <Field label="Email" error={errors.email}>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setField('email', e.target.value)}
            placeholder="correo@dominio.com"
          />
        </Field>

        <Field label="Teléfono">
          <Input
            value={form.telefono}
            onChange={(e) => setField('telefono', e.target.value)}
            placeholder="+54 11 5555-1234"
          />
        </Field>

        {prospecto?.origen && (
          <div className="rounded-lg border border-slate-200 bg-brand-zebra/40 p-3 text-xs text-brand-muted">
            <p>
              <span className="font-semibold text-brand-ink">Origen:</span>{' '}
              {prospecto.origen}
            </p>
            {prospecto.convertido_at && (
              <p className="mt-1">
                Convertido a cliente el{' '}
                {new Date(prospecto.convertido_at).toLocaleDateString('es-AR')}.
              </p>
            )}
          </div>
        )}
      </form>
    </Drawer>
  );
}
