import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Plus,
  Search,
  ScrollText,
  Users,
} from 'lucide-react';
import {
  AnimatedNumber,
  Button,
  Drawer,
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  crearCurso,
  listCursos,
  listMatriculas,
  MODALIDADES,
  MODALIDAD_LABEL,
  type CursoListItem,
  type Modalidad,
  type MatriculaListItem,
} from '@/services/api/campus';
import { CursoCard } from '../components/CursoCard';
import { humanizeError } from '@/lib/errors';

type ModFilter = Modalidad | 'todos';

// Página de gerencia/operadores: cataloga los cursos, KPIs y permite crear uno
// nuevo desde un Drawer.
export function CampusListPage() {
  const [cursos, setCursos] = useState<CursoListItem[]>([]);
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalidad, setModalidad] = useState<ModFilter>('todos');
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [c, m] = await Promise.all([
      listCursos({ soloActivos: false }),
      listMatriculas({}),
    ]);
    setLoading(false);
    if (!c.ok) {
      toast.error(`No pudimos cargar cursos: ${humanizeError(c.error)}`);
      return;
    }
    setCursos(c.data);
    if (m.ok) setMatriculas(m.data);
  }

  useEffect(() => {
    void load();
  }, []);

  useRealtimeRefresh(
    ['cursos', 'curso_matriculas', 'examen_intentos'],
    () => void load(),
  );

  const filtered = useMemo(() => {
    return cursos.filter((c) => {
      if (modalidad !== 'todos' && c.modalidad !== modalidad) return false;
      if (search.trim().length > 0) {
        const s = search.trim().toLowerCase();
        const hay = [c.titulo, c.slug, c.categoria]
          .filter(Boolean)
          .some((x) => x!.toLowerCase().includes(s));
        if (!hay) return false;
      }
      return true;
    });
  }, [cursos, search, modalidad]);

  const kpis = useMemo(() => {
    const activas = matriculas.filter((m) => m.estado === 'activa').length;
    const completadas = matriculas.filter((m) => m.estado === 'completada')
      .length;
    return { activas, completadas, cursos: cursos.filter((c) => c.activo).length };
  }, [cursos, matriculas]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Subsistema 7</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Campus virtual
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Cursos con clases asincrónicas, encuentros sincrónicos y exámenes
            autocorregibles. Vinculá matrículas a tus formularios de inscripción.
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus size={16} /> Nuevo curso
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Cursos activos"
          value={<AnimatedNumber value={kpis.cursos} />}
          icon={<GraduationCap size={18} />}
          tone="cyan"
        />
        <KpiCard
          label="Matrículas activas"
          value={<AnimatedNumber value={kpis.activas} />}
          icon={<Users size={18} />}
          tone="emerald"
        />
        <KpiCard
          label="Cursadas completadas"
          value={<AnimatedNumber value={kpis.completadas} />}
          icon={<CheckCircle2 size={18} />}
          tone="amber"
        />
      </section>

      <section className="card-premium flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="Buscar" className="flex-1">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Título, slug o categoría"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Modalidad" className="sm:w-48">
          <Select
            value={modalidad}
            onChange={(e) => setModalidad(e.target.value as ModFilter)}
          >
            <option value="todos">Todas</option>
            {MODALIDADES.map((m) => (
              <option key={m} value={m}>
                {MODALIDAD_LABEL[m]}
              </option>
            ))}
          </Select>
        </Field>
      </section>

      <section className="card-premium relative overflow-hidden p-5">
        <TrianglesAccent
          position="top-right"
          size={140}
          tone="cyan"
          density="soft"
          className="opacity-20"
        />
        <div className="relative">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-72 w-full rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={cursos.length === 0 ? 'Aún no hay cursos' : 'Sin resultados'}
              description={
                <>
                  Creá tu primer curso para arrancar el campus. Podés vincular
                  matrículas desde los formularios "Curso de Formación" y
                  "Curso de Actualización".
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Nuevo curso
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((c) => (
                <CursoCard
                  key={c.id}
                  curso={c}
                  to={`/gerencia/campus/${c.id}`}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Lista compacta de últimas matrículas */}
      {!loading && matriculas.length > 0 && (
        <section className="card-premium p-5">
          <header className="mb-3 flex items-center gap-2">
            <ScrollText size={16} className="text-brand-cyan" />
            <h2 className="font-display text-lg font-semibold text-brand-ink">
              Últimas matrículas
            </h2>
          </header>
          <ul className="divide-y divide-slate-100">
            {matriculas.slice(0, 6).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-brand-ink">
                    {m.alumno_nombre ?? 'Alumno'}
                  </p>
                  <p className="truncate text-xs text-brand-muted">
                    {m.curso?.titulo ?? 'Curso'}{' '}
                    {m.administracion_nombre && (
                      <span>· {m.administracion_nombre}</span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                    m.estado === 'activa'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 bg-slate-50 text-slate-700',
                  )}
                >
                  {m.estado}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NuevoCursoDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={(id) => {
          setDrawerOpen(false);
          void load();
          window.location.assign(`/gerencia/campus/${id}`);
        }}
      />
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone: 'cyan' | 'emerald' | 'amber';
}

const TONE: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
};

function KpiCard({ label, value, icon, tone }: KpiCardProps) {
  return (
    <div className="card-premium flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONE[tone])}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </p>
        <p className="font-display text-2xl font-bold text-brand-ink">{value}</p>
      </div>
    </div>
  );
}

interface NuevoCursoDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}

function NuevoCursoDrawer({ open, onClose, onSaved }: NuevoCursoDrawerProps) {
  const [slug, setSlug] = useState('');
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad>('asincronica');
  const [duracion, setDuracion] = useState<number | ''>('');
  const [precio, setPrecio] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!slug.trim() || !titulo.trim()) {
      toast.error('Slug y título son obligatorios.');
      return;
    }
    setSaving(true);
    const res = await crearCurso({
      slug: slug.trim(),
      titulo: titulo.trim(),
      descripcion: descripcion.trim() || null,
      modalidad,
      duracion_horas: duracion === '' ? null : Number(duracion),
      precio_lista: precio === '' ? null : Number(precio),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Curso creado');
    onSaved(res.data.id);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Nuevo curso"
      kicker="Campus · Subsistema 7"
      description="Definí los datos básicos. Luego cargás módulos, clases y exámenes desde el editor."
      icon={<BookOpen size={18} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={guardar} loading={saving}>
            Crear curso
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Título"
          required
          hint="Cómo aparece en el catálogo."
        >
          <Input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Curso de Formación para Administradores RPAC"
          />
        </Field>
        <Field label="Slug" required hint="URL amigable. Solo letras minúsculas, números y guiones.">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="curso-administradores-formacion-rpac"
          />
        </Field>
        <Field label="Descripción">
          <textarea
            className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm outline-none focus:border-brand-cyan focus:ring-4 focus:ring-brand-cyan/10"
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Resumen breve de qué se aprende."
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Field label="Precio">
            <Input
              type="number"
              min={0}
              value={precio}
              onChange={(e) =>
                setPrecio(e.target.value === '' ? '' : Number(e.target.value))
              }
            />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}
