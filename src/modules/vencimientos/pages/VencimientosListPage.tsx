import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import {
  Plus,
  Search,
  Filter,
  CalendarClock,
  AlertTriangle,
  Sliders,
  RefreshCcw,
  Download,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Button,
  Field,
  Input,
  Select,
  Skeleton,
  AnimatedNumber,
  useConfirm,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import { VencimientoFormDrawer } from '../components/VencimientoFormDrawer';
import { RenovarModal } from '../components/RenovarModal';
import { VencimientoCard } from '../components/VencimientoCard';
import {
  getProximosVencimientos,
  cancelarVencimiento,
  diasHastaFecha,
  VENCIMIENTO_TIPOS,
  VENCIMIENTO_TIPO_LABEL,
  VENCIMIENTO_ESTADOS,
  VENCIMIENTO_ESTADO_LABEL,
  type ProximoVencimiento,
  type VencimientoTipo,
  type VencimientoEstado,
} from '@/services/api/vencimientos';

type TipoFilter = VencimientoTipo | 'todos';
type EstadoFilter = VencimientoEstado | 'todos';

export function VencimientosListPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<ProximoVencimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [tipo, setTipo] = useState<TipoFilter>('todos');
  const [estado, setEstado] = useState<EstadoFilter>('todos');
  const [horizonte, setHorizonte] = useState<number>(90);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [renovar, setRenovar] = useState<ProximoVencimiento | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getProximosVencimientos(horizonte);
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      toast.error(`No pudimos cargar los vencimientos: ${res.error.message}`);
      return;
    }
    setRows(res.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonte]);

  useRealtimeRefresh(['vencimientos'], () => void load());

  // Filtros client-side sobre el resultado del RPC (lista acotada).
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tipo !== 'todos' && r.tipo !== tipo) return false;
      if (estado !== 'todos' && r.estado !== estado) return false;
      if (search.trim().length > 0) {
        const s = search.trim().toLowerCase();
        const hay = [
          r.administracion_nombre,
          r.consorcio_nombre,
          r.descripcion,
          r.observaciones,
          VENCIMIENTO_TIPO_LABEL[r.tipo],
        ]
          .filter(Boolean)
          .some((x) => x!.toLowerCase().includes(s));
        if (!hay) return false;
      }
      return true;
    });
  }, [rows, tipo, estado, search]);

  const kpis = useMemo(() => {
    const vigentes = rows.filter((r) => r.estado === 'vigente').length;
    const proximos30 = rows.filter(
      (r) =>
        r.estado === 'vigente' &&
        r.dias_restantes >= 0 &&
        r.dias_restantes <= 30,
    ).length;
    const vencidos = rows.filter((r) => r.estado === 'vencido').length;
    const renovados = rows.filter((r) => {
      if (r.estado !== 'renovado') return false;
      const d = diasHastaFecha(r.fecha_vencimiento);
      return d >= -30;
    }).length;
    return { vigentes, proximos30, vencidos, renovados };
  }, [rows]);

  // 6.D · export CSV con los filtros aplicados. Cabeceras en español y
  // escapado RFC4180 (comillas + LF). Compatible con Excel/Sheets.
  function exportarCSV() {
    if (filtered.length === 0) {
      toast.error('No hay vencimientos para exportar');
      return;
    }
    const headers = [
      'Tipo',
      'Administración',
      'Consorcio',
      'Fecha vencimiento',
      'Días restantes',
      'Estado',
      'Descripción',
    ];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rowsCsv = filtered.map((r) =>
      [
        VENCIMIENTO_TIPO_LABEL[r.tipo],
        r.administracion_nombre,
        r.consorcio_nombre ?? '',
        r.fecha_vencimiento,
        r.dias_restantes,
        VENCIMIENTO_ESTADO_LABEL[r.estado] ?? r.estado,
        r.descripcion ?? '',
      ]
        .map(escape)
        .join(','),
    );
    const csv = '﻿' + [headers.join(','), ...rowsCsv].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vencimientos-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('CSV descargado', {
      description: `${filtered.length} vencimientos exportados.`,
    });
  }

  // 6.E · vencimientos críticos HOY (dias_restantes <= 0 && vigente).
  const [bannerCerrado, setBannerCerrado] = useState(false);
  const venceHoy = useMemo(
    () =>
      rows.filter(
        (r) => r.estado === 'vigente' && r.dias_restantes <= 0,
      ),
    [rows],
  );

  async function onCancelar(v: ProximoVencimiento) {
    const okConf = await confirm({
      title: 'Cancelar vencimiento',
      message: `¿Cancelar el vencimiento de ${
        VENCIMIENTO_TIPO_LABEL[v.tipo]
      } de ${v.administracion_nombre}? El registro queda en el histórico.`,
      confirmLabel: 'Cancelar vencimiento',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!okConf) return;
    const res = await cancelarVencimiento(v.id);
    if (!res.ok) {
      toast.error(`No se pudo cancelar: ${res.error.message}`);
      return;
    }
    toast.success('Vencimiento cancelado');
    void load();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Datos estratégicos</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Vencimientos
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Matrículas, DDJJ, certificados ARCA, seguros y libros — con alertas
            configurables y sugerencias automáticas de servicios.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 6.D · export CSV. */}
          <Button variant="ghost" onClick={exportarCSV} title="Exportar CSV con los filtros aplicados">
            <Download size={15} /> Export CSV
          </Button>
          <Link
            to="/gerencia/vencimientos/configuracion"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            <Sliders size={15} /> Configuración
          </Link>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus size={16} /> Nuevo vencimiento
          </Button>
        </div>
      </header>

      {/* 6.E · banner crítico: vencimientos HOY o vencidos sin renovar. Cierra
          por sesión hasta que se procesen o el usuario los descarte. */}
      {!bannerCerrado && venceHoy.length > 0 && (
        <section
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-red-300 bg-gradient-to-r from-red-50 via-red-50/90 to-rose-50 p-4 text-sm shadow-sm motion-safe:animate-fade-up"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-600">
            <AlertTriangle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-bold text-red-800">
              {venceHoy.length === 1
                ? '1 vencimiento requiere acción HOY'
                : `${venceHoy.length} vencimientos requieren acción HOY`}
            </p>
            <p className="mt-0.5 text-xs text-red-700/90">
              Tocá &laquo;Ver&raquo; para enfocarte y resolverlos uno por uno.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setEstado('vigente');
              setHorizonte(30);
            }}
          >
            Ver
          </Button>
          <button
            type="button"
            onClick={() => setBannerCerrado(true)}
            className="rounded-md p-1 text-red-700/70 transition hover:bg-red-100"
            aria-label="Cerrar"
            title="Cerrar hasta la próxima carga"
          >
            ×
          </button>
        </section>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={CalendarClock}
          label="Vigentes"
          value={<AnimatedNumber value={kpis.vigentes} />}
          tone="cyan"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Próximos 30 d"
          value={<AnimatedNumber value={kpis.proximos30} />}
          tone="amber"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Vencidos"
          value={<AnimatedNumber value={kpis.vencidos} />}
          tone="red"
        />
        <KpiCard
          icon={RefreshCcw}
          label="Renovados (30 d)"
          value={<AnimatedNumber value={kpis.renovados} />}
          tone="teal"
        />
      </section>

      {/* Toolbar */}
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
              placeholder="Administración, consorcio, descripción…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Tipo" className="sm:w-52">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoFilter)}
              className="pl-9"
            >
              <option value="todos">Todos</option>
              {VENCIMIENTO_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {VENCIMIENTO_TIPO_LABEL[t]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
        <Field label="Estado" className="sm:w-44">
          <Select
            value={estado}
            onChange={(e) => setEstado(e.target.value as EstadoFilter)}
          >
            <option value="todos">Todos</option>
            {VENCIMIENTO_ESTADOS.map((e) => (
              <option key={e} value={e}>
                {VENCIMIENTO_ESTADO_LABEL[e]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Horizonte" className="sm:w-32">
          <Select
            value={String(horizonte)}
            onChange={(e) => setHorizonte(Number(e.target.value))}
          >
            <option value="30">30 días</option>
            <option value="60">60 días</option>
            <option value="90">90 días</option>
            <option value="180">180 días</option>
            <option value="365">1 año</option>
          </Select>
        </Field>
      </section>

      {/* Lista */}
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
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-2xl" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={
                rows.length === 0
                  ? 'Sin vencimientos registrados'
                  : 'Sin resultados con esos filtros'
              }
              description={
                <>
                  Registrá matrículas, DDJJ y otros datos estratégicos para
                  recibir alertas automáticas y proponer servicios.
                </>
              }
              action={
                <Button onClick={() => setDrawerOpen(true)}>
                  <Plus size={15} /> Nuevo vencimiento
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((v) => (
                <VencimientoCard
                  key={v.id}
                  venc={v}
                  onRenovar={
                    v.estado === 'vigente' || v.estado === 'vencido'
                      ? setRenovar
                      : undefined
                  }
                  onCancelar={
                    v.estado === 'vigente' || v.estado === 'vencido'
                      ? onCancelar
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <VencimientoFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void load()}
      />

      <RenovarModal
        open={!!renovar}
        venc={renovar}
        onClose={() => setRenovar(null)}
        onRenewed={() => void load()}
      />
    </div>
  );
}

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone: 'cyan' | 'amber' | 'red' | 'teal';
}

const TONE: Record<KpiCardProps['tone'], string> = {
  cyan: 'bg-brand-cyan/10 text-brand-cyan',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  teal: 'bg-emerald-50 text-emerald-600',
};

function KpiCard({ icon: Icon, label, value, tone }: KpiCardProps) {
  return (
    <div className="card-premium flex items-center gap-3 p-4">
      <span className={cn('grid h-10 w-10 place-items-center rounded-xl', TONE[tone])}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
          {label}
        </p>
        <p className="font-display text-2xl font-bold text-brand-ink">
          {value}
        </p>
      </div>
    </div>
  );
}
