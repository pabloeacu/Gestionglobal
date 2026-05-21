import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Send, AlertTriangle, Filter, ArrowLeft } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Field,
  Input,
  Select,
  Skeleton,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { cn } from '@/lib/cn';
import { DispararRecuperoDrawer } from '../components/DispararRecuperoDrawer';
import { formatMoney, comprobanteLabel } from '../lib/format';
import {
  listMorosos,
  getKpis,
  RECUPERO_NIVELES,
  RECUPERO_NIVEL_LABEL,
  RECUPERO_NIVEL_TONO,
  type MorosoRow,
  type RecuperoKpis,
  type RecuperoNivel,
} from '@/services/api/recupero';
import { MorososKpiStrip } from '../components/MorososKpiStrip';

type NivelFilter = RecuperoNivel | 'todos';

const TONE_BADGE: Record<'cyan' | 'amber' | 'red', string> = {
  cyan: 'border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
};

export function MorososPage() {
  const [rows, setRows] = useState<MorosoRow[]>([]);
  const [kpis, setKpis] = useState<RecuperoKpis>({
    deuda_total: 0,
    morosos_count: 0,
    r1_30d: 0,
    r2_30d: 0,
    r3_30d: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const [search, setSearch] = useState('');
  const [nivelFilter, setNivelFilter] = useState<NivelFilter>('todos');

  const [drawerMoroso, setDrawerMoroso] = useState<MorosoRow | null>(null);
  const [drawerNivel, setDrawerNivel] = useState<RecuperoNivel>(1);

  async function load() {
    setLoading(true);
    const res = await listMorosos({});
    setLoading(false);
    if (!res.ok) {
      toast.error(`No pudimos cargar morosos: ${res.error.message}`);
      return;
    }
    setRows(res.data);
  }

  async function loadKpis() {
    setLoadingKpis(true);
    const res = await getKpis();
    setLoadingKpis(false);
    if (res.ok) setKpis(res.data);
  }

  useEffect(() => {
    void load();
    void loadKpis();
  }, []);

  useRealtimeRefresh(['comprobantes', 'recupero_acciones'], () => {
    void load();
    void loadKpis();
  });

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (nivelFilter !== 'todos' && r.nivel_sugerido !== nivelFilter) return false;
      if (search.trim().length > 0) {
        const s = search.trim().toLowerCase();
        const hay = [r.administracion_nombre, r.consorcio_nombre, r.comprobante_tipo]
          .filter(Boolean)
          .some((x) => x!.toLowerCase().includes(s));
        if (!hay) return false;
      }
      return true;
    });
  }, [rows, search, nivelFilter]);

  function onDisparar(m: MorosoRow, nivel: RecuperoNivel) {
    setDrawerMoroso(m);
    setDrawerNivel(nivel);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="kicker text-brand-cyan">Cobranzas · MDC-17</p>
          <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
            Morosos
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            Comprobantes con saldo pendiente y vencimiento pasado. Disparamos
            recupero en el nivel sugerido por la configuración (override por admin
            o default global).
          </p>
        </div>
        <Link
          to="/gerencia/recupero"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
        >
          <ArrowLeft size={15} /> Volver a Recupero
        </Link>
      </header>

      <MorososKpiStrip kpis={kpis} loading={loadingKpis} />

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
              placeholder="Administración, consorcio, tipo de comprobante…"
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Nivel sugerido" className="sm:w-52">
          <div className="relative">
            <Filter
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Select
              value={String(nivelFilter)}
              onChange={(e) =>
                setNivelFilter(
                  e.target.value === 'todos'
                    ? 'todos'
                    : (Number(e.target.value) as RecuperoNivel),
                )
              }
              className="pl-9"
            >
              <option value="todos">Todos</option>
              {RECUPERO_NIVELES.map((n) => (
                <option key={n} value={n}>
                  {RECUPERO_NIVEL_LABEL[n]}
                </option>
              ))}
            </Select>
          </div>
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
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <IllustratedEmpty
              illustration="lista"
              title={
                rows.length === 0
                  ? '¡Sin morosos! 🎉'
                  : 'Sin resultados con esos filtros'
              }
              description={
                <>
                  Todos los comprobantes están al día. Si se atrasa alguno, va a
                  aparecer acá con su nivel sugerido (R1/R2/R3).
                </>
              }
            />
          ) : (
            <ul className="space-y-2">
              {filtered.map((m) => {
                const sug = m.nivel_sugerido;
                const tone = sug ? RECUPERO_NIVEL_TONO[sug] : 'cyan';
                return (
                  <li
                    key={m.comprobante_id}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-cyan hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-display text-base font-semibold text-brand-ink">
                          {m.administracion_nombre}
                        </h3>
                        {sug != null && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                              TONE_BADGE[tone],
                            )}
                          >
                            {sug === 3 && <AlertTriangle size={11} />}
                            Sugerido: {RECUPERO_NIVEL_LABEL[sug]}
                          </span>
                        )}
                      </div>
                      {m.consorcio_nombre && (
                        <p className="truncate text-xs text-brand-muted">
                          {m.consorcio_nombre}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-brand-muted">
                        {comprobanteLabel(m.comprobante_tipo, m.punto_venta, m.comprobante_numero)}
                        {' · venció '}
                        <span className="font-medium text-red-600">
                          {m.vencimiento} ({m.dias_vencido} días)
                        </span>
                      </p>
                      {m.ultima_accion_at && m.ultima_accion_nivel && (
                        <p className="mt-1 text-[11px] text-brand-muted">
                          Última gestión: {RECUPERO_NIVEL_LABEL[m.ultima_accion_nivel as RecuperoNivel]} ·{' '}
                          {new Date(m.ultima_accion_at).toLocaleDateString('es-AR')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
                      <p className="font-display text-lg font-bold text-red-600">
                        {formatMoney(Number(m.saldo_pendiente))}
                      </p>
                      <div className="flex gap-1.5">
                        {RECUPERO_NIVELES.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => onDisparar(m, n)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition hover:shadow-sm',
                              sug === n
                                ? TONE_BADGE[RECUPERO_NIVEL_TONO[n]]
                                : 'border-slate-200 bg-white text-brand-ink hover:border-brand-cyan/40',
                            )}
                            title={`Disparar ${RECUPERO_NIVEL_LABEL[n]}`}
                          >
                            <Send size={11} /> R{n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <DispararRecuperoDrawer
        open={!!drawerMoroso}
        moroso={drawerMoroso}
        nivelInicial={drawerNivel}
        onClose={() => setDrawerMoroso(null)}
        onDispatched={() => {
          void load();
          void loadKpis();
        }}
      />
    </div>
  );
}
