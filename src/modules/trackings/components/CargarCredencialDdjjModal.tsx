// ============================================================================
// CargarCredencialDdjjModal · DGG-243 (entregable A — carril de gerencia)
//
// Gemelo de CargarOtorgamientoModal, pero para las credenciales del Portal de
// DDJJ (misgestiones.com.ar): 2 campos (usuario + contraseña). La carga directa
// de gerencia deja la credencial 'publicado' (visible/revelable por el cliente
// en su sección DDJJ del portal), vía la RPC credencial_reg_set (store cifrado,
// mig 0644/0645). La contraseña se guarda cifrada; nunca viaja al tracking.
//
// Al abrir, pre-carga el usuario YA cargado (sin la contraseña) para editar;
// contraseña vacía al guardar = se conserva la existente (COALESCE server-side).
// ============================================================================
import { useEffect, useState } from 'react';
import { KeyRound, Check } from 'lucide-react';
import { Button, Field, Input, Modal, PasswordRevealInput } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { getCredencialDdjjMeta, setCredencialDdjj } from '@/services/api/ddjj';

interface CargarCredencialDdjjModalProps {
  open: boolean;
  onClose: () => void;
  administracionId: string;
  trackingTitulo?: string;
  /** Se llama tras guardar OK (para refrescar la ficha/estado en el host). */
  onGuardado?: () => void;
}

export function CargarCredencialDdjjModal({
  open,
  onClose,
  administracionId,
  trackingTitulo,
  onGuardado,
}: CargarCredencialDdjjModalProps) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [yaTienePassword, setYaTienePassword] = useState(false);
  const [cargandoMeta, setCargandoMeta] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsuario('');
    setPassword('');
    setYaTienePassword(false);
    setSubmitting(false);
    setCargandoMeta(true);
    void getCredencialDdjjMeta(administracionId).then((r) => {
      setCargandoMeta(false);
      if (r.ok && r.data.existe) {
        setUsuario(r.data.usuario ?? '');
        setYaTienePassword(r.data.tienePassword);
      }
    });
  }, [open, administracionId]);

  const puedeGuardar = !submitting && !cargandoMeta && (usuario.trim() !== '' || password !== '');

  async function handleGuardar() {
    if (!puedeGuardar) {
      toast.error('Cargá el usuario y/o la contraseña del Portal de DDJJ.');
      return;
    }
    setSubmitting(true);
    const res = await setCredencialDdjj({ administracionId, usuario: usuario.trim(), password });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Credenciales del Portal de DDJJ guardadas en la ficha del cliente');
    onGuardado?.();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cargar credenciales del Portal de DDJJ"
      kicker={trackingTitulo ? `Trámite · ${trackingTitulo}` : 'Declaraciones Juradas'}
      icon={<KeyRound className="h-5 w-5 text-brand-cyan" />}
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
          Son las credenciales del Portal de Declaraciones Juradas (misgestiones.com.ar) que el
          cliente verá en su sección DDJJ del portal. Se guardan <strong>cifradas</strong>; la
          contraseña nunca queda a la vista ni viaja al tracking.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Usuario" hint="Usuario del Portal de DDJJ">
            <Input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              maxLength={120}
              placeholder="Ej.: 20-12345678-9"
              disabled={submitting || cargandoMeta}
            />
          </Field>
          <Field
            label="Contraseña"
            hint={yaTienePassword ? 'Ya hay una cargada · dejá vacío para conservarla' : 'Contraseña del Portal de DDJJ'}
          >
            <PasswordRevealInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
              placeholder={yaTienePassword ? '•••••••• (sin cambios)' : ''}
              disabled={submitting || cargandoMeta}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export default CargarCredencialDdjjModal;
