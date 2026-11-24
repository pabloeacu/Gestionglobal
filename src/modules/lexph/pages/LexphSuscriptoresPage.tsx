// LexphSuscriptoresPage · panel de suscriptores del newsletter LexPH (gerencia).
// DGG-244 F2f · R4 (queries en services/), R19 (KPIs sobre el universo completo;
// filtros/paginación en memoria). Medición del éxito del proyecto: crecimiento,
// confirmados/pendientes/bajas, origen, y export CSV.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ArrowLeft, Download, Mail, MailX, CheckCircle2, Clock, UserMinus, TrendingUp, Loader2, RotateCcw,
} from 'lucide-react';
import {
  Button, Input, Tabs, Skeleton, Paginador, PAGE_SIZE_DEFAULT, useConfirm, type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { foldText } from '@/lib/searchText';
import { humanizeError } from '@/lib/errors';
import { hoyISO } from '@/lib/dates';
import { rowsToCsv } from '@/lib/csvCopy';
import { downloadBlob } from '@/modules/reportes/lib/_helpers';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  listSuscriptores, bajaSuscriptorLexph, reactivarSuscriptorLexph, getSuscriptoresSuprimidos,
  type LexphSuscriptorItem, type LexphSuprimido,
} from '@/services/api/lexph';

type FiltroEstado = 'todos' | 'confirmado' | 'pendiente' | 'baja';

// DGG-257 · motivos de "casilla muerta" (hard) legibles para el aviso al reactivar.
const MOTIVO_DURO_LABEL: Record<string, string> = {
  bounce: 'rebote',
  queja: 'queja de spam',
  invalida: 'casilla inválida',
  descartado_gerencia: 'descarte de gerencia',
};

// DGG-257 (display E-GG-281) · todos los motivos legibles para el badge "No recibe".
const MOTIVO_LABEL: Record<string, string> = {
  ...MOTIVO_DURO_LABEL,
  baja_usuario: 'baja de marketing',
  manual: 'baja manual',
};

// Normaliza igual que email_norm (lower(btrim)) para cruzar con la supresión.
const normEmail = (e: string) => e.trim().toLowerCase();

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

// Origen técnico → etiqueta legible.
function origenLabel(origen: string | null): string {
  if (!origen) return 'Directo';
  if (origen === 'web_lexph') return 'Web';
  if (origen.startsWith('form')) return 'Formulario';
  if (origen === 'cliente') return 'Cliente';
  if (origen.startsWith('padron') || origen === 'captacion') return 'Captación';
  if (origen === 'import_nacional') return 'Importado (nacional)';
  if (origen === 'gerencia_testigo') return 'Testigo';
  if (origen === 'manual') return 'Manual (gerencia)';
  if (origen.startsWith('qa')) return 'QA';
  return origen;
}

export function LexphSuscriptoresPage() {
  const navigate = useNavigate();
  const confirmar = useConfirm();
  const [bajaId, setBajaId] = useState<string | null>(null);
  const [reactId, setReactId] = useState<string | null>(null);

  const [items, setItems] = useState<LexphSuscriptorItem[]>([]);
  // DGG-257 (display E-GG-281) · overlay de supresión GLOBAL (por cualquier vía),
  // para no "mentir" cuando un confirmado está suprimido por otra superficie.
  const [supr, setSupr] = useState<LexphSuprimido[]>([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState<FiltroEstado>('todos');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  // DGG-267: con ~13k suscriptores, evitar re-fetchear todo el universo por cada update de
  // last_email_at durante los envíos (realtime). Throttle de 30s para el refresh por realtime.
  const lastRtRef = useRef(0);

  async function refresh() {
    lastRtRef.current = Date.now();
    // R19 · universo completo + overlay de supresión, en paralelo. El cruce es en memoria.
    const [res, resSupr] = await Promise.all([listSuscriptores(), getSuscriptoresSuprimidos()]);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos cargar los suscriptores', { description: humanizeError(res.error) });
      return;
    }
    setItems(res.data);
    // Si el overlay falla, el panel degrada al estado local (no rompe) — mejor eso que romper la lista.
    setSupr(resSupr.ok ? resSupr.data : []);
  }

  // DGG-256 · baja manual por gerencia (p. ej. pidió la baja por WhatsApp/mail).
  // Suprime el email globalmente (email_suppression) → deja de recibir el newsletter
  // y cualquier otra vía. No se puede deshacer desde acá.
  async function handleBaja(s: LexphSuscriptorItem) {
    const ok = await confirmar({
      title: 'Dar de baja del newsletter',
      message: `Vas a dar de baja a "${s.email}" de LexPH y suprimir ese correo de todos los envíos. Se usa cuando alguien pide la baja por fuera del link del mail. ¿Confirmás?`,
      confirmLabel: 'Dar de baja',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setBajaId(s.id);
    const res = await bajaSuscriptorLexph(s.id);
    setBajaId(null);
    if (!res.ok || !res.data.ok) {
      toast.error('No pudimos dar de baja', { description: res.ok ? (res.data.error ?? '') : humanizeError(res.error) });
      return;
    }
    toast.success(`"${s.email}" dado de baja y suprimido de los envíos`);
    void refresh();
  }

  // DGG-257 · reactivar manual (inverso de la baja): quita la supresión global y
  // devuelve el email al newsletter (estado='confirmado') y a cualquier otra vía.
  // Si la casilla está muerta (rebote/queja/inválida/descarte) el server la frena y
  // deriva a Configuración → Correos suprimidos (override consciente).
  async function handleReactivar(s: LexphSuscriptorItem) {
    const ok = await confirmar({
      title: 'Reactivar en el newsletter',
      message: `Vas a reactivar a "${s.email}": se quita de la lista de suprimidos y vuelve a recibir el newsletter de LexPH. ¿Confirmás?`,
      confirmLabel: 'Reactivar',
      cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setReactId(s.id);
    const res = await reactivarSuscriptorLexph(s.id);
    setReactId(null);
    if (!res.ok) {
      toast.error('No pudimos reactivar', { description: humanizeError(res.error) });
      return;
    }
    if (!res.data.ok) {
      if (res.data.error === 'bloqueo_duro') {
        const m = MOTIVO_DURO_LABEL[res.data.motivo ?? ''] ?? 'casilla muerta';
        toast.error('Casilla bloqueada', {
          description: `"${s.email}" está suprimido por ${m}. Para reactivarlo igual, usá Configuración → Correos suprimidos.`,
        });
      } else {
        toast.error('No pudimos reactivar', { description: res.data.error ?? '' });
      }
      return;
    }
    toast.success(`"${s.email}" reactivado · vuelve a recibir el newsletter`);
    void refresh();
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtimeRefresh(['lexph_suscriptores'], () => {
    // Throttle: durante una ventana de envío last_email_at cambia ~1/min sobre 13k filas;
    // sin esto se re-fetchearía todo el universo en cada evento.
    if (Date.now() - lastRtRef.current < 30_000) return;
    void refresh();
  });

  // Supresión GLOBAL por email_norm (una sola fuente de verdad del envío).
  const suprMap = useMemo(() => {
    const m = new Map<string, LexphSuprimido>();
    for (const x of supr) m.set(x.email, x);
    return m;
  }, [supr]);
  const suprDe = (s: LexphSuscriptorItem) => suprMap.get(normEmail(s.email));

  // R19 · KPIs sobre el universo completo (items crudos).
  const kpis = useMemo(() => {
    const confirmados = items.filter((s) => s.estado === 'confirmado').length;
    const pendientes = items.filter((s) => s.estado === 'pendiente').length;
    const bajas = items.filter((s) => s.estado === 'baja').length;
    // Confirmados que NO reciben porque su email está suprimido por otra vía (§6-e).
    const confirmadosNoReciben = items.filter(
      (s) => s.estado === 'confirmado' && suprMap.has(normEmail(s.email)),
    ).length;
    // Crecimiento: altas de los últimos 30 días.
    const hace30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const nuevos30 = items.filter((s) => {
      const t = new Date(s.created_at).getTime();
      return Number.isFinite(t) && t >= hace30;
    }).length;
    return { total: items.length, confirmados, pendientes, bajas, nuevos30, confirmadosNoReciben };
  }, [items, suprMap]);

  const filtrados = useMemo(() => {
    const needle = foldText(q);
    return items.filter((s) => {
      if (estado !== 'todos' && s.estado !== estado) return false;
      if (needle && !foldText(s.email).includes(needle) && !foldText(origenLabel(s.origen)).includes(needle)) return false;
      return true;
    });
  }, [items, estado, q]);

  useEffect(() => setPage(1), [estado, q]);

  const totalFiltrados = filtrados.length;
  const totalPaginas = Math.max(1, Math.ceil(totalFiltrados / PAGE_SIZE_DEFAULT));
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
    { key: 'confirmado', label: `Confirmados · ${kpis.confirmados}` },
    { key: 'pendiente', label: `Pendientes · ${kpis.pendientes}` },
    { key: 'baja', label: `Bajas · ${kpis.bajas}` },
  ];

  function exportarCsv() {
    if (filtrados.length === 0) {
      toast.error('No hay suscriptores para exportar');
      return;
    }
    const csv = rowsToCsv(filtrados, [
      { key: 'email', label: 'Email' },
      { key: 'estado', label: 'Estado' },
      { key: 'estado', label: 'Entrega', format: (r) => (suprMap.has(normEmail(r.email)) ? 'no recibe (suprimido)' : r.estado === 'baja' ? 'baja' : 'ok') },
      { key: 'origen', label: 'Origen', format: (r) => origenLabel(r.origen) },
      { key: 'created_at', label: 'Alta', format: (r) => fmtFecha(r.created_at) },
      { key: 'confirmed_at', label: 'Confirmado', format: (r) => fmtFecha(r.confirmed_at) },
      { key: 'last_email_at', label: 'Último envío', format: (r) => fmtFecha(r.last_email_at) },
      { key: 'baja_at', label: 'Baja', format: (r) => fmtFecha(r.baja_at) },
    ]);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `lexph-suscriptores-${hoyISO()}.csv`);
    toast.success('CSV exportado');
  }

  return (
    <div className="relative space-y-6 pb-12">
      <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-40" />

      {/* Header */}
      <header className="card-premium relative overflow-hidden">
        <div className="relative flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="kicker text-brand-cyan">LEXPH · UN SERVICIO DE GESTIÓN GLOBAL</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink">Suscriptores</h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Quién recibe el newsletter de LexPH y cómo crece la base. Cada nuevo confirmado
              avisa a gerencia por la campanita.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => navigate('/gerencia/contenidos')}>
              <ArrowLeft size={15} /> Contenidos
            </Button>
            <Button variant="ghost" onClick={exportarCsv}>
              <Download size={15} /> Exportar CSV
            </Button>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Confirmados" value={kpis.confirmados} icon={CheckCircle2} tone="green"
          hint={kpis.confirmadosNoReciben > 0 ? `${kpis.confirmadosNoReciben} no reciben (suprimidos)` : undefined} />
        <KpiCard label="Pendientes" value={kpis.pendientes} icon={Clock} tone="amber" />
        <KpiCard label="Bajas" value={kpis.bajas} icon={UserMinus} tone="slate" />
        <KpiCard label="Nuevos · 30 días" value={kpis.nuevos30} icon={TrendingUp} tone="cyan" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs items={tabs} activeKey={estado} onChange={(k) => setEstado(k as FiltroEstado)} />
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por email u origen…" className="pl-9" />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Todavía no hay suscriptores"
          description="Cuando alguien se suscriba desde la web o desde un formulario, aparecerá acá."
        />
      ) : totalFiltrados === 0 ? (
        <IllustratedEmpty illustration="busqueda" title="Sin resultados" description="Ajustá los filtros o la búsqueda." />
      ) : (
        <>
          <ul className="space-y-2">
            {pageItems.map((s) => {
              const sup = suprDe(s);
              // Suprimido por OTRA vía pero con estado local no-baja (el chip "Confirmado"
              // mentía): badge "No recibe" + el botón pasa a Reactivar (igual que una baja).
              const suprVisible = s.estado !== 'baja' && !!sup;
              const mostrarReactivar = s.estado === 'baja' || !!sup;
              return (
              <li key={s.id}>
                <div className="card-premium flex items-center gap-4 p-4">
                  <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-cyan-pale/60 text-brand-cyan">
                    <Mail size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <EstadoChip estado={s.estado} />
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {origenLabel(s.origen)}
                      </span>
                      {suprVisible && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${sup!.es_hard ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}
                          title={`No recibe envíos · ${MOTIVO_LABEL[sup!.motivo] ?? sup!.motivo}`}
                        >
                          <MailX size={11} /> No recibe
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-medium text-brand-ink">{s.email}</p>
                  </div>
                  <div className="hidden flex-shrink-0 text-right text-xs text-brand-muted sm:block">
                    <p className="tabular-nums">Alta {fmtFecha(s.created_at)}</p>
                    {s.estado === 'confirmado' && s.confirmed_at && (
                      <p className="tabular-nums text-emerald-600">Confirmó {fmtFecha(s.confirmed_at)}</p>
                    )}
                    {s.estado === 'baja' && s.baja_at && (
                      <p className="tabular-nums text-rose-500">Baja {fmtFecha(s.baja_at)}</p>
                    )}
                  </div>
                  {!mostrarReactivar && (
                    <button
                      type="button"
                      onClick={() => void handleBaja(s)}
                      disabled={bajaId === s.id}
                      aria-label={`Dar de baja a ${s.email} y suprimir el correo de todos los envíos`}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-muted transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      title="Dar de baja y suprimir el correo de todos los envíos"
                    >
                      {bajaId === s.id ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                      <span className="hidden sm:inline">{bajaId === s.id ? 'Dando de baja…' : 'Dar de baja'}</span>
                    </button>
                  )}
                  {mostrarReactivar && (
                    <button
                      type="button"
                      onClick={() => void handleReactivar(s)}
                      disabled={reactId === s.id}
                      aria-label={`Reactivar a ${s.email} y devolverlo al newsletter`}
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-muted transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-50"
                      title="Reactivar y devolver el correo al newsletter"
                    >
                      {reactId === s.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      <span className="hidden sm:inline">{reactId === s.id ? 'Reactivando…' : 'Reactivar'}</span>
                    </button>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
          <Paginador page={page} pageSize={PAGE_SIZE_DEFAULT} total={totalFiltrados} onPage={setPage} />
        </>
      )}
    </div>
  );
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600',
  cyan: 'bg-brand-cyan-pale/60 text-brand-cyan',
} as const;

function KpiCard({
  label, value, icon: Icon, tone, hint,
}: { label: string; value: number; icon: typeof Mail; tone: keyof typeof TONES; hint?: string }) {
  return (
    <div className="card-premium flex items-center gap-3 p-4">
      <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${TONES[tone]}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="font-display text-2xl font-bold tabular-nums text-brand-ink">{value}</p>
        <p className="truncate text-xs text-brand-muted">{label}</p>
        {hint && <p className="mt-0.5 truncate text-[11px] font-medium text-rose-500">{hint}</p>}
      </div>
    </div>
  );
}

function EstadoChip({ estado }: { estado: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    confirmado: { cls: 'bg-emerald-50 text-emerald-700', label: 'Confirmado' },
    pendiente: { cls: 'bg-amber-50 text-amber-700', label: 'Pendiente' },
    baja: { cls: 'bg-rose-50 text-rose-600', label: 'Baja' },
  };
  const m = map[estado] ?? { cls: 'bg-slate-100 text-slate-500', label: estado };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}
