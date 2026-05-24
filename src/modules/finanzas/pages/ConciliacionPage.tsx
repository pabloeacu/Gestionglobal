import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, Upload, Link2, Plus, EyeOff, AlertCircle, CheckCircle2,
  TrendingUp, TrendingDown,
} from 'lucide-react';
import { Button, Field, Input, Select, Textarea, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  getCajasConSaldo, listarHistoricoPendientes, sugerirMatches,
  conciliarManual, crearMovDesdeHistorico, ignorarLineaHistorico,
  getConciliacionKpis, listCategoriasFinanzas, buscarAdministraciones,
  type CajaConSaldoRow, type HistoricoPendienteRow, type SugerenciaMatchRow,
  type CategoriaFinanzaRow, type ConciliacionKpis,
} from '@/services/api/finanzas';
import { ImportadorExtractoModal } from '../components/ImportadorExtractoModal';
import { cn } from '@/lib/cn';

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(n);
}
function fmtFecha(d: string): string {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' }); }
  catch { return d; }
}

export function ConciliacionPage() {
  const [cajas, setCajas] = useState<CajaConSaldoRow[]>([]);
  const [cajaId, setCajaId] = useState<string>('');
  const [lineas, setLineas] = useState<HistoricoPendienteRow[]>([]);
  const [kpis, setKpis] = useState<ConciliacionKpis>({ total_lineas: 0, pendientes: 0, conciliadas: 0, ignoradas: 0 });
  const [loading, setLoading] = useState(true);
  const [importerOpen, setImporterOpen] = useState(false);
  const [resolverFor, setResolverFor] = useState<HistoricoPendienteRow | null>(null);

  async function loadCajas() {
    const r = await getCajasConSaldo();
    if (r.ok) {
      setCajas(r.data);
      if (!cajaId && r.data[0]) setCajaId(r.data[0].caja_id);
    }
  }
  async function loadData() {
    if (!cajaId) return;
    setLoading(true);
    const [r1, r2] = await Promise.all([
      listarHistoricoPendientes(cajaId, 100, 0),
      getConciliacionKpis(cajaId),
    ]);
    setLoading(false);
    if (r1.ok) setLineas(r1.data.rows);
    if (r2.ok) setKpis(r2.data);
  }

  useEffect(() => { void loadCajas(); }, []);
  useEffect(() => { void loadData(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cajaId]);

  const cajaActual = useMemo(() => cajas.find((c) => c.caja_id === cajaId), [cajas, cajaId]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/gerencia/finanzas" className="inline-flex items-center gap-1 text-xs text-brand-muted hover:text-brand-cyan">
            <ArrowLeft size={12} /> Volver a Finanzas
          </Link>
          <p className="kicker mt-1">Conciliación bancaria</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
            Conciliar extracto
          </h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Importá el extracto del banco con el formato universal y vinculá cada línea con un movimiento existente o creá uno nuevo.
          </p>
        </div>
        <Button onClick={() => setImporterOpen(true)}>
          <Upload size={14} /> Importar extracto
        </Button>
      </header>

      {/* Caja + KPIs */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Caja" hint="Las líneas pendientes corresponden a esta caja.">
          <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className="w-64">
            {cajas.filter((c) => c.activo).map((c) => (
              <option key={c.caja_id} value={c.caja_id}>{c.nombre}</option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <KpiPill label="Pendientes" value={kpis.pendientes} tone="amber" />
          <KpiPill label="Conciliadas" value={kpis.conciliadas} tone="green" />
          <KpiPill label="Ignoradas" value={kpis.ignoradas} tone="slate" />
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-brand-muted">
          Cargando…
        </div>
      ) : lineas.length === 0 ? (
        <IllustratedEmpty
          title={kpis.total_lineas === 0 ? 'Todavía no importaste ningún extracto' : '¡Todo conciliado!'}
          description={
            kpis.total_lineas === 0
              ? `Importá el primer extracto bancario de la caja "${cajaActual?.nombre ?? ''}".`
              : 'No quedan líneas pendientes en esta caja.'
          }
          action={
            <Button onClick={() => setImporterOpen(true)}>
              <Upload size={14} /> Importar extracto
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Fecha</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Descripción</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Ingreso</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Egreso</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Saldo</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lineas.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 text-xs text-brand-muted whitespace-nowrap">{fmtFecha(l.fecha)}</td>
                  <td className="px-4 py-2">
                    <div className="text-brand-ink">{l.descripcion}</div>
                    {l.observaciones && <div className="text-[10px] text-brand-muted mt-0.5">{l.observaciones}</div>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-green-700 tabular-nums">
                    {l.ingreso > 0 ? formatMoney(l.ingreso) : <span className="text-brand-muted/40">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-red-700 tabular-nums">
                    {l.egreso > 0 ? formatMoney(l.egreso) : <span className="text-brand-muted/40">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-brand-muted tabular-nums">
                    {l.saldo ? formatMoney(l.saldo) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="tonal" onClick={() => setResolverFor(l)}>
                      Conciliar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importerOpen && (
        <ImportadorExtractoModal
          cajas={cajas.filter((c) => c.activo)}
          onClose={() => setImporterOpen(false)}
          onImported={() => { setImporterOpen(false); void loadData(); }}
        />
      )}

      {resolverFor && (
        <ResolverLineaDrawer
          linea={resolverFor}
          onClose={() => setResolverFor(null)}
          onDone={() => { setResolverFor(null); void loadData(); }}
        />
      )}
    </div>
  );
}

function KpiPill({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'green' | 'slate' }) {
  const tones: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    green: 'bg-green-50 text-green-700 ring-green-200',
    slate: 'bg-slate-50 text-slate-700 ring-slate-200',
  };
  return (
    <div className={cn('rounded-xl px-3 py-2 ring-1', tones[tone])}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="font-display text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function ResolverLineaDrawer({
  linea, onClose, onDone,
}: {
  linea: HistoricoPendienteRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const [tab, setTab] = useState<'vincular' | 'crear' | 'ignorar'>('vincular');
  const [sugerencias, setSugerencias] = useState<SugerenciaMatchRow[]>([]);
  const [loadingSug, setLoadingSug] = useState(true);

  // Crear nuevo
  const [categorias, setCategorias] = useState<CategoriaFinanzaRow[]>([]);
  const [categoriaId, setCategoriaId] = useState<string>('');
  const [descripcionCustom, setDescripcionCustom] = useState<string>(linea.descripcion);
  const [adminSearch, setAdminSearch] = useState('');
  const [admins, setAdmins] = useState<Array<{ id: string; nombre: string; codigo: string | null }>>([]);
  const [adminId, setAdminId] = useState<string | null>(null);
  const [guardarPatron, setGuardarPatron] = useState(true);
  const [creating, setCreating] = useState(false);

  // Ignorar
  const [motivoIgnorar, setMotivoIgnorar] = useState('');
  const [ignoring, setIgnoring] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoadingSug(true);
      const r = await sugerirMatches(linea.id);
      setLoadingSug(false);
      if (r.ok) setSugerencias(r.data);
    })();
    void (async () => {
      const r = await listCategoriasFinanzas();
      if (r.ok) setCategorias(r.data);
    })();
  }, [linea.id]);

  useEffect(() => {
    if (adminId) return;
    const t = setTimeout(async () => {
      if (adminSearch.trim().length < 2) { setAdmins([]); return; }
      const r = await buscarAdministraciones(adminSearch);
      if (r.ok) setAdmins(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [adminSearch, adminId]);

  const categoriasFiltradas = categorias.filter((c) =>
    c.tipo === linea.tipo_efectivo || c.tipo === 'ambos',
  );

  async function onVincular(mov: SugerenciaMatchRow) {
    const okConfirm = await confirm({
      title: 'Confirmar vinculación',
      message: `Vincular esta línea del extracto con el movimiento del ${mov.fecha} por ${formatMoney(mov.monto)}?`,
      confirmLabel: 'Vincular',
    });
    if (!okConfirm) return;
    const res = await conciliarManual(linea.id, mov.movimiento_id);
    if (!res.ok) {
      toast.error('No pudimos vincular', { description: res.error.message });
      return;
    }
    toast.success('Línea conciliada');
    onDone();
  }

  async function onCrear() {
    setCreating(true);
    const res = await crearMovDesdeHistorico({
      historicoId: linea.id,
      categoriaId: categoriaId || null,
      administracionId: adminId,
      descripcionCustom: descripcionCustom.trim() || null,
      guardarPatron,
    });
    setCreating(false);
    if (!res.ok) {
      toast.error('No pudimos crear', { description: res.error.message });
      return;
    }
    toast.success('Movimiento creado y conciliado');
    onDone();
  }

  async function onIgnorar() {
    setIgnoring(true);
    const res = await ignorarLineaHistorico(linea.id, motivoIgnorar.trim() || undefined);
    setIgnoring(false);
    if (!res.ok) {
      toast.error('No pudimos ignorar', { description: res.error.message });
      return;
    }
    toast.success('Línea ignorada');
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-900/30" onClick={onClose} />
      <aside className="w-full max-w-md overflow-y-auto bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-5">
          <button onClick={onClose} className="text-xs text-brand-muted hover:text-brand-cyan">← Cerrar</button>
          <p className="kicker mt-2">Línea del extracto</p>
          <h2 className="mt-1 font-display text-lg font-bold text-brand-ink">{linea.descripcion}</h2>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="text-brand-muted">{fmtFecha(linea.fecha)}</span>
            {linea.ingreso > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-green-700">
                <TrendingUp size={12} /> {formatMoney(linea.ingreso)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-red-700">
                <TrendingDown size={12} /> {formatMoney(linea.egreso)}
              </span>
            )}
          </div>
          {linea.observaciones && (
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-brand-muted">{linea.observaciones}</p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200">
          <TabBtn active={tab === 'vincular'} onClick={() => setTab('vincular')}>
            <Link2 size={12} /> Vincular
          </TabBtn>
          <TabBtn active={tab === 'crear'} onClick={() => setTab('crear')}>
            <Plus size={12} /> Crear nuevo
          </TabBtn>
          <TabBtn active={tab === 'ignorar'} onClick={() => setTab('ignorar')}>
            <EyeOff size={12} /> Ignorar
          </TabBtn>
        </div>

        <div className="p-5">
          {tab === 'vincular' && (
            <div>
              <p className="mb-2 text-xs text-brand-muted">
                Movimientos del sistema con mismo monto y misma caja, en ±5 días:
              </p>
              {loadingSug ? (
                <p className="text-sm text-brand-muted">Buscando…</p>
              ) : sugerencias.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <AlertCircle size={16} className="inline mr-1" />
                  No hay coincidencias. Probablemente sea un movimiento nuevo — usá la pestaña "Crear nuevo".
                </div>
              ) : (
                <ul className="space-y-2">
                  {sugerencias.map((s) => (
                    <li key={s.movimiento_id}>
                      <button
                        type="button"
                        onClick={() => onVincular(s)}
                        className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-cyan hover:bg-brand-cyan/5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-brand-ink">
                            {s.descripcion ?? 'Sin descripción'}
                          </span>
                          <span className="rounded-full bg-brand-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan">
                            {s.dias_diff === 0 ? 'mismo día' : `±${s.dias_diff}d`}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-brand-muted">
                          <span>{fmtFecha(s.fecha)}</span>
                          {s.administracion_nombre && <span>· {s.administracion_nombre}</span>}
                          {s.categoria_nombre && <span>· {s.categoria_nombre}</span>}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'crear' && (
            <div className="space-y-3">
              <p className="text-xs text-brand-muted">
                Esto crea un nuevo movimiento en <strong>{linea.caja_nombre}</strong> con tipo
                <strong> {linea.tipo_efectivo}</strong> y monto <strong>{formatMoney(linea.monto_efectivo)}</strong>, y queda conciliado con esta línea.
              </p>
              <Field label="Categoría">
                <Select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
                  <option value="">— Sin categoría —</option>
                  {categoriasFiltradas.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Descripción">
                <Input value={descripcionCustom} onChange={(e) => setDescripcionCustom(e.target.value)} />
              </Field>
              <Field label="Asociar a administración (opcional)">
                {adminId ? (
                  <div className="flex items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-2 text-sm">
                    <span className="flex-1 text-brand-ink">
                      {admins.find((a) => a.id === adminId)?.nombre ?? 'Seleccionada'}
                    </span>
                    <button type="button" onClick={() => { setAdminId(null); setAdminSearch(''); }} className="text-xs text-brand-muted">Quitar</button>
                  </div>
                ) : (
                  <>
                    <Input
                      value={adminSearch}
                      onChange={(e) => setAdminSearch(e.target.value)}
                      placeholder="Nombre, código o CUIT"
                    />
                    {admins.length > 0 && (
                      <ul className="mt-1 max-h-32 overflow-auto rounded-lg border border-slate-200">
                        {admins.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => { setAdminId(a.id); setAdminSearch(a.nombre); setAdmins([]); }}
                              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
                            >
                              {a.nombre}{a.codigo && <span className="text-brand-muted"> · {a.codigo}</span>}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Field>
              <label className="flex items-center gap-2 text-xs text-brand-muted">
                <input
                  type="checkbox"
                  checked={guardarPatron}
                  onChange={(e) => setGuardarPatron(e.target.checked)}
                  className="accent-brand-cyan"
                />
                Aprender este patrón (sugerir auto-categoría en futuras líneas similares)
              </label>
              <Button onClick={onCrear} loading={creating} className="w-full">
                <Plus size={14} /> Crear movimiento y conciliar
              </Button>
            </div>
          )}

          {tab === 'ignorar' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-brand-muted">
                Marca esta línea como <strong>ignorada</strong>. NO genera movimiento ni impacta el saldo. Usar para líneas que no son movimientos reales (saldo inicial, encabezado, error del banco).
              </div>
              <Field label="Motivo (opcional)">
                <Textarea
                  rows={2}
                  value={motivoIgnorar}
                  onChange={(e) => setMotivoIgnorar(e.target.value)}
                  placeholder="Ej: saldo inicial, línea duplicada del banco"
                />
              </Field>
              <Button variant="danger" onClick={onIgnorar} loading={ignoring} className="w-full">
                <EyeOff size={14} /> Marcar como ignorada
              </Button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition',
        active
          ? 'border-b-2 border-brand-cyan bg-brand-cyan/5 text-brand-ink'
          : 'border-b-2 border-transparent text-brand-muted hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

// Suppress unused import warning
void CheckCircle2;
