import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Tabs,
  useConfirm,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  actualizarClase,
  actualizarCurso,
  actualizarModulo,
  borrarClase,
  borrarModulo,
  CLASE_TIPOS,
  CLASE_TIPO_LABEL,
  crearBibliografia,
  crearClase,
  crearModulo,
  fmtFechaHora,
  getCurso,
  MODALIDADES,
  MODALIDAD_LABEL,
  setCursoActivo,
  youtubeIdFromUrl,
  type ClaseTipo,
  type CursoBibliografiaRow,
  type CursoClaseRow,
  type CursoDetalle,
  type CursoModuloRow,
  type Modalidad,
} from '@/services/api/campus';
import { ExamenEditor } from '../components/ExamenEditor';
import { CondicionesTab } from '../components/CondicionesTab';
import { GestionMatriculasTab } from '../components/GestionMatriculasTab';
import { EncuentrosTab } from '../components/EncuentrosTab';

// Editor de un curso (gerencia/operadores). Tabs: datos, contenido, exámenes,
// matrículas.
export function CursoEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [data, setData] = useState<CursoDetalle | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const d = await getCurso(id);
    setLoading(false);
    if (!d.ok) {
      toast.error(d.error.message);
      return;
    }
    setData(d.data);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useRealtimeRefresh(
    ['cursos', 'curso_modulos', 'curso_clases', 'curso_examenes', 'curso_matriculas'],
    () => void reload(),
  );

  if (loading || !data) {
    return (
      <div className="grid h-64 place-items-center text-brand-muted">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  const tabs: TabItem[] = [
    { key: 'datos', label: 'Datos generales' },
    { key: 'contenido', label: 'Contenido' },
    { key: 'examenes', label: 'Exámenes' },
    { key: 'condiciones', label: 'Condiciones' },
    { key: 'encuentros', label: 'Encuentros' },
    { key: 'matriculas', label: 'Alumnos' },
  ];
  const [activeKey, setActiveKey] = useState('datos');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/gerencia/campus"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-ink"
          >
            <ArrowLeft size={13} /> Campus
          </Link>
          <p className="kicker mt-2 text-brand-cyan">Curso · /{data.curso.slug}</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            {data.curso.titulo}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-semibold',
              data.curso.activo
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600',
            )}
          >
            {data.curso.activo ? 'Publicado' : 'Borrador'}
          </span>
          <Button
            variant="secondary"
            onClick={async () => {
              const res = await setCursoActivo(data.curso.id, !data.curso.activo);
              if (!res.ok) {
                toast.error(res.error.message);
                return;
              }
              toast.success(
                data.curso.activo ? 'Curso despublicado' : 'Curso publicado',
              );
              void reload();
            }}
          >
            {data.curso.activo ? 'Despublicar' : 'Publicar'}
          </Button>
        </div>
      </header>

      <Tabs items={tabs} activeKey={activeKey} onChange={setActiveKey} />
      <div className="mt-4">
        {activeKey === 'datos' && <DatosTab data={data} onChanged={reload} />}
        {activeKey === 'contenido' && (
          <ContenidoTab data={data} onChanged={reload} />
        )}
        {activeKey === 'examenes' && (
          <ExamenEditor
            cursoId={data.curso.id}
            examenes={data.examenes}
            onChanged={reload}
          />
        )}
        {activeKey === 'condiciones' && <CondicionesTab data={data} />}
        {activeKey === 'encuentros' && <EncuentrosTab data={data} />}
        {activeKey === 'matriculas' && <GestionMatriculasTab data={data} />}
      </div>
    </div>
  );
}

// ============================================================================
// Tab: datos generales
// ============================================================================
function DatosTab({
  data,
  onChanged,
}: {
  data: CursoDetalle;
  onChanged: () => void;
}) {
  const [titulo, setTitulo] = useState(data.curso.titulo);
  const [descripcion, setDescripcion] = useState(data.curso.descripcion ?? '');
  const [descripcionHtml, setDescripcionHtml] = useState(
    data.curso.descripcion_html ?? '',
  );
  const [categoria, setCategoria] = useState(data.curso.categoria ?? '');
  const [modalidad, setModalidad] = useState<Modalidad>(
    (data.curso.modalidad ?? 'asincronica') as Modalidad,
  );
  const [duracion, setDuracion] = useState<number | ''>(
    data.curso.duracion_horas ?? '',
  );
  const [precio, setPrecio] = useState<number | ''>(
    data.curso.precio_lista !== null ? Number(data.curso.precio_lista) : '',
  );
  const [cupo, setCupo] = useState<number | ''>(data.curso.cupo_max ?? '');
  const [vigencia, setVigencia] = useState<number>(data.curso.vigencia_meses);
  const [instructor, setInstructor] = useState(
    data.curso.instructor_nombre ?? '',
  );
  const [bio, setBio] = useState(data.curso.instructor_bio ?? '');
  const [banner, setBanner] = useState(data.curso.banner_url ?? '');
  const [saving, setSaving] = useState(false);

  async function guardar() {
    setSaving(true);
    const res = await actualizarCurso(data.curso.id, {
      titulo,
      descripcion: descripcion || null,
      descripcion_html: descripcionHtml || null,
      categoria: categoria || null,
      modalidad,
      duracion_horas: duracion === '' ? null : Number(duracion),
      precio_lista: precio === '' ? null : Number(precio),
      cupo_max: cupo === '' ? null : Number(cupo),
      vigencia_meses: vigencia,
      instructor_nombre: instructor || null,
      instructor_bio: bio || null,
      banner_url: banner || null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Curso actualizado');
    onChanged();
  }

  return (
    <div className="card-premium relative overflow-hidden p-6">
      <TrianglesAccent
        position="bottom-right"
        size={140}
        tone="cyan"
        density="soft"
        className="opacity-20"
      />
      <div className="relative space-y-4">
        <Field label="Título" required>
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Categoría">
            <Input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Administradores, RR.HH., Fiscal…"
            />
          </Field>
          <Field label="Modalidad">
            <Select
              value={modalidad}
              onChange={(e) => setModalidad(e.target.value as Modalidad)}
            >
              {MODALIDADES.map((m) => (
                <option key={m} value={m}>
                  {MODALIDAD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Descripción corta">
          <Textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
          />
        </Field>
        <Field
          label="Descripción extendida (HTML)"
          hint="Se renderiza tal cual en la landing del curso. HTML básico permitido."
        >
          <Textarea
            value={descripcionHtml}
            onChange={(e) => setDescripcionHtml(e.target.value)}
            rows={5}
            className="font-mono text-xs"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Duración (h)">
            <Input
              type="number"
              min={0}
              value={duracion}
              onChange={(e) =>
                setDuracion(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Precio lista">
            <Input
              type="number"
              min={0}
              value={precio}
              onChange={(e) =>
                setPrecio(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Cupo máximo">
            <Input
              type="number"
              min={1}
              value={cupo}
              onChange={(e) =>
                setCupo(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </Field>
          <Field label="Vigencia (meses)" hint="Default 12.">
            <Input
              type="number"
              min={1}
              max={120}
              value={vigencia}
              onChange={(e) => setVigencia(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instructor">
            <Input
              value={instructor}
              onChange={(e) => setInstructor(e.target.value)}
            />
          </Field>
          <Field label="Banner (URL)">
            <Input
              value={banner}
              onChange={(e) => setBanner(e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>
        <Field label="Bio del instructor">
          <Textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
          />
        </Field>

        <div className="flex justify-end">
          <Button onClick={guardar} loading={saving}>
            <Save size={14} /> Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tab: contenido (módulos + clases + bibliografía)
// ============================================================================
function ContenidoTab({
  data,
  onChanged,
}: {
  data: CursoDetalle;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [nuevoModulo, setNuevoModulo] = useState('');
  const [biblioTitulo, setBiblioTitulo] = useState('');
  const [biblioUrl, setBiblioUrl] = useState('');
  const [biblioAutor, setBiblioAutor] = useState('');

  async function addModulo() {
    if (!nuevoModulo.trim()) return;
    const res = await crearModulo(data.curso.id, nuevoModulo.trim());
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setNuevoModulo('');
    toast.success('Módulo creado');
    onChanged();
  }

  async function delModulo(m: CursoModuloRow) {
    const ok = await confirm({
      title: 'Eliminar módulo',
      message: `¿Eliminar "${m.titulo}" y todas sus clases?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarModulo(m.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onChanged();
  }

  async function addBiblio() {
    if (!biblioTitulo.trim()) return;
    const res = await crearBibliografia(data.curso.id, {
      titulo: biblioTitulo.trim(),
      autor: biblioAutor.trim() || null,
      url: biblioUrl.trim() || null,
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setBiblioTitulo('');
    setBiblioAutor('');
    setBiblioUrl('');
    onChanged();
  }

  async function moverModulo(m: CursoModuloRow, dir: -1 | 1) {
    const orden = (m.orden ?? 0) + dir;
    if (orden < 0) return;
    const res = await actualizarModulo(m.id, { orden });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-5">
      {/* Alta módulo */}
      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Nuevo módulo" className="flex-1">
          <Input
            value={nuevoModulo}
            onChange={(e) => setNuevoModulo(e.target.value)}
            placeholder="Título del módulo"
          />
        </Field>
        <Button onClick={addModulo}>
          <Plus size={14} /> Agregar módulo
        </Button>
      </section>

      {/* Lista módulos */}
      {data.modulos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-brand-muted">
          Todavía no hay módulos. Creá el primero arriba.
        </div>
      ) : (
        data.modulos.map((m) => (
          <ModuloCard
            key={m.id}
            modulo={m}
            onChanged={onChanged}
            onMove={(d) => void moverModulo(m, d)}
            onDelete={() => void delModulo(m)}
          />
        ))
      )}

      {/* Bibliografía */}
      <section className="card-premium p-5">
        <header className="mb-3 flex items-center gap-2">
          <BookOpen size={16} className="text-brand-cyan" />
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            Bibliografía
          </h2>
        </header>
        {data.bibliografia.length === 0 ? (
          <p className="text-sm text-brand-muted">
            Todavía no hay bibliografía cargada.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.bibliografia.map((b) => (
              <BiblioItem key={b.id} item={b} />
            ))}
          </ul>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            value={biblioTitulo}
            onChange={(e) => setBiblioTitulo(e.target.value)}
            placeholder="Título"
          />
          <Input
            value={biblioAutor}
            onChange={(e) => setBiblioAutor(e.target.value)}
            placeholder="Autor"
          />
          <Input
            value={biblioUrl}
            onChange={(e) => setBiblioUrl(e.target.value)}
            placeholder="URL (opcional)"
          />
          <Button onClick={addBiblio}>
            <Plus size={14} /> Agregar
          </Button>
        </div>
      </section>
    </div>
  );
}

function BiblioItem({ item }: { item: CursoBibliografiaRow }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="truncate font-semibold text-brand-ink">{item.titulo}</p>
        {item.autor && <p className="text-xs text-brand-muted">{item.autor}</p>}
      </div>
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-brand-cyan hover:underline"
        >
          Abrir
        </a>
      )}
    </li>
  );
}

function ModuloCard({
  modulo,
  onChanged,
  onMove,
  onDelete,
}: {
  modulo: CursoDetalle['modulos'][number];
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const [tipo, setTipo] = useState<ClaseTipo>('asincronica_video');
  const [titulo, setTitulo] = useState('');
  const [url, setUrl] = useState('');
  const [fecha, setFecha] = useState('');
  const [duracion, setDuracion] = useState<number | ''>('');

  async function addClase() {
    if (!titulo.trim()) {
      toast.error('Ponele un título a la clase.');
      return;
    }
    const res = await crearClase({
      modulo_id: modulo.id,
      titulo: titulo.trim(),
      tipo,
      youtube_url: tipo === 'asincronica_video' ? url.trim() || null : null,
      zoom_url: tipo === 'sincronica_zoom' ? url.trim() || null : null,
      zoom_fecha_hora:
        tipo === 'sincronica_zoom' && fecha ? new Date(fecha).toISOString() : null,
      material_url: tipo === 'lectura_pdf' ? url.trim() || null : null,
      duracion_min: duracion === '' ? null : Number(duracion),
    });
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setTitulo('');
    setUrl('');
    setFecha('');
    setDuracion('');
    onChanged();
  }

  async function delClase(c: CursoClaseRow) {
    const ok = await confirm({
      title: 'Eliminar clase',
      message: `¿Eliminar "${c.titulo}"?`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await borrarClase(c.id);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    onChanged();
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-brand-zebra/30 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-cyan/10 text-xs font-bold text-brand-cyan">
            {modulo.orden}
          </span>
          <div>
            <p className="font-display text-base font-semibold text-brand-ink">
              {modulo.titulo}
            </p>
            {modulo.descripcion && (
              <p className="text-xs text-brand-muted">{modulo.descripcion}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-brand-muted">
          <button
            onClick={() => onMove(-1)}
            className="rounded-md p-1 hover:bg-white"
            title="Subir"
          >
            <ChevronLeft size={14} className="rotate-90" />
          </button>
          <button
            onClick={() => onMove(1)}
            className="rounded-md p-1 hover:bg-white"
            title="Bajar"
          >
            <ChevronRight size={14} className="rotate-90" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1 hover:bg-red-50 hover:text-red-600"
            title="Eliminar módulo"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {modulo.clases.length === 0 ? (
          <p className="text-sm text-brand-muted">Aún no hay clases.</p>
        ) : (
          <ol className="space-y-2">
            {modulo.clases.map((c) => (
              <ClasePreview
                key={c.id}
                clase={c}
                onDelete={() => void delClase(c)}
                onSavedOrden={async (orden) => {
                  const res = await actualizarClase(c.id, { orden });
                  if (!res.ok) toast.error(res.error.message);
                  onChanged();
                }}
              />
            ))}
          </ol>
        )}

        {/* Alta clase */}
        <div className="rounded-xl border border-dashed border-slate-300 p-3">
          <p className="kicker text-brand-cyan">Nueva clase</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Título de la clase"
            />
            <Select value={tipo} onChange={(e) => setTipo(e.target.value as ClaseTipo)}>
              {CLASE_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {CLASE_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={
                tipo === 'asincronica_video'
                  ? 'YouTube URL'
                  : tipo === 'sincronica_zoom'
                  ? 'Zoom URL'
                  : tipo === 'lectura_pdf'
                  ? 'URL del material'
                  : 'URL (opcional)'
              }
            />
            <Input
              type="datetime-local"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              disabled={tipo !== 'sincronica_zoom'}
            />
            <Input
              type="number"
              min={0}
              value={duracion}
              onChange={(e) =>
                setDuracion(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="min"
            />
            <Button onClick={addClase}>
              <Plus size={14} />
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ClasePreview({
  clase,
  onDelete,
  onSavedOrden,
}: {
  clase: CursoClaseRow;
  onDelete: () => void;
  onSavedOrden: (n: number) => void;
}) {
  const ytId = useMemo(() => youtubeIdFromUrl(clase.youtube_url), [clase.youtube_url]);
  return (
    <li className="flex items-start gap-3 rounded-lg border border-slate-100 bg-brand-zebra/30 p-3">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-xs font-semibold text-brand-cyan">
        {clase.orden}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand-ink">
          {clase.titulo}
        </p>
        <p className="text-xs text-brand-muted">
          {CLASE_TIPO_LABEL[clase.tipo as ClaseTipo]}
          {clase.zoom_fecha_hora && ` · ${fmtFechaHora(clase.zoom_fecha_hora)}`}
          {clase.duracion_min && ` · ${clase.duracion_min} min`}
          {ytId && ` · YT:${ytId}`}
        </p>
      </div>
      <div className="flex items-center gap-1 text-brand-muted">
        <button
          onClick={() => onSavedOrden(Math.max(1, (clase.orden ?? 1) - 1))}
          className="rounded-md p-1 hover:bg-white"
          title="Subir"
        >
          ↑
        </button>
        <button
          onClick={() => onSavedOrden((clase.orden ?? 1) + 1)}
          className="rounded-md p-1 hover:bg-white"
          title="Bajar"
        >
          ↓
        </button>
        <button
          onClick={onDelete}
          className="rounded-md p-1 hover:bg-red-50 hover:text-red-600"
          title="Eliminar"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}


