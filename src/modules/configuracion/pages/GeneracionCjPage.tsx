// GeneracionCjPage · herramienta para generar documentos de Consultoría
// Jurídica con editor visual (estilo MANAXER · sin variables) + PDF
// descargable + historial en grilla.
//
// Citas: regla 4 (queries en services/), regla 13 (DialogProvider, sin
// window.confirm/alert).

import { useEffect, useMemo, useState } from 'react';
import {
  FileSignature,
  PlusCircle,
  Download,
  Mail,
  Trash2,
  Loader2,
  Save,
  X as XIcon,
  Image as ImageIcon,
  Tag,
  MailOpen,
  Eye,
  CheckCircle2,
  Send,
} from 'lucide-react';
import {
  Drawer,
  Field,
  Input,
  Button,
  Skeleton,
  ColorPicker,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  listarCjDocumentos,
  getCjDocumento,
  crearCjDocumento,
  actualizarCjDocumento,
  eliminarCjDocumento,
  subirPdfYMarcar,
  descargarPdf,
  enviarPdfPorEmail,
  type CjDocumento,
  type CjDocumentoListItem,
  type CjDocumentoInput,
} from '@/services/api/cj-documentos';
import { generarPdfBlob, descargarBlob, buildCjLayoutHtml } from '@/lib/cj-pdf';

// TipTap rich editor (reusamos el bridge que ya tenemos en EmailTemplatesPage,
// pero acá lo hacemos local para evitar dependencia cruzada). Importamos
// directo TipTap core.
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import ColorExt from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Strikethrough, List, ListOrdered, Quote, Heading2,
  Link2, Paintbrush, Eraser, Undo2, Redo2,
} from 'lucide-react';
import { usePrompt } from '@/components/common/DialogProvider';
import { humanizeError } from '@/lib/errors';

// =========================================================================
export function GeneracionCjPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<CjDocumentoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CjDocumento | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await listarCjDocumentos();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar el historial', { description: humanizeError(res.error) });
      return;
    }
    setRows(res.data);
  }

  useEffect(() => { void load(); }, []);

  async function openExisting(id: string) {
    setBusyId(id);
    const res = await getCjDocumento(id);
    setBusyId(null);
    if (!res.ok) {
      toast.error('No pudimos abrir el documento', { description: humanizeError(res.error) });
      return;
    }
    setEditing(res.data);
  }

  async function handleDescargar(row: CjDocumentoListItem) {
    if (!row.pdf_storage_path) {
      // Generar al vuelo desde el documento completo
      const full = await getCjDocumento(row.id);
      if (!full.ok) { toast.error('No pudimos cargar el documento'); return; }
      setBusyId(row.id);
      try {
        const blob = await generarPdfBlob(full.data);
        const upload = await subirPdfYMarcar(row.id, blob);
        if (!upload.ok) { toast.error('No pudimos guardar el PDF', { description: humanizeError(upload.error) }); return; }
        descargarBlob(blob, `CJ-${row.titulo.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`);
        toast.success('PDF generado y descargado');
        await load();
      } finally {
        setBusyId(null);
      }
      return;
    }
    setBusyId(row.id);
    const dl = await descargarPdf(row.pdf_storage_path);
    setBusyId(null);
    if (!dl.ok) { toast.error('No pudimos descargar el PDF', { description: humanizeError(dl.error) }); return; }
    descargarBlob(dl.data, `CJ-${row.titulo.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`);
  }

  async function handleEnviar(row: CjDocumentoListItem) {
    if (!row.destinatario_email) {
      toast.error('El destinatario no tiene email', { description: 'Editá el documento para agregar uno.' });
      return;
    }
    // Si no hay PDF, generarlo primero
    setBusyId(row.id);
    try {
      if (!row.pdf_storage_path) {
        const full = await getCjDocumento(row.id);
        if (!full.ok) { toast.error('No pudimos cargar el documento'); return; }
        const blob = await generarPdfBlob(full.data);
        const upload = await subirPdfYMarcar(row.id, blob);
        if (!upload.ok) { toast.error('No pudimos guardar el PDF', { description: humanizeError(upload.error) }); return; }
      }
      const send = await enviarPdfPorEmail(row.id);
      if (!send.ok) {
        toast.error('No pudimos enviar el email', { description: humanizeError(send.error) });
        return;
      }
      toast.success('Enviado', { description: `PDF enviado a ${row.destinatario_email}` });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleEliminar(row: CjDocumentoListItem) {
    const ok = await confirm({
      title: '¿Eliminar documento?',
      message: `Vas a eliminar la consultoría "${row.tema}" y su PDF. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    setBusyId(row.id);
    const res = await eliminarCjDocumento(row.id);
    setBusyId(null);
    if (!res.ok) { toast.error('No pudimos eliminar', { description: humanizeError(res.error) }); return; }
    toast.success('Documento eliminado');
    await load();
  }

  return (
    <div className="relative space-y-5 pb-12">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-30" />

      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
          <div>
            <p className="kicker text-brand-cyan">CONFIGURACIÓN · HERRAMIENTAS</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink">
              Generación CJ
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Compone documentos de Consultoría Jurídica y exportalos como PDF.
              Cada documento queda registrado en el historial.
            </p>
          </div>
          <Button onClick={() => setEditing('new')}>
            <PlusCircle size={15} /> Nueva consultoría
          </Button>
        </div>
      </section>

      {/* Grilla */}
      {loading ? (
        <div className="space-y-2">
          {[0,1,2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Sin documentos generados"
          description="Cuando crees tu primera consultoría jurídica aparecerá acá."
          action={
            <Button onClick={() => setEditing('new')}>
              <PlusCircle size={15} /> Crear la primera
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-brand-muted">
              <tr>
                <th className="px-4 py-2.5 w-[140px]">Fecha</th>
                <th className="px-4 py-2.5">Tema</th>
                <th className="px-4 py-2.5 w-[260px]">Destinatario</th>
                <th className="px-4 py-2.5 text-right w-[200px]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isBusy = busyId === r.id;
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-brand-zebra/30">
                    <td className="px-4 py-3 text-brand-muted tabular text-xs">
                      {new Date(r.created_at).toLocaleDateString('es-AR', {
                        day: '2-digit', month: 'short', year: '2-digit',
                      })}
                      <div className="text-[10px] text-brand-muted/70">
                        {new Date(r.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void openExisting(r.id)}
                        className="text-left font-medium text-brand-ink transition hover:text-brand-cyan"
                      >
                        {r.tema}
                      </button>
                      <p className="mt-0.5 truncate text-[11px] text-brand-muted">
                        {r.titulo}
                      </p>
                      <div className="mt-1 flex gap-1.5 text-[10px]">
                        {r.pdf_generated_at && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                            <CheckCircle2 size={9} /> PDF
                          </span>
                        )}
                        {r.last_emailed_at && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-cyan-pale px-1.5 py-0.5 font-semibold text-brand-cyan ring-1 ring-inset ring-brand-cyan/30">
                            <Send size={9} /> enviado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-ink">{r.destinatario_nombre}</p>
                      {r.destinatario_email && (
                        <p className="text-[11px] text-brand-muted">{r.destinatario_email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <ActionBtn
                          onClick={() => void handleDescargar(r)}
                          disabled={isBusy}
                          title="Descargar PDF"
                          tone="neutral"
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                        </ActionBtn>
                        <ActionBtn
                          onClick={() => void handleEnviar(r)}
                          disabled={isBusy || !r.destinatario_email}
                          title={r.destinatario_email ? 'Enviar por email' : 'Sin email destinatario'}
                          tone="cyan"
                        >
                          <Mail size={13} />
                        </ActionBtn>
                        <ActionBtn
                          onClick={() => void handleEliminar(r)}
                          disabled={isBusy}
                          title="Eliminar"
                          tone="danger"
                        >
                          <Trash2 size={13} />
                        </ActionBtn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor drawer */}
      {editing !== null && (
        <CjEditorDrawer
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

// =========================================================================
function ActionBtn({
  children, onClick, disabled, title, tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone: 'neutral' | 'cyan' | 'danger';
}) {
  const cls = {
    neutral: 'text-brand-ink hover:bg-slate-100',
    cyan:    'text-brand-cyan hover:bg-brand-cyan-pale/50',
    danger:  'text-rose-600 hover:bg-rose-50',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

// =========================================================================
// Drawer de edición (form + preview)
// =========================================================================
interface DrawerProps {
  initial: CjDocumento | null;
  onClose: () => void;
  onSaved: (doc: CjDocumento) => void;
}

function CjEditorDrawer({ initial, onClose, onSaved }: DrawerProps) {
  const [tema, setTema] = useState(initial?.tema ?? '');
  const [destNombre, setDestNombre] = useState(initial?.destinatario_nombre ?? '');
  const [destEmail, setDestEmail] = useState(initial?.destinatario_email ?? '');
  const [kicker, setKicker] = useState(initial?.kicker ?? 'CONSULTORÍA JURÍDICA');
  const [titulo, setTitulo] = useState(initial?.titulo ?? '');
  const [color, setColor] = useState(initial?.color_acento ?? '#0891b2');
  const [mostrarLogo, setMostrarLogo] = useState(initial?.mostrar_logo ?? true);
  const [cuerpo, setCuerpo] = useState(initial?.cuerpo_html ?? '<p></p>');
  const [firma, setFirma] = useState(initial?.firma ?? 'Equipo de Consultoría Jurídica · Gestión Global');

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const isEdit = !!initial;

  function buildInput(): CjDocumentoInput {
    return {
      tema: tema.trim(),
      destinatario_nombre: destNombre.trim(),
      destinatario_email: destEmail.trim() || null,
      kicker: kicker.trim(),
      titulo: titulo.trim(),
      color_acento: color,
      mostrar_logo: mostrarLogo,
      cuerpo_html: cuerpo,
      firma: firma.trim() || null,
    };
  }

  function validate(): string | null {
    if (!tema.trim()) return 'El tema es obligatorio (resumen para la grilla).';
    if (!destNombre.trim()) return 'Falta el nombre del destinatario.';
    if (!titulo.trim()) return 'Falta el título del documento.';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return 'Color de acento inválido (hex).';
    return null;
  }

  async function handleGuardar(): Promise<CjDocumento | null> {
    const err = validate();
    if (err) { toast.error(err); return null; }
    setSaving(true);
    const input = buildInput();
    const res = isEdit
      ? await actualizarCjDocumento(initial!.id, input)
      : await crearCjDocumento(input);
    setSaving(false);
    if (!res.ok) { toast.error('No pudimos guardar', { description: humanizeError(res.error) }); return null; }
    toast.success(isEdit ? 'Documento actualizado' : 'Documento creado');
    return res.data;
  }

  async function handleGenerarPdf() {
    const saved = await handleGuardar();
    if (!saved) return;
    setGenerating(true);
    try {
      const blob = await generarPdfBlob({
        kicker: saved.kicker,
        titulo: saved.titulo,
        color_acento: saved.color_acento,
        mostrar_logo: saved.mostrar_logo,
        cuerpo_html: saved.cuerpo_html,
        firma: saved.firma,
        destinatario_nombre: saved.destinatario_nombre,
        destinatario_email: saved.destinatario_email,
      });
      const upload = await subirPdfYMarcar(saved.id, blob);
      if (!upload.ok) { toast.error('PDF generado pero no se pudo guardar', { description: humanizeError(upload.error) }); return; }
      descargarBlob(blob, `CJ-${saved.titulo.replace(/[^a-zA-Z0-9]+/g, '-')}.pdf`);
      toast.success('PDF generado y descargado');
      onSaved(saved);
    } catch (e) {
      toast.error('Error generando PDF', { description: humanizeError(e) });
    } finally {
      setGenerating(false);
    }
  }

  async function handleGuardarSolo() {
    const saved = await handleGuardar();
    if (saved) onSaved(saved);
  }

  // Preview en vivo (iframe sandboxed que muestra el layout PDF tal cual)
  const previewSrc = useMemo(() => buildCjLayoutHtml({
    kicker, titulo, color_acento: color, mostrar_logo: mostrarLogo,
    cuerpo_html: cuerpo, firma: firma.trim() || null,
    destinatario_nombre: destNombre || '(destinatario)',
    destinatario_email: destEmail.trim() || null,
  }), [kicker, titulo, color, mostrarLogo, cuerpo, firma, destNombre, destEmail]);

  return (
    <Drawer
      open
      onClose={onClose}
      kicker={isEdit ? 'EDITANDO' : 'NUEVA CONSULTORÍA'}
      title={tema || (isEdit ? initial!.tema : 'Sin tema')}
      icon={<FileSignature size={18} />}
      width={1280}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-brand-muted">
            {destEmail ? `Se podrá mailear a ${destEmail}` : 'Sin email destinatario — sólo PDF'}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="ghost" onClick={() => void handleGuardarSolo()} disabled={saving || generating}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Guardar
            </Button>
            <Button onClick={() => void handleGenerarPdf()} disabled={saving || generating}>
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Generar PDF
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Form izquierda */}
        <div className="space-y-4">
          <section className="card-premium p-5">
            <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
              <Tag size={11} /> METADATA
            </p>
            <div className="space-y-3">
              <Field label="Tema (resumen para la grilla)" required>
                <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Asamblea ordinaria · consulta Lic. Pérez" />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Destinatario" required>
                  <Input value={destNombre} onChange={(e) => setDestNombre(e.target.value)} placeholder="Lic. María Pérez" />
                </Field>
                <Field label="Email (opcional)">
                  <Input type="email" value={destEmail} onChange={(e) => setDestEmail(e.target.value)} placeholder="maria@ejemplo.com" />
                </Field>
              </div>
            </div>
          </section>

          <section className="card-premium p-5">
            <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
              <Tag size={11} /> ENCABEZADO
            </p>
            <div className="space-y-3">
              <Field label="Kicker (línea superior)">
                <Input value={kicker} onChange={(e) => setKicker(e.target.value)} placeholder="CONSULTORÍA JURÍDICA"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.1em' }} />
              </Field>
              <Field label="Título (H1)" required>
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Dictamen sobre régimen sancionatorio del CCCN" />
              </Field>
              <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                <ColorPicker label="COLOR DE ACENTO" value={color} onChange={setColor} />
                <label className="inline-flex items-center gap-2 text-sm text-brand-ink">
                  <Toggle checked={mostrarLogo} onChange={setMostrarLogo} />
                  <span className="inline-flex items-center gap-1.5">
                    <ImageIcon size={13} className="text-brand-muted" /> Mostrar logo
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section className="card-premium p-5">
            <p className="kicker mb-3 flex items-center gap-1.5 text-brand-muted">
              <MailOpen size={11} /> CUERPO DEL DOCUMENTO
            </p>
            <CjRichEditor value={cuerpo} onChange={setCuerpo} />
          </section>

          <section className="card-premium p-5">
            <Field label="Firma (línea final del documento)">
              <Input value={firma} onChange={(e) => setFirma(e.target.value)} placeholder="Equipo de Consultoría Jurídica · Gestión Global" />
            </Field>
          </section>
        </div>

        {/* Preview derecha */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <p className="kicker flex items-center gap-1.5 text-brand-cyan">
            <Eye size={11} /> PREVIEW EN VIVO · LAYOUT DEL PDF
          </p>
          <iframe
            title="cj-preview"
            sandbox=""
            srcDoc={previewSrc}
            className="w-full rounded-2xl bg-white shadow-md ring-1 ring-slate-200"
            style={{ minHeight: 720, border: 0 }}
          />
        </div>
      </div>
    </Drawer>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition ${checked ? 'bg-brand-cyan' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// =========================================================================
// Rich text editor para el cuerpo del documento (TipTap)
// =========================================================================
function CjRichEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TextStyle,
      ColorExt,
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({ placeholder: 'Escribí el cuerpo del documento…' }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none p-3 focus:outline-none text-brand-ink leading-relaxed',
        style: 'min-height:280px;',
      },
    },
    onUpdate({ editor }) { onChange(editor.getHTML()); },
  });

  const prompt = usePrompt();
  if (!editor) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-brand-muted" style={{ minHeight: 280 }}>
        Cargando editor…
      </div>
    );
  }

  async function handleLink() {
    const prev = (editor!.getAttributes('link') as { href?: string }).href ?? '';
    const url = await prompt({
      title: prev ? 'Editar enlace' : 'Insertar enlace',
      message: 'URL completa (https://…)',
      defaultValue: prev,
      placeholder: 'https://',
      confirmLabel: prev ? 'Actualizar' : 'Insertar',
    });
    if (url === null) return;
    if (url === '') { editor!.chain().focus().unsetLink().run(); return; }
    editor!.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  const colorPresets = [
    { hex: '#0f172a', name: 'Tinta' }, { hex: '#0891b2', name: 'Cian' },
    { hex: '#ea580c', name: 'Naranja' }, { hex: '#16a34a', name: 'Verde' },
    { hex: '#dc2626', name: 'Rojo' }, { hex: '#94a3b8', name: 'Gris' },
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
        <TBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Negrita"><Bold size={14} /></TBtn>
        <TBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Itálica"><Italic size={14} /></TBtn>
        <TBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="Tachado"><Strikethrough size={14} /></TBtn>
        <TSep />
        <TBtn active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} label="Párrafo"><span className="text-[10px] font-bold">¶</span></TBtn>
        <TBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Encabezado"><Heading2 size={14} /></TBtn>
        <TSep />
        <TBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Lista"><List size={14} /></TBtn>
        <TBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numerada"><ListOrdered size={14} /></TBtn>
        <TBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Cita"><Quote size={14} /></TBtn>
        <TSep />
        <TBtn active={editor.isActive('link')} onClick={() => void handleLink()} label="Enlace"><Link2 size={14} /></TBtn>
        <div className="group relative">
          <TBtn active={!!editor.getAttributes('textStyle').color} onClick={() => { /* hover */ }} label="Color"><Paintbrush size={14} /></TBtn>
          <div className="absolute left-0 top-full z-30 hidden flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg group-hover:flex group-focus-within:flex">
            {colorPresets.map((c) => (
              <button key={c.hex} type="button" title={c.name}
                onClick={() => editor.chain().focus().setColor(c.hex).run()}
                className="h-5 w-5 rounded-md ring-1 ring-slate-200 transition hover:scale-110"
                style={{ background: c.hex }} />
            ))}
            <button type="button" title="Sin color" onClick={() => editor.chain().focus().unsetColor().run()}
              className="grid h-5 w-5 place-items-center rounded-md ring-1 ring-slate-200 transition hover:bg-slate-100">
              <Eraser size={11} className="text-slate-500" />
            </button>
          </div>
        </div>
        <TSep />
        <TBtn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} label="Limpiar formato"><Eraser size={14} /></TBtn>
        <div className="ml-auto inline-flex items-center gap-0.5">
          <TBtn onClick={() => editor.chain().focus().undo().run()} label="Deshacer" disabled={!editor.can().undo()}><Undo2 size={14} /></TBtn>
          <TBtn onClick={() => editor.chain().focus().redo().run()} label="Rehacer" disabled={!editor.can().redo()}><Redo2 size={14} /></TBtn>
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function TBtn({ active, disabled, onClick, label, children }: { active?: boolean; disabled?: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-md text-brand-ink transition disabled:opacity-30 disabled:cursor-not-allowed ${active ? 'bg-brand-cyan text-white shadow-sm' : 'hover:bg-white hover:shadow-sm'}`}>
      {children}
    </button>
  );
}

function TSep() { return <div className="mx-1 h-5 w-px bg-slate-200" />; }

// Silencia unused imports
void XIcon;
