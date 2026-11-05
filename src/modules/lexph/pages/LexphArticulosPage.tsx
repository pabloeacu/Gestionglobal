// LexphArticulosPage · grilla del CMS editorial LexPH (gerencia).
// DGG-244 · R4 (queries en services/), R13 (useConfirm, sin window.confirm),
// R19 (KPIs sobre el universo completo; filtros en memoria con useMemo).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Tags, Search, Newspaper } from 'lucide-react';
import {
  Button,
  Input,
  Tabs,
  Skeleton,
  Paginador,
  PAGE_SIZE_DEFAULT,
  useConfirm,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  listArticulos,
  eliminarArticulo,
  type LexphArticuloConTags,
} from '@/services/api/lexph';
import { TIPOS, tipoMeta } from '../constants';

type FiltroEstado = 'todos' | 'publicado' | 'borrador';

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function LexphArticulosPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [items, setItems] = useState<LexphArticuloConTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<FiltroEstado>('todos');
  const [tipoFiltro, setTipoFiltro] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  async function refresh() {
    const res = await listArticulos();
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar los contenidos', { description: humanizeError(res.error) });
      return;
    }
    setItems(res.data);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: recargar al cambiar artículos o el M2M de etiquetas.
  useRealtimeRefresh(['lexph_articulos', 'lexph_articulo_tags'], () => void refresh());

  // R19 · KPIs sobre el universo completo (items crudos, sin filtro de backend).
  const kpis = useMemo(() => {
    const total = items.length;
    const publicados = items.filter((a) => a.estado === 'publicado').length;
    const borradores = total - publicados;
    return { total, publicados, borradores };
  }, [items]);

  // Filtro en memoria para la lista visible.
  const filtrados = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((a) => {
      if (estado !== 'todos' && a.estado !== estado) return false;
      if (tipoFiltro && a.tipo !== tipoFiltro) return false;
      if (needle) {
        const hay =
          a.titulo.toLowerCase().includes(needle) ||
          (a.resumen ?? '').toLowerCase().includes(needle) ||
          a.slug.toLowerCase().includes(needle) ||
          a.tags.some((t) => t.nombre.toLowerCase().includes(needle));
        if (!hay) return false;
      }
      return true;
    });
  }, [items, estado, tipoFiltro, q]);

  // Reset de página cuando cambian los filtros.
  useEffect(() => setPage(1), [estado, tipoFiltro, q]);

  const totalFiltrados = filtrados.length;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrados / PAGE_SIZE_DEFAULT));
  // Clamp: tras borrar en una página alta, no quedar en una página vacía.
  useEffect(() => {
    if (page > totalPaginas) setPage(totalPaginas);
  }, [page, totalPaginas]);
  const safePage = Math.min(page, totalPaginas);
  const pageItems = useMemo(
    () => filtrados.slice((safePage - 1) * PAGE_SIZE_DEFAULT, safePage * PAGE_SIZE_DEFAULT),
    [filtrados, safePage],
  );

  const tabs: TabItem[] = [
    { key: 'todos', label: `Todos · ${kpis.total}` },
    { key: 'publicado', label: `Publicados · ${kpis.publicados}` },
    { key: 'borrador', label: `Borradores · ${kpis.borradores}` },
  ];

  async function handleEliminar(a: LexphArticuloConTags) {
    const ok = await confirm({
      title: 'Eliminar artículo',
      message: `¿Eliminar "${a.titulo}"? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarArticulo(a.id);
    if (!res.ok) {
      toast.error('No pudimos eliminar', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Artículo eliminado');
    setItems((prev) => prev.filter((x) => x.id !== a.id));
  }

  return (
    <div className="relative space-y-6 pb-12">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      {/* Header */}
      <header className="card-premium relative overflow-hidden">
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="kicker text-brand-cyan">LEXPH · UN SERVICIO DE GESTIÓN GLOBAL</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink">Contenidos</h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Hub editorial de propiedad horizontal: fallos, normativas, novedades internacionales e
              insights. Cargá y publicá las piezas que después alimentan el newsletter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/gerencia/contenidos/etiquetas')}>
              <Tags size={15} /> Etiquetas
            </Button>
            <Button onClick={() => navigate('/gerencia/contenidos/nuevo')}>
              <Plus size={15} /> Nuevo artículo
            </Button>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs items={tabs} activeKey={estado} onChange={(k) => setEstado(k as FiltroEstado)} />
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título, etiqueta…"
            className="pl-9"
          />
        </div>
      </div>

      {/* Chips de tipo */}
      <div className="flex flex-wrap gap-1.5">
        <TipoChip active={tipoFiltro === null} onClick={() => setTipoFiltro(null)} label="Todos los tipos" />
        {TIPOS.map((t) => (
          <TipoChip
            key={t.value}
            active={tipoFiltro === t.value}
            onClick={() => setTipoFiltro(tipoFiltro === t.value ? null : t.value)}
            label={t.plural}
          />
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Todavía no hay contenidos"
          description="Creá el primer artículo de LexPH. Cuando lo publiques, quedará listo para el próximo newsletter."
          action={<Button onClick={() => navigate('/gerencia/contenidos/nuevo')}><Plus size={15} /> Nuevo artículo</Button>}
        />
      ) : totalFiltrados === 0 ? (
        <IllustratedEmpty illustration="busqueda" title="Sin resultados" description="Ajustá los filtros o la búsqueda." />
      ) : (
        <>
          <ul className="space-y-2">
            {pageItems.map((a) => {
              const meta = tipoMeta(a.tipo);
              const Icon = meta.icon;
              return (
                <li key={a.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/gerencia/contenidos/${a.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/gerencia/contenidos/${a.id}`);
                      }
                    }}
                    className="card-premium group flex cursor-pointer items-center gap-4 p-4 transition hover:border-brand-cyan/50"
                  >
                    <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${meta.chip}`}>
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${meta.chip}`}>
                          {meta.label}
                        </span>
                        <EstadoChip estado={a.estado} />
                      </div>
                      <p className="mt-1 truncate font-display text-base font-semibold text-brand-ink">
                        {a.titulo}
                      </p>
                      {a.tags.length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-brand-muted">
                          {a.tags.map((t) => t.nombre).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="hidden flex-shrink-0 text-right text-xs text-brand-muted sm:block">
                      <p className="tabular-nums">
                        {a.estado === 'publicado' ? fmtFecha(a.publicado_at) : `edit. ${fmtFecha(a.updated_at)}`}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        type="button"
                        title="Editar"
                        aria-label="Editar"
                        onClick={(e) => { e.stopPropagation(); navigate(`/gerencia/contenidos/${a.id}`); }}
                        className="grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-brand-cyan-pale/60 hover:text-brand-cyan"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        title="Eliminar"
                        aria-label="Eliminar"
                        onClick={(e) => { e.stopPropagation(); void handleEliminar(a); }}
                        className="grid h-8 w-8 place-items-center rounded-lg text-brand-muted transition hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Paginador
            page={page}
            pageSize={PAGE_SIZE_DEFAULT}
            total={totalFiltrados}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}

function TipoChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? 'border-brand-cyan bg-brand-cyan text-white'
          : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/50'
      }`}
    >
      {label}
    </button>
  );
}

function EstadoChip({ estado }: { estado: string }) {
  const publicado = estado === 'publicado';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
        publicado ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      <Newspaper size={10} /> {publicado ? 'Publicado' : 'Borrador'}
    </span>
  );
}
