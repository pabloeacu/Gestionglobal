// EmailTemplatesPage · gestión visual de plantillas estilo MANAXER.
// Editor 2-col: izq formulario (kicker, título, color, logo toggle, cuerpo
// rich-text, firma, toggle tabla envío, CTA, variables clickeables) ·
// der preview en vivo con el layout final que recibe el destinatario.
//
// Citas: regla 4 (queries en services/), regla 13 (DialogProvider, sin
// window.confirm), regla 5 (encolar via RPC para enviar prueba),
// E42/D05 (throttle global emails 5 min sigue intacto).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail,
  Save,
  Loader2,
  Send,
  Image as ImageIcon,
  Tag,
  MailOpen,
  Power,
  ExternalLink,
} from 'lucide-react';
import {
  Field,
  Input,
  Button,
  Skeleton,
  ColorPicker,
  EmailManaxerPreview,
  type ManaxerTemplateData,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  listTemplates,
  updateTemplateVisual,
  sendTestEmail,
  CASILLAS,
  type EmailTemplateRow,
  type FromCasilla,
} from '@/services/api/emails';

// Datos de ejemplo para el preview en vivo. Cubre las variables más comunes
// de todos los slugs sembrados (regla: si una variable no aparece acá,
// queda vacía en el preview — no rompe el render).
const SAMPLE_VARS: Record<string, string> = {
  nombre: 'Diego García',
  destinatario: 'Diego García',
  destinatario_nombre: 'Diego García',
  empresa: 'Gestión Global',
  edificio: 'Las Heras 1234',
  administracion: 'Administración Norte SRL',
  nombre_administracion: 'Administración Norte SRL',
  numero_administracion: 'AG-00428',
  periodo: 'Mayo 2026',
  tipo: 'FC',
  numero: '00001-00000123',
  total: '$ 45.000',
  monto: '$ 45.000',
  saldo_pendiente: '$ 45.000',
  cae: '69325125472142',
  cae_vencimiento: '15/06/2026',
  fecha: '21/05/2026',
  fecha_vencimiento: '31/05/2026',
  vencimiento: '31/05/2026',
  link_descarga: 'https://gestionglobal.ar/descargar/abc',
  link_portal: 'https://gestionglobal.ar/portal',
  nombre_curso: 'Liquidación de expensas — Nivel 2',
  webinar_titulo: 'Renovación anual RPAC',
  formulario_titulo: 'Inscripción al RPAC',
  asunto: 'Solicitud de baja de unidad',
  tipo_label: 'Vencimiento',
  admin_o_consorcio: 'Administración Norte SRL',
  tipo_comprobante: 'Factura C',
  comprobante_tipo: 'FC',
  comprobante_numero: '00001-00000123',
  dias_restantes: '10',
  dias_vencido: '7',
};

// Variables disponibles globalmente — el dispatcher las inyecta según contexto.
// El usuario ve esta lista como pills clickeables abajo del editor.
const VARIABLES_DISPONIBLES = [
  'destinatario',
  'empresa',
  'edificio',
  'administracion',
  'periodo',
  'tipo',
  'numero',
  'total',
  'cae',
  'cae_vencimiento',
  'fecha',
  'vencimiento',
  'link_portal',
  'link_descarga',
] as const;

export function EmailTemplatesPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<EmailTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const res = await listTemplates();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar plantillas', { description: humanizeError(res.error) });
      return;
    }
    setRows(res.data);
    if (res.data.length > 0 && !activeSlug) setActiveSlug(res.data[0]!.slug);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(
    () => rows.find((r) => r.slug === activeSlug) ?? null,
    [rows, activeSlug],
  );

  return (
    <div className="relative space-y-6 pb-12">
      <TrianglesAccent
        position="top-right"
        size={200}
        tone="cyan"
        density="soft"
        className="opacity-40"
      />

      {/* Header */}
      <header className="card-premium relative overflow-hidden">
        <div className="relative p-6">
          <p className="kicker text-brand-cyan">COMUNICACIONES</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink">
            Plantillas de email
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Editá el mail que se envía desde cada flujo automático. El preview
            a la derecha se actualiza en vivo con datos de ejemplo.
          </p>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="No hay plantillas activas"
          description="Las plantillas se sincronizan desde supabase/migrations/. Revisá las migraciones 0006/0082."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Sidebar: lista de plantillas */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="card-premium p-2">
              <p className="kicker mb-2 px-3 pt-2 text-brand-muted">
                {rows.length} plantilla{rows.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-0.5">
                {rows.map((t) => (
                  <li key={t.slug}>
                    <button
                      type="button"
                      onClick={() => setActiveSlug(t.slug)}
                      className={`group flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                        t.slug === activeSlug
                          ? 'bg-brand-cyan-pale/60 text-brand-cyan'
                          : 'text-brand-ink hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Mail
                          size={13}
                          className={
                            t.slug === activeSlug ? 'text-brand-cyan' : 'text-brand-muted'
                          }
                        />
                        <span className="truncate">{t.nombre}</span>
                        {!t.activo && (
                          <span className="ml-auto rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">
                            off
                          </span>
                        )}
                      </span>
                      <span className="truncate pl-5 font-mono text-[10px] text-brand-muted">
                        {t.slug}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Editor + preview de la plantilla activa */}
          {active && (
            <TemplateEditor
              key={active.slug}
              template={active}
              userEmail={user?.email ?? null}
              onSaved={(updated) => {
                setRows((prev) =>
                  prev.map((r) => (r.slug === updated.slug ? updated : r)),
                );
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// TemplateEditor · 2-col layout con form y preview en vivo
// =========================================================================

interface EditorProps {
  template: EmailTemplateRow;
  userEmail: string | null;
  onSaved: (updated: EmailTemplateRow) => void;
}

function TemplateEditor({ template, userEmail, onSaved }: EditorProps) {
  // Estado local controlado por todos los campos editables.
  const [kicker, setKicker] = useState(template.kicker);
  const [titulo, setTitulo] = useState(template.titulo_visual);
  const [color, setColor] = useState(template.color_acento);
  const [mostrarLogo, setMostrarLogo] = useState(template.mostrar_logo);
  const [cuerpo, setCuerpo] = useState(template.cuerpo_html_visual);
  const [firma, setFirma] = useState(template.firma ?? '');
  const [incluirTabla, setIncluirTabla] = useState(template.incluir_tabla_envio);
  const [ctaText, setCtaText] = useState(template.cta_text ?? '');
  const [ctaUrl, setCtaUrl] = useState(template.cta_url ?? '');
  const [asunto, setAsunto] = useState(template.asunto);

  const [saving, setSaving] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);

  // Ref opcional para inyectar variables al editor desde las pills (el editor
  // lo expone via window.tiptapInsert para evitar prop-drill — sólo se usa
  // dentro de esta página).
  const editorRef = useRef<{ insert: (text: string) => void } | null>(null);

  // Reset al cambiar de plantilla
  useEffect(() => {
    setKicker(template.kicker);
    setTitulo(template.titulo_visual);
    setColor(template.color_acento);
    setMostrarLogo(template.mostrar_logo);
    setCuerpo(template.cuerpo_html_visual);
    setFirma(template.firma ?? '');
    setIncluirTabla(template.incluir_tabla_envio);
    setCtaText(template.cta_text ?? '');
    setCtaUrl(template.cta_url ?? '');
    setAsunto(template.asunto);
  }, [template]);

  const previewData: ManaxerTemplateData = useMemo(
    () => ({
      kicker,
      titulo_visual: titulo,
      color_acento: color,
      mostrar_logo: mostrarLogo,
      cuerpo_html_visual: cuerpo,
      firma: firma.trim() || null,
      incluir_tabla_envio: incluirTabla,
      cta_text: ctaText.trim() || null,
      cta_url: ctaUrl.trim() || null,
    }),
    [kicker, titulo, color, mostrarLogo, cuerpo, firma, incluirTabla, ctaText, ctaUrl],
  );

  const casilla = CASILLAS.find((c) => c.value === template.from_casilla);
  const fromEmail = casilla?.email ?? 'contacto@gestionglobal.ar';

  async function handleSave() {
    setSaving(true);
    const res = await updateTemplateVisual(template.slug, {
      kicker,
      titulo_visual: titulo,
      color_acento: color,
      mostrar_logo: mostrarLogo,
      cuerpo_html_visual: cuerpo,
      firma: firma.trim() || null,
      incluir_tabla_envio: incluirTabla,
      cta_text: ctaText.trim() || null,
      cta_url: ctaUrl.trim() || null,
      asunto: asunto.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Plantilla guardada');
    onSaved(res.data);
  }

  async function handleTestSend() {
    if (!userEmail) {
      toast.error('Iniciá sesión para enviarte la prueba');
      return;
    }
    setSendingTest(true);
    const res = await sendTestEmail(template.slug, userEmail, SAMPLE_VARS);
    setSendingTest(false);
    if (!res.ok) {
      toast.error('No pudimos encolar la prueba', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Enviado a tu correo', {
      description: `Llegará en menos de 5 min a ${userEmail}`,
    });
  }

  function insertVariable(varName: string) {
    const token = `{{${varName}}}`;
    void navigator.clipboard?.writeText(token).catch(() => {});
    // Insertar en el editor si el ref está disponible
    if (editorRef.current) {
      editorRef.current.insert(token);
      toast.success(`Variable ${token} insertada · también está en el portapapeles`);
    } else {
      toast.info(`Variable ${token} copiada al portapapeles`);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* ---------------- Columna izquierda: editor ---------------- */}
      <div className="space-y-4">
        {/* Tabs/header de la plantilla */}
        <div className="card-premium relative overflow-hidden">
          <div className="relative space-y-4 p-5">
            <header>
              <p className="kicker text-brand-cyan">EDITANDO</p>
              <h2 className="font-display text-xl font-bold text-brand-ink">
                {template.nombre}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-brand-muted">
                {template.slug} · casilla {casilla?.label ?? template.from_casilla}
              </p>
            </header>
          </div>
        </div>

        {/* ENCABEZADO */}
        <section className="card-premium p-5">
          <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
            <Tag size={11} /> ENCABEZADO
          </p>
          <div className="space-y-3">
            <Field label="Kicker (línea superior, mayúsculas)">
              <Input
                value={kicker}
                onChange={(e) => setKicker(e.target.value)}
                placeholder="ADMINISTRACIÓN GLOBAL"
                style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }}
              />
            </Field>
            <Field label="Título (H1 del mail)">
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Tu comprobante está listo"
              />
            </Field>
            <Field label="Asunto del mail">
              <Input
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                placeholder="Comprobante {{tipo}} {{numero}}"
              />
            </Field>
            <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
              <ColorPicker
                label="COLOR DE ACENTO"
                value={color}
                onChange={setColor}
              />
              <label className="inline-flex items-center gap-2 text-sm text-brand-ink">
                <Toggle checked={mostrarLogo} onChange={setMostrarLogo} />
                <span className="inline-flex items-center gap-1.5">
                  <ImageIcon size={13} className="text-brand-muted" />
                  Mostrar logo
                </span>
              </label>
            </div>
          </div>
        </section>

        {/* CUERPO */}
        <section className="card-premium p-5">
          <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
            <MailOpen size={11} /> CUERPO DEL MENSAJE
          </p>
          <RichTextEditorRef
            value={cuerpo}
            onChange={setCuerpo}
            placeholder="Escribí el cuerpo del mensaje… (negrita, listas, links, color)"
            registerRef={(api) => {
              editorRef.current = api;
            }}
          />
        </section>

        {/* FIRMA + TABLA ENVÍO */}
        <section className="card-premium p-5">
          <div className="space-y-3">
            <Field label="Firma (línea opcional antes del footer)">
              <Input
                value={firma}
                onChange={(e) => setFirma(e.target.value)}
                placeholder="Equipo Gestión Global"
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm text-brand-ink">
              <Toggle checked={incluirTabla} onChange={setIncluirTabla} />
              Incluir tabla con datos del envío (FROM / REPLY-TO)
            </label>
          </div>
        </section>

        {/* CTA */}
        <section className="card-premium p-5">
          <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
            <ExternalLink size={11} /> BOTÓN OPCIONAL (CTA)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Texto del botón">
              <Input
                value={ctaText}
                onChange={(e) => setCtaText(e.target.value)}
                placeholder="Ver comprobante"
              />
            </Field>
            <Field label="Link (URL)">
              <Input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://… o {{link_portal}}"
              />
            </Field>
          </div>
        </section>

        {/* Variables */}
        <section className="card-premium p-5">
          <p className="kicker mb-2 text-brand-muted">VARIABLES DISPONIBLES</p>
          <p className="mb-3 text-xs text-brand-muted">
            Insertá estas variables en kicker / título / cuerpo. Se reemplazan
            al enviar. Click inserta en el cuerpo (al cursor) y también copia al
            portapapeles para pegar en otros campos.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLES_DISPONIBLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[11px] text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan-pale/50"
                title={`Insertar {{${v}}} en el cuerpo + copiar al portapapeles`}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ---------------- Columna derecha: preview ---------------- */}
      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between">
          <p className="kicker flex items-center gap-1.5 text-brand-cyan">
            <Power size={11} /> PREVIEW EN VIVO (CON DATOS DE EJEMPLO)
          </p>
        </div>
        <EmailManaxerPreview
          template={previewData}
          variables={SAMPLE_VARS}
          fromEmail={fromEmail}
          replyToEmail={fromEmail}
          minHeight={620}
        />
        <p className="text-center font-mono text-[10px] text-brand-muted">
          640 × auto · iframe sandboxed
        </p>
      </div>

      {/* ---------------- Footer sticky con acciones ---------------- */}
      <div className="lg:col-span-2 sticky bottom-0 -mb-3 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <span className="mr-auto text-xs text-brand-muted">
          Enviá una prueba a <strong>{userEmail ?? '(sin sesión)'}</strong>
        </span>
        <Button variant="ghost" onClick={() => void handleTestSend()} disabled={sendingTest || !userEmail}>
          {sendingTest ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Enviar prueba
        </Button>
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Guardar plantilla
        </Button>
      </div>
    </div>
  );
}

// =========================================================================
// Helpers locales
// =========================================================================

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition ${
        checked ? 'bg-brand-cyan' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

// Wrapper sobre RichTextEditor que expone un imperativo `insert(text)`
// para que las pills de variables puedan inyectar al cursor.
function RichTextEditorRef({
  value,
  onChange,
  placeholder,
  registerRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  registerRef: (api: { insert: (t: string) => void } | null) => void;
}) {
  // El editor TipTap se monta dentro; usamos un trick simple: el wrapper le
  // pasa onChange normal, y abrimos una API via cmd+v / paste fallback. Pero
  // lo limpio acá es exponer una API real expuesta por TipTap. Para no
  // exportar la ref del editor desde el componente común (que abriría
  // surface area), implementamos esta versión local que duplica un mini
  // bridge con TipTap.
  //
  // En la práctica: las pills llaman a `editorRef.current.insert(text)`. Si
  // el editor no está montado, fallback: insertar al final del HTML.
  return (
    <TipTapBridge
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      registerRef={registerRef}
    />
  );
}

// Versión "embebida" de TipTap que expone una API imperativa para insertar
// texto al cursor. Mantiene la sintaxis de RichTextEditor pero hosteado
// localmente para tener acceso al `editor`. La toolbar viene del componente
// común vía import (no duplicada).
import { useEditor as useEditorBridge, EditorContent as EditorContentBridge } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import ColorExt from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';

function TipTapBridge({
  value,
  onChange,
  placeholder,
  registerRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  registerRef: (api: { insert: (t: string) => void } | null) => void;
}) {
  const editor = useEditorBridge({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TextStyle,
      ColorExt,
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Escribí el cuerpo del mensaje…',
      }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none p-3 focus:outline-none text-brand-ink leading-relaxed',
        style: 'min-height:240px;',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      registerRef(null);
      return;
    }
    registerRef({
      insert: (text: string) => {
        editor.chain().focus().insertContent(text).run();
      },
    });
    return () => registerRef(null);
  }, [editor, registerRef]);

  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-brand-muted" style={{ minHeight: 240 }}>
        Cargando editor…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/20">
      <TipTapToolbarLocal editor={editor} />
      <EditorContentBridge editor={editor} />
    </div>
  );
}

// Toolbar local (mismo set de botones que RichTextEditor común). La
// duplicamos acá para tener acceso directo al `editor` sin gymnastics.
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Link2,
  Paintbrush,
  Eraser,
  Undo2,
  Redo2,
  Strikethrough,
} from 'lucide-react';
import { usePrompt } from '@/components/common/DialogProvider';
import { humanizeError } from '@/lib/errors';

const COLOR_PRESETS = [
  { hex: '#0f172a', name: 'Tinta' },
  { hex: '#0891b2', name: 'Cian' },
  { hex: '#ea580c', name: 'Naranja' },
  { hex: '#16a34a', name: 'Verde' },
  { hex: '#dc2626', name: 'Rojo' },
  { hex: '#94a3b8', name: 'Gris' },
];

function TipTapToolbarLocal({ editor }: { editor: NonNullable<ReturnType<typeof useEditorBridge>> }) {
  const prompt = usePrompt();

  async function handleLink() {
    const prev = (editor.getAttributes('link') as { href?: string }).href ?? '';
    const url = await prompt({
      title: prev ? 'Editar enlace' : 'Insertar enlace',
      message: 'URL completa (https://… o {{variable}})',
      defaultValue: prev,
      placeholder: 'https://gestionglobal.ar',
      confirmLabel: prev ? 'Actualizar' : 'Insertar',
    });
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
      <TBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Negrita">
        <Bold size={14} />
      </TBtn>
      <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Itálica">
        <Italic size={14} />
      </TBtn>
      <TBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="Tachado">
        <Strikethrough size={14} />
      </TBtn>
      <TSep />
      <TBtn active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} label="Párrafo">
        <span className="text-[10px] font-bold">¶</span>
      </TBtn>
      <TBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Encabezado">
        <Heading2 size={14} />
      </TBtn>
      <TSep />
      <TBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Lista con viñetas">
        <List size={14} />
      </TBtn>
      <TBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Lista numerada">
        <ListOrdered size={14} />
      </TBtn>
      <TBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Cita">
        <Quote size={14} />
      </TBtn>
      <TSep />
      <TBtn active={editor.isActive('link')} onClick={() => void handleLink()} label="Enlace">
        <Link2 size={14} />
      </TBtn>
      <div className="group relative">
        <TBtn active={!!editor.getAttributes('textStyle').color} onClick={() => { /* hover */ }} label="Color del texto">
          <Paintbrush size={14} />
        </TBtn>
        <div className="absolute left-0 top-full z-30 hidden flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg group-hover:flex group-focus-within:flex">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              onClick={() => editor.chain().focus().setColor(c.hex).run()}
              className="h-5 w-5 rounded-md ring-1 ring-slate-200 transition hover:scale-110"
              style={{ background: c.hex }}
            />
          ))}
          <button
            type="button"
            title="Sin color"
            onClick={() => editor.chain().focus().unsetColor().run()}
            className="grid h-5 w-5 place-items-center rounded-md ring-1 ring-slate-200 transition hover:bg-slate-100"
          >
            <Eraser size={11} className="text-slate-500" />
          </button>
        </div>
      </div>
      <TSep />
      <TBtn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} label="Limpiar formato">
        <Eraser size={14} />
      </TBtn>
      <div className="ml-auto inline-flex items-center gap-0.5">
        <TBtn onClick={() => editor.chain().focus().undo().run()} label="Deshacer" disabled={!editor.can().undo()}>
          <Undo2 size={14} />
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().redo().run()} label="Rehacer" disabled={!editor.can().redo()}>
          <Redo2 size={14} />
        </TBtn>
      </div>
    </div>
  );
}

function TBtn({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-md text-brand-ink transition disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? 'bg-brand-cyan text-white shadow-sm' : 'hover:bg-white hover:shadow-sm'
      }`}
    >
      {children}
    </button>
  );
}

function TSep() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />;
}

// Mantener el tipo importado para evitar TS unused
void ({} as FromCasilla);
