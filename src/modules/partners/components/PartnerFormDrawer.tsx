import { useEffect, useState } from 'react';
import { Handshake } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  crearPartner,
  actualizarPartner,
  CONDICION_IVA,
  CONDICION_IVA_LABEL,
  type CondicionIva,
  type PartnerRow,
} from '@/services/api/partners';

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: PartnerRow | null;
  onSaved?: (id: string) => void;
}

export function PartnerFormDrawer({
  open,
  onClose,
  editing = null,
  onSaved,
}: Props) {
  const isEdit = !!editing;

  const [slug, setSlug] = useState('');
  const [nombreLegal, setNombreLegal] = useState('');
  const [cuit, setCuit] = useState('');
  const [condicionIva, setCondicionIva] = useState<CondicionIva | ''>('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [domicilio, setDomicilio] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setSlug(editing.slug);
      setNombreLegal(editing.nombre_legal);
      setCuit(editing.cuit ?? '');
      setCondicionIva((editing.condicion_iva as CondicionIva | null) ?? '');
      setEmail(editing.email ?? '');
      setTelefono(editing.telefono ?? '');
      setDomicilio(editing.domicilio ?? '');
      setObservaciones(editing.observaciones ?? '');
    } else {
      setSlug('');
      setNombreLegal('');
      setCuit('');
      setCondicionIva('');
      setEmail('');
      setTelefono('');
      setDomicilio('');
      setObservaciones('');
    }
  }, [open, editing]);

  // Auto-genera slug desde el nombre cuando es alta y el usuario no lo tocó.
  useEffect(() => {
    if (isEdit || !nombreLegal) return;
    const candidate = nombreLegal
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
    setSlug((prev) => (prev === '' || prev === slugDerivedRef ? candidate : prev));
    slugDerivedRef = candidate;
  }, [nombreLegal, isEdit]);

  async function onSave() {
    if (!slug.trim()) {
      toast.error('Indicá un slug (ej: funplata)');
      return;
    }
    if (!nombreLegal.trim()) {
      toast.error('Indicá el nombre legal');
      return;
    }
    setSaving(true);
    if (isEdit && editing) {
      const res = await actualizarPartner(editing.id, {
        nombre_legal: nombreLegal.trim(),
        cuit: cuit.trim() || null,
        condicion_iva: (condicionIva as CondicionIva) || null,
        email: email.trim() || null,
        telefono: telefono.trim() || null,
        domicilio: domicilio.trim() || null,
        observaciones: observaciones.trim() || null,
      });
      setSaving(false);
      if (!res.ok) {
        toast.error(`No se pudo actualizar: ${res.error.message}`);
        return;
      }
      toast.success('Partner actualizado');
      onSaved?.(res.data.id);
      onClose();
      return;
    }

    const res = await crearPartner({
      slug: slug.trim(),
      nombre_legal: nombreLegal.trim(),
      cuit: cuit.trim() || null,
      condicion_iva: (condicionIva as CondicionIva) || null,
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      domicilio: domicilio.trim() || null,
      observaciones: observaciones.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo crear: ${res.error.message}`);
      return;
    }
    toast.success('Partner creado');
    onSaved?.(res.data.id);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Editar partner' : 'Nuevo partner'}
      kicker="Partners"
      description="Entidades con convenio de rendición sobre el ecosistema Gestión Global."
      icon={<Handshake size={18} />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear partner'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug" required>
            <Input
              value={slug}
              onChange={(e) =>
                setSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                )
              }
              disabled={isEdit}
              placeholder="funplata"
            />
          </Field>
          <Field label="Nombre legal" required>
            <Input
              value={nombreLegal}
              onChange={(e) => setNombreLegal(e.target.value)}
              placeholder="Funplata S.A."
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="CUIT">
            <Input
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              placeholder="30-00000000-0"
            />
          </Field>
          <Field label="Condición IVA">
            <Select
              value={condicionIva}
              onChange={(e) => setCondicionIva(e.target.value as CondicionIva | '')}
            >
              <option value="">— Sin definir —</option>
              {CONDICION_IVA.map((c) => (
                <option key={c} value={c}>
                  {CONDICION_IVA_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contacto@partner.com"
            />
          </Field>
          <Field label="Teléfono">
            <Input
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Domicilio">
          <Input
            value={domicilio}
            onChange={(e) => setDomicilio(e.target.value)}
          />
        </Field>

        <Field label="Observaciones">
          <Textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            placeholder="Notas internas, contactos, condiciones especiales…"
          />
        </Field>
      </div>
    </Drawer>
  );
}

// Helper module-level state para detectar si el slug fue derivado del nombre
// o tipeado a mano (sin acoplar refs por componente).
let slugDerivedRef = '';
