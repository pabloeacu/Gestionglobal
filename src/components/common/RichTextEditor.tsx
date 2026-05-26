// RichTextEditor · TipTap wrapper para Plantillas MANAXER.
// Toolbar de formato (negrita, itálica, listas, links, color). Output: HTML.
// Soporta variables {{var}} como texto plano — no las renderiza distinto.
//
// Citas: regla 4 (queries en services/, no acá), regla 13 (sin window.confirm).

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import LinkExt from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import ColorExt from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Heading2,
  Link2,
  Paintbrush,
  Underline as UnderlineIcon,
  Eraser,
  Undo2,
  Redo2,
} from 'lucide-react';
import { usePrompt } from './DialogProvider';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 220 }: Props) {
  const prompt = usePrompt();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      TextStyle,
      ColorExt,
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Escribí el cuerpo del mensaje…',
        emptyEditorClass:
          'before:content-[attr(data-placeholder)] before:text-slate-400 before:float-left before:pointer-events-none before:h-0',
      }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none p-3 focus:outline-none text-brand-ink leading-relaxed',
        style: `min-height:${minHeight}px;`,
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  if (!editor) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-brand-muted"
        style={{ minHeight }}
      >
        Cargando editor…
      </div>
    );
  }

  // Lista compacta de presets de color de marca
  const COLOR_PRESETS = [
    { hex: '#0f172a', name: 'Tinta' },
    { hex: '#0891b2', name: 'Cian' },
    { hex: '#ea580c', name: 'Naranja' },
    { hex: '#16a34a', name: 'Verde' },
    { hex: '#dc2626', name: 'Rojo' },
    { hex: '#94a3b8', name: 'Gris' },
  ];

  async function handleLink() {
    const prev = (editor!.getAttributes('link') as { href?: string }).href ?? '';
    const url = await prompt({
      title: prev ? 'Editar enlace' : 'Insertar enlace',
      message: 'URL completa (https://… o {{variable}})',
      defaultValue: prev,
      placeholder: 'https://gestionglobal.ar',
      confirmLabel: prev ? 'Actualizar' : 'Insertar',
    });
    if (url === null) return;
    if (url === '') {
      editor!.chain().focus().unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/20">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
        <ToolbarBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="Negrita"
        >
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="Itálica"
        >
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          label="Tachado"
        >
          <UnderlineIcon size={14} />
        </ToolbarBtn>

        <ToolbarSep />

        <ToolbarBtn
          active={editor.isActive('paragraph')}
          onClick={() => editor.chain().focus().setParagraph().run()}
          label="Párrafo"
        >
          <span className="text-[10px] font-bold">¶</span>
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="Encabezado"
        >
          <Heading2 size={14} />
        </ToolbarBtn>

        <ToolbarSep />

        <ToolbarBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Lista con viñetas"
        >
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Lista numerada"
        >
          <ListOrdered size={14} />
        </ToolbarBtn>
        <ToolbarBtn
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Cita"
        >
          <Quote size={14} />
        </ToolbarBtn>

        <ToolbarSep />

        <ToolbarBtn
          active={editor.isActive('link')}
          onClick={() => void handleLink()}
          label="Enlace"
        >
          <Link2 size={14} />
        </ToolbarBtn>

        {/* Color picker dropdown */}
        <div className="group relative">
          <ToolbarBtn
            active={!!editor.getAttributes('textStyle').color}
            onClick={() => {
              /* abre tooltip */
            }}
            label="Color del texto"
          >
            <Paintbrush size={14} />
          </ToolbarBtn>
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

        <ToolbarSep />

        <ToolbarBtn
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          label="Limpiar formato"
        >
          <Eraser size={14} />
        </ToolbarBtn>

        <div className="ml-auto inline-flex items-center gap-0.5">
          <ToolbarBtn
            onClick={() => editor.chain().focus().undo().run()}
            label="Deshacer"
            disabled={!editor.can().undo()}
          >
            <Undo2 size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => editor.chain().focus().redo().run()}
            label="Rehacer"
            disabled={!editor.can().redo()}
          >
            <Redo2 size={14} />
          </ToolbarBtn>
        </div>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarBtn({
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

function ToolbarSep() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />;
}

/**
 * Inserta texto en el editor (al cursor o al final).
 * Útil para variables clickeables {{var}} desde fuera del editor.
 */
export function insertTextIntoEditor(editor: ReturnType<typeof useEditor>, text: string) {
  if (!editor) return;
  editor.chain().focus().insertContent(text).run();
}
