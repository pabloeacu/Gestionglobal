// EmailTemplatesPage · gestión de plantillas de email del motor workflow.
// Editor 2 columnas con autocomplete de variables {{var}}, preview en vivo
// desktop/mobile (iframe sandboxed) y botón de envío de prueba. Citas:
// regla 4 (queries en services/), regla 5 (encolar via RPC), regla 13
// (DialogProvider, sin window.confirm), D05/E42 (throttle email).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import {
  Mail,
  Eye,
  Save,
  Loader2,
  Sparkles,
  Send,
  Monitor,
  Smartphone,
  AlertTriangle,
} from 'lucide-react';
import {
  Drawer,
  Field,
  Input,
  Select,
  Button,
  AnimatedNumber,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  listTemplates,
  updateTemplate,
  previewTemplate,
  sendTestEmail,
  CASILLAS,
  type EmailTemplateRow,
  type FromCasilla,
} from '@/services/api/emails';

// Datos de muestra compartidos entre preview y "enviar prueba". Cubren las
// vars de los 11 templates sembrados; si falta alguna, el render devuelve ''.
const SAMPLE_VARS: Record<string, string> = {
  nombre: 'Diego García',
  nombre_administracion: 'Administración Norte SRL',
  numero_administracion: 'AG-00428',
  email: 'diego@ejemplo.com',
  fecha: '21/05/2026',
  fecha_inicio: '01/06/2026',
  fecha_vencimiento: '31/05/2026',
  vencimiento: '31/05/2026',
  monto: '$ 45.000',
  total: '$ 45.000',
  saldo_pendiente: '$ 45.000',
  tipo: 'FC',
  tipo_comprobante: 'Factura C',
  comprobante_tipo: 'FC',
  comprobante_numero: '00001-00000123',
  numero: '00001-00000123',
  dias_restantes: '10',
  dias_vencido: '7',
  link_portal: 'https://gestionglobal.ar/portal',
  link_descarga: 'https://gestionglobal.ar/descargar/abc',
  nombre_curso: 'Liquidación de expensas — nivel 2',
  asunto: 'Solicitud de baja de unidad',
  detalle_cierre: 'Resuelto: aplicamos la baja con vigencia retroactiva.',
  cuit: '30-71234567-8',
};

// Lista por defecto si el template no trae `variables`. Cubre las vars más
// comunes a través de todos los templates.
const FALLBACK_VARS = [
  'nombre',
  'email',
  'numero_administracion',
  'fecha',
  'monto',
  'tipo_comprobante',
  'link_portal',
  'link_descarga',
  'dias_restantes',
];

// Botones rápidos del toolbar — pares [label, var].
const QUICK_INSERT: { label: string; varName: string }[] = [
  { label: 'Nombre', varName: 'nombre' },
  { label: 'Monto', varName: 'total' },
  { label: 'Fecha', varName: 'fecha_vencimiento' },
  { label: 'CUIT', varName: 'cuit' },
  { label: 'Link', varName: 'link_portal' },
];

export function EmailTemplatesPage() {
  const [rows, setRows] = useState<EmailTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<EmailTemplateRow | null>(null);

  async function refresh() {
    const res = await listTemplates();
    if (res.ok) setRows(res.data);
    else toast.error('No pudimos cargar templates', { description: res.error.message });
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  const stats = useMemo(() => ({
    total: rows.length,
    activos: rows.filter(r => r.activo).length,
    casillas: new Set(rows.map(r => r.from_casilla)).size,
  }), [rows]);

  return (
    <div className="relative space-y-6">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      <header>
        <p className="kicker text-brand-cyan">Configuración · Emails</p>
        <h1 className="font-display text-2xl font-bold text-brand-ink">
          Plantillas de email
        </h1>
        <p className="mt-1 text-sm text-brand-muted">
          Cada plantilla define asunto + cuerpo + casilla. El motor de workflow las dispara con variables ({'{{nombre}}, {{numero}}…'}).
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Plantillas" value={stats.total} icon={Mail} />
        <Stat label="Activas" value={stats.activos} icon={Sparkles} />
        <Stat label="Casillas" value={stats.casillas} icon={Mail} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-brand-zebra/40 text-left text-xs uppercase tracking-wider text-brand-muted">
            <tr>
              <th className="px-4 py-2">Plantilla</th>
              <th className="px-4 py-2">Casilla</th>
              <th className="px-4 py-2">Asunto</th>
              <th className="px-4 py-2 text-center">Activo</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="py-10 text-center text-brand-muted">
                <Loader2 className="mx-auto animate-spin" size={18} />
              </td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={5}>
                <IllustratedEmpty
                  illustration="lista"
                  title="No hay plantillas todavía"
                  description="Las plantillas se sincronizan desde el repositorio. Si esperabas verlas acá, revisá la migración 0006_emails.sql."
                />
              </td></tr>
            )}
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-brand-zebra/30">
                <td className="px-4 py-2">
                  <p className="font-medium text-brand-ink">{t.nombre}</p>
                  <p className="font-mono text-[11px] text-brand-muted">{t.slug}</p>
                </td>
                <td className="px-4 py-2">
                  <CasillaBadge casilla={t.from_casilla as FromCasilla} />
                </td>
                <td className="px-4 py-2 max-w-md truncate text-brand-muted">{t.asunto}</td>
                <td className="px-4 py-2 text-center">
                  {t.activo ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">activo</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">pausado</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEdit(t)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
                  >
                    <Eye size={11} /> Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditTemplateDrawer
        template={edit}
        onClose={() => setEdit(null)}
        onSaved={() => { setEdit(null); void refresh(); }}
      />
    </div>
  );
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Mail }) {
  return (
    <div className="card-premium flex flex-col items-start gap-1 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-cyan">
        <Icon size={13} />
        {label}
      </div>
      <p className="font-display text-2xl font-bold tabular text-brand-ink">
        <AnimatedNumber value={value} />
      </p>
    </div>
  );
}

function CasillaBadge({ casilla }: { casilla: FromCasilla }) {
  const def = CASILLAS.find(c => c.value === casilla);
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-brand-cyan-pale px-2 py-0.5 text-[11px] font-semibold text-brand-cyan">
        {def?.label ?? casilla}
      </span>
      <span className="font-mono text-[10px] text-brand-muted">{def?.email}</span>
    </span>
  );
}

// =========================================================================
// Drawer de edición
// =========================================================================

interface EditDrawerProps {
  template: EmailTemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function EditTemplateDrawer({ template, onClose, onSaved }: EditDrawerProps) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<EmailTemplateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');

  useEffect(() => { setDraft(template); }, [template]);

  // Lista de variables conocidas para el autocomplete (de la columna
  // `variables` del template + fallback). Se usa para sugerir, no para
  // restringir — el editor permite escribir cualquier nombre.
  const knownVars = useMemo<string[]>(() => {
    if (!draft) return FALLBACK_VARS;
    const arr = Array.isArray(draft.variables) ? (draft.variables as string[]) : [];
    return arr.length > 0 ? arr : FALLBACK_VARS;
  }, [draft]);

  // Variables que el template *usa* pero no están en `knownVars` → warning.
  const unresolvedVars = useMemo<string[]>(() => {
    if (!draft) return [];
    const used = new Set<string>();
    const re = /\{\{\s*([\w.]+)\s*\}\}/g;
    [draft.asunto ?? '', draft.body_html ?? '', draft.body_text ?? ''].forEach((s) => {
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        if (m[1]) used.add(m[1]);
      }
    });
    return Array.from(used).filter(v => !knownVars.includes(v));
  }, [draft, knownVars]);

  // Preview con debounce 200 ms.
  const [debouncedDraft, setDebouncedDraft] = useState<EmailTemplateRow | null>(null);
  useEffect(() => {
    if (!draft) { setDebouncedDraft(null); return; }
    const t = setTimeout(() => setDebouncedDraft(draft), 200);
    return () => clearTimeout(t);
  }, [draft]);

  const preview = useMemo(() => {
    if (!debouncedDraft) return null;
    return previewTemplate(debouncedDraft, SAMPLE_VARS);
  }, [debouncedDraft]);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    const res = await updateTemplate(draft.id, {
      nombre: draft.nombre,
      asunto: draft.asunto,
      body_html: draft.body_html,
      body_text: draft.body_text,
      from_casilla: draft.from_casilla,
      reply_to: draft.reply_to,
      descripcion: draft.descripcion,
      activo: draft.activo,
      variables: draft.variables,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: res.error.message });
      return;
    }
    toast.success('Plantilla actualizada');
    onSaved();
  }

  async function handleTestSend() {
    if (!draft) return;
    const to = user?.email;
    if (!to) {
      toast.error('No hay email de destino', { description: 'Iniciá sesión para enviarte la prueba.' });
      return;
    }
    setSendingTest(true);
    const res = await sendTestEmail(draft.slug, to, SAMPLE_VARS);
    setSendingTest(false);
    if (!res.ok) {
      toast.error('No pudimos encolar la prueba', { description: res.error.message });
      return;
    }
    toast.success('Enviado a tu correo', { description: to });
  }

  if (!draft) return null;

  return (
    <Drawer
      open={!!template}
      onClose={onClose}
      kicker="Plantilla"
      title={draft.nombre}
      description={draft.slug}
      icon={<Mail size={18} />}
      width={1240}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => void handleTestSend()}
            disabled={sendingTest || !user?.email}
          >
            {sendingTest ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
            Enviar prueba a mí
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Guardar
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------------- Columna izquierda: editor ---------------- */}
        <div className="space-y-3">
          <Field label="Nombre">
            <Input value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />
          </Field>

          <Field label="Casilla (From)">
            <Select
              value={draft.from_casilla}
              onChange={(e) => setDraft({ ...draft, from_casilla: e.target.value })}
            >
              {CASILLAS.map(c => (
                <option key={c.value} value={c.value}>{c.label} · {c.email}</option>
              ))}
            </Select>
          </Field>

          <Field label="Asunto">
            <VarAutocompleteField
              kind="input"
              value={draft.asunto}
              onChange={(v) => setDraft({ ...draft, asunto: v })}
              knownVars={knownVars}
            />
          </Field>

          <Field label="Reply-To (opcional)">
            <Input
              value={draft.reply_to ?? ''}
              placeholder="(usa la casilla por default)"
              onChange={(e) => setDraft({ ...draft, reply_to: e.target.value || null })}
            />
          </Field>

          {/* Toolbar de inserción rápida */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-brand-muted">Insertar:</span>
            {QUICK_INSERT.map((q) => (
              <button
                key={q.varName}
                type="button"
                onClick={() => {
                  // Insertamos en el body_html al final del cursor del textarea
                  // activo (si existe), o al final del body.
                  insertAtActiveField(`{{${q.varName}}}`, (next) => setDraft({ ...draft, body_html: next }), draft.body_html, (next) => setDraft({ ...draft, asunto: next }), draft.asunto);
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-brand-ink hover:border-brand-cyan hover:text-brand-cyan"
              >
                [{q.label}]
              </button>
            ))}
          </div>

          <Field label="Body HTML">
            <VarAutocompleteField
              kind="textarea"
              value={draft.body_html}
              onChange={(v) => setDraft({ ...draft, body_html: v })}
              knownVars={knownVars}
              rows={14}
            />
          </Field>

          <Field label="Body texto plano (opcional)">
            <VarAutocompleteField
              kind="textarea"
              value={draft.body_text ?? ''}
              onChange={(v) => setDraft({ ...draft, body_text: v || null as unknown as string })}
              knownVars={knownVars}
              rows={4}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              checked={draft.activo}
              onChange={(e) => setDraft({ ...draft, activo: e.target.checked })}
            />
            Activo
          </label>

          {knownVars.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="kicker mb-2 text-brand-cyan">Variables disponibles</p>
              <div className="flex flex-wrap gap-1">
                {knownVars.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-brand-cyan ring-1 ring-brand-cyan/20"
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---------------- Columna derecha: preview ---------------- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="kicker text-brand-cyan">Preview</p>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setViewport('desktop')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  viewport === 'desktop'
                    ? 'bg-brand-cyan text-white shadow'
                    : 'text-brand-muted hover:text-brand-ink'
                }`}
              >
                <Monitor size={12} /> Desktop
              </button>
              <button
                type="button"
                onClick={() => setViewport('mobile')}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  viewport === 'mobile'
                    ? 'bg-brand-cyan text-white shadow'
                    : 'text-brand-muted hover:text-brand-ink'
                }`}
              >
                <Smartphone size={12} /> Mobile
              </button>
            </div>
          </div>

          {unresolvedVars.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 motion-safe:animate-fade-up">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Variables no listadas en este template:</p>
                <p className="mt-1 font-mono">
                  {unresolvedVars.map(v => `{{${v}}}`).join(' · ')}
                </p>
                <p className="mt-1 text-amber-700">
                  Quedarán vacías al renderizar a menos que el motor las pase.
                </p>
              </div>
            </div>
          )}

          <EmailPreviewFrame
            asunto={preview?.asunto ?? ''}
            html={preview?.html ?? ''}
            from={CASILLAS.find(c => c.value === draft.from_casilla)?.email ?? draft.from_casilla}
            toName={SAMPLE_VARS.nombre ?? 'Destinatario'}
            viewport={viewport}
          />

          {preview?.text && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="kicker mb-1 text-brand-muted">Texto plano</p>
              <pre className="whitespace-pre-wrap text-xs text-brand-ink">{preview.text}</pre>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// =========================================================================
// Insertador en el campo activo (helper para los botones del toolbar)
// =========================================================================

function insertAtActiveField(
  snippet: string,
  setBody: (v: string) => void,
  body: string,
  setAsunto: (v: string) => void,
  asunto: string,
) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
    const isBody = el.getAttribute('data-tpl-field') === 'body_html';
    const isAsunto = el.getAttribute('data-tpl-field') === 'asunto';
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const current = el.value;
    const next = current.slice(0, start) + snippet + current.slice(end);
    if (isBody) setBody(next);
    else if (isAsunto) setAsunto(next);
    else {
      // Fallback: insertamos al final del body.
      setBody(body + snippet);
      return;
    }
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
    return;
  }
  setBody(body + snippet);
  // evitamos lint unused
  void asunto;
}

// =========================================================================
// VarAutocompleteField · textarea/input con menú flotante al tipear {{
// =========================================================================

interface VarFieldProps {
  kind: 'input' | 'textarea';
  value: string;
  onChange: (v: string) => void;
  knownVars: string[];
  rows?: number;
}

function VarAutocompleteField({ kind, value, onChange, knownVars, rows = 10 }: VarFieldProps) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [menu, setMenu] = useState<{
    open: boolean;
    filter: string;
    /** índice del `{{` que dispara el menú */
    triggerAt: number;
    activeIdx: number;
  }>({ open: false, filter: '', triggerAt: -1, activeIdx: 0 });

  // Detecta si el cursor está dentro de un `{{filtro` aún sin cerrar `}}`.
  const recompute = useCallback((nextValue: string, caret: number) => {
    // Buscamos hacia atrás el último `{{` antes del caret.
    const upToCaret = nextValue.slice(0, caret);
    const lastOpen = upToCaret.lastIndexOf('{{');
    if (lastOpen === -1) {
      setMenu(m => ({ ...m, open: false }));
      return;
    }
    // Si entre `{{` y caret aparece `}}` o salto de línea, el menú ya cerró.
    const between = upToCaret.slice(lastOpen + 2);
    if (/[}\n]/.test(between)) {
      setMenu(m => ({ ...m, open: false }));
      return;
    }
    setMenu({
      open: true,
      filter: between.trim(),
      triggerAt: lastOpen,
      activeIdx: 0,
    });
  }, []);

  const onValueChange = (e: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    const caret = e.target.selectionStart ?? v.length;
    recompute(v, caret);
  };

  // Sugerencias filtradas.
  const suggestions = useMemo(() => {
    const f = menu.filter.toLowerCase();
    return knownVars
      .filter(v => v.toLowerCase().includes(f))
      .slice(0, 8);
  }, [knownVars, menu.filter]);

  const insertVar = useCallback((varName: string) => {
    const el = ref.current;
    if (!el) return;
    const before = value.slice(0, menu.triggerAt);
    const caret = el.selectionStart ?? value.length;
    const after = value.slice(caret);
    const insert = `{{${varName}}}`;
    const next = before + insert + after;
    onChange(next);
    setMenu(m => ({ ...m, open: false }));
    requestAnimationFrame(() => {
      el.focus();
      const pos = before.length + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }, [menu.triggerAt, onChange, value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!menu.open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMenu(m => ({ ...m, activeIdx: (m.activeIdx + 1) % suggestions.length }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMenu(m => ({ ...m, activeIdx: (m.activeIdx - 1 + suggestions.length) % suggestions.length }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const pick = suggestions[menu.activeIdx] ?? suggestions[0];
      if (pick) insertVar(pick);
    } else if (e.key === 'Escape') {
      setMenu(m => ({ ...m, open: false }));
    }
  };

  const fieldAttr = kind === 'textarea' ? 'body_html' : 'asunto';

  const commonClasses = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-brand-ink shadow-sm focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/30 focus:outline-none';

  return (
    <div className="relative">
      {kind === 'textarea' ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          data-tpl-field={fieldAttr}
          value={value}
          onChange={onValueChange}
          onKeyDown={onKeyDown}
          onClick={(e) => recompute(value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          rows={rows}
          className={`${commonClasses} font-mono text-xs leading-relaxed`}
          spellCheck={false}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          data-tpl-field={fieldAttr}
          type="text"
          value={value}
          onChange={onValueChange}
          onKeyDown={onKeyDown}
          onClick={(e) => recompute(value, (e.target as HTMLInputElement).selectionStart ?? 0)}
          className={commonClasses}
        />
      )}

      {menu.open && suggestions.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white shadow-xl motion-safe:animate-fade-up"
          role="listbox"
        >
          <p className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
            Variables · ↑↓ + Enter
          </p>
          {suggestions.map((v, i) => (
            <button
              key={v}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertVar(v); }}
              onMouseEnter={() => setMenu(m => ({ ...m, activeIdx: i }))}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs ${
                i === menu.activeIdx
                  ? 'bg-brand-cyan-pale/60 text-brand-cyan'
                  : 'text-brand-ink hover:bg-slate-50'
              }`}
              role="option"
              aria-selected={i === menu.activeIdx}
            >
              <span className="font-mono">{`{{${v}}}`}</span>
              <span className="text-[10px] text-brand-muted">{SAMPLE_VARS[v] ?? '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// EmailPreviewFrame · iframe sandboxed con header simulado de cliente email
// =========================================================================

interface PreviewProps {
  asunto: string;
  html: string;
  from: string;
  toName: string;
  viewport: 'desktop' | 'mobile';
}

function EmailPreviewFrame({ asunto, html, from, toName, viewport }: PreviewProps) {
  const width = viewport === 'desktop' ? 720 : 360;

  // Generamos el documento del iframe. NO incluimos scripts del padre — sólo
  // un estilo base para que el HTML del template se vea con tipografía sana.
  const srcDoc = useMemo(() => {
    const base = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; line-height: 1.55; margin: 0; padding: 20px; background: #ffffff; font-size: ${viewport === 'mobile' ? '14px' : '15px'}; }
      a { color: #0891b2; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
    </style></head><body>${html || '<p style="color:#94a3b8">(cuerpo vacío)</p>'}</body></html>`;
    return base;
  }, [html, viewport]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg transition-all duration-300"
        style={{ width }}
      >
        {/* Header simulado tipo Gmail */}
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
          <p className="truncate text-sm font-semibold text-brand-ink">{asunto || '(sin asunto)'}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-brand-muted">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-cyan/15 font-semibold text-brand-cyan">
              {(from?.[0] ?? 'G').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 truncate">
              <span className="font-medium text-brand-ink">{from}</span>
              <span className="mx-1">→</span>
              <span>{toName}</span>
            </div>
          </div>
        </div>

        {/* Body en iframe sandboxed */}
        <iframe
          title="preview-email"
          sandbox=""
          srcDoc={srcDoc}
          className="w-full"
          style={{ height: viewport === 'mobile' ? 480 : 520, border: 0, background: '#ffffff' }}
        />
      </div>
      <p className="font-mono text-[10px] text-brand-muted">
        {viewport === 'desktop' ? '720 × auto' : '360 × auto'}
      </p>
    </div>
  );
}
