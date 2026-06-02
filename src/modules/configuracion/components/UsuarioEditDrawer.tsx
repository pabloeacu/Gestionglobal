// UsuarioEditDrawer · DGG-34 · Edita nombre + rol de un gerente/operador
// desde /gerencia/configuracion/usuarios. Cierra el GAP de "no se podía
// editar usuario post-alta" detectado en la auditoría ASIG.
//
// El email NO se edita acá: vive en auth.users y requiere flujo aparte
// (cambio de email, reverificación, etc).
//
// Citas: regla 4 (RPC vía service), regla 5 (multi-validación → RPC
// SECURITY DEFINER), regla 13 (DialogProvider, no window.confirm).

import { useEffect, useState, type FormEvent } from 'react';
import { Save, UserCog } from 'lucide-react';
import {
  Drawer,
  Field,
  Input,
  Select,
  Button,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { actualizarGerente } from '@/services/api/usuarios';
import { humanizeError } from '@/lib/errors';

export interface UsuarioEditTarget {
  id: string;
  full_name: string | null;
  role: 'gerente' | 'operador';
}

interface UsuarioEditDrawerProps {
  open: boolean;
  usuario: UsuarioEditTarget;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  full_name: string;
  role: 'gerente' | 'operador';
}

export function UsuarioEditDrawer({
  open,
  usuario,
  onClose,
  onSaved,
}: UsuarioEditDrawerProps) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>({
    full_name: usuario.full_name ?? '',
    role: usuario.role,
  });
  const [saving, setSaving] = useState(false);

  // Resetear form on-open (P-FE-02 — patrón AdministracionFormDrawer)
  useEffect(() => {
    if (open) {
      setForm({
        full_name: usuario.full_name ?? '',
        role: usuario.role,
      });
    }
  }, [open, usuario.id, usuario.full_name, usuario.role]);

  const initial: FormState = {
    full_name: usuario.full_name ?? '',
    role: usuario.role,
  };
  const dirty =
    form.full_name.trim() !== initial.full_name.trim() ||
    form.role !== initial.role;

  async function handleClose() {
    if (dirty) {
      const ok = await confirm({
        title: '¿Descartar cambios?',
        message: 'Si cerrás ahora vas a perder lo que modificaste.',
        confirmLabel: 'Descartar',
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const nombre = form.full_name.trim();
    if (!nombre) {
      toast.error('El nombre es obligatorio');
      return;
    }
    setSaving(true);
    const res = await actualizarGerente(usuario.id, nombre, form.role);
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos actualizar el usuario', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Usuario actualizado');
    onSaved();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={520}
      kicker="Editar usuario"
      title={usuario.full_name ?? 'Usuario'}
      description="Cambiá el nombre o el rol. El email se gestiona en un flujo aparte."
      icon={<UserCog size={20} />}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="usuario-edit-form"
            loading={saving}
            disabled={!dirty || saving}
          >
            <Save size={15} /> Guardar
          </Button>
        </div>
      }
    >
      <form
        id="usuario-edit-form"
        onSubmit={onSubmit}
        className="relative space-y-5"
      >
        <TrianglesAccent
          position="top-right"
          size={150}
          tone="cyan"
          density="soft"
          className="opacity-40"
        />

        <div className="relative space-y-5">
          <Field label="Nombre completo" required>
            <Input
              value={form.full_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, full_name: e.target.value }))
              }
              placeholder="Juan García"
              autoFocus
              required
            />
          </Field>

          <Field
            label="Rol"
            hint="Gerente: acceso total. Operador: acceso operativo (sin configuración crítica)."
          >
            <Select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  role: e.target.value as FormState['role'],
                }))
              }
            >
              <option value="gerente">Gerente</option>
              <option value="operador">Operador</option>
            </Select>
          </Field>

          <p className="text-xs text-brand-muted">
            El email no se edita desde acá. Para cambiarlo hace falta un flujo
            específico (cambio + reverificación) que se hará a futuro.
          </p>
        </div>
      </form>
    </Drawer>
  );
}
