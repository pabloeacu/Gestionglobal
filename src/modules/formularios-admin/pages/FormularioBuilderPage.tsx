// Editor visual del formulario. 3 columnas: paleta · canvas · propiedades.
// Estado del schema en memoria, persistido al hacer "Guardar". Cualquier
// cambio en el schema dispara el trigger SQL `formulario_versionado` que
// crea un snapshot automático.
//
// Cumple regla 13 (sin window.confirm): se usa useConfirm para eliminar
// secciones con campos dentro.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Eye,
  ExternalLink,
  History,
  Share2,
  Settings2,
  Loader2,
} from 'lucide-react';
import { Button, Modal, Field, Input, Textarea, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { cn } from '@/lib/cn';
import {
  actualizarFormulario,
  getFormularioPorId,
} from '@/services/api/formularios-admin';
import type {
  FormularioRow,
  FormularioFieldDef,
  FormularioSchemaDef,
  FormularioSectionDef,
} from '@/services/api/formularios';
import { FieldPalette } from '../components/FieldPalette';
import { CanvasFormulario } from '../components/CanvasFormulario';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { PreviewModal } from '../components/PreviewModal';
import { EmbedCodeModal } from '../components/EmbedCodeModal';
import type { Selection } from '../types';

function emptySchema(): FormularioSchemaDef {
  return { sections: [{ title: 'Primera sección', fields: [] }], submit_label: 'Enviar' };
}

export function FormularioBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [formulario, setFormulario] = useState<FormularioRow | null>(null);
  const [schema, setSchema] = useState<FormularioSchemaDef>(emptySchema());
  const [selection, setSelection] = useState<Selection>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [ajustesOpen, setAjustesOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void getFormularioPorId(id).then((res) => {
      setLoading(false);
      if (!res.ok) {
        toast.error('No pudimos cargar el formulario', { description: res.error.message });
        return;
      }
      setFormulario(res.data);
      const sch = (res.data.schema as unknown as FormularioSchemaDef | null) ?? emptySchema();
      setSchema(sch.sections ? sch : emptySchema());
    });
  }, [id]);

  // ----- Mutaciones del schema (locales, persisten al "Guardar") -----

  function mutate(fn: (s: FormularioSchemaDef) => FormularioSchemaDef) {
    setSchema((prev) => {
      const next = fn(structuredClone(prev));
      return next;
    });
    setDirty(true);
  }

  function onInsertField(
    sectionIdx: number,
    insertAt: number,
    field: FormularioFieldDef,
  ) {
    mutate((s) => {
      const section = s.sections[sectionIdx];
      if (!section) return s;
      section.fields.splice(insertAt, 0, field);
      return s;
    });
    setSelection({ kind: 'field', value: { sectionIdx, fieldIdx: insertAt } });
  }

  function onMoveField(
    fromSection: number,
    fromIdx: number,
    toSection: number,
    toIdx: number,
  ) {
    mutate((s) => {
      const src = s.sections[fromSection];
      const dst = s.sections[toSection];
      if (!src || !dst) return s;
      const [moved] = src.fields.splice(fromIdx, 1);
      if (!moved) return s;
      let actualTo = toIdx;
      if (fromSection === toSection && fromIdx < toIdx) actualTo = toIdx - 1;
      dst.fields.splice(actualTo, 0, moved);
      return s;
    });
    setSelection(null);
  }

  function onDuplicateField(sectionIdx: number, fieldIdx: number) {
    mutate((s) => {
      const section = s.sections[sectionIdx];
      const field = section?.fields[fieldIdx];
      if (!section || !field) return s;
      const cloned = structuredClone(field);
      cloned.name = `${field.name}_copia`;
      section.fields.splice(fieldIdx + 1, 0, cloned);
      return s;
    });
  }

  async function onDeleteField(sectionIdx: number, fieldIdx: number) {
    const ok = await confirm({
      title: 'Eliminar campo',
      message: '¿Quitar este campo del formulario?',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    mutate((s) => {
      s.sections[sectionIdx]?.fields.splice(fieldIdx, 1);
      return s;
    });
    setSelection(null);
  }

  function onUpdateField(
    sectionIdx: number,
    fieldIdx: number,
    patch: Partial<FormularioFieldDef>,
  ) {
    mutate((s) => {
      const f = s.sections[sectionIdx]?.fields[fieldIdx];
      if (!f) return s;
      Object.assign(f, patch);
      return s;
    });
  }

  function onUpdateSection(sectionIdx: number, patch: Partial<FormularioSectionDef>) {
    mutate((s) => {
      const sec = s.sections[sectionIdx];
      if (!sec) return s;
      Object.assign(sec, patch);
      return s;
    });
  }

  function onAddSection() {
    mutate((s) => {
      s.sections.push({ title: `Sección ${s.sections.length + 1}`, fields: [] });
      return s;
    });
  }

  async function onDeleteSection(sectionIdx: number) {
    const section = schema.sections[sectionIdx];
    if (!section) return;
    if (section.fields.length > 0) {
      const ok = await confirm({
        title: 'Eliminar sección',
        message: `La sección tiene ${section.fields.length} campos. ¿Eliminar todo?`,
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
    }
    mutate((s) => {
      s.sections.splice(sectionIdx, 1);
      if (s.sections.length === 0) s.sections.push({ title: 'Primera sección', fields: [] });
      return s;
    });
    setSelection(null);
  }

  function onMoveSection(sectionIdx: number, dir: -1 | 1) {
    mutate((s) => {
      const target = sectionIdx + dir;
      if (target < 0 || target >= s.sections.length) return s;
      const [m] = s.sections.splice(sectionIdx, 1);
      if (m) s.sections.splice(target, 0, m);
      return s;
    });
  }

  // ----- Guardar -----

  async function onSave() {
    if (!formulario) return;
    // Validación: campos no pueden tener `name` vacío ni duplicado.
    const names = new Set<string>();
    for (const sec of schema.sections) {
      for (const f of sec.fields) {
        if (['separator', 'heading', 'html'].includes(f.type)) continue;
        if (!f.name) {
          toast.error('Hay campos sin nombre interno (key).');
          return;
        }
        if (names.has(f.name)) {
          toast.error(`Hay dos campos con el mismo key: "${f.name}". Renombrá uno.`);
          return;
        }
        names.add(f.name);
      }
    }
    setSaving(true);
    const res = await actualizarFormulario(formulario.id, { schema });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: res.error.message });
      return;
    }
    setFormulario(res.data);
    setDirty(false);
    toast.success('Formulario guardado · nueva versión creada');
  }

  async function onToggleActivo() {
    if (!formulario) return;
    const res = await actualizarFormulario(formulario.id, { activo: !formulario.activo });
    if (!res.ok) {
      toast.error('No pudimos cambiar el estado', { description: res.error.message });
      return;
    }
    setFormulario(res.data);
    toast.success(res.data.activo ? 'Formulario activado' : 'Formulario desactivado');
  }

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <BrandLoader size={48} label="Cargando constructor…" />
      </div>
    );
  }

  if (!formulario) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-center">
        <div>
          <p className="text-sm text-brand-muted">Formulario no encontrado.</p>
          <Link
            to="/gerencia/formularios"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-cyan"
          >
            <ArrowLeft size={14} /> Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[600px] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => navigate('/gerencia/formularios')}
          className="rounded-md p-1.5 text-brand-muted hover:bg-slate-100"
          aria-label="Volver"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="kicker">Constructor</p>
          <h1 className="truncate font-display text-lg font-bold text-brand-ink">
            {formulario.titulo}
          </h1>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            formulario.activo
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-slate-100 text-brand-muted',
          )}
        >
          {formulario.activo ? 'Activo' : 'Inactivo'}
        </span>
        <span className="hidden text-xs text-brand-muted sm:inline">
          v{formulario.version_actual ?? 1}
          {dirty && <span className="ml-1 text-amber-700">· sin guardar</span>}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setAjustesOpen(true)}>
            <Settings2 size={14} /> Ajustes
          </Button>
          <Link
            to={`/gerencia/formularios/${formulario.id}/versiones`}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-brand-muted hover:bg-slate-100"
          >
            <History size={14} /> Versiones
          </Link>
          <Button variant="ghost" onClick={() => setEmbedOpen(true)}>
            <Share2 size={14} /> Embed
          </Button>
          <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
            <Eye size={14} /> Vista previa
          </Button>
          <a
            href={`/formulario/${formulario.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-brand-ink hover:bg-slate-50"
          >
            <ExternalLink size={14} /> Probar en público
          </a>
          <Button variant="secondary" onClick={onToggleActivo}>
            {formulario.activo ? 'Desactivar' : 'Activar'}
          </Button>
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <FieldPalette />
        <CanvasFormulario
          schema={schema}
          selection={selection}
          onSelect={setSelection}
          onInsertField={onInsertField}
          onMoveField={onMoveField}
          onDuplicateField={onDuplicateField}
          onDeleteField={onDeleteField}
          onAddSection={onAddSection}
          onDeleteSection={onDeleteSection}
          onMoveSection={onMoveSection}
        />
        <PropertiesPanel
          schema={schema}
          selection={selection}
          onUpdateField={onUpdateField}
          onUpdateSection={onUpdateSection}
        />
      </div>

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        formulario={formulario}
        schema={schema}
      />
      <EmbedCodeModal
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        slug={formulario.slug}
      />
      {ajustesOpen && (
        <AjustesModal
          formulario={formulario}
          onClose={() => setAjustesOpen(false)}
          onSaved={(f) => {
            setFormulario(f);
            setAjustesOpen(false);
            toast.success('Ajustes guardados');
          }}
        />
      )}
    </div>
  );
}

function AjustesModal({
  formulario,
  onClose,
  onSaved,
}: {
  formulario: FormularioRow;
  onClose: () => void;
  onSaved: (f: FormularioRow) => void;
}) {
  const [titulo, setTitulo] = useState(formulario.titulo);
  const [descripcion, setDescripcion] = useState(formulario.descripcion ?? '');
  const [mensajeOk, setMensajeOk] = useState(formulario.mensaje_confirmacion);
  const [textosLegales, setTextosLegales] = useState(formulario.textos_legales ?? '');
  const [emails, setEmails] = useState((formulario.notificar_a_emails ?? []).join(', '));
  const [redirect, setRedirect] = useState(formulario.redirect_url_after ?? '');
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    setSaving(true);
    const res = await actualizarFormulario(formulario.id, {
      titulo,
      descripcion: descripcion || null,
      mensaje_confirmacion: mensajeOk,
      textos_legales: textosLegales || null,
      redirect_url_after: redirect || null,
      notificar_a_emails: emails
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: res.error.message });
      return;
    }
    onSaved(res.data);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ajustes del formulario"
      kicker="Configuración"
      width={560}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Título">
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <Field label="Descripción">
          <Textarea
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Field>
        <Field label="Mensaje al enviar" hint="Confirmación que ve el visitante.">
          <Textarea
            rows={2}
            value={mensajeOk}
            onChange={(e) => setMensajeOk(e.target.value)}
          />
        </Field>
        <Field label="URL de redirección post-envío (opcional)">
          <Input value={redirect} onChange={(e) => setRedirect(e.target.value)} />
        </Field>
        <Field label="Notificar a estos emails" hint="Coma-separados.">
          <Input value={emails} onChange={(e) => setEmails(e.target.value)} />
        </Field>
        <Field label="Textos legales / condiciones">
          <Textarea
            rows={3}
            value={textosLegales}
            onChange={(e) => setTextosLegales(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
