import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Drawer, Button, Field, Input, Select, Textarea } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import {
  getPerfilRegulatorioDeclarado,
  declararPerfilRegulatorio,
  type PerfilRegulatorio,
  type CertezaDato,
  type DeclararPerfilInput,
} from '@/services/api/perfilRegulatorio';

// Agenda · progressive profiling (writer de gerencia). Ancla datos DECLARADOS en
// `perfil_regulatorio` (certeza='declarado'). No pisa lo confirmado por la plataforma:
// la RPC mergea con precedencia (confirmado > declarado > inferido).
//
// DGG-205 (pedido Pablo): el drawer arrancaba VACÍO y confundía ("¿por qué no me trae
// lo que ya sabemos?"). Ahora PRECARGA cada campo con el valor conocido (del perfil
// mergeado) y muestra su certeza. Clave para no ensuciar la semántica: al guardar se
// envían SÓLO los campos que el gerente CAMBIÓ respecto de lo precargado — un valor
// confirmado que se deja igual NO se re-graba como declarado.

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

// Chip de certeza — paleta de GERENCIA (emerald/sky/amber/slate), igual que
// PerfilRegulatorioPanel. NO la del portal (esa es superficie de cliente).
const CERTEZA_CHIP: Record<CertezaDato, { label: string; cls: string }> = {
  confirmado: { label: 'Confirmado', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  declarado: { label: 'Declarado', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  inferido: { label: 'Inferido', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  desconocido: { label: 'Sin dato', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

// Aviso por campo según su certeza: confirmado (editar no reemplaza), inferido (a confirmar).
function certezaHint(certeza: CertezaDato | undefined): string | undefined {
  if (certeza === 'confirmado') return 'Ya lo confirma la plataforma; declarar algo distinto no reemplaza el valor confirmado (se corrige en la ficha).';
  if (certeza === 'inferido') return 'Estimado por cálculo — editá para confirmarlo.';
  return undefined;
}

function fieldLabel(text: string, certeza: CertezaDato | undefined) {
  const c = certeza ?? 'desconocido';
  const m = CERTEZA_CHIP[c];
  return (
    <span className="inline-flex items-center gap-2">
      {text}
      <span
        className={cn(
          'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold',
          m.cls,
        )}
      >
        {m.label}
      </span>
    </span>
  );
}

// 'YYYY-MM-DD...' → 'YYYY-MM-DD' (para los <input type=date>)
function iso(d: string | null | undefined): string {
  return d ? d.slice(0, 10) : '';
}

// Precarga cada campo con el valor CONOCIDO del perfil mergeado (+ notas de la fila
// declarada). Editar declara algo distinto; dejar igual = no re-graba.
function buildInitial(perfil: PerfilRegulatorio | null, notas: string): FormState {
  if (!perfil) return { ...EMPTY, notas };
  return {
    jurisdiccion: perfil.jurisdiccion === 'rpac' || perfil.jurisdiccion === 'rpa' ? perfil.jurisdiccion : '',
    matricula_nro_declarada: perfil.matricula.nro ?? '',
    matricula_fecha_declarada: iso(perfil.matricula.fecha),
    ultima_renovacion_declarada: iso(perfil.ultima_renovacion.fecha),
    ultimo_curso_actualizacion_declarado: iso(perfil.ultimo_curso_actualizacion.fecha),
    ultima_ddjj_declarada: iso(perfil.ultima_ddjj.fecha),
    ultima_consultoria_declarada: iso(perfil.ultima_consultoria.fecha),
    ultimo_certificado_declarado: iso(perfil.ultimo_certificado.fecha),
    notas,
  };
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
  // Snapshot de lo PRECARGADO — para detectar qué cambió y enviar sólo eso.
  const [initial, setInitial] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    // Sólo necesitamos la fila declarada para las NOTAS (el resto sale del perfil mergeado).
    getPerfilRegulatorioDeclarado(administracionId)
      .then((res) => {
        if (cancel) return;
        if (!res.ok) {
          toast.error('No se pudieron cargar los datos declarados', {
            description: humanizeError(res.error),
          });
        }
        const notas = res.ok ? (res.data?.notas ?? '') : '';
        const init = buildInitial(perfil, notas);
        setForm(init);
        setInitial(init);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
    // perfil es estable mientras el drawer está abierto (lo pasa el panel ya cargado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, administracionId]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function changed<K extends keyof FormState>(k: K): boolean {
    return form[k] !== initial[k];
  }

  async function handleSave() {
    // Enviar SÓLO lo que cambió respecto de lo precargado. Un confirmado dejado igual
    // no se re-graba como declarado; la RPC hace COALESCE con lo no enviado.
    const input: DeclararPerfilInput = { administracionId };
    if (changed('jurisdiccion')) input.jurisdiccion = (form.jurisdiccion || undefined) as 'rpac' | 'rpa' | undefined;
    if (changed('matricula_nro_declarada')) input.matriculaNro = form.matricula_nro_declarada.trim() || undefined;
    if (changed('matricula_fecha_declarada')) input.matriculaFecha = form.matricula_fecha_declarada || undefined;
    if (changed('ultima_renovacion_declarada')) input.ultimaRenovacion = form.ultima_renovacion_declarada || undefined;
    if (changed('ultimo_curso_actualizacion_declarado')) input.ultimoCursoActualizacion = form.ultimo_curso_actualizacion_declarado || undefined;
    if (changed('ultima_ddjj_declarada')) input.ultimaDdjj = form.ultima_ddjj_declarada || undefined;
    if (changed('ultima_consultoria_declarada')) input.ultimaConsultoria = form.ultima_consultoria_declarada || undefined;
    if (changed('ultimo_certificado_declarado')) input.ultimoCertificado = form.ultimo_certificado_declarado || undefined;
    if (changed('notas')) input.notas = form.notas.trim() || undefined;

    // contar sólo campos con valor DEFINIDO (borrar un precargado deja undefined,
    // que la RPC ignora por COALESCE → no es un cambio real que valga guardar).
    const numCambios = Object.values(input).filter((v) => v !== undefined).length - 1; // menos administracionId
    if (numCambios === 0) {
      toast.info('No hiciste cambios para declarar');
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await declararPerfilRegulatorio(input);
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
      description="Precargamos lo que ya sabemos de este cliente. Editá un campo sólo para declarar algo distinto (p. ej. una renovación hecha por fuera). Lo que la plataforma ya confirma no se pisa."
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
              <option value="">— No cambiar —</option>
              <option value="rpac">RPAC · Buenos Aires</option>
              <option value="rpa">RPA · CABA</option>
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={fieldLabel('Nº de matrícula', perfil?.matricula.nro_certeza)} hint={certezaHint(perfil?.matricula.nro_certeza)}>
              <Input
                value={form.matricula_nro_declarada}
                onChange={(e) => set('matricula_nro_declarada', e.target.value)}
                placeholder="ej. 1234"
              />
            </Field>
            <Field label={fieldLabel('Fecha de matriculación', perfil?.matricula.fecha_certeza)} hint={certezaHint(perfil?.matricula.fecha_certeza)}>
              <Input
                type="date"
                value={form.matricula_fecha_declarada}
                onChange={(e) => set('matricula_fecha_declarada', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={fieldLabel('Última renovación', perfil?.ultima_renovacion.certeza)} hint={certezaHint(perfil?.ultima_renovacion.certeza)}>
              <Input
                type="date"
                value={form.ultima_renovacion_declarada}
                onChange={(e) => set('ultima_renovacion_declarada', e.target.value)}
              />
            </Field>
            <Field label={fieldLabel('Último curso de actualización', perfil?.ultimo_curso_actualizacion.certeza)} hint={certezaHint(perfil?.ultimo_curso_actualizacion.certeza)}>
              <Input
                type="date"
                value={form.ultimo_curso_actualizacion_declarado}
                onChange={(e) => set('ultimo_curso_actualizacion_declarado', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={fieldLabel('Última DDJJ', perfil?.ultima_ddjj.certeza)} hint={certezaHint(perfil?.ultima_ddjj.certeza)}>
              <Input
                type="date"
                value={form.ultima_ddjj_declarada}
                onChange={(e) => set('ultima_ddjj_declarada', e.target.value)}
              />
            </Field>
            <Field label={fieldLabel('Último certificado', perfil?.ultimo_certificado.certeza)} hint={certezaHint(perfil?.ultimo_certificado.certeza)}>
              <Input
                type="date"
                value={form.ultimo_certificado_declarado}
                onChange={(e) => set('ultimo_certificado_declarado', e.target.value)}
              />
            </Field>
          </div>

          <Field label={fieldLabel('Última consultoría jurídica', perfil?.ultima_consultoria.certeza)} hint={certezaHint(perfil?.ultima_consultoria.certeza)}>
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
            Guardamos <span className="font-semibold">sólo lo que cambies</span>. Un campo que dejás
            igual no se re-graba (lo <span className="font-semibold">confirmado</span> sigue como está).
            Lo que edites queda con certeza <span className="font-semibold">declarado</span>; dejar un
            campo vacío <span className="font-semibold">no borra</span> un dato ya cargado.
          </p>
        </div>
      )}
    </Drawer>
  );
}
