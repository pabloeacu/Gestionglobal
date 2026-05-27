import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Award,
  Check,
  Copy as CopyIcon,
  Image as ImageIcon,
  Loader2,
  Plus,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from '@/lib/toast';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { ColorPicker } from '@/components/common/ColorPicker';
import { useConfirm, usePrompt } from '@/components/common/DialogProvider';
import {
  actualizarEsquema,
  crearEsquema,
  duplicarEsquema,
  eliminarEsquema,
  listarEsquemas,
  setEsquemaDefault,
  subirAssetEsquema,
  type AssetSlot,
  type CertificadoEsquemaRow,
} from '@/services/api/certificado-esquemas';
import {
  CERT_H,
  CERT_W,
  CertificadoPremium,
  type EsquemaCert,
} from '../components/CertificadoPremium';
import type { CertificadoParaPdf } from '@/services/api/campus';

// Cert demo para el preview (datos del alumno hardcoded, lo que cambia es el esquema)
const CERT_DEMO: CertificadoParaPdf = {
  id: 'preview',
  codigo: 'GG-2026-DEMO-PREVIEW',
  tema: 1,
  alumno_nombre: 'María Soledad López Etchart',
  curso_titulo: 'Curso inicial de formación · Administradores RPAC',
  instructor_nombre: 'Dr. Pablo E. Acuña',
  nota_examen: 9,
  emitido_at: new Date().toISOString(),
  duracion_horas: 40,
};

// Convierte un row de BD a EsquemaCert que CertificadoPremium consume
function rowToEsquema(r: CertificadoEsquemaRow): EsquemaCert {
  return {
    color_acento: r.color_acento,
    color_dorado: r.color_dorado,
    visible_marca_logo: r.visible_marca_logo,
    marca_logo_url: r.marca_logo_url,
    visible_sigla: r.visible_sigla,
    sigla_texto: r.sigla_texto,
    visible_texto_descriptivo: r.visible_texto_descriptivo,
    texto_descriptivo: r.texto_descriptivo,
    visible_leyenda_legal: r.visible_leyenda_legal,
    leyenda_legal: r.leyenda_legal,
    visible_firma_1: r.visible_firma_1,
    firma_1_img_url: r.firma_1_img_url,
    firma_1_nombre: r.firma_1_nombre,
    firma_1_cargo: r.firma_1_cargo,
    visible_firma_2: r.visible_firma_2,
    firma_2_img_url: r.firma_2_img_url,
    firma_2_nombre: r.firma_2_nombre,
    firma_2_cargo: r.firma_2_cargo,
    visible_sello: r.visible_sello,
    sello_logo_url: r.sello_logo_url,
    visible_watermark: r.visible_watermark,
    watermark_url: r.watermark_url,
  };
}

export function CertificadoPlantillasPage() {
  const [rows, setRows] = useState<CertificadoEsquemaRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CertificadoEsquemaRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [qr, setQr] = useState<string | null>(null);

  const active = useMemo(() => rows.find((r) => r.id === activeId) ?? null, [rows, activeId]);
  const dirty = useMemo(() => {
    if (!active || !draft) return false;
    return JSON.stringify(active) !== JSON.stringify(draft);
  }, [active, draft]);

  async function reload() {
    setLoading(true);
    const res = await listarEsquemas();
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setRows(res.data);
    if (!activeId && res.data.length > 0) setActiveId(res.data[0]!.id);
  }

  useEffect(() => {
    void reload();
    // QR demo (se renderiza una vez)
    void QRCode.toDataURL('https://www.gestionglobal.ar/verificar/GG-2026-DEMO-PREVIEW', {
      margin: 1,
      width: 320,
      color: { dark: '#0b1f33', light: '#ffffff' },
    }).then(setQr).catch(() => setQr(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambia el esquema activo, reseteo el draft
  useEffect(() => {
    setDraft(active ? { ...active } : null);
  }, [active]);

  async function handleCrear() {
    const nombre = await prompt({
      title: 'Nueva plantilla',
      message: 'Nombre interno del esquema',
      placeholder: 'Ej: Diplomatura premium · 2026',
    });
    if (!nombre) return;
    const res = await crearEsquema({ nombre });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Plantilla creada');
    await reload();
    setActiveId(res.data.id);
  }

  async function handleDuplicar() {
    if (!active) return;
    const nombre = await prompt({
      title: 'Duplicar plantilla',
      message: 'Nombre del duplicado',
      defaultValue: `${active.nombre} (copia)`,
    });
    if (!nombre) return;
    const res = await duplicarEsquema(active.id, nombre);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Plantilla duplicada');
    await reload();
    setActiveId(res.data.id);
  }

  async function handleEliminar() {
    if (!active || active.es_default) return;
    const ok = await confirm({
      title: 'Eliminar plantilla',
      message: `¿Eliminar "${active.nombre}"? Esta acción no se puede deshacer.`,
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarEsquema(active.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Plantilla eliminada');
    setActiveId(null);
    await reload();
  }

  async function handleSetDefault() {
    if (!active || active.es_default) return;
    const res = await setEsquemaDefault(active.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Marcada como predeterminada');
    await reload();
  }

  async function handleGuardar() {
    if (!draft) return;
    setSaving(true);
    const { id, created_at: _c, updated_at: _u, created_by: _cb, ...patch } = draft;
    const res = await actualizarEsquema(id, patch);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Cambios guardados');
    await reload();
  }

  function handleDescartar() {
    if (!active) return;
    setDraft({ ...active });
  }

  return (
    <div className="space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <a
            href="/gerencia/campus"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted hover:text-brand-ink"
          >
            <ArrowLeft size={13} /> Campus
          </a>
          <p className="kicker mt-1 text-brand-cyan">EDITOR DE CERTIFICADOS</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Plantillas de certificado
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cada esquema deriva de la plantilla base. Asignalo a un curso o webinar y se aplica
            automáticamente cuando el alumno egresa.
          </p>
        </div>
        <Button variant="primary" onClick={() => void handleCrear()}>
          <Plus size={14} /> Nueva plantilla
        </Button>
      </header>

      {loading ? (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="No hay esquemas todavía"
          description="Creá la primera plantilla para comenzar."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          {/* Sidebar */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="card-premium p-2">
              <p className="kicker mb-2 px-3 pt-2 text-brand-muted">
                {rows.length} esquema{rows.length === 1 ? '' : 's'}
              </p>
              <ul className="space-y-0.5">
                {rows.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setActiveId(r.id)}
                      className={`group flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                        r.id === activeId
                          ? 'bg-brand-cyan-pale/60 text-brand-cyan'
                          : 'text-brand-ink hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <Award
                          size={13}
                          className={r.id === activeId ? 'text-brand-cyan' : 'text-brand-muted'}
                        />
                        <span className="truncate">{r.nombre}</span>
                        {r.es_default && (
                          <Star size={11} className="text-brand-orange" fill="currentColor" />
                        )}
                      </span>
                      {r.descripcion && (
                        <span className="line-clamp-1 pl-5 text-[11px] text-brand-muted">
                          {r.descripcion}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Editor + Preview */}
          {active && draft ? (
            <div className="space-y-4">
              {/* Action bar */}
              <div className="card-premium flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-xs text-brand-muted">Editando esquema</p>
                  <h2 className="truncate font-display text-lg font-semibold text-brand-ink">
                    {active.nombre}
                    {active.es_default && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-orange/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-orange">
                        <Star size={9} fill="currentColor" /> Default
                      </span>
                    )}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!active.es_default && (
                    <Button variant="ghost" onClick={() => void handleSetDefault()}>
                      <Star size={13} /> Hacer default
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void handleDuplicar()}>
                    <CopyIcon size={13} /> Duplicar
                  </Button>
                  {!active.es_default && (
                    <Button variant="ghost" onClick={() => void handleEliminar()}>
                      <Trash2 size={13} /> Eliminar
                    </Button>
                  )}
                  {dirty && (
                    <Button variant="ghost" onClick={handleDescartar}>
                      Descartar
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    onClick={() => void handleGuardar()}
                    disabled={!dirty || saving}
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    Guardar cambios
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                {/* Formulario por bloques */}
                <div className="card-premium space-y-1 divide-y divide-slate-100 p-1">
                  <FormField label="Nombre del esquema">
                    <input
                      type="text"
                      value={draft.nombre}
                      onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
                      className="input-field"
                    />
                  </FormField>

                  <FormField label="Descripción (opcional)">
                    <textarea
                      rows={2}
                      value={draft.descripcion ?? ''}
                      onChange={(e) => setDraft({ ...draft, descripcion: e.target.value || null })}
                      className="input-field"
                    />
                  </FormField>

                  {/* Campos automáticos · vienen del curso/webinar y la matrícula */}
                  <div className="p-3">
                    <header className="mb-2 flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-brand-ink">
                        Campos automáticos
                      </h3>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-muted">
                        no editables
                      </span>
                    </header>
                    <p className="mb-3 text-[11px] text-brand-muted">
                      Se completan al emitir el certificado, desde el curso/webinar al que está vinculado este esquema y los datos del alumno.
                    </p>
                    <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {[
                        { l: 'Nombre del alumno', o: 'Desde la matrícula' },
                        { l: 'Nombre del curso o webinar', o: 'Desde el curso/webinar vinculado' },
                        { l: 'Fecha de emisión', o: 'Mes y año del egreso' },
                        { l: 'Duración en horas', o: 'Desde el curso' },
                        { l: 'Calificación', o: 'Si corresponde (examen)' },
                        { l: 'Código + QR de verificación', o: 'Generados automáticamente' },
                      ].map((c) => (
                        <li
                          key={c.l}
                          className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-2.5 py-1.5"
                        >
                          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-brand-ink">{c.l}</p>
                            <p className="text-[10px] text-brand-muted">{c.o}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Paleta */}
                  <SeccionBlock title="Paleta · color base" icon="palette">
                    <div className="grid grid-cols-2 gap-3">
                      <ColorPicker
                        label="Acento (franjas + curso)"
                        value={draft.color_acento}
                        onChange={(v) => setDraft({ ...draft, color_acento: v })}
                      />
                      <ColorPicker
                        label="Dorado (líneas + sello)"
                        value={draft.color_dorado}
                        onChange={(v) => setDraft({ ...draft, color_dorado: v })}
                      />
                    </div>
                  </SeccionBlock>

                  {/* Logo emisor */}
                  <SeccionBlock
                    title="Logo emisor"
                    icon="image"
                    visible={draft.visible_marca_logo}
                    onToggle={(v) => setDraft({ ...draft, visible_marca_logo: v })}
                  >
                    <AssetField
                      esquemaId={active.id}
                      slot="marca_logo"
                      url={draft.marca_logo_url}
                      onUploaded={(u) => setDraft({ ...draft, marca_logo_url: u })}
                      onClear={() => setDraft({ ...draft, marca_logo_url: null })}
                      defaultUrl="/cert/logo-fundplata.png"
                    />
                  </SeccionBlock>

                  {/* Sigla */}
                  <SeccionBlock
                    title="Sigla institucional"
                    icon="text"
                    visible={draft.visible_sigla}
                    onToggle={(v) => setDraft({ ...draft, visible_sigla: v })}
                  >
                    <input
                      type="text"
                      value={draft.sigla_texto}
                      onChange={(e) => setDraft({ ...draft, sigla_texto: e.target.value })}
                      className="input-field"
                    />
                  </SeccionBlock>

                  {/* Texto descriptivo */}
                  <SeccionBlock
                    title="Texto descriptivo"
                    icon="text"
                    visible={draft.visible_texto_descriptivo}
                    onToggle={(v) => setDraft({ ...draft, visible_texto_descriptivo: v })}
                  >
                    <textarea
                      rows={2}
                      value={draft.texto_descriptivo}
                      onChange={(e) => setDraft({ ...draft, texto_descriptivo: e.target.value })}
                      className="input-field"
                    />
                  </SeccionBlock>

                  {/* Leyenda legal */}
                  <SeccionBlock
                    title="Leyenda legal"
                    icon="text"
                    visible={draft.visible_leyenda_legal}
                    onToggle={(v) => setDraft({ ...draft, visible_leyenda_legal: v })}
                  >
                    <textarea
                      rows={3}
                      value={draft.leyenda_legal}
                      onChange={(e) => setDraft({ ...draft, leyenda_legal: e.target.value })}
                      className="input-field"
                    />
                  </SeccionBlock>

                  {/* Firma 1 */}
                  <SeccionBlock
                    title="Firma izquierda"
                    icon="signature"
                    visible={draft.visible_firma_1}
                    onToggle={(v) => setDraft({ ...draft, visible_firma_1: v })}
                  >
                    <AssetField
                      esquemaId={active.id}
                      slot="firma_1"
                      url={draft.firma_1_img_url}
                      onUploaded={(u) => setDraft({ ...draft, firma_1_img_url: u })}
                      onClear={() => setDraft({ ...draft, firma_1_img_url: null })}
                      defaultUrl="/cert/firma-acuna.png"
                    />
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <FormField label="Nombre" compact>
                        <input
                          type="text"
                          value={draft.firma_1_nombre}
                          onChange={(e) => setDraft({ ...draft, firma_1_nombre: e.target.value })}
                          className="input-field"
                        />
                      </FormField>
                      <FormField label="Cargo" compact>
                        <input
                          type="text"
                          value={draft.firma_1_cargo}
                          onChange={(e) => setDraft({ ...draft, firma_1_cargo: e.target.value })}
                          className="input-field"
                        />
                      </FormField>
                    </div>
                  </SeccionBlock>

                  {/* Firma 2 */}
                  <SeccionBlock
                    title="Firma derecha"
                    icon="signature"
                    visible={draft.visible_firma_2}
                    onToggle={(v) => setDraft({ ...draft, visible_firma_2: v })}
                  >
                    <AssetField
                      esquemaId={active.id}
                      slot="firma_2"
                      url={draft.firma_2_img_url}
                      onUploaded={(u) => setDraft({ ...draft, firma_2_img_url: u })}
                      onClear={() => setDraft({ ...draft, firma_2_img_url: null })}
                      defaultUrl="/cert/firma-parente.png"
                    />
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <FormField label="Nombre" compact>
                        <input
                          type="text"
                          value={draft.firma_2_nombre}
                          onChange={(e) => setDraft({ ...draft, firma_2_nombre: e.target.value })}
                          className="input-field"
                        />
                      </FormField>
                      <FormField label="Cargo" compact>
                        <input
                          type="text"
                          value={draft.firma_2_cargo}
                          onChange={(e) => setDraft({ ...draft, firma_2_cargo: e.target.value })}
                          className="input-field"
                        />
                      </FormField>
                    </div>
                  </SeccionBlock>

                  {/* Sello */}
                  <SeccionBlock
                    title="Sello holográfico (logo central)"
                    icon="image"
                    visible={draft.visible_sello}
                    onToggle={(v) => setDraft({ ...draft, visible_sello: v })}
                  >
                    <AssetField
                      esquemaId={active.id}
                      slot="sello_logo"
                      url={draft.sello_logo_url}
                      onUploaded={(u) => setDraft({ ...draft, sello_logo_url: u })}
                      onClear={() => setDraft({ ...draft, sello_logo_url: null })}
                      defaultUrl="/logo-white.png"
                    />
                  </SeccionBlock>

                  {/* Watermark */}
                  <SeccionBlock
                    title="Watermark de fondo"
                    icon="image"
                    visible={draft.visible_watermark}
                    onToggle={(v) => setDraft({ ...draft, visible_watermark: v })}
                  >
                    <AssetField
                      esquemaId={active.id}
                      slot="watermark"
                      url={draft.watermark_url}
                      onUploaded={(u) => setDraft({ ...draft, watermark_url: u })}
                      onClear={() => setDraft({ ...draft, watermark_url: null })}
                      defaultUrl="/cert/logo-fondo.png"
                    />
                  </SeccionBlock>
                </div>

                {/* Live preview */}
                <div className="card-premium lg:sticky lg:top-4 lg:self-start">
                  <div className="border-b border-slate-100 px-4 py-2.5">
                    <p className="kicker text-brand-cyan">Vista previa en vivo</p>
                    <p className="text-xs text-brand-muted">
                      Cambios sin guardar reflejados al instante.
                    </p>
                  </div>
                  <div className="bg-slate-100 p-3">
                    <PreviewBox esquema={rowToEsquema(draft)} qr={qr} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <IllustratedEmpty
              illustration="lista"
              title="Seleccioná un esquema"
              description="Elegí uno de la lista para editarlo o creá uno nuevo."
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Componentes auxiliares
// ============================================================================
function FormField({
  label,
  children,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <label className={`block ${compact ? 'p-2' : 'p-3'}`}>
      <span className="kicker mb-1 block text-brand-muted">{label}</span>
      {children}
    </label>
  );
}

function SeccionBlock({
  title,
  children,
  visible,
  onToggle,
}: {
  title: string;
  icon: 'image' | 'text' | 'signature' | 'palette';
  children: React.ReactNode;
  visible?: boolean;
  onToggle?: (v: boolean) => void;
}) {
  return (
    <div className="p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-brand-ink">{title}</h3>
        {onToggle && (
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-brand-muted">
            <input
              type="checkbox"
              checked={visible}
              onChange={(e) => onToggle(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
            />
            Visible
          </label>
        )}
      </header>
      <div className={visible === false ? 'opacity-40' : ''}>{children}</div>
    </div>
  );
}

function AssetField({
  esquemaId,
  slot,
  url,
  onUploaded,
  onClear,
  defaultUrl,
}: {
  esquemaId: string;
  slot: AssetSlot;
  url: string | null;
  onUploaded: (url: string) => void;
  onClear: () => void;
  defaultUrl: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const previewUrl = url ?? defaultUrl;

  async function handleFile(file: File) {
    setUploading(true);
    const res = await subirAssetEsquema(esquemaId, slot, file);
    setUploading(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onUploaded(res.data);
    toast.success('Imagen subida');
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-2">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageIcon size={16} className="text-brand-muted" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            if (fileRef.current) fileRef.current.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-brand-ink hover:bg-slate-50 disabled:opacity-60"
        >
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          {url ? 'Reemplazar' : 'Subir imagen'}
        </button>
        {url && (
          <button
            type="button"
            onClick={onClear}
            className="text-left text-[11px] text-brand-muted hover:text-brand-ink"
          >
            Volver al default
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewBox({ esquema, qr }: { esquema: EsquemaCert; qr: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      setScale(Math.min(1, w / CERT_W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="mx-auto w-full">
      <div
        style={{ width: CERT_W * scale, height: CERT_H * scale }}
        className="mx-auto shadow-xl ring-1 ring-black/10"
      >
        <div
          style={{
            width: CERT_W,
            height: CERT_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <CertificadoPremium
            cert={CERT_DEMO}
            qrDataUrl={qr}
            verificarUrl="https://www.gestionglobal.ar/verificar/GG-2026-DEMO-PREVIEW"
            esquema={esquema}
          />
        </div>
      </div>
    </div>
  );
}
