// ============================================================================
// AuditoriaPage · DGG-35 / P2-#34
//
// Bitácora unificada de cambios. Filtros: tabla, acción, fechas, actor.
// Cada fila expande con detalle de campos modificados.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  History,
  Filter,
  ChevronDown,
  ChevronRight,
  Plus,
  Edit3,
  Trash2,
  RefreshCcw,
  User2,
  Calendar,
} from 'lucide-react';
import { Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { cn } from '@/lib/cn';
import {
  listAuditLog,
  getAuditResumen,
  diffPayload,
  type AuditLogRow,
  type AuditResumenRow,
} from '@/services/api/auditoria';

const TABLE_LABELS: Record<string, string> = {
  administraciones: 'Clientes',
  comprobantes: 'Comprobantes',
  tramites: 'Trámites/Trackings',
  vencimientos: 'Vencimientos',
  formularios: 'Formularios',
  solicitudes: 'Solicitudes',
  partners: 'Partners',
  servicios: 'Servicios',
};

const ACTION_META: Record<
  AuditLogRow['action'],
  { label: string; icon: typeof Plus; tone: string }
> = {
  insert: { label: 'Creado', icon: Plus, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: 'Modificado', icon: Edit3, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  delete: { label: 'Eliminado', icon: Trash2, tone: 'bg-rose-50 text-rose-700 border-rose-200' },
};

function previewValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 58) + '…' : v;
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  try {
    return JSON.stringify(v).slice(0, 60);
  } catch {
    return String(v);
  }
}

function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - d);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'recién';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
  });
}

export function AuditoriaPage() {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [resumen, setResumen] = useState<AuditResumenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [actionFilter, setActionFilter] = useState<AuditLogRow['action'] | ''>('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    const [a, r] = await Promise.all([
      listAuditLog({
        limit: 100,
        table: tableFilter || null,
        action: actionFilter || null,
      }),
      getAuditResumen(),
    ]);
    if (a.ok) setItems(a.data);
    if (r.ok) setResumen(r.data);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFilter, actionFilter]);

  const total = items.length;
  const ultimos7d = useMemo(
    () => resumen.reduce((acc, r) => acc + r.ultimos_7d, 0),
    [resumen],
  );

  function toggle(id: number) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/50 to-white p-6">
        <TrianglesAccent position="top-right" tone="cyan" density="soft" />
        <div className="relative">
          <p className="kicker text-brand-cyan">Seguridad</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Bitácora de cambios
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Registro append-only de todas las creaciones, modificaciones y
            eliminaciones en las tablas clave del sistema. Sólo lectura.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="Total" value={total} icon={History} tone="cyan" />
            <KpiTile label="Últimos 7 días" value={ultimos7d} icon={Calendar} tone="emerald" />
            <KpiTile
              label="Tablas con cambios"
              value={resumen.length}
              icon={RefreshCcw}
              tone="amber"
            />
            <KpiTile
              label="Actores distintos"
              value={new Set(items.map((i) => i.actor_id).filter(Boolean)).size}
              icon={User2}
              tone="ink"
            />
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <Filter size={14} className="text-brand-muted" />
        <span className="text-xs font-medium uppercase tracking-wider text-brand-muted">
          Filtros
        </span>

        <select
          value={tableFilter}
          onChange={(e) => setTableFilter(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
        >
          <option value="">Todas las tablas</option>
          {Object.entries(TABLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as AuditLogRow['action'] | '')}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm"
        >
          <option value="">Cualquier acción</option>
          <option value="insert">Creaciones</option>
          <option value="update">Modificaciones</option>
          <option value="delete">Eliminaciones</option>
        </select>

        <span className="ml-auto text-xs text-brand-muted">
          Últimos {items.length} eventos
        </span>
      </section>

      {/* Lista */}
      <section className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <IllustratedEmpty
            illustration="lista"
            title="Sin eventos registrados"
            description="Cuando alguien cree, modifique o elimine algo en el sistema, va a quedar registrado acá."
          />
        ) : (
          items.map((it) => {
            const meta = ACTION_META[it.action];
            const Icon = meta.icon;
            const isExpanded = expanded.has(it.id);
            const changes = it.action === 'update'
              ? diffPayload(it.payload_before, it.payload_after)
              : [];
            const titulo = previewTitle(it);

            return (
              <article
                key={it.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => toggle(it.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
                      meta.tone,
                    )}
                  >
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                          meta.tone,
                        )}
                      >
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-700">
                        {TABLE_LABELS[it.table_name] ?? it.table_name}
                      </span>
                      <span className="font-medium text-brand-ink">
                        {titulo}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-brand-muted">
                      <span>
                        {it.actor_email ?? 'Sistema'}
                      </span>
                      <span>·</span>
                      <span>{relTime(it.created_at)}</span>
                      <span>·</span>
                      <span className="font-mono">{(it.row_pk ?? '').slice(0, 8)}</span>
                      {it.action === 'update' && changes.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-amber-700">
                            {changes.length} {changes.length === 1 ? 'campo' : 'campos'} modificado{changes.length === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronDown size={14} className="mt-1 text-brand-muted" />
                  ) : (
                    <ChevronRight size={14} className="mt-1 text-brand-muted" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/50 p-4 text-xs">
                    {it.action === 'update' ? (
                      changes.length === 0 ? (
                        <p className="text-brand-muted">Sin cambios detectados.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {changes.map((c) => (
                            <li key={c.field} className="grid grid-cols-[140px_1fr] items-center gap-3">
                              <span className="font-mono text-[11px] font-medium text-slate-600">
                                {c.field}
                              </span>
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700 line-through">
                                  {previewValue(c.old)}
                                </span>
                                <span className="text-amber-700">→</span>
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                                  {previewValue(c.new)}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : it.action === 'insert' ? (
                      <PayloadSnapshot label="Datos creados" data={it.payload_after} />
                    ) : (
                      <PayloadSnapshot label="Datos eliminados" data={it.payload_before} />
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

// Título legible (intenta nombre, titulo, descripcion, etc.)
function previewTitle(it: AuditLogRow): string {
  const p = it.payload_after ?? it.payload_before ?? {};
  return (
    (p.nombre as string) ??
    (p.titulo as string) ??
    (p.descripcion as string) ??
    (p.codigo as string) ??
    (p.numero ? `Nº ${p.numero}` : null) ??
    (it.row_pk ?? '').slice(0, 8)
  );
}

function PayloadSnapshot({
  label,
  data,
}: {
  label: string;
  data: Record<string, unknown> | null;
}) {
  if (!data) return null;
  const entries = Object.entries(data).filter(([k]) => k !== 'updated_at');
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
        {label}
      </p>
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {entries.slice(0, 12).map(([k, v]) => (
          <li key={k} className="grid grid-cols-[110px_1fr] gap-2">
            <span className="font-mono text-[11px] text-slate-500">{k}</span>
            <span className="font-medium text-slate-700">{previewValue(v)}</span>
          </li>
        ))}
        {entries.length > 12 && (
          <li className="col-span-full text-[11px] italic text-brand-muted">
            +{entries.length - 12} campos más
          </li>
        )}
      </ul>
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Plus;
  tone: 'cyan' | 'emerald' | 'amber' | 'ink';
}) {
  const colors = {
    cyan: 'bg-brand-cyan-pale/40 text-brand-cyan',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    ink: 'bg-slate-100 text-slate-700',
  }[tone];
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3">
      <span className={cn('grid h-9 w-9 place-items-center rounded-xl', colors)}>
        <Icon size={15} />
      </span>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
        <p className="text-xl font-bold tabular-nums text-brand-ink">{value}</p>
      </div>
    </div>
  );
}
