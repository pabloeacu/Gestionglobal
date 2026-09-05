// Tab "Contenido" del editor del curso (gerencia).
// Rediseñado en sesión 30/05/2026 (Campus L1):
//   · El editor mantiene la potestad sobre cada módulo, cada clase y cada
//     ítem de bibliografía: títulos, URLs, fechas, foto del instructor — todo
//     editable inline, sin perder dominio al agregar otro módulo.
//   · Publicación con ventana (checkbox + publicar_at + despublicar_at) por
//     módulo, clase y bibliografía. Mig 0140.
//   · Imágenes: ícono por módulo, foto del instructor en clases asincrónicas.

import { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronDown,
  Paperclip,
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
  actualizarMaterialModulo,
  actualizarModulo,
  borrarBibliografia,
  borrarClase,
  borrarMaterialModulo,
  borrarModulo,
  CLASE_TIPOS,
  CLASE_TIPO_LABEL,
  crearBibliografia,
  crearClase,
  crearMaterialModulo,
  crearModulo,
  estadoPublicacion,
  fmtFechaHora,
  swapOrdenModulo,
  swapOrdenClase,
  type ClaseTipo,
  type CursoBibliografiaRow,
  type CursoClaseRow,
  type CursoDetalle,
  type CursoModuloMaterialRow,
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
  // Guard in-flight: evita que un doble-click en las flechas dispare 2 swaps
  // solapados (§6 B#15).
  const reordenandoRef = useRef(false);

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

  // Reordenar = SWAP del `orden` con el módulo vecino (no `orden ± 1`: eso dejaba
  // dos módulos con el mismo valor → sort inestable y numeración impredecible).
  // El badge muestra la posición (i+1), así que el `orden` sólo importa como
  // clave de ordenamiento; intercambiarlo con el vecino mueve el módulo un lugar.
  async function moverModulo(i: number, dir: -1 | 1) {
    if (reordenandoRef.current) return; // ya hay un swap en vuelo
    const j = i + dir;
    if (j < 0 || j >= data.modulos.length) return;
    const a = data.modulos[i];
    const b = data.modulos[j];
    if (!a || !b) return; // narrowing para noUncheckedIndexedAccess (j ya está en rango)
    reordenandoRef.current = true;
    try {
      const res = await swapOrdenModulo(a.id, b.id); // swap ATÓMICO (mig 0463)
      if (!res.ok) {
        toast.error(humanizeError(res.error));
        return;
      }
      onChanged();
    } finally {
      reordenandoRef.current = false;
    }
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
            posicion={i + 1}
            esPrimero={i === 0}
            esUltimo={i === data.modulos.length - 1}
            onChanged={onChanged}
            onMove={(d) => void moverModulo(i, d)}
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
  posicion,
  esPrimero,
  esUltimo,
  onChanged,
  onMove,
}: {
  modulo: CursoDetalle['modulos'][number];
  posicion: number;
  esPrimero: boolean;
  esUltimo: boolean;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const confirm = useConfirm();
  // Colapsado por defecto: con varios módulos, el editor es más manejable
  // arrancando cerrado (pedido Pablo). El gerente expande el que va a editar.
  const [expanded, setExpanded] = useState(false);
  // Guard in-flight del reorden de clases (§6 B#15).
  const reordenandoClaseRef = useRef(false);
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

  // Reordenar clases = SWAP del `orden` con la vecina (mismo criterio que los
  // módulos: `orden ± 1` colisionaba). El badge de la clase muestra la posición.
  async function moverClase(idx: number, dir: -1 | 1) {
    if (reordenandoClaseRef.current) return; // ya hay un swap en vuelo
    const j = idx + dir;
    if (j < 0 || j >= modulo.clases.length) return;
    const a = modulo.clases[idx];
    const b = modulo.clases[j];
    if (!a || !b) return; // narrowing para noUncheckedIndexedAccess (j ya está en rango)
    reordenandoClaseRef.current = true;
    try {
      const res = await swapOrdenClase(a.id, b.id); // swap ATÓMICO (mig 0463)
      if (!res.ok) {
        toast.error(humanizeError(res.error));
        return;
      }
      onChanged();
    } finally {
      reordenandoClaseRef.current = false;
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header: toda la franja (badge + título + estado) es el toggle de
          colapsar/expandir — un solo chevron rotante lo indica. Las acciones de
          reordenar (flechas agrupadas) y eliminar viven en un cluster APARTE, con
          iconos distintos del chevron, para no confundir "colapsar" con "mover". */}
      <header className="flex items-stretch justify-between gap-2 border-b border-slate-100 bg-brand-zebra/30">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Colapsar módulo' : 'Expandir módulo'}
          className="flex min-w-0 flex-1 items-center gap-3 p-4 text-left transition hover:bg-white/50"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-cyan/10 text-xs font-bold text-brand-cyan">
            {posicion}
          </span>
          {modulo.icono_url ? (
            <img
              src={modulo.icono_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg border border-slate-200 object-cover"
            />
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-base font-semibold text-brand-ink">
              {modulo.titulo}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-brand-muted">
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
            </span>
          </span>
          <ChevronDown
            size={18}
            className={cn(
              'shrink-0 text-brand-muted transition-transform duration-300',
              expanded && 'rotate-180',
            )}
            aria-hidden
          />
        </button>

        {/* Acciones (separadas del toggle): reordenar + eliminar */}
        <div className="flex items-center gap-1.5 self-center pl-1 pr-3">
          {/* Grupo de reorden: flechas SÓLIDAS agrupadas en una pastilla — se
              lee como un control único de "mover", distinto del chevron. */}
          <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={esPrimero}
              className="px-1.5 py-1.5 text-brand-muted transition hover:bg-slate-50 hover:text-brand-ink disabled:opacity-25"
              title="Subir módulo"
              aria-label="Subir módulo"
            >
              <ArrowUp size={14} />
            </button>
            <span className="h-4 w-px bg-slate-200" aria-hidden />
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={esUltimo}
              className="px-1.5 py-1.5 text-brand-muted transition hover:bg-slate-50 hover:text-brand-ink disabled:opacity-25"
              title="Bajar módulo"
              aria-label="Bajar módulo"
            >
              <ArrowDown size={14} />
            </button>
          </div>
          <button
            type="button"
            onClick={() => void eliminar()}
            className="rounded-md p-1.5 text-brand-muted transition hover:bg-red-50 hover:text-red-600"
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
                bankEnabled
                onPickBank={async (item) => {
                  setDocenteNombre(item.nombre);
                  setDocenteCv(item.cv_url);
                  const r = await actualizarModulo(modulo.id, {
                    docente_nombre: item.nombre,
                    docente_cv_url: item.cv_url,
                  });
                  if (!r.ok) toast.error(humanizeError(r.error));
                  else onChanged();
                }}
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
                    posicion={idx + 1}
                    esPrimero={idx === 0}
                    esUltimo={idx === modulo.clases.length - 1}
                    onChanged={onChanged}
                    onMove={(d) => void moverClase(idx, d)}
                  />
                ))}
              </ol>
            )}
            <NuevaClaseForm moduloId={modulo.id} onCreated={onChanged} />
          </div>

          {/* Material extra del módulo (DGG-72): links/archivos varios. Al
              alumno se le muestra sólo si hay ≥1 ítem. */}
          <MaterialExtraSection
            moduloId={modulo.id}
            items={modulo.material}
            onChanged={onChanged}
          />
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
  posicion,
  esPrimero,
  esUltimo,
  onChanged,
  onMove,
}: {
  clase: CursoClaseRow;
  posicion: number;
  esPrimero: boolean;
  esUltimo: boolean;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
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
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-white text-xs font-semibold text-brand-cyan ring-1 ring-slate-200">
          {posicion}
        </span>
        {clase.instructor_foto_url ? (
          <img
            src={clase.instructor_foto_url}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : null}
        <span className="block min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-brand-ink">
            {clase.titulo}
          </span>
          <span className="block truncate text-xs text-brand-muted">
            <span className="inline-flex items-center gap-1">
              {tipoIcon}
              {CLASE_TIPO_LABEL[clase.tipo as ClaseTipo]}
            </span>
            {clase.zoom_fecha_hora && ` · ${fmtFechaHora(clase.zoom_fecha_hora)}`}
            {clase.duracion_min ? ` · ${clase.duracion_min} min` : ''}
          </span>
        </span>
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
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-brand-muted transition-transform duration-300',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-slate-200 bg-white p-3">
          {/* Acciones de orden + borrar — flechas sólidas en pastilla (mismo
              idiom que los módulos), distintas del chevron de colapsar. */}
          <div className="flex items-center justify-end gap-1.5 text-brand-muted">
            <div className="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => onMove(-1)}
                disabled={esPrimero}
                className="px-1.5 py-1 transition hover:bg-slate-50 hover:text-brand-ink disabled:opacity-25"
                title="Subir clase"
                aria-label="Subir clase"
              >
                <ArrowUp size={13} />
              </button>
              <span className="h-4 w-px bg-slate-200" aria-hidden />
              <button
                type="button"
                onClick={() => onMove(1)}
                disabled={esUltimo}
                className="px-1.5 py-1 transition hover:bg-slate-50 hover:text-brand-ink disabled:opacity-25"
                title="Bajar clase"
                aria-label="Bajar clase"
              >
                <ArrowDown size={13} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void eliminar()}
              className="rounded-md p-1.5 transition hover:bg-red-50 hover:text-red-600"
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
                hint="Avatar del docente. Subí una nueva o reusá una del banco. Recortable. ≤ 5 MB."
                bankEnabled
                onPickBank={async (item) => {
                  // La clase solo guarda foto (sin nombre); reusamos la imagen.
                  setFoto(item.foto_url);
                  const r = await actualizarClase(clase.id, {
                    instructor_foto_url: item.foto_url,
                  });
                  if (!r.ok) toast.error(humanizeError(r.error));
                  else onChanged();
                }}
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
// ============================================================================
// MATERIAL EXTRA por módulo (DGG-72) · links/archivos varios; visible al alumno
// SÓLO si el módulo tiene ≥1 ítem. Opera como bibliografía pero con scope módulo.
// ============================================================================
function MaterialExtraSection({
  moduloId,
  items,
  onChanged,
}: {
  moduloId: string;
  items: CursoModuloMaterialRow[];
  onChanged: () => void;
}) {
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevoUrl, setNuevoUrl] = useState('');
  const [nuevoArchivo, setNuevoArchivo] = useState<string | null>(null);
  // ownerId temporal para subir el archivo ANTES de que exista la fila.
  const [tempOwnerId, setTempOwnerId] = useState(() => crypto.randomUUID());
  const [creando, setCreando] = useState(false);

  async function crear() {
    if (!nuevoTitulo.trim()) {
      toast.error('Ponele un título al material.');
      return;
    }
    if (!nuevoUrl.trim() && !nuevoArchivo) {
      toast.error('Agregá un link o subí un archivo.');
      return;
    }
    setCreando(true);
    const res = await crearMaterialModulo(moduloId, {
      titulo: nuevoTitulo.trim(),
      url: nuevoUrl.trim() || null,
      archivo_url: nuevoArchivo,
    });
    setCreando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    setNuevoTitulo('');
    setNuevoUrl('');
    setNuevoArchivo(null);
    setTempOwnerId(crypto.randomUUID());
    onChanged();
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-4">
      <h4 className="kicker mb-0 flex items-center gap-1 text-brand-muted">
        <Paperclip size={12} /> Material extra
      </h4>
      <p className="text-[11px] text-brand-muted">
        Links o archivos del módulo. Al alumno sólo se le muestra si hay al menos
        uno cargado.
      </p>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <MaterialItem key={it.id} item={it} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-brand-zebra/20 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted">
          Nuevo material
        </p>
        <Input
          value={nuevoTitulo}
          onChange={(e) => setNuevoTitulo(e.target.value)}
          placeholder="Título * (ej: Planilla de cálculo)"
        />
        <Input
          value={nuevoUrl}
          onChange={(e) => setNuevoUrl(e.target.value)}
          placeholder="Link externo (https://…)"
        />
        <FileUploader
          value={nuevoArchivo}
          onChange={setNuevoArchivo}
          scope="modulo-material"
          ownerId={tempOwnerId}
          maxMb={50}
          accept="*/*"
          label="Archivo"
          hint="Cargá el link externo O subí el archivo (lo que prefieras). ≤ 50 MB."
        />
        <div className="flex justify-end">
          <Button onClick={crear} loading={creando}>
            <Plus size={13} /> Agregar
          </Button>
        </div>
      </div>
    </div>
  );
}

function MaterialItem({
  item,
  onChanged,
}: {
  item: CursoModuloMaterialRow;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState(false);
  const [titulo, setTitulo] = useState(item.titulo);
  const [url, setUrl] = useState(item.url ?? '');
  const [archivo, setArchivo] = useState<string | null>(item.archivo_url ?? null);
  const [descripcion, setDescripcion] = useState(item.descripcion ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    titulo !== item.titulo ||
    (url || null) !== (item.url ?? null) ||
    (archivo || null) !== (item.archivo_url ?? null) ||
    (descripcion || null) !== (item.descripcion ?? null);

  async function guardar() {
    if (!titulo.trim()) {
      toast.error('El título no puede quedar vacío.');
      return;
    }
    setSaving(true);
    const res = await actualizarMaterialModulo(item.id, {
      titulo: titulo.trim(),
      url: url.trim() || null,
      archivo_url: archivo,
      descripcion: descripcion.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Material actualizado');
    onChanged();
  }

  async function eliminar() {
    const ok = await confirm({
      title: 'Eliminar material',
      message: `¿Eliminar "${item.titulo}"?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarMaterialModulo(item.id);
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
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white"
      >
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-brand-ink">{item.titulo}</span>
          <span className="block truncate text-xs text-brand-muted">
            {item.archivo_url ? 'Archivo' : item.url ? 'Link' : 'Sin contenido'}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-brand-muted transition-transform duration-300',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-slate-200 bg-white p-3">
          <Field label="Título" required>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </Field>
          <Field label="Link externo (opcional)">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <FileUploader
            value={archivo}
            onChange={setArchivo}
            onPersist={async (u) => {
              const r = await actualizarMaterialModulo(item.id, { archivo_url: u });
              if (!r.ok) toast.error(humanizeError(r.error));
              else onChanged();
            }}
            scope="modulo-material"
            ownerId={item.id}
            maxMb={50}
            accept="*/*"
            label="Archivo"
            hint="Link O archivo. El alumno lo abre/descarga. ≤ 50 MB."
          />
          <Field label="Descripción (opcional)">
            <Textarea
              rows={2}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </Field>
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
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-white"
      >
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-brand-ink">{item.titulo}</span>
          {item.autor && <span className="block text-xs text-brand-muted">{item.autor}</span>}
        </span>
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
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-brand-muted transition-transform duration-300',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
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
