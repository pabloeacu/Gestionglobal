// EmailTemplatesPage · gestión de plantillas de email del motor workflow.
// Tabla simple + Drawer para editar body con preview en vivo. Cita:
// regla 13 (DialogProvider, no window.confirm), AnimatedNumber, premium UX.

import { useEffect, useMemo, useState } from 'react';
import { Mail, Eye, Save, Loader2, Sparkles } from 'lucide-react';
import {
  Drawer,
  Field,
  Input,
  Select,
  Textarea,
  Button,
  AnimatedNumber,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import {
  listTemplates,
  updateTemplate,
  previewTemplate,
  CASILLAS,
  type EmailTemplateRow,
  type FromCasilla,
} from '@/services/api/emails';

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
              <tr><td colSpan={5} className="py-10 text-center text-brand-muted">
                No hay plantillas todavía.
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

interface EditDrawerProps {
  template: EmailTemplateRow | null;
  onClose: () => void;
  onSaved: () => void;
}

function EditTemplateDrawer({ template, onClose, onSaved }: EditDrawerProps) {
  const [draft, setDraft] = useState<EmailTemplateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});

  useEffect(() => {
    setDraft(template);
    if (template) {
      const vars: Record<string, string> = {};
      const arr = Array.isArray(template.variables) ? (template.variables as string[]) : [];
      arr.forEach(v => { vars[v] = `<${v}>`; });
      setPreviewVars(vars);
    } else setPreviewVars({});
  }, [template]);

  const preview = useMemo(() => {
    if (!draft) return null;
    return previewTemplate(draft, previewVars);
  }, [draft, previewVars]);

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

  if (!draft) return null;

  const varList: string[] = Array.isArray(draft.variables) ? (draft.variables as string[]) : [];

  return (
    <Drawer
      open={!!template}
      onClose={onClose}
      kicker="Plantilla"
      title={draft.nombre}
      description={draft.slug}
      icon={<Mail size={18} />}
      width={920}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Guardar
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
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
            <Input value={draft.asunto} onChange={(e) => setDraft({ ...draft, asunto: e.target.value })} />
          </Field>
          <Field label="Reply-To (opcional)">
            <Input
              value={draft.reply_to ?? ''}
              placeholder="(usa la casilla por default)"
              onChange={(e) => setDraft({ ...draft, reply_to: e.target.value || null })}
            />
          </Field>
          <Field label="Body HTML">
            <Textarea
              rows={10}
              className="font-mono text-xs"
              value={draft.body_html}
              onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
            />
          </Field>
          <Field label="Body texto plano (opcional)">
            <Textarea
              rows={4}
              className="font-mono text-xs"
              value={draft.body_text ?? ''}
              onChange={(e) => setDraft({ ...draft, body_text: e.target.value || null })}
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

          {varList.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="kicker mb-2 text-brand-cyan">Variables para el preview</p>
              <div className="grid grid-cols-2 gap-2">
                {varList.map((v) => (
                  <Field key={v} label={`{{${v}}}`}>
                    <Input
                      value={previewVars[v] ?? ''}
                      onChange={(e) => setPreviewVars({ ...previewVars, [v]: e.target.value })}
                    />
                  </Field>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <p className="kicker text-brand-cyan">Preview</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-brand-muted">Asunto:</p>
            <p className="font-medium text-brand-ink">{preview?.asunto}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white">
            <div
              className="email-preview p-4 text-sm"
              dangerouslySetInnerHTML={{ __html: preview?.html ?? '' }}
            />
          </div>
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
