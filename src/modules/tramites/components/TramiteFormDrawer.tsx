import { useEffect, useState } from 'react';
import { toast } from '@/lib/toast';
import { Briefcase } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  createTramite,
  TRAMITE_CATEGORIAS,
  TRAMITE_PRIORIDADES,
  TRAMITE_CATEGORIA_LABEL,
  TRAMITE_PRIORIDAD_LABEL,
  type TramiteCategoria,
  type TramitePrioridad,
} from '@/services/api/tramites';
import {
  listAdministraciones,
  type AdministracionRow,
} from '@/services/api/administraciones';
import { humanizeError } from '@/lib/errors';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

export function TramiteFormDrawer({ open, onClose, onCreated }: Props) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState<TramiteCategoria>('consulta_juridica');
  const [prioridad, setPrioridad] = useState<TramitePrioridad>('normal');
  const [administracionId, setAdministracionId] = useState<string>('');
  const [solicitanteNombre, setSolicitanteNombre] = useState('');
  const [solicitanteEmail, setSolicitanteEmail] = useState('');
  const [solicitanteTelefono, setSolicitanteTelefono] = useState('');
  const [venceAt, setVenceAt] = useState('');
  const [admins, setAdmins] = useState<AdministracionRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Cargar lista de administraciones al abrir
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await listAdministraciones({ estado: 'activo' });
      if (res.ok) setAdmins(res.data.rows);
    })();
  }, [open]);

  // Reset al cerrar
  useEffect(() => {
    if (open) return;
    setTitulo('');
    setDescripcion('');
    setCategoria('consulta_juridica');
    setPrioridad('normal');
    setAdministracionId('');
    setSolicitanteNombre('');
    setSolicitanteEmail('');
    setSolicitanteTelefono('');
    setVenceAt('');
  }, [open]);

  async function onSave() {
    if (!titulo.trim()) {
      toast.error('El título es obligatorio');
      return;
    }
    setSaving(true);
    const res = await createTramite({
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      categoria,
      prioridad,
      administracion_id: administracionId || null,
      solicitante_nombre: solicitanteNombre.trim() || null,
      solicitante_email: solicitanteEmail.trim() || null,
      solicitante_telefono: solicitanteTelefono.trim() || null,
      vence_at: venceAt ? new Date(venceAt).toISOString() : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo crear: ${humanizeError(res.error)}`);
      return;
    }
    toast.success(`Trámite ${res.data.codigo} creado`);
    onCreated?.(res.data.id);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nuevo trámite"
      kicker="Gerencia"
      description="Creá un expediente para hacer seguimiento de una solicitud."
      icon={<Briefcase size={18} />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void onSave()} disabled={saving}>
            {saving ? 'Creando…' : 'Crear trámite'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Título" required>
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ej: Renovación de matrícula RPAC para Diego García"
            autoFocus
          />
        </Field>

        <Field label="Descripción">
          <Textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Contexto, detalles, documentación adicional…"
            rows={4}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría" required>
            <Select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as TramiteCategoria)}
            >
              {TRAMITE_CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {TRAMITE_CATEGORIA_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridad">
            <Select
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as TramitePrioridad)}
            >
              {TRAMITE_PRIORIDADES.map((p) => (
                <option key={p} value={p}>
                  {TRAMITE_PRIORIDAD_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Cliente (administración)">
          <Select
            value={administracionId}
            onChange={(e) => setAdministracionId(e.target.value)}
          >
            <option value="">— Sin asociar —</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Vence el (opcional)">
          <Input
            type="date"
            value={venceAt}
            onChange={(e) => setVenceAt(e.target.value)}
          />
        </Field>

        <div className="rounded-lg border border-slate-200 bg-brand-zebra/40 p-3 text-xs text-brand-muted">
          <p className="mb-2 font-medium text-brand-ink">
            Datos del solicitante (opcional)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input
                value={solicitanteNombre}
                onChange={(e) => setSolicitanteNombre(e.target.value)}
                placeholder="Diego García"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={solicitanteEmail}
                onChange={(e) => setSolicitanteEmail(e.target.value)}
                placeholder="diego@correo.com"
              />
            </Field>
            <Field label="Teléfono" className="sm:col-span-2">
              <Input
                value={solicitanteTelefono}
                onChange={(e) => setSolicitanteTelefono(e.target.value)}
                placeholder="+54 11 5555-1234"
              />
            </Field>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
