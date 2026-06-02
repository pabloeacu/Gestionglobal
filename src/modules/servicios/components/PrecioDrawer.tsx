import { useEffect, useState, type FormEvent } from 'react';
import { toast } from '@/lib/toast';
import { Coins, Save } from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/common';
import {
  crearPrecio,
  type ServicioRow,
} from '@/services/api/servicios';
import {
  listAdministraciones,
  type AdministracionListItem,
} from '@/services/api/administraciones';
import {
  listConsorciosByAdministracion,
  type ConsorcioRow,
} from '@/services/api/consorcios';
import { humanizeError } from '@/lib/errors';

interface PrecioDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  servicio: ServicioRow;
}

type Alcance = 'base' | 'administracion' | 'consorcio' | 'convenio';

type Draft = {
  alcance: Alcance;
  precio: string;
  vigente_desde: string;
  vigente_hasta: string;
  administracion_id: string;
  consorcio_id: string;
  convenio: string;
  motivo: string;
  notas: string;
};

const today = () => new Date().toISOString().slice(0, 10);

export function PrecioDrawer({
  open,
  onClose,
  onSaved,
  servicio,
}: PrecioDrawerProps) {
  const [draft, setDraft] = useState<Draft>({
    alcance: 'base',
    precio: '',
    vigente_desde: today(),
    vigente_hasta: '',
    administracion_id: '',
    consorcio_id: '',
    convenio: '',
    motivo: '',
    notas: '',
  });
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [consorcios, setConsorcios] = useState<ConsorcioRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({
      alcance: 'base',
      precio: '',
      vigente_desde: today(),
      vigente_hasta: '',
      administracion_id: '',
      consorcio_id: '',
      convenio: '',
      motivo: '',
      notas: '',
    });
    setErr(null);
    void (async () => {
      const r = await listAdministraciones({ limit: 200 });
      if (r.ok) setAdmins(r.data.rows);
    })();
  }, [open]);

  useEffect(() => {
    if (!draft.administracion_id) {
      setConsorcios([]);
      return;
    }
    void (async () => {
      const r = await listConsorciosByAdministracion(draft.administracion_id);
      if (r.ok) setConsorcios(r.data);
    })();
  }, [draft.administracion_id]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setErr(null);
    if (!draft.precio || Number(draft.precio) < 0) {
      setErr('Precio inválido.');
      return;
    }
    if (draft.alcance === 'administracion' && !draft.administracion_id) {
      setErr('Elegí una administración.');
      return;
    }
    if (draft.alcance === 'consorcio' && !draft.consorcio_id) {
      setErr('Elegí un consorcio.');
      return;
    }
    if (draft.alcance === 'convenio' && !draft.convenio.trim()) {
      setErr('Ingresá el nombre del convenio.');
      return;
    }

    setSaving(true);
    const origen =
      draft.alcance === 'administracion'
        ? 'preferencial'
        : draft.alcance === 'convenio'
          ? 'convenio'
          : 'base';

    const res = await crearPrecio(servicio.id, {
      precio: Number(draft.precio),
      origen: origen as 'base' | 'preferencial' | 'convenio',
      vigente_desde: draft.vigente_desde || today(),
      vigente_hasta: draft.vigente_hasta || null,
      administracion_id:
        draft.alcance === 'administracion' ? draft.administracion_id : null,
      consorcio_id:
        draft.alcance === 'consorcio' ? draft.consorcio_id : null,
      convenio: draft.alcance === 'convenio' ? draft.convenio.trim() : null,
      motivo: draft.motivo.trim() || null,
      notas: draft.notas.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(`No pudimos guardar el precio: ${humanizeError(res.error)}`);
      return;
    }
    toast.success('Precio cargado.');
    onSaved?.();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nuevo precio"
      kicker={servicio.nombre}
      icon={<Coins size={18} />}
      width={620}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button type="submit" form="precio-form" loading={saving}>
            <Save size={16} /> Guardar
          </Button>
        </>
      }
    >
      <form id="precio-form" onSubmit={onSubmit} className="space-y-5">
        <Field label="Alcance">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ['base', 'Regla base'],
                ['administracion', 'Administración'],
                ['consorcio', 'Consorcio'],
                ['convenio', 'Convenio'],
              ] as Array<[Alcance, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setDraft({ ...draft, alcance: k })}
                className={
                  'rounded-lg border px-3 py-2 text-xs font-medium transition ' +
                  (draft.alcance === k
                    ? 'border-brand-cyan bg-brand-cyan-pale/40 text-brand-ink'
                    : 'border-slate-200 bg-white text-brand-muted hover:border-slate-300')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {draft.alcance === 'administracion' && (
          <Field label="Administración" required>
            <Select
              value={draft.administracion_id}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  administracion_id: e.target.value,
                  consorcio_id: '',
                })
              }
            >
              <option value="" disabled>
                Elegí cliente…
              </option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {draft.alcance === 'consorcio' && (
          <>
            <Field label="Administración" required>
              <Select
                value={draft.administracion_id}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    administracion_id: e.target.value,
                    consorcio_id: '',
                  })
                }
              >
                <option value="" disabled>
                  Elegí cliente…
                </option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Consorcio" required>
              <Select
                value={draft.consorcio_id}
                onChange={(e) =>
                  setDraft({ ...draft, consorcio_id: e.target.value })
                }
                disabled={!draft.administracion_id}
              >
                <option value="" disabled>
                  Elegí consorcio…
                </option>
                {consorcios.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {draft.alcance === 'convenio' && (
          <Field label="Nombre del convenio" required>
            <Input
              value={draft.convenio}
              onChange={(e) =>
                setDraft({ ...draft, convenio: e.target.value })
              }
              placeholder="Convenio AIPH 2026"
            />
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Precio (ARS)" required>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.precio}
              onChange={(e) =>
                setDraft({ ...draft, precio: e.target.value })
              }
              placeholder="0,00"
            />
          </Field>
          <Field label="Vigente desde">
            <Input
              type="date"
              value={draft.vigente_desde}
              onChange={(e) =>
                setDraft({ ...draft, vigente_desde: e.target.value })
              }
            />
          </Field>
          <Field label="Vigente hasta" hint="Vacío = abierto">
            <Input
              type="date"
              value={draft.vigente_hasta}
              onChange={(e) =>
                setDraft({ ...draft, vigente_hasta: e.target.value })
              }
            />
          </Field>
        </div>

        <Field label="Motivo / referencia">
          <Input
            value={draft.motivo}
            onChange={(e) => setDraft({ ...draft, motivo: e.target.value })}
            placeholder="Aumento por costo de insumos"
          />
        </Field>

        <Field label="Notas internas">
          <Textarea
            value={draft.notas}
            onChange={(e) => setDraft({ ...draft, notas: e.target.value })}
          />
        </Field>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <p className="text-xs text-brand-muted">
          Si elegís <strong>regla base</strong> y ya existe una abierta, se
          cierra automáticamente con fecha de hoy.
        </p>
      </form>
    </Drawer>
  );
}
