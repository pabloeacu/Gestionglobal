// Editor visual del formulario. 3 columnas: paleta · canvas · propiedades.
// Estado del schema en memoria, persistido al hacer "Guardar". Cualquier
// cambio en el schema dispara el trigger SQL `formulario_versionado` que
// crea un snapshot automático.
//
// Cumple regla 13 (sin window.confirm): se usa useConfirm para eliminar
// secciones con campos dentro.

import { useEffect, useMemo, useRef, useState } from 'react';
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
  Check,
  CloudUpload,
  AlertTriangle,
  ShieldCheck,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button, Modal, Field, Input, Select, Textarea, useConfirm } from '@/components/common';
import { listWebinars, type WebinarRow } from '@/services/api/webinars';
import { toast } from '@/lib/toast';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { cn } from '@/lib/cn';
import {
  actualizarFormulario,
  autosaveSchema,
  guardarVersion,
  getFormularioPorId,
  validarSchema,
  type SchemaWarning,
} from '@/services/api/formularios-admin';
import type {
  FormularioRow,
  FormularioFieldDef,
  FormularioSchemaDef,
  FormularioSectionDef,
} from '@/services/api/formularios';
import { FieldPalette } from '../components/FieldPalette';
import { CanvasFormulario, makeFieldFromType } from '../components/CanvasFormulario';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { PreviewModal } from '../components/PreviewModal';
import { EmbedCodeModal } from '../components/EmbedCodeModal';
import { FIELD_TYPES, type Selection } from '../types';
import { humanizeError } from '@/lib/errors';

function emptySchema(): FormularioSchemaDef {
  // Bloque J / obs 14: todo formulario nuevo arranca con los 5 campos de
  // identificación estándar (Apellido, Nombre, DNI, CUIT, Email). Sirven
  // para el cross-match contra administraciones existentes (RPC
  // solicitud_match_cliente) y para que el wizard sepa si el solicitante ya
  // es cliente. El operador puede editarlos / borrarlos en el builder, pero
  // arrancar con ellos cubre el 90% de los casos.
  return {
    sections: [
      {
        title: 'Identificación',
        fields: [
          { name: 'apellido', type: 'text', label: 'Apellido', required: true },
          { name: 'nombre',   type: 'text', label: 'Nombre',   required: true },
          { name: 'dni',      type: 'text', label: 'DNI',      required: true },
          { name: 'cuit',     type: 'text', label: 'CUIT/CUIL', required: false },
          { name: 'email',    type: 'email', label: 'Correo electrónico', required: true },
        ],
      },
    ],
    submit_label: 'Enviar',
  };
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
  // 4.A · estado del autosave (estilo Google Docs).
  const [autosaveState, setAutosaveState] = useState<
    'idle' | 'pending' | 'saving' | 'saved'
  >('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [savedAgo, setSavedAgo] = useState<string>('');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipAutosave = useRef(true); // evita autosave en la carga inicial

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    void getFormularioPorId(id).then((res) => {
      setLoading(false);
      if (!res.ok) {
        toast.error('No pudimos cargar el formulario', { description: humanizeError(res.error) });
        return;
      }
      setFormulario(res.data);
      // 4.A · preferimos el borrador de autosave si es más reciente que el
      // schema versionado (el usuario cerró sin "Guardar versión").
      const draft = res.data.schema_draft as unknown as FormularioSchemaDef | null;
      const draftAt = res.data.schema_draft_at;
      const sch = (res.data.schema as unknown as FormularioSchemaDef | null) ?? emptySchema();
      if (draft && draft.sections && draftAt) {
        setSchema(draft);
        setLastSavedAt(new Date(draftAt));
        setAutosaveState('saved');
        setDirty(false);
      } else {
        setSchema(sch.sections ? sch : emptySchema());
      }
      skipAutosave.current = true;
    });
  }, [id]);

  // 4.A · autosave con debounce 1500ms ante cualquier cambio del schema.
  useEffect(() => {
    if (!formulario) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    setAutosaveState('pending');
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(async () => {
      setAutosaveState('saving');
      const res = await autosaveSchema(formulario.id, schema);
      if (!res.ok) {
        setAutosaveState('idle');
        toast.error('No pudimos guardar el borrador', { description: humanizeError(res.error) });
        return;
      }
      setLastSavedAt(new Date(res.data.at));
      setAutosaveState('saved');
    }, 1500);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // 4.A · refresca el texto "Guardado hace Xs" cada 15s.
  useEffect(() => {
    if (!lastSavedAt) return;
    const tick = () => {
      const secs = Math.round((Date.now() - lastSavedAt.getTime()) / 1000);
      if (secs < 5) setSavedAgo('recién');
      else if (secs < 60) setSavedAgo(`hace ${secs} s`);
      else if (secs < 3600) setSavedAgo(`hace ${Math.round(secs / 60)} min`);
      else setSavedAgo(`hace ${Math.round(secs / 3600)} h`);
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [lastSavedAt, autosaveState]);

  // 4.F · validación del schema en tiempo real.
  const warnings = useMemo(() => validarSchema(schema), [schema]);

  function scrollToWarning(w: SchemaWarning) {
    const id =
      w.fieldIdx !== undefined
        ? `fb-field-${w.sectionIdx}-${w.fieldIdx}`
        : `fb-section-${w.sectionIdx}`;
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (w.fieldIdx !== undefined) {
        setSelection({
          kind: 'field',
          value: { sectionIdx: w.sectionIdx, fieldIdx: w.fieldIdx },
        });
      } else {
        setSelection({ kind: 'section', value: { sectionIdx: w.sectionIdx } });
      }
    }
  }

  // ----- Mutaciones del schema (locales, persisten al "Guardar") -----
  //
  // 4.D · Undo / Redo (DGG-32). Cada llamada a `mutate(fn)` empuja el snapshot
  // previo al stack `past`. ⌘Z mueve `present → future` y pone el último
  // `past` como nuevo `present`. ⌘⇧Z o ⌘Y revierten. Capamos en HISTORY_CAP
  // (30 pasos) para no inflar memoria. Las acciones que vienen del propio
  // undo/redo NO se empujan al stack (skipHistory.current = true).
  const HISTORY_CAP = 30;
  const historyPast = useRef<FormularioSchemaDef[]>([]);
  const historyFuture = useRef<FormularioSchemaDef[]>([]);
  const skipHistory = useRef(false);
  const [historyCounts, setHistoryCounts] = useState<{ past: number; future: number }>({
    past: 0,
    future: 0,
  });

  function refreshHistoryCounts() {
    setHistoryCounts({
      past: historyPast.current.length,
      future: historyFuture.current.length,
    });
  }

  function mutate(fn: (s: FormularioSchemaDef) => FormularioSchemaDef) {
    setSchema((prev) => {
      if (!skipHistory.current) {
        historyPast.current.push(structuredClone(prev));
        if (historyPast.current.length > HISTORY_CAP) historyPast.current.shift();
        // Cualquier mutación nueva invalida el future stack.
        historyFuture.current = [];
      }
      skipHistory.current = false;
      const next = fn(structuredClone(prev));
      return next;
    });
    setDirty(true);
    // setState es asíncrono — diferimos a un microtask para que la lectura
    // de los refs sea consistente con el render que viene.
    queueMicrotask(refreshHistoryCounts);
  }

  function undo() {
    if (historyPast.current.length === 0) return;
    setSchema((current) => {
      const prev = historyPast.current.pop()!;
      historyFuture.current.unshift(structuredClone(current));
      if (historyFuture.current.length > HISTORY_CAP) historyFuture.current.pop();
      return prev;
    });
    skipHistory.current = true; // el próximo mutate no debe re-pushear
    setDirty(true);
    queueMicrotask(refreshHistoryCounts);
  }

  function redo() {
    if (historyFuture.current.length === 0) return;
    setSchema((current) => {
      const next = historyFuture.current.shift()!;
      historyPast.current.push(structuredClone(current));
      if (historyPast.current.length > HISTORY_CAP) historyPast.current.shift();
      return next;
    });
    skipHistory.current = true;
    setDirty(true);
    queueMicrotask(refreshHistoryCounts);
  }

  // Cuando recargamos el schema desde la BD (mount o reload), reseteamos
  // el historial — no tiene sentido "deshacer" una carga inicial.
  useEffect(() => {
    historyPast.current = [];
    historyFuture.current = [];
    setHistoryCounts({ past: 0, future: 0 });
  }, [formulario?.id]);

  // Atajos de teclado: ⌘Z = undo, ⌘⇧Z / ⌘Y = redo.
  // 4.B · ⌘+1..9 inserta el N-ésimo tipo de FIELD_TYPES en la sección
  // seleccionada (o la primera). Útil para construir formularios sin levantar
  // las manos del teclado. Si el foco está en input/textarea, no hace nada
  // (no pisamos el "ir a posición N" nativo de algunos browsers en text fields).
  useEffect(() => {
    function isEditableTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        redo();
      } else if (/^[1-9]$/.test(e.key)) {
        if (isEditableTarget(e.target)) return;
        const n = parseInt(e.key, 10) - 1;
        const fieldType = FIELD_TYPES[n];
        if (!fieldType) return;
        e.preventDefault();
        const targetSection =
          selection?.kind === 'section'
            ? selection.value.sectionIdx
            : selection?.kind === 'field'
              ? selection.value.sectionIdx
              : 0;
        const section = schema.sections[targetSection];
        if (!section) return;
        onInsertField(
          targetSection,
          section.fields.length,
          makeFieldFromType(fieldType.type, section),
        );
        toast.success(`Campo agregado · ${fieldType.label}`, { duration: 1500 });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, selection]);

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
        // Presentacionales (sin dato/sin key): no requieren `name`. Alineado con
        // el runner (FormularioRunner) y PropertiesPanel (F5 · consistencia).
        if (['separator', 'heading', 'html', 'file_download', 'costos_info'].includes(f.type)) continue;
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
    // 4.A · "Guardar versión" promueve el draft a schema (dispara versionado).
    const res = await guardarVersion(formulario.id, schema);
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    setFormulario(res.data);
    setDirty(false);
    setAutosaveState('saved');
    setLastSavedAt(new Date());
    toast.success('Versión guardada', {
      description: `v${res.data.version_actual ?? '?'} creada en el historial.`,
    });
  }

  async function onToggleActivo() {
    if (!formulario) return;
    const res = await actualizarFormulario(formulario.id, { activo: !formulario.activo });
    if (!res.ok) {
      toast.error('No pudimos cambiar el estado', { description: humanizeError(res.error) });
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
        </span>
        {/* 4.A · indicador discreto de autosave (estilo Google Docs). */}
        <span
          className="hidden items-center gap-1 text-xs sm:inline-flex"
          aria-live="polite"
        >
          {autosaveState === 'saving' || autosaveState === 'pending' ? (
            <span className="inline-flex items-center gap-1 text-brand-muted">
              <CloudUpload size={12} className="animate-pulse" /> Guardando…
            </span>
          ) : autosaveState === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-emerald-600">
              <Check size={12} /> Guardado {savedAgo}
              {dirty && (
                <span className="ml-1 text-amber-600">· versión sin guardar</span>
              )}
            </span>
          ) : null}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {/* 4.F · badge validador del schema en tiempo real. */}
          <ValidadorBadge warnings={warnings} onJump={scrollToWarning} />
          {/* 4.D · Undo / Redo (DGG-32). Atajos ⌘Z / ⌘⇧Z. */}
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={undo}
              disabled={historyCounts.past === 0}
              title={`Deshacer${historyCounts.past ? ` (${historyCounts.past})` : ''} · ⌘Z`}
              aria-label="Deshacer"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition',
                historyCounts.past > 0
                  ? 'text-brand-ink hover:bg-slate-100'
                  : 'cursor-not-allowed text-slate-300',
              )}
            >
              <Undo2 size={13} />
              {historyCounts.past > 0 && (
                <span className="tabular-nums">{historyCounts.past}</span>
              )}
            </button>
            <span className="h-4 w-px bg-slate-200" aria-hidden />
            <button
              type="button"
              onClick={redo}
              disabled={historyCounts.future === 0}
              title={`Rehacer${historyCounts.future ? ` (${historyCounts.future})` : ''} · ⌘⇧Z`}
              aria-label="Rehacer"
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition',
                historyCounts.future > 0
                  ? 'text-brand-ink hover:bg-slate-100'
                  : 'cursor-not-allowed text-slate-300',
              )}
            >
              <Redo2 size={13} />
              {historyCounts.future > 0 && (
                <span className="tabular-nums">{historyCounts.future}</span>
              )}
            </button>
          </div>
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
          {/* 4.A · el guardado es ahora opcional (autosave activo); este botón
              crea explícitamente una VERSIÓN en el historial. */}
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar versión
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <FieldPalette
          onClickAdd={(type) => {
            // Fallback confiable a DnD: insertamos al final de la sección
            // seleccionada o, si no hay selección, de la primera sección.
            const targetSection =
              selection?.kind === 'section'
                ? selection.value.sectionIdx
                : selection?.kind === 'field'
                  ? selection.value.sectionIdx
                  : 0;
            const section = schema.sections[targetSection];
            if (!section) return;
            onInsertField(targetSection, section.fields.length, makeFieldFromType(type, section));
          }}
        />
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
          formularioId={formulario.id}
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

// 4.F · badge "N advertencias" con popover que lista cada problema del schema.
// Click en una advertencia → scroll + selección del campo afectado.
function ValidadorBadge({
  warnings,
  onJump,
}: {
  warnings: SchemaWarning[];
  onJump: (w: SchemaWarning) => void;
}) {
  const [open, setOpen] = useState(false);
  const limpio = warnings.length === 0;

  // Cierra el popover al click afuera.
  useEffect(() => {
    if (!open) return;
    const onDoc = () => setOpen(false);
    window.addEventListener('click', onDoc);
    return () => window.removeEventListener('click', onDoc);
  }, [open]);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition',
          limpio
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
        )}
        title="Validez del schema"
        aria-expanded={open}
      >
        {limpio ? (
          <>
            <ShieldCheck size={14} /> Schema válido
          </>
        ) : (
          <>
            <AlertTriangle size={14} />
            {warnings.length}{' '}
            {warnings.length === 1 ? 'advertencia' : 'advertencias'}
          </>
        )}
      </button>
      {open && !limpio && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl motion-safe:animate-fade-in">
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
            Revisá antes de publicar
          </p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {warnings.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(w);
                    setOpen(false);
                  }}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-brand-ink transition hover:bg-amber-50"
                >
                  <AlertTriangle
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  <span>{w.mensaje}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
  // DGG-11/15: Webinar destino (sólo aplica si categoria='evento')
  const esEvento = formulario.categoria === 'evento';
  const [webinarId, setWebinarId] = useState<string | null>(
    (formulario as unknown as { webinar_id?: string | null }).webinar_id ?? null
  );
  const [webinars, setWebinars] = useState<WebinarRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!esEvento) return;
    void (async () => {
      const res = await listWebinars();
      if (res.ok) setWebinars(res.data);
    })();
  }, [esEvento]);

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
      webinar_id: esEvento ? webinarId : undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
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

        {esEvento && (
          <Field
            label="Evento destino"
            hint="DGG-11/15: el inscripto recibe magic-link automáticamente al enviar el formulario."
          >
            <Select
              value={webinarId ?? ''}
              onChange={(e) => setWebinarId(e.target.value || null)}
            >
              <option value="">— Sin evento vinculado —</option>
              {webinars.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.titulo} · {new Date(w.fecha_hora).toLocaleDateString('es-AR')}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
