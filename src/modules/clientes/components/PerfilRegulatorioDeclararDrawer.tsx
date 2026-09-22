import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Drawer, Button, Field, Input, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  getPerfilRegulatorioDeclarado,
  declararPerfilRegulatorio,
  type PerfilRegulatorio,
  type CertezaDato,
} from '@/services/api/perfilRegulatorio';

// Agenda · progressive profiling (writer de gerencia). Ancla datos DECLARADOS en
// `perfil_regulatorio` (certeza='declarado'). No pisa lo confirmado por la plataforma:
// la RPC mergea con precedencia. Sirve para cargar lo que el cliente informa ("ya
// renové afuera el 15/08", "no requiero X"). El form del cliente en el portal llega
// en el incremento siguiente y usa la misma RPC.

type FormState = {
  jurisdiccion: '' | 'rpac' | 'rpa';
  matricula_nro_declarada: string;
  matricula_fecha_declarada: string;
  ultima_renovacion_declarada: string;
  ultimo_curso_actualizacion_declarado: string;
  ultima_ddjj_declarada: string;
  ultima_consultoria_declarada: string;
  ultimo_certificado_declarado: string;
  notas: string;
};

const EMPTY: FormState = {
  jurisdiccion: '',
  matricula_nro_declarada: '',
  matricula_fecha_declarada: '',
  ultima_renovacion_declarada: '',
  ultimo_curso_actualizacion_declarado: '',
  ultima_ddjj_declarada: '',
  ultima_consultoria_declarada: '',
  ultimo_certificado_declarado: '',
  notas: '',
};

// aviso cuando la plataforma YA confirma el dato (declararlo es redundante)
function confHint(certeza: CertezaDato | undefined): string | undefined {
  return certeza === 'confirmado'
    ? 'Ya confirmado por la plataforma — declararlo es opcional.'
    : undefined;
}

export function PerfilRegulatorioDeclararDrawer({
  open,
  onClose,
  administracionId,
  perfil,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  administracionId: string;
  perfil: PerfilRegulatorio | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    getPerfilRegulatorioDeclarado(administracionId)
      .then((res) => {
        if (cancel) return;
        if (res.ok) {
          const d = res.data;
          setForm(
            d
              ? {
                  jurisdiccion: d.jurisdiccion === 'rpac' || d.jurisdiccion === 'rpa' ? d.jurisdiccion : '',
                  matricula_nro_declarada: d.matricula_nro_declarada ?? '',
                  matricula_fecha_declarada: d.matricula_fecha_declarada ?? '',
                  ultima_renovacion_declarada: d.ultima_renovacion_declarada ?? '',
                  ultimo_curso_actualizacion_declarado: d.ultimo_curso_actualizacion_declarado ?? '',
                  ultima_ddjj_declarada: d.ultima_ddjj_declarada ?? '',
                  ultima_consultoria_declarada: d.ultima_consultoria_declarada ?? '',
                  ultimo_certificado_declarado: d.ultimo_certificado_declarado ?? '',
                  notas: d.notas ?? '',
                }
              : EMPTY,
          );
        } else {
          // G4: no confundir "nunca declaró" con "falló la carga"
          setForm(EMPTY);
          toast.error('No se pudieron cargar los datos declarados', {
            description: humanizeError(res.error),
          });
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, administracionId]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await declararPerfilRegulatorio({
        administracionId,
        jurisdiccion: (form.jurisdiccion || undefined) as 'rpac' | 'rpa' | undefined,
        matriculaNro: form.matricula_nro_declarada.trim() || undefined,
        matriculaFecha: form.matricula_fecha_declarada || undefined,
        ultimaRenovacion: form.ultima_renovacion_declarada || undefined,
        ultimoCursoActualizacion: form.ultimo_curso_actualizacion_declarado || undefined,
        ultimaDdjj: form.ultima_ddjj_declarada || undefined,
        ultimaConsultoria: form.ultima_consultoria_declarada || undefined,
        ultimoCertificado: form.ultimo_certificado_declarado || undefined,
        notas: form.notas.trim() || undefined,
      });
      if (res.ok) {
        toast.success('Datos declarados guardados');
        onSaved();
        onClose();
      } else {
        toast.error('No se pudo guardar', { description: humanizeError(res.error) });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={<ShieldCheck size={18} className="text-brand-cyan" />}
      kicker="Perfil regulatorio"
      title="Anclar datos declarados"
      description="Registrá lo que el cliente informa (p. ej. una renovación hecha por fuera). No pisa lo que la plataforma ya confirma."
      width={620}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} loading={saving} disabled={loading}>
            Guardar
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="text-sm text-brand-muted">Cargando…</p>
      ) : (
        <div className="space-y-4">
          <Field label="Jurisdicción">
            <Select
              value={form.jurisdiccion}
              onChange={(e) => set('jurisdiccion', e.target.value as FormState['jurisdiccion'])}
            >
              {/* G2: dejar vacío NO borra lo ya declarado (COALESCE en la RPC) — la opción
                  se rotula "(no cambiar)" para no prometer un borrado que no ocurre. */}
              <option value="">— No cambiar —</option>
              <option value="rpac">RPAC · Buenos Aires</option>
              <option value="rpa">RPA · CABA</option>
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nº de matrícula (declarado)" hint={confHint(perfil?.matricula.nro_certeza)}>
              <Input
                value={form.matricula_nro_declarada}
                onChange={(e) => set('matricula_nro_declarada', e.target.value)}
                placeholder="ej. 1234"
              />
            </Field>
            <Field label="Fecha de matriculación (declarada)" hint={confHint(perfil?.matricula.fecha_certeza)}>
              <Input
                type="date"
                value={form.matricula_fecha_declarada}
                onChange={(e) => set('matricula_fecha_declarada', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Última renovación (declarada)" hint={confHint(perfil?.ultima_renovacion.certeza)}>
              <Input
                type="date"
                value={form.ultima_renovacion_declarada}
                onChange={(e) => set('ultima_renovacion_declarada', e.target.value)}
              />
            </Field>
            <Field label="Último curso de actualización (declarado)" hint={confHint(perfil?.ultimo_curso_actualizacion.certeza)}>
              <Input
                type="date"
                value={form.ultimo_curso_actualizacion_declarado}
                onChange={(e) => set('ultimo_curso_actualizacion_declarado', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Última DDJJ (declarada)" hint={confHint(perfil?.ultima_ddjj.certeza)}>
              <Input
                type="date"
                value={form.ultima_ddjj_declarada}
                onChange={(e) => set('ultima_ddjj_declarada', e.target.value)}
              />
            </Field>
            <Field label="Último certificado (declarado)" hint={confHint(perfil?.ultimo_certificado.certeza)}>
              <Input
                type="date"
                value={form.ultimo_certificado_declarado}
                onChange={(e) => set('ultimo_certificado_declarado', e.target.value)}
              />
            </Field>
          </div>

          <Field label="Última consultoría jurídica (declarada)" hint={confHint(perfil?.ultima_consultoria.certeza)}>
            <Input
              type="date"
              value={form.ultima_consultoria_declarada}
              onChange={(e) => set('ultima_consultoria_declarada', e.target.value)}
            />
          </Field>

          <Field label="Notas">
            <Textarea
              value={form.notas}
              onChange={(e) => set('notas', e.target.value)}
              placeholder="Contexto de lo declarado (opcional)…"
            />
          </Field>

          <p className="text-[11px] leading-snug text-brand-muted">
            Lo que cargues queda con certeza <span className="font-semibold">declarado</span>. Dejar un
            campo vacío <span className="font-semibold">no borra</span> un dato ya declarado (se conserva).
          </p>
        </div>
      )}
    </Drawer>
  );
}
