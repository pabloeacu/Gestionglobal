import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Award,
  Loader2,
  Save,
} from 'lucide-react';
import { listarEsquemas } from '@/services/api/certificado-esquemas';

type CertEsquemaOpt = { id: string; nombre: string; es_default: boolean };
import {
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Tabs,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import {
  actualizarCurso,
  getCurso,
  MODALIDADES,
  MODALIDAD_LABEL,
  setCursoActivo,
  type CursoDetalle,
  type Modalidad,
} from '@/services/api/campus';
import { ExamenEditor } from '../components/ExamenEditor';
import { CondicionesTab } from '../components/CondicionesTab';
import { GestionMatriculasTab } from '../components/GestionMatriculasTab';
import { EncuentrosTab } from '../components/EncuentrosTab';
import { EncuestaTab } from '../components/EncuestaTab';
import { ContenidoTab } from '../components/ContenidoTab';
import { ImageUploader } from '../components/ImageUploader';
import { PublicacionEditor, type PublicacionState } from '../components/PublicacionEditor';

// Editor de un curso (gerencia/operadores). Tabs: datos, contenido, exámenes,
// matrículas.
export function CursoEditorPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [data, setData] = useState<CursoDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  // OJO: este hook DEBE estar antes de cualquier early return (React #310).
  const [activeKey, setActiveKey] = useState('datos');

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
    { key: 'encuesta', label: 'Encuesta de Satisfacción' },
    { key: 'matriculas', label: 'Alumnos' },
  ];

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
        {activeKey === 'encuesta' && (
          <EncuestaTab curso_id={data.curso.id} curso_titulo={data.curso.titulo} />
        )}
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
  const [instructorFoto, setInstructorFoto] = useState<string | null>(
    data.curso.instructor_foto_url ?? null,
  );
  const [pub, setPub] = useState<PublicacionState>({
    publicado: data.curso.activo,
    publicar_at: data.curso.publicar_at,
    despublicar_at: data.curso.despublicar_at,
  });
  const [certEsquemaId, setCertEsquemaId] = useState<string | null>(
    data.curso.cert_esquema_id ?? null,
  );
  const [certEmiteAuto, setCertEmiteAuto] = useState<boolean>(
    data.curso.cert_emite_auto ?? true,
  );
  const [esquemas, setEsquemas] = useState<CertEsquemaOpt[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listarEsquemas().then((r) => {
      if (r.ok) setEsquemas(r.data.map((e) => ({ id: e.id, nombre: e.nombre, es_default: e.es_default })));
    });
  }, []);

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
      instructor_foto_url: instructorFoto,
      banner_url: banner || null,
      activo: pub.publicado,
      publicar_at: pub.publicar_at,
      despublicar_at: pub.despublicar_at,
      cert_esquema_id: certEsquemaId,
      cert_emite_auto: certEmiteAuto,
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
        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <ImageUploader
            value={instructorFoto}
            onChange={setInstructorFoto}
            onPersist={async (url) => {
              const r = await actualizarCurso(data.curso.id, { instructor_foto_url: url });
              if (!r.ok) toast.error(r.error.message);
              else onChanged();
            }}
            scope="curso-instructor"
            ownerId={data.curso.id}
            shape="circle"
            label="Foto del instructor"
            hint="Recortable, con zoom y rotación. ≤ 5 MB."
          />
          <div className="space-y-3">
            <Field label="Instructor">
              <Input
                value={instructor}
                onChange={(e) => setInstructor(e.target.value)}
              />
            </Field>
            <Field label="Bio del instructor">
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
              />
            </Field>
          </div>
        </div>

        {/* Banner / flyer del curso */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold text-brand-ink">
              Imagen banner / flyer del curso
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-[300px_1fr]">
            <ImageUploader
              value={banner || null}
              onChange={(url) => setBanner(url ?? '')}
              onPersist={async (url) => {
                const r = await actualizarCurso(data.curso.id, { banner_url: url });
                if (!r.ok) toast.error(r.error.message);
                else onChanged();
              }}
              scope="curso-banner"
              ownerId={data.curso.id}
              shape="wide"
              label="Banner"
              hint="Aparece en la landing del curso. Recortable 3:1. ≤ 5 MB."
            />
            <Field
              label="O pegar URL externa (opcional)"
              hint="Si subís un archivo arriba, este campo se autocompleta."
            >
              <Input
                value={banner}
                onChange={(e) => setBanner(e.target.value)}
                placeholder="https://…"
              />
            </Field>
          </div>
        </div>

        {/* Publicación del curso (toggle + ventana opcional) */}
        <PublicacionEditor value={pub} onChange={setPub} />

        {/* Certificado · esquema visual + flag emisión automática */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Award size={14} className="text-brand-cyan" />
            <h3 className="text-sm font-semibold text-brand-ink">Certificado</h3>
            <a
              href="/gerencia/campus/plantillas"
              className="ml-auto text-[11px] font-medium text-brand-cyan hover:underline"
            >
              Gestionar plantillas →
            </a>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Esquema de certificado"
              hint="El diseño visual que se aplica cuando el alumno egresa."
            >
              <Select
                value={certEsquemaId ?? ''}
                onChange={(e) => setCertEsquemaId(e.target.value || null)}
              >
                <option value="">
                  Default institucional
                  {esquemas.find((x) => x.es_default)
                    ? ` (${esquemas.find((x) => x.es_default)!.nombre})`
                    : ''}
                </option>
                {esquemas
                  .filter((x) => !x.es_default)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field
              label="Emisión"
              hint="Si está activo, el motor emite el cert apenas se cumplen las condiciones."
            >
              <label className="flex h-[38px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={certEmiteAuto}
                  onChange={(e) => setCertEmiteAuto(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
                />
                <span className="text-brand-ink">Emitir automáticamente al cumplir condiciones</span>
              </label>
            </Field>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={guardar} loading={saving}>
            <Save size={14} /> Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
