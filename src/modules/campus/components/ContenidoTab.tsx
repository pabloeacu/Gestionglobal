// Tab "Contenido" del editor del curso (gerencia).
// Rediseñado en sesión 30/05/2026 (Campus L1):
//   · El editor mantiene la potestad sobre cada módulo, cada clase y cada
//     ítem de bibliografía: títulos, URLs, fechas, foto del instructor — todo
//     editable inline, sin perder dominio al agregar otro módulo.
//   · Publicación con ventana (checkbox + publicar_at + despublicar_at) por
//     módulo, clase y bibliografía. Mig 0140.
//   · Imágenes: ícono por módulo, foto del instructor en clases asincrónicas.

import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Trash2,
  Video,
  ScrollText,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { FileUploader } from './FileUploader';
import {
  actualizarBibliografia,
  actualizarClase,
  actualizarModulo,
  borrarBibliografia,
  borrarClase,
  borrarModulo,
  CLASE_TIPOS,
  CLASE_TIPO_LABEL,
  crearBibliografia,
  crearClase,
  crearModulo,
  estadoPublicacion,
  fmtFechaHora,
  type ClaseTipo,
  type CursoBibliografiaRow,
  type CursoClaseRow,
  type CursoDetalle,
  type CursoModuloRow,
} from '@/services/api/campus';
import { ImageUploader } from './ImageUploader';
import { PublicacionEditor, type PublicacionState } from './PublicacionEditor';
import { humanizeError } from '@/lib/errors';

interface ContenidoTabProps {
  data: CursoDetalle;
  onChanged: () => void;
}

export function ContenidoTab({ data, onChanged }: ContenidoTabProps) {
  const [nuevoModulo, setNuevoModulo] = useState('');
  const [creandoModulo, setCreandoModulo] = useState(false);

  async function addModulo() {
    if (!nuevoModulo.trim()) {
      toast.error('Ponele un título al módulo.');
      return;
    }
    setCreandoModulo(true);
    const res = await crearModulo(data.curso.id, nuevoModulo.trim());
    setCreandoModulo(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setNuevoModulo('');
    toast.success('Módulo creado');
    onChanged();
  }

  async function moverModulo(m: CursoModuloRow, dir: -1 | 1) {
    const orden = (m.orden ?? 0) + dir;
    if (orden < 0) return;
    const res = await actualizarModulo(m.id, { orden });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-5">
      {/* Alta de módulo */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Nuevo módulo" className="flex-1">
          <Input
            value={nuevoModulo}
            onChange={(e) => setNuevoModulo(e.target.value)}
            placeholder="Título del módulo (ej: Introducción, Marco legal…)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addModulo();
            }}
          />
        </Field>
        <Button onClick={addModulo} loading={creandoModulo}>
          <Plus size={14} /> Agregar módulo
        </Button>
      </section>

      {/* Lista de módulos editables */}
      {data.modulos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
          Todavía no hay módulos. Creá el primero arriba.
        </div>
      ) : (
        data.modulos.map((m, i) => (
          <ModuloEditor
            key={m.id}
            modulo={m}
            esPrimero={i === 0}
            esUltimo={i === data.modulos.length - 1}
            onChanged={onChanged}
            onMove={(d) => void moverModulo(m, d)}
          />
        ))
      )}

      {/* Bibliografía */}
      <BibliografiaSection
        cursoId={data.curso.id}
        items={data.bibliografia}
        onChanged={onChanged}
      />
    </div>
  );
}

// ============================================================================
// MÓDULO · header con ícono + edición inline + publicación + clases
// ============================================================================
function ModuloEditor({
  modulo,
  esPrimero,
  esUltimo,
  onChanged,
  onMove,
}: {
  modulo: CursoDetalle['modulos'][number];
  esPrimero: boolean;
  esUltimo: boolean;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(true);
  const [titulo, setTitulo] = useState(modulo.titulo);
  const [descripcion, setDescripcion] = useState(modulo.descripcion ?? '');
  const [icono, setIcono] = useState<string | null>(modulo.icono_url ?? null);
  const [docenteNombre, setDocenteNombre] = useState(modulo.docente_nombre ?? '');
  const [docenteFoto, setDocenteFoto] = useState<string | null>(modulo.docente_foto_url ?? null);
  const [docenteBio, setDocenteBio] = useState(modulo.docente_bio ?? '');
  const [docenteCv, setDocenteCv] = useState<string | null>(modulo.docente_cv_url ?? null);
  const [pub, setPub] = useState<PublicacionState>({
    publicado: modulo.publicado ?? true,
    publicar_at: modulo.publicar_at,
    despublicar_at: modulo.despublicar_at,
  });
  const [saving, setSaving] = useState(false);

  const dirty =
    titulo !== modulo.titulo ||
    (descripcion || null) !== (modulo.descripcion ?? null) ||
    (icono || null) !== (modulo.icono_url ?? null) ||
    (docenteNombre || null) !== (modulo.docente_nombre ?? null) ||
    (docenteFoto || null) !== (modulo.docente_foto_url ?? null) ||
    (docenteBio || null) !== (modulo.docente_bio ?? null) ||
    (docenteCv || null) !== (modulo.docente_cv_url ?? null) ||
    pub.publicado !== (modulo.publicado ?? true) ||
    pub.publicar_at !== modulo.publicar_at ||
    pub.despublicar_at !== modulo.despublicar_at;

  const estado = estadoPublicacion(modulo);

  async function guardar() {
    if (!titulo.trim()) {
      toast.error('El título no puede quedar vacío.');
      return;
    }
    setSaving(true);
    const res = await actualizarModulo(modulo.id, {
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      icono_url: icono,
      docente_nombre: docenteNombre.trim() || null,
      docente_foto_url: docenteFoto,
      docente_bio: docenteBio.trim() || null,
      docente_cv_url: docenteCv,
      publicado: pub.publicado,
      publicar_at: pub.publicar_at,
      despublicar_at: pub.despublicar_at,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Módulo actualizado');
    onChanged();
  }

  async function eliminar() {
    const ok = await confirm({
      title: 'Eliminar módulo',
      message: `¿Eliminar "${modulo.titulo}" y todas sus ${modulo.clases.length} clase(s)?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarModulo(modulo.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    onChanged();
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header con ícono + título + chip estado + acciones */}
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-brand-zebra/30 p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-cyan/10 text-xs font-bold text-brand-cyan">
            {modulo.orden}
          </span>
          {modulo.icono_url ? (
            <img
              src={modulo.icono_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-brand-ink">
              {modulo.titulo}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-brand-muted">
              <span>{modulo.clases.length} clase(s)</span>
              <span>·</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  estado.tone === 'emerald' && 'bg-emerald-50 text-emerald-700',
                  estado.tone === 'slate' && 'bg-slate-100 text-slate-600',
                  estado.tone === 'amber' && 'bg-amber-50 text-amber-700',
                  estado.tone === 'rose' && 'bg-rose-50 text-rose-700',
                )}
              >
                {estado.label}
              </span>
              {modulo.publicar_at && estado.tone === 'amber' && (
                <span className="text-[11px]">
                  desde {fmtFechaHora(modulo.publicar_at)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-brand-muted">
          <button
            onClick={() => onMove(-1)}
            disabled={esPrimero}
            className="rounded-md p-1 hover:bg-white disabled:opacity-30"
            title="Subir módulo"
            aria-label="Subir módulo"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={esUltimo}
            className="rounded-md p-1 hover:bg-white disabled:opacity-30"
            title="Bajar módulo"
            aria-label="Bajar módulo"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md p-1 hover:bg-white"
            title={expanded ? 'Colapsar' : 'Expandir'}
            aria-label="Colapsar/expandir"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={() => void eliminar()}
            className="rounded-md p-1 hover:bg-red-50 hover:text-red-600"
            title="Eliminar módulo"
            aria-label="Eliminar módulo"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {expanded && (
        <div className="space-y-4 p-4">
          {/* Edición del módulo */}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <ImageUploader
              value={icono}
              onChange={setIcono}
              onPersist={async (url) => {
                const r = await actualizarModulo(modulo.id, { icono_url: url });
                if (!r.ok) toast.error(humanizeError(r.error));
                else onChanged();
              }}
              scope="modulo-icono"
              ownerId={modulo.id}
              shape="square"
              label="Ícono"
              hint="Aparece junto al nombre del módulo. Recortable y cuadrada. ≤ 5 MB."
            />
            <div className="space-y-3">
              <Field label="Título del módulo" required>
                <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
              </Field>
              <Field label="Descripción (opcional)">
                <Textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  rows={2}
                  placeholder="Breve introducción al módulo. Aparece debajo del título."
                />
              </Field>
            </div>
          </div>

          {/* Docente a cargo de la asignatura */}
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-brand-zebra/20 p-3 sm:grid-cols-[120px_1fr]">
            <ImageUploader
              value={docenteFoto}
              onChange={setDocenteFoto}
              onPersist={async (url) => {
                const r = await actualizarModulo(modulo.id, { docente_foto_url: url });
                if (!r.ok) toast.error(humanizeError(r.error));
                else onChanged();
              }}
              scope="modulo-docente"
              ownerId={modulo.id}
              shape="circle"
              label="Foto del docente"
              hint="Avatar del docente a cargo. Subí una nueva o reusá una del banco. ≤ 5 MB."
              bankEnabled
              onPickBank={async (item) => {
                // Reusar una foto del banco: setea nombre + foto y persiste ambos.
                setDocenteNombre(item.nombre);
                setDocenteFoto(item.foto_url);
                const r = await actualizarModulo(modulo.id, {
                  docente_nombre: item.nombre,
                  docente_foto_url: item.foto_url,
                });
                if (!r.ok) toast.error(humanizeError(r.error));
                else onChanged();
              }}
            />
            <div className="space-y-3">
              <Field label="Docente a cargo">
                <Input
                  value={docenteNombre}
                  onChange={(e) => setDocenteNombre(e.target.value)}
                  placeholder="Ej: Lic. Ximena González"
                />
              </Field>
              <Field label="Bio del docente (opcional)">
                <Textarea
                  value={docenteBio}
                  onChange={(e) => setDocenteBio(e.target.value)}
                  rows={2}
                  placeholder="Breve reseña del docente. Aparece en la asignatura."
                />
              </Field>
              <FileUploader
                value={docenteCv}
                onChange={setDocenteCv}
                onPersist={async (url) => {
                  const r = await actualizarModulo(modulo.id, { docente_cv_url: url });
                  if (!r.ok) toast.error(humanizeError(r.error));
                  else onChanged();
                }}
                scope="modulo-docente-cv"
                ownerId={modulo.id}
                label="CV del docente (PDF)"
                hint="Opcional. El alumno lo descarga desde la asignatura. ≤ 10 MB."
              />
            </div>
          </div>

          <PublicacionEditor value={pub} onChange={setPub} />

          {dirty && (
            <div className="flex items-center justify-end gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 px-3 py-2 text-sm">
              <span className="text-brand-muted">Cambios sin guardar.</span>
              <Button onClick={() => void guardar()} loading={saving}>
                <Save size={13} /> Guardar módulo
              </Button>
            </div>
          )}

          {/* Clases del módulo */}
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <h4 className="kicker mb-1 text-brand-muted">Clases del módulo</h4>
            {modulo.clases.length === 0 ? (
              <p className="text-sm text-brand-muted">Aún no hay clases.</p>
            ) : (
              <ol className="space-y-2">
                {modulo.clases.map((c, idx) => (
                  <ClaseEditor
                    key={c.id}
                    clase={c}
                    esPrimero={idx === 0}
                    esUltimo={idx === modulo.clases.length - 1}
                    onChanged={onChanged}
                  />
                ))}
              </ol>
            )}
            <NuevaClaseForm moduloId={modulo.id} onCreated={onChanged} />
          </div>
        </div>
      )}
    </article>
  );
}

// ============================================================================
// CLASE · card editable inline
// ============================================================================
function ClaseEditor({
  clase,
  esPrimero,
  esUltimo,
  onChanged,
}: {
  clase: CursoClaseRow;
  esPrimero: boolean;
  esUltimo: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [tipo, setTipo] = useState<ClaseTipo>(clase.tipo as ClaseTipo);
  const [titulo, setTitulo] = useState(clase.titulo);
  const [descripcion, setDescripcion] = useState(clase.descripcion ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(clase.youtube_url ?? '');
  const [zoomUrl, setZoomUrl] = useState(clase.zoom_url ?? '');
  const [zoomFecha, setZoomFecha] = useState(clase.zoom_fecha_hora ?? '');
  const [materialUrl, setMaterialUrl] = useState(clase.material_url ?? '');
  const [duracion, setDuracion] = useState<number | ''>(clase.duracion_min ?? '');
  const [foto, setFoto] = useState<string | null>(clase.instructor_foto_url ?? null);
  const [pub, setPub] = useState<PublicacionState>({
    publicado: clase.publicado ?? true,
    publicar_at: clase.publicar_at,
    despublicar_at: clase.despublicar_at,
  });
  const [saving, setSaving] = useState(false);

  const dirty =
    tipo !== (clase.tipo as ClaseTipo) ||
    titulo !== clase.titulo ||
    (descripcion || null) !== (clase.descripcion ?? null) ||
    (youtubeUrl || null) !== (clase.youtube_url ?? null) ||
    (zoomUrl || null) !== (clase.zoom_url ?? null) ||
    (zoomFecha || null) !== (clase.zoom_fecha_hora ?? null) ||
    (materialUrl || null) !== (clase.material_url ?? null) ||
    (duracion === '' ? null : Number(duracion)) !== (clase.duracion_min ?? null) ||
    (foto || null) !== (clase.instructor_foto_url ?? null) ||
    pub.publicado !== (clase.publicado ?? true) ||
    pub.publicar_at !== clase.publicar_at ||
    pub.despublicar_at !== clase.despublicar_at;

  const estado = estadoPublicacion(clase);

  async function guardar() {
    if (!titulo.trim()) {
      toast.error('El título no puede quedar vacío.');
      return;
    }
    setSaving(true);
    const res = await actualizarClase(clase.id, {
      tipo,
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      youtube_url: tipo === 'asincronica_video' ? youtubeUrl.trim() || null : null,
      zoom_url: tipo === 'sincronica_zoom' ? zoomUrl.trim() || null : null,
      zoom_fecha_hora: tipo === 'sincronica_zoom' && zoomFecha
        ? new Date(zoomFecha).toISOString()
        : null,
      material_url: tipo === 'lectura_pdf' ? materialUrl.trim() || null : null,
      duracion_min: duracion === '' ? null : Number(duracion),
      instructor_foto_url: foto,
      publicado: pub.publicado,
      publicar_at: pub.publicar_at,
      despublicar_at: pub.despublicar_at,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Clase actualizada');
    onChanged();
  }

  async function moverOrden(dir: -1 | 1) {
    const next = Math.max(1, (clase.orden ?? 1) + dir);
    const res = await actualizarClase(clase.id, { orden: next });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    onChanged();
  }

  async function eliminar() {
    const ok = await confirm({
      title: 'Eliminar clase',
      message: `¿Eliminar "${clase.titulo}"?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarClase(clase.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    onChanged();
  }

  const tipoIcon =
    tipo === 'asincronica_video' ? <Video size={13} /> :
    tipo === 'sincronica_zoom' ? <Video size={13} /> :
    tipo === 'lectura_pdf' ? <BookOpen size={13} /> :
    <ScrollText size={13} />;

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-brand-zebra/20">
      {/* Resumen colapsado */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-xs font-semibold text-brand-cyan ring-1 ring-slate-200">
          {clase.orden}
        </span>
        {clase.instructor_foto_url ? (
          <img
            src={clase.instructor_foto_url}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-ink">
            {clase.titulo}
          </p>
          <p className="truncate text-xs text-brand-muted">
            <span className="inline-flex items-center gap-1">
              {tipoIcon}
              {CLASE_TIPO_LABEL[clase.tipo as ClaseTipo]}
            </span>
            {clase.zoom_fecha_hora && ` · ${fmtFechaHora(clase.zoom_fecha_hora)}`}
            {clase.duracion_min ? ` · ${clase.duracion_min} min` : ''}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            estado.tone === 'emerald' && 'bg-emerald-50 text-emerald-700',
            estado.tone === 'slate' && 'bg-slate-100 text-slate-600',
            estado.tone === 'amber' && 'bg-amber-50 text-amber-700',
            estado.tone === 'rose' && 'bg-rose-50 text-rose-700',
          )}
        >
          {estado.label}
        </span>
        <span className="text-brand-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-200 bg-white p-3">
          {/* Acciones de orden + borrar */}
          <div className="flex items-center justify-end gap-1 text-brand-muted">
            <button
              type="button"
              onClick={() => void moverOrden(-1)}
              disabled={esPrimero}
              className="rounded-md p-1 hover:bg-slate-100 disabled:opacity-30"
              title="Subir clase"
              aria-label="Subir clase"
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => void moverOrden(1)}
              disabled={esUltimo}
              className="rounded-md p-1 hover:bg-slate-100 disabled:opacity-30"
              title="Bajar clase"
              aria-label="Bajar clase"
            >
              <ChevronDown size={13} />
            </button>
            <button
              type="button"
              onClick={() => void eliminar()}
              className="rounded-md p-1 hover:bg-red-50 hover:text-red-600"
              title="Eliminar clase"
              aria-label="Eliminar clase"
            >
              <Trash2 size={13} />
            </button>
          </div>

          {/* Edición */}
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            {tipo === 'asincronica_video' && (
              <ImageUploader
                value={foto}
                onChange={setFoto}
                onPersist={async (url) => {
                  const r = await actualizarClase(clase.id, { instructor_foto_url: url });
                  if (!r.ok) toast.error(humanizeError(r.error));
                  else onChanged();
                }}
                scope="clase-instructor"
                ownerId={clase.id}
                shape="circle"
                label="Foto del docente"
                hint="Aparece como avatar circular del docente al lado del título de la clase. Recortable. ≤ 5 MB."
              />
            )}
            <div className={cn('space-y-3', tipo !== 'asincronica_video' && 'sm:col-span-2')}>
              <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
                <Field label="Título de la clase" required>
                  <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                </Field>
                <Field label="Tipo">
                  <Select value={tipo} onChange={(e) => setTipo(e.target.value as ClaseTipo)}>
                    {CLASE_TIPOS.map((t) => (
                      <option key={t} value={t}>
                        {CLASE_TIPO_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Descripción (opcional)">
                <Textarea
                  rows={2}
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Qué va a aprender el alumno en esta clase."
                />
              </Field>

              {tipo === 'asincronica_video' && (
                <Field label="YouTube URL" hint="Pegá el link completo (https://www.youtube.com/watch?v=…).">
                  <Input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/…" />
                </Field>
              )}
              {tipo === 'sincronica_zoom' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Zoom URL">
                    <Input value={zoomUrl} onChange={(e) => setZoomUrl(e.target.value)} placeholder="https://zoom.us/j/…" />
                  </Field>
                  <Field label="Fecha y hora del encuentro">
                    <Input
                      type="datetime-local"
                      value={
                        zoomFecha
                          ? new Date(zoomFecha).toISOString().slice(0, 16)
                          : ''
                      }
                      onChange={(e) =>
                        setZoomFecha(
                          e.target.value
                            ? new Date(e.target.value).toISOString()
                            : '',
                        )
                      }
                    />
                  </Field>
                </div>
              )}
              {tipo === 'lectura_pdf' && (
                <Field label="URL del material (PDF, drive, etc.)">
                  <Input value={materialUrl} onChange={(e) => setMaterialUrl(e.target.value)} placeholder="https://…" />
                </Field>
              )}

              <Field label="Duración estimada (minutos)">
                <Input
                  type="number"
                  min={0}
                  value={duracion}
                  onChange={(e) => setDuracion(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </Field>
            </div>
          </div>

          <PublicacionEditor value={pub} onChange={setPub} density="compact" />

          {dirty && (
            <div className="flex items-center justify-end gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 px-3 py-2 text-sm">
              <span className="text-brand-muted">Cambios sin guardar.</span>
              <Button onClick={() => void guardar()} loading={saving}>
                <Save size={13} /> Guardar clase
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ============================================================================
// Form de nueva clase (alta rápida, después se edita en el card)
// ============================================================================
function NuevaClaseForm({
  moduloId,
  onCreated,
}: {
  moduloId: string;
  onCreated: () => void;
}) {
  const [tipo, setTipo] = useState<ClaseTipo>('asincronica_video');
  const [titulo, setTitulo] = useState('');
  const [creando, setCreando] = useState(false);

  async function crear() {
    if (!titulo.trim()) {
      toast.error('Ponele un título a la clase.');
      return;
    }
    setCreando(true);
    const res = await crearClase({
      modulo_id: moduloId,
      titulo: titulo.trim(),
      tipo,
    });
    setCreando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setTitulo('');
    toast.success('Clase creada · ahora completala desde su panel.');
    onCreated();
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3">
      <p className="kicker mb-2 text-brand-cyan">Nueva clase</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
        <Input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título de la clase"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void crear();
          }}
        />
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as ClaseTipo)}>
          {CLASE_TIPOS.map((t) => (
            <option key={t} value={t}>
              {CLASE_TIPO_LABEL[t]}
            </option>
          ))}
        </Select>
        <Button onClick={crear} loading={creando}>
          <Plus size={13} /> Agregar
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-brand-muted">
        La clase queda publicada por defecto. Tras crearla podés cargar la URL,
        la duración, la foto del docente y programar su publicación.
      </p>
    </div>
  );
}

// ============================================================================
// BIBLIOGRAFÍA
// ============================================================================
function BibliografiaSection({
  cursoId,
  items,
  onChanged,
}: {
  cursoId: string;
  items: CursoBibliografiaRow[];
  onChanged: () => void;
}) {
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevoAutor, setNuevoAutor] = useState('');
  const [nuevoUrl, setNuevoUrl] = useState('');
  const [nuevoArchivo, setNuevoArchivo] = useState<string | null>(null);
  // ownerId temporal para que el FileUploader pueda subir el PDF ANTES de que
  // exista la fila de bibliografía (la fila guarda la URL resultante al crear).
  const [tempOwnerId, setTempOwnerId] = useState(() => crypto.randomUUID());
  const [creando, setCreando] = useState(false);

  async function crear() {
    if (!nuevoTitulo.trim()) {
      toast.error('Ponele un título.');
      return;
    }
    setCreando(true);
    const res = await crearBibliografia(cursoId, {
      titulo: nuevoTitulo.trim(),
      autor: nuevoAutor.trim() || null,
      url: nuevoUrl.trim() || null,
      archivo_url: nuevoArchivo,
    });
    setCreando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setNuevoTitulo('');
    setNuevoAutor('');
    setNuevoUrl('');
    setNuevoArchivo(null);
    setTempOwnerId(crypto.randomUUID()); // próxima carga usa un path nuevo
    onChanged();
  }

  return (
    <section className="card-premium p-5">
      <header className="mb-3 flex items-center gap-2">
        <BookOpen size={16} className="text-brand-cyan" />
        <h2 className="font-display text-lg font-semibold text-brand-ink">
          Bibliografía
        </h2>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-brand-muted">
          Todavía no hay bibliografía cargada.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((b) => (
            <BiblioItem key={b.id} item={b} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3 rounded-xl border border-dashed border-slate-300 bg-brand-zebra/20 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
          Nueva bibliografía
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={nuevoTitulo}
            onChange={(e) => setNuevoTitulo(e.target.value)}
            placeholder="Título *"
          />
          <Input
            value={nuevoAutor}
            onChange={(e) => setNuevoAutor(e.target.value)}
            placeholder="Autor (opcional)"
          />
        </div>
        <Input
          value={nuevoUrl}
          onChange={(e) => setNuevoUrl(e.target.value)}
          placeholder="Link externo (https://…)"
        />
        <FileUploader
          value={nuevoArchivo}
          onChange={setNuevoArchivo}
          scope="biblio-archivo"
          ownerId={tempOwnerId}
          maxMb={50}
          label="Archivo (PDF)"
          hint="Cargá el link externo O subí el PDF (lo que prefieras). ≤ 50 MB."
        />
        <div className="flex justify-end">
          <Button onClick={crear} loading={creando}>
            <Plus size={13} /> Agregar
          </Button>
        </div>
      </div>
    </section>
  );
}

function BiblioItem({
  item,
  onChanged,
}: {
  item: CursoBibliografiaRow;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [titulo, setTitulo] = useState(item.titulo);
  const [autor, setAutor] = useState(item.autor ?? '');
  const [url, setUrl] = useState(item.url ?? '');
  const [archivo, setArchivo] = useState<string | null>(item.archivo_url ?? null);
  const [descripcion, setDescripcion] = useState(item.descripcion ?? '');
  const [pub, setPub] = useState<PublicacionState>({
    publicado: item.publicado ?? true,
    publicar_at: item.publicar_at,
    despublicar_at: item.despublicar_at,
  });
  const [saving, setSaving] = useState(false);

  const dirty =
    titulo !== item.titulo ||
    (autor || null) !== (item.autor ?? null) ||
    (url || null) !== (item.url ?? null) ||
    (archivo || null) !== (item.archivo_url ?? null) ||
    (descripcion || null) !== (item.descripcion ?? null) ||
    pub.publicado !== (item.publicado ?? true) ||
    pub.publicar_at !== item.publicar_at ||
    pub.despublicar_at !== item.despublicar_at;

  const estado = estadoPublicacion(item);

  async function guardar() {
    if (!titulo.trim()) {
      toast.error('El título no puede quedar vacío.');
      return;
    }
    setSaving(true);
    const res = await actualizarBibliografia(item.id, {
      titulo: titulo.trim(),
      autor: autor.trim() || null,
      url: url.trim() || null,
      archivo_url: archivo,
      descripcion: descripcion.trim() || null,
      publicado: pub.publicado,
      publicar_at: pub.publicar_at,
      despublicar_at: pub.despublicar_at,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Bibliografía actualizada');
    onChanged();
  }

  async function eliminar() {
    const ok = await confirm({
      title: 'Eliminar bibliografía',
      message: `¿Eliminar "${item.titulo}"?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarBibliografia(item.id);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    onChanged();
  }

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-brand-zebra/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold text-brand-ink">{item.titulo}</p>
          {item.autor && <p className="text-xs text-brand-muted">{item.autor}</p>}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
            estado.tone === 'emerald' && 'bg-emerald-50 text-emerald-700',
            estado.tone === 'slate' && 'bg-slate-100 text-slate-600',
            estado.tone === 'amber' && 'bg-amber-50 text-amber-700',
            estado.tone === 'rose' && 'bg-rose-50 text-rose-700',
          )}
        >
          {estado.label}
        </span>
        <span className="text-brand-muted">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-slate-200 bg-white p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Título" required>
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </Field>
            <Field label="Autor">
              <Input value={autor} onChange={(e) => setAutor(e.target.value)} />
            </Field>
          </div>
          <Field label="Link externo (opcional)">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </Field>
          <FileUploader
            value={archivo}
            onChange={setArchivo}
            onPersist={async (u) => {
              const r = await actualizarBibliografia(item.id, { archivo_url: u });
              if (!r.ok) toast.error(humanizeError(r.error));
              else onChanged();
            }}
            scope="biblio-archivo"
            ownerId={item.id}
            maxMb={50}
            label="Archivo (PDF)"
            hint="Opcional. Subí el PDF de la lectura. El alumno lo descarga. ≤ 50 MB."
          />
          <Field label="Descripción (opcional)">
            <Textarea
              rows={2}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </Field>
          <PublicacionEditor value={pub} onChange={setPub} density="compact" />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void eliminar()}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} /> Eliminar
            </button>
            {dirty && (
              <Button onClick={() => void guardar()} loading={saving}>
                <Save size={13} /> Guardar
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
