import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Gauge,
  Loader2,
  Mail,
  MailX,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Search,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button, Input, Modal, Select, Switch, Paginador, PAGE_SIZE_DEFAULT, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import {
  CAMPANAS_CATALOGO,
  SEGMENTO_LABEL,
  enviarCampana,
  getCaptacionKpis,
  listProspectosCaptacion,
  pausarMotor,
  previewCampana,
  type CampanaCatalogoItem,
  type CampanaPreview,
  type CaptacionKpis,
  type ProspectoCaptacionRow,
  type SegmentoCaptacion,
} from '@/services/api/prospectosCaptacion';
import { convertirProspecto, type ProspectoRow } from '@/services/api/webinars';
import { listAdministraciones, type AdministracionListItem } from '@/services/api/administraciones';
import { FormulariosWebinarsTabs } from '../components/FormulariosWebinarsTabs';
import { ProspectoEditDrawer } from '../components/ProspectoEditDrawer';

const SEG_TONE: Record<SegmentoCaptacion, string> = {
  vencida: 'bg-red-50 text-red-700 ring-red-100',
  curso_reno_30: 'bg-orange-50 text-orange-700 ring-orange-100',
  curso_31_90: 'bg-amber-50 text-amber-700 ring-amber-100',
  vigente_lejos: 'bg-green-50 text-green-700 ring-green-100',
  sin_dato: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

type SegmentoFiltro = SegmentoCaptacion | '';

export function ProspectosCaptacionPage() {
  const [kpis, setKpis] = useState<CaptacionKpis | null>(null);

  const [rows, setRows] = useState<ProspectoCaptacionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // filtros
  const [segmento, setSegmento] = useState<SegmentoFiltro>('');
  const [estado, setEstado] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [soloSancionados, setSoloSancionados] = useState(false);
  const [soloConEmail, setSoloConEmail] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = PAGE_SIZE_DEFAULT;

  const [editing, setEditing] = useState<ProspectoRow | null>(null);
  const [convertir, setConvertir] = useState<ProspectoCaptacionRow | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  async function recargarKpis() {
    const res = await getCaptacionKpis();
    if (res.ok) setKpis(res.data);
    else toast.error('No pudimos cargar los indicadores', { description: humanizeError(res.error) });
  }

  async function recargarLista() {
    setLoading(true);
    const res = await listProspectosCaptacion({
      segmento: segmento || null,
      estado: estado || null,
      search: debounced || null,
      soloSancionados,
      soloConEmail,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    setLoading(false);
    if (res.ok) { setRows(res.data.rows); setTotal(res.data.total); }
    else toast.error('No pudimos cargar los prospectos', { description: humanizeError(res.error) });
  }

  // KPIs: una sola vez (universo). NO dependen de los filtros (R19).
  useEffect(() => { void recargarKpis(); }, []);

  // debounce de la búsqueda (resetea a pág. 1 en el mismo batch → 1 solo fetch)
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // lista: server-side, re-fetch al cambiar filtro o página. §6 B#10: el reset de
  // página se hace en el setter del filtro (mismo batch que el cambio) para NO
  // disparar un fetch stale con el page viejo + uno nuevo con page=1.
  useEffect(() => { void recargarLista(); }, [segmento, estado, debounced, soloSancionados, soloConEmail, page]);

  // setters de filtro que resetean a página 1 (un solo re-render → un solo fetch)
  function changeSegmento(next: SegmentoFiltro) { setSegmento(next); setPage(1); }
  function changeEstado(next: string) { setEstado(next); setPage(1); }
  function changeSoloConEmail(next: boolean) { setSoloConEmail(next); setPage(1); }
  function changeSoloSancionados(next: boolean) { setSoloSancionados(next); setPage(1); }
  function toggleSegmentoChip(key: SegmentoCaptacion) {
    setSegmento((prev) => (prev === key ? '' : key));
    setPage(1);
  }

  const segChips = useMemo(() => {
    if (!kpis) return [];
    return [
      { key: 'vencida' as const, label: 'Vencidas', n: kpis.seg_vencida },
      { key: 'curso_reno_30' as const, label: 'Vence ≤30d', n: kpis.seg_curso_reno_30 },
      { key: 'curso_31_90' as const, label: 'Vence 31-90d', n: kpis.seg_curso_31_90 },
      { key: 'vigente_lejos' as const, label: 'Vigentes', n: kpis.seg_vigente_lejos },
      { key: 'sin_dato' as const, label: 'Sin dato', n: kpis.seg_sin_dato },
    ];
  }, [kpis]);

  const enrichPct = kpis && kpis.padron_total > 0
    ? Math.round((kpis.enriquecidos / kpis.padron_total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Padrón PBA · Captación</h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Administradores matriculados de la Provincia de Buenos Aires. Segmentados por
            vencimiento de matrícula para las campañas de curso y renovación.
          </p>
        </div>
        <Button variant="primary" onClick={() => setLauncherOpen(true)}>
          <Megaphone size={14} /> Lanzar campaña
        </Button>
      </header>

      {/* KPIs del universo (R19) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Prospectos" value={kpis?.total ?? '—'} icon={Users} tone="cyan" />
        <KpiCard label="Con email" value={kpis?.con_email_real ?? '—'} icon={Mail} tone="navy"
          hint={kpis ? `${kpis.sin_email} sin email` : undefined} />
        <KpiCard label="Convertidos" value={kpis?.convertidos ?? '—'} icon={CheckCircle2} tone="green" />
        <KpiCard label="Contactados" value={kpis?.contactados ?? '—'} icon={Megaphone} tone="amber"
          hint={kpis ? `${kpis.bajas} bajas · ${kpis.sancionados} sancionados` : undefined} />
      </div>

      {/* Panel del motor de campañas */}
      {kpis && <MotorPanel kpis={kpis} onChange={() => void recargarKpis()} />}

      {/* Progreso de enriquecimiento (goteo TRAMIX) */}
      {kpis && kpis.enrich_pendientes > 0 && (
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-cyan/[0.03] p-4">
          <div className="mb-2 flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 font-semibold text-brand-ink">
              <Loader2 size={14} className="animate-spin text-brand-cyan" />
              Enriquecimiento de vencimientos (TRAMIX)
            </span>
            <span className="tabular-nums text-brand-muted">
              {kpis.enriquecidos.toLocaleString('es-AR')} / {kpis.padron_total.toLocaleString('es-AR')} · {enrichPct}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-brand-cyan transition-all" style={{ width: `${enrichPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-brand-muted">
            Quedan {kpis.enrich_pendientes.toLocaleString('es-AR')} matrículas por consultar (a 1/min, goteo automático).
            Los segmentos de vencimiento se completan a medida que avanza.
          </p>
        </div>
      )}

      {/* Chips de segmento (clickeables → filtran) */}
      <div className="flex flex-wrap items-center gap-2">
        {segChips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => toggleSegmentoChip(c.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
              SEG_TONE[c.key],
              segmento === c.key ? 'ring-2 ring-offset-1' : 'opacity-90 hover:opacity-100',
            )}
          >
            {c.label} <span className="tabular-nums">{c.n.toLocaleString('es-AR')}</span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select value={segmento} onChange={(e) => changeSegmento(e.target.value as SegmentoFiltro)} className="max-w-[12rem]">
          <option value="">Todos los segmentos</option>
          <option value="vencida">Vencidas</option>
          <option value="curso_reno_30">Vence ≤30 días</option>
          <option value="curso_31_90">Vence 31-90 días</option>
          <option value="vigente_lejos">Vigentes</option>
          <option value="sin_dato">Sin dato</option>
        </Select>
        <Select value={estado} onChange={(e) => changeEstado(e.target.value)} className="max-w-[11rem]">
          <option value="">Todos los estados</option>
          <option value="nuevo">Nuevo</option>
          <option value="contactado">Contactado</option>
          <option value="interesado">Interesado</option>
          <option value="no_interesado">No interesado</option>
          <option value="convertido">Convertido</option>
          <option value="baja">Baja</option>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, CUIT, legajo…"
            className="pl-9"
          />
        </div>
        <Switch checked={soloConEmail} onChange={changeSoloConEmail} label="Solo con email" size="sm" />
        <Switch checked={soloSancionados} onChange={changeSoloSancionados} label="Solo sancionados" size="sm" />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
          Cargando prospectos…
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          title={total === 0 ? 'Sin prospectos con ese filtro' : 'Sin resultados'}
          description="Probá cambiar el segmento, el estado o limpiar la búsqueda."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Nombre</Th>
                  <Th>Contacto</Th>
                  <Th>Vencimiento</Th>
                  <Th center>Segmento</Th>
                  <Th>Estado</Th>
                  <Th center>Campañas</Th>
                  <Th>Último mail</Th>
                  <Th right>Acción</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-brand-ink">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{p.nombre}</span>
                        {p.sanciones && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-100" title="Tiene sanciones registradas">
                            <ShieldAlert size={10} /> Sanción
                          </span>
                        )}
                        {p.padron_count > 1 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600" title={`${p.padron_count} matriculados comparten este email`}>
                            <Users size={10} /> {p.padron_count}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] tabular-nums text-brand-muted">
                        {p.matricula ? `Mat. ${p.matricula}` : ''}{p.legajo ? ` · Leg. ${p.legajo}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      {p.sin_email ? (
                        <span className="inline-flex items-center gap-1 text-slate-400"><MailX size={11} /> sin email</span>
                      ) : (
                        <span className="inline-flex items-center gap-1"><Mail size={11} /> {p.email}</span>
                      )}
                      {p.suprimido && (
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          dado de baja
                        </div>
                      )}
                      {p.cuit && <div className="tabular-nums">CUIT {p.cuit}</div>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {p.matricula_vencimiento ? (
                        <>
                          <span className={cn('tabular-nums', p.segmento === 'vencida' ? 'font-semibold text-red-600' : 'text-brand-ink')}>
                            {fmtFecha(p.matricula_vencimiento)}
                          </span>
                          {p.ultima_renovacion && (
                            <div className="text-[10px] text-brand-muted">renovó {fmtFecha(p.ultima_renovacion)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', SEG_TONE[p.segmento])}>
                        {SEGMENTO_LABEL[p.segmento]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.convertido_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                          <CheckCircle2 size={10} /> Convertido
                        </span>
                      ) : p.baja_at ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Baja</span>
                      ) : p.estado_captacion === 'contactado' ? (
                        <span className="rounded-full bg-brand-cyan/5 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan ring-1 ring-brand-cyan/20">Contactado</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Nuevo</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <CampanasCoins enviadas={p.campanas_enviadas} tieneVencimiento={!!p.matricula_vencimiento} />
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      {p.ultimo_mail_at ? (
                        <div title={p.ultimo_mail_asunto ?? ''}>
                          <div className="truncate max-w-[12rem]">{p.ultimo_mail_asunto ?? p.ultimo_mail_slug}</div>
                          <div className="text-[10px]">{fmtFecha(p.ultimo_mail_at)}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" onClick={() => setEditing(toProspectoRow(p))} title="Editar prospecto">
                          <Pencil size={12} />
                        </Button>
                        {!p.convertido_at && (
                          <Button variant="tonal" onClick={() => setConvertir(p)} title="Convertir a cliente">
                            <UserPlus size={12} /> Convertir
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </div>
      )}

      <ProspectoEditDrawer
        open={!!editing}
        prospecto={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void recargarLista(); void recargarKpis(); }}
      />

      {convertir && (
        <ConvertirModal
          prospecto={convertir}
          onClose={() => setConvertir(null)}
          onConverted={() => { setConvertir(null); void recargarLista(); void recargarKpis(); }}
        />
      )}

      {launcherOpen && kpis && (
        <CampanaLauncher
          activo={kpis.activo}
          onClose={() => setLauncherOpen(false)}
          onEnqueued={() => { void recargarLista(); void recargarKpis(); }}
        />
      )}
    </div>
  );
}

// Tira de "monedas": una por campaña del catálogo. Sólida+color si ya se envió
// (tooltip con la fecha), contorno gris si está pendiente, punteada tenue si no
// aplica (campaña de vencimiento para un prospecto sin vencimiento). Vencimiento
// = ámbar (FUNDPLATA); bondad = cyan (GG). Separador entre los 3 y los 4.
function CampanasCoins({ enviadas, tieneVencimiento }: { enviadas: Record<string, string> | null; tieneVencimiento: boolean }) {
  const map = enviadas ?? {};
  return (
    <div className="flex items-center justify-center gap-0.5">
      {CAMPANAS_CATALOGO.map((c, i) => {
        const sentAt = map[c.slug];
        const enviada = !!sentAt;
        const aplica = !c.vencimiento || tieneVencimiento;
        const tip =
          c.label +
          (enviada ? ` · enviada ${fmtFecha(sentAt)}` : aplica ? ' · aún no enviada' : ' · no aplica (sin vencimiento)');
        const cls = enviada
          ? c.vencimiento
            ? 'border-amber-500 bg-amber-500 text-white'
            : 'border-brand-cyan bg-brand-cyan text-white'
          : aplica
            ? 'border-slate-300 bg-white text-slate-400'
            : 'border-dashed border-slate-200 bg-slate-50 text-slate-300';
        return (
          <span
            key={c.slug}
            title={tip}
            aria-label={tip}
            className={cn(
              'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border text-[8px] font-bold leading-none',
              i === 3 && 'ml-1.5',
              cls,
            )}
          >
            {c.inicial}
          </span>
        );
      })}
    </div>
  );
}

function Th({ children, center, right }: { children: React.ReactNode; center?: boolean; right?: boolean }) {
  return (
    <th className={cn(
      'px-4 py-2 text-xs font-semibold uppercase tracking-wider text-brand-muted',
      center ? 'text-center' : right ? 'text-right' : 'text-left',
    )}>
      {children}
    </th>
  );
}

function toProspectoRow(p: ProspectoCaptacionRow): ProspectoRow {
  return {
    id: p.id,
    nombre: p.nombre,
    email: p.email,
    telefono: p.telefono,
    origen: 'padron_pba',
    observaciones: null,
    convertido_a_administracion_id: null,
    convertido_at: p.convertido_at,
    creado_por: null,
    created_at: '',
    updated_at: '',
  } as ProspectoRow;
}

function KpiCard({ label, value, icon: Icon, tone, hint }: {
  label: string; value: number | string; icon: typeof Users; tone: 'cyan' | 'green' | 'navy' | 'amber'; hint?: string;
}) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-brand-ink">
        {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-brand-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel del motor automático: estado (enviando/pausado/apagado), cap diario,
// progreso de hoy, cola, y botón de pausar/reanudar.
// ---------------------------------------------------------------------------
function MotorPanel({ kpis, onChange }: { kpis: CaptacionKpis; onChange: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const estado: 'enviando' | 'pausado' | 'apagado' = !kpis.activo ? 'apagado' : kpis.pausado ? 'pausado' : 'enviando';
  const pct = kpis.cap_diario > 0 ? Math.min(100, Math.round((kpis.encolados_hoy / kpis.cap_diario) * 100)) : 0;

  async function toggle() {
    const pausar = !kpis.pausado;
    if (pausar) {
      const ok = await confirm({
        title: 'Pausar el motor', message: 'Deja de enviar campañas hasta que lo reanudes. ¿Pausar ahora?',
        confirmLabel: 'Pausar', cancelLabel: 'No',
      });
      if (!ok) return;
    }
    setBusy(true);
    const res = await pausarMotor(pausar);
    setBusy(false);
    if (res.ok) { toast.success(pausar ? 'Motor pausado' : 'Motor reanudado'); onChange(); }
    else toast.error('No pudimos cambiar el estado', { description: humanizeError(res.error) });
  }

  const badge =
    estado === 'enviando' ? { t: 'Enviando', c: 'bg-green-50 text-green-700 ring-green-100' }
    : estado === 'pausado' ? { t: 'Pausado', c: 'bg-amber-50 text-amber-700 ring-amber-100' }
    : { t: 'Apagado', c: 'bg-slate-100 text-slate-600 ring-slate-200' };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-cyan/5 text-brand-cyan ring-1 ring-brand-cyan/20">
            <Gauge size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-ink">Motor de campañas</p>
            <p className="text-xs text-brand-muted">Automático · {kpis.cap_diario}/día · 1 cada 20 min</p>
          </div>
          <span className={cn('ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1', badge.c)}>
            {badge.t}
          </span>
        </div>
        {kpis.activo && (
          <Button variant={kpis.pausado ? 'primary' : 'secondary'} onClick={toggle} loading={busy}>
            {kpis.pausado ? <><Play size={14} /> Reanudar</> : <><Pause size={14} /> Pausar</>}
          </Button>
        )}
      </div>

      {estado === 'pausado' && kpis.pausado_motivo && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {kpis.pausado_motivo}
        </div>
      )}
      {estado === 'apagado' && (
        <p className="mt-3 text-xs text-brand-muted">El motor todavía no está activado. Nada se envía.</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MotorStat label="Hoy" value={`${kpis.encolados_hoy} / ${kpis.cap_diario}`} />
        <MotorStat label="En cola" value={kpis.cola_pendiente} />
        <MotorStat label="Enviados total" value={kpis.enviados_total} />
        <MotorStat label="Contactados" value={kpis.contactados} />
      </div>
      {kpis.activo && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-brand-cyan transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function MotorStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
      <p className="font-display text-base font-bold tabular-nums text-brand-ink">
        {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launcher de campaña: elegir plantilla + segmento → preview de elegibles →
// Enviar. GATED: si el motor está apagado, el envío está deshabilitado con
// explicación (y el server lo rechaza igual — defensa en profundidad).
// ---------------------------------------------------------------------------
function CampanaLauncher({ activo, onClose, onEnqueued }: {
  activo: boolean;
  onClose: () => void;
  onEnqueued: () => void;
}) {
  const [slug, setSlug] = useState<string>(CAMPANAS_CATALOGO[0]!.slug);
  const [segmento, setSegmento] = useState<SegmentoFiltro>('curso_reno_30');
  const [limite, setLimite] = useState(25);
  const [preview, setPreview] = useState<CampanaPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [forzar, setForzar] = useState(false);

  const item: CampanaCatalogoItem = CAMPANAS_CATALOGO.find((c) => c.slug === slug) ?? CAMPANAS_CATALOGO[0]!;

  // Para templates de vencimiento, el segmento debe ser uno de vencimiento.
  useEffect(() => {
    if (item.vencimiento && !['vencida', 'curso_reno_30', 'curso_31_90'].includes(segmento)) {
      setSegmento('curso_reno_30');
    }
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancel = false;
    setPreviewing(true);
    void (async () => {
      const res = await previewCampana(slug, segmento || null);
      if (cancel) return;
      setPreviewing(false);
      setPreview(res.ok ? res.data : null);
      if (!res.ok) toast.error('No pudimos calcular el preview', { description: humanizeError(res.error) });
    })();
    return () => { cancel = true; };
  }, [slug, segmento]);

  const elegibles = (preview?.elegibles ?? 0) + (forzar ? (preview?.en_cooldown ?? 0) : 0);
  const aEnviar = Math.min(elegibles, limite);
  const puedeEnviar = activo && !previewing && aEnviar > 0 && !preview?.bloqueado_guard;

  async function onEnviar() {
    setEnviando(true);
    const res = await enviarCampana(slug, segmento || null, limite, forzar);
    setEnviando(false);
    if (!res.ok) { toast.error('No pudimos enviar', { description: humanizeError(res.error) }); return; }
    if (res.data.gated) {
      toast.error('El motor de campañas está apagado', { description: 'Activalo en configuración para habilitar envíos.' });
      return;
    }
    if (!res.data.ok) {
      toast.error('No se encoló', { description: res.data.error ?? 'Revisá el segmento y la plantilla.' });
      return;
    }
    toast.success(`${res.data.encolados} correo(s) encolado(s)`, { description: 'Se envían a ~1/min respetando el throttle.' });
    onEnqueued();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Lanzar campaña de captación" width={620}>
      <div className="space-y-4">
        {!activo && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>El motor de campañas está apagado.</strong> Podés previsualizar a cuántos llegaría,
              pero el envío está deshabilitado hasta activarlo. El servidor rechaza el envío mientras el flag esté en OFF.
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-muted">Plantilla</span>
          <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {CAMPANAS_CATALOGO.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.estrella === 'FUNDPLATA' ? '🎓 ' : '✨ '}{c.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-brand-muted">{item.descripcion}</p>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-muted">Segmento</span>
          <Select value={segmento} onChange={(e) => setSegmento(e.target.value as SegmentoFiltro)}>
            {item.vencimiento ? (
              <>
                <option value="vencida">Vencidas</option>
                <option value="curso_reno_30">Vence ≤30 días</option>
                <option value="curso_31_90">Vence 31-90 días</option>
              </>
            ) : (
              <>
                <option value="">Todos (con email)</option>
                <option value="vencida">Vencidas</option>
                <option value="curso_reno_30">Vence ≤30 días</option>
                <option value="curso_31_90">Vence 31-90 días</option>
                <option value="vigente_lejos">Vigentes</option>
              </>
            )}
          </Select>
          {item.vencimiento && (
            <p className="mt-1 text-xs text-brand-muted">
              Esta plantilla usa la fecha de vencimiento, así que requiere un segmento de vencimiento.
            </p>
          )}
        </label>

        {/* Preview de elegibilidad */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <BadgeCheck size={15} className="text-brand-cyan" /> ¿A cuántos llegaría?
          </div>
          {previewing ? (
            <p className="text-sm text-brand-muted">Calculando…</p>
          ) : !preview ? (
            <p className="text-sm text-brand-muted">—</p>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <PreviewStat label="En el segmento" value={preview.en_segmento} />
                <PreviewStat label="Sin email" value={preview.sin_email} muted />
                <PreviewStat label="Dados de baja" value={preview.suprimidos} muted />
                <PreviewStat label="En gracia (30d)" value={preview.en_gracia} muted />
                <PreviewStat label="Ya recibieron" value={preview.en_cooldown} muted />
                <PreviewStat label="Elegibles" value={preview.elegibles} tone="green" />
              </div>
              {preview.bloqueado_guard && (
                <p className="text-amber-700">⚠ Elegí un segmento de vencimiento para esta plantilla.</p>
              )}
            </div>
          )}
        </div>

        {!!preview && preview.en_cooldown > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <Switch
              checked={forzar}
              onChange={setForzar}
              size="sm"
              label={`Reenviar a los ${preview.en_cooldown} que ya recibieron esta campaña`}
              hint="Por defecto no se les reitera. Activalo sólo si querés insistir con los mismos."
            />
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Tope de este envío (warm-up)
          </span>
          <Input
            type="number"
            min={1}
            max={200}
            value={limite}
            onChange={(e) => setLimite(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
            className="max-w-[8rem]"
          />
          <p className="mt-1 text-xs text-brand-muted">
            Se encolan hasta este número (máx 200). Hoy enviaría <strong>{aEnviar}</strong>.
          </p>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={onEnviar} loading={enviando} disabled={!puedeEnviar}
            title={!activo ? 'El motor está apagado' : aEnviar === 0 ? 'No hay destinatarios elegibles' : undefined}>
            <Megaphone size={14} /> Encolar {aEnviar > 0 ? `(${aEnviar})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PreviewStat({ label, value, tone, muted }: { label: string; value: number; tone?: 'green'; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
      <p className={cn(
        'font-display text-base font-bold tabular-nums',
        tone === 'green' ? 'text-green-700' : muted ? 'text-slate-400' : 'text-brand-ink',
      )}>
        {value.toLocaleString('es-AR')}
      </p>
    </div>
  );
}

function ConvertirModal({ prospecto, onClose, onConverted }: {
  prospecto: ProspectoCaptacionRow;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [administraciones, setAdministraciones] = useState<AdministracionListItem[]>([]);
  const [search, setSearch] = useState('');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) { setAdministraciones([]); return; }
      setSearching(true);
      const res = await listAdministraciones({ search: search.trim(), limit: 10 });
      setSearching(false);
      if (res.ok) setAdministraciones(res.data.rows);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function onConvertir() {
    if (!seleccionada) { toast.error('Seleccioná una administración'); return; }
    setLoading(true);
    const res = await convertirProspecto(prospecto.id, seleccionada);
    setLoading(false);
    if (!res.ok) { toast.error('No pudimos convertir', { description: humanizeError(res.error) }); return; }
    toast.success('Prospecto convertido a cliente');
    onConverted();
  }

  return (
    <Modal open onClose={onClose} title="Convertir prospecto a cliente" width={520}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-brand-ink">{prospecto.nombre}</p>
          <p className="text-xs text-brand-muted">{prospecto.sin_email ? 'sin email' : prospecto.email}</p>
          {prospecto.cuit && <p className="text-xs tabular-nums text-brand-muted">CUIT {prospecto.cuit}</p>}
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-muted">
            Buscar administración existente
          </span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, código o CUIT" />
          <p className="mt-1 text-xs text-brand-muted">
            Si todavía no creaste la administración, andá a /gerencia/clientes y creala primero.
          </p>
        </label>
        {searching && <p className="text-xs text-brand-muted">Buscando…</p>}
        {administraciones.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-xl border border-slate-200">
            {administraciones.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSeleccionada(a.id)}
                  className={cn(
                    'flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50',
                    seleccionada === a.id && 'bg-brand-cyan/5 ring-1 ring-inset ring-brand-cyan/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">{a.nombre}</p>
                    <p className="text-xs text-brand-muted">
                      {a.codigo ?? '—'} · {a.estado} · {a.consorcios_count} consorcios
                    </p>
                  </div>
                  {seleccionada === a.id && <CheckCircle2 size={16} className="flex-shrink-0 text-brand-cyan" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConvertir} loading={loading} disabled={!seleccionada}>Convertir a cliente</Button>
        </div>
      </div>
    </Modal>
  );
}
