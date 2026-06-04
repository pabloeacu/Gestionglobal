// PortalHome · Dashboard premium del cliente (administrador).
// Filosofía: muestra SERVICIOS ACTIVOS y OPORTUNIDADES DE RENOVACIÓN, no
// deuda como eje. Cuenta corriente solo aparece si hay saldo real. Mobile-first.
//
// Estructura:
//   1. Hero card premium (saludo + datos)
//   2. Hot cards adaptativos (clase HOY, webinar próximo, vencimientos críticos, deuda real)
//   3. Atajos principales (Mis cursos, Mis gestiones, Mis webinars, Solicitar nuevo)
//   4. Oportunidades cross-sell (sutil, basado en reglas del nicho)
//   5. Mis cursos activos (compacto)
//   6. Próximos vencimientos (compacto)
//
// Citas: regla 4 (queries en services/), regla 13 (sin window.confirm).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  GraduationCap,
  Video,
  FileText,
  PlusCircle,
  CalendarClock,
  BadgeCheck,
  Wallet,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  PlayCircle,
  BellRing,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { Skeleton } from '@/components/common';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import {
  fetchClientePortalDashboard,
  fetchTrackingAvancesNuevosCount,
  marcarOportunidadMostrada,
  posponerOportunidad,
  type ClientePortalDashboard,
  type ClienteOportunidad,
} from '@/services/api/portal-dashboard';
import {
  listPedidosAbiertosCliente,
  type PedidoAbiertoResumen,
} from '@/services/api/tramitePedidosDoc';
import { ActivarPushAssistant } from '@/components/common/ActivarPushAssistant';
import { CertCelebracionBanner } from '@/modules/campus/components/CertCelebracionBanner';
import { NovedadesBanner } from '../components/NovedadesBanner';
import { PortalOnboardingTour, tourCompletado } from '../components/PortalOnboardingTour';
import { PortalPwaAssistant } from '../components/PortalPwaAssistant';
import { PortalPushAssistant } from '../components/PortalPushAssistant';

// =========================================================================
export function PortalHome() {
  const { user } = useAuth();
  const [data, setData] = useState<ClientePortalDashboard | null>(null);
  const [avancesNuevos, setAvancesNuevos] = useState(0);
  const [pedidosAbiertos, setPedidosAbiertos] = useState<PedidoAbiertoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTour, setShowTour] = useState(false);

  async function load() {
    const [res, count, pedidos] = await Promise.all([
      fetchClientePortalDashboard(),
      fetchTrackingAvancesNuevosCount(),
      listPedidosAbiertosCliente(),
    ]);
    setLoading(false);
    if (res.ok && !res.data.error) {
      setData(res.data);
      // DGG-45 · sostiene la recurrencia "desde la última vez mostrado":
      // marca como vistos hoy los banners suaves visibles para que no
      // reaparezcan hasta N días después.
      const posponibles = res.data.oportunidades
        .filter((o) => o.posponible)
        .map((o) => o.codigo);
      if (posponibles.length > 0) void marcarOportunidadMostrada(posponibles);
    }
    setAvancesNuevos(count);
    if (pedidos.ok) setPedidosAbiertos(pedidos.data);
  }

  // DGG-45 · "Recordar después": pospone un banner suave 30 días.
  async function handlePosponer(codigo: string) {
    setData((prev) =>
      prev
        ? { ...prev, oportunidades: prev.oportunidades.filter((o) => o.codigo !== codigo) }
        : prev,
    );
    await posponerOportunidad(codigo);
  }

  useEffect(() => { void load(); }, []);

  // Tour de bienvenida (sólo primera vez)
  useEffect(() => {
    if (!tourCompletado()) {
      // Delay para que la página cargue primero
      const t = setTimeout(() => setShowTour(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  // Realtime refresh on relevant tables
  useRealtimeRefresh(['curso_encuentros', 'webinar_inscriptos', 'vencimientos', 'tramites', 'comprobantes'], () => { void load(); });

  if (loading) {
    return (
      <div className="space-y-4 sm:space-y-5">
        <Skeleton className="h-40 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0,1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center">
        <p className="text-sm text-amber-800">
          No pudimos cargar tu información. Intentá refrescar la página.
        </p>
      </div>
    );
  }

  const userName = user?.fullName?.split(' ')[0] ?? data.administracion.responsable_nombre ?? 'Hola';

  return (
    <div className="space-y-5 sm:space-y-6 pb-12">
      <Hero
        userName={userName}
        nombre={data.administracion.nombre}
        responsable={data.administracion.responsable_nombre}
        tieneMatricula={data.administracion.tiene_matricula}
        matricula={data.administracion.matricula_rpac}
        cursosCount={data.cursos_activos.length}
        tramitesCount={data.tramites_abiertos_count}
      />

      {avancesNuevos > 0 && <AvancesNuevosBanner count={avancesNuevos} />}

      {/* Novedades enviadas por gerencia (panel Comunicaciones).
          Sólo aparece si hay alguna vigente sin marcar como vista. */}
      <NovedadesBanner />

      {/* CTA universal: pide permiso de push con 1 click (no entra a config). */}
      <ActivarPushAssistant />

      {/* DGG-41 · Banner premium cuando el alumno terminó un curso y se
          emitió su certificado. Tiene la frase de José Luis + CTA descarga
          directa del PDF. Va al tope para que se vea apenas entra. */}
      <CertCelebracionBanner />

      {/* M1 · Banner urgente cuando hay pedidos de documentación abiertos.
          Va arriba para que el cliente lo vea apenas entra. */}
      {pedidosAbiertos.length > 0 && <DocsPendientesBanner items={pedidosAbiertos} />}

      <HotCards
        claseHoy={data.clase_hoy}
        webinar={data.webinar_proximo}
        oportunidades={data.oportunidades}
        deuda={data.deuda}
      />

      <Atajos avancesNuevos={avancesNuevos} />

      <Assistants />

      {data.oportunidades.length > 0 && (
        <Oportunidades items={data.oportunidades} onPosponer={handlePosponer} />
      )}

      {data.cursos_activos.length > 0 && (
        <MisCursosCompact items={data.cursos_activos} />
      )}

      {data.vencimientos_proximos.length > 0 && (
        <ProximosVencimientos items={data.vencimientos_proximos} />
      )}

      <PortalOnboardingTour open={showTour} onClose={() => setShowTour(false)} />
    </div>
  );
}

// =========================================================================
// Assistants strip (PWA install + Push activation)
// =========================================================================
function Assistants() {
  return (
    <section className="space-y-3">
      <PortalPwaAssistant />
      <PortalPushAssistant />
    </section>
  );
}

// =========================================================================
// Hero — Bienvenida + nombre admin + matrícula
// =========================================================================
function Hero({
  userName, nombre, responsable, tieneMatricula, matricula, cursosCount, tramitesCount,
}: {
  userName: string;
  nombre: string;
  responsable: string | null;
  tieneMatricula: boolean;
  matricula: string | null;
  cursosCount: number;
  tramitesCount: number;
}) {
  const greeting = greetingFromHour();
  return (
    <section className="card-premium relative overflow-hidden">
      <TrianglesAccent position="top-right" size={220} tone="cyan" density="soft" className="opacity-30" />
      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0 flex-1">
          <p className="kicker text-brand-cyan">{greeting}</p>
          <h1 className="font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
            {userName}{userName?.length > 0 ? ',' : ''} bienvenido
          </h1>
          <p className="mt-1 text-sm text-brand-muted">
            <span className="font-medium text-brand-ink">{nombre}</span>
            {responsable && <span> · {responsable}</span>}
          </p>
          {tieneMatricula && matricula && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <BadgeCheck size={11} /> Matrícula {matricula}
            </p>
          )}
        </div>
        <div className="flex flex-row gap-3 sm:flex-col sm:items-end sm:gap-1">
          <HeroStat n={cursosCount} label="cursos activos" />
          <HeroStat n={tramitesCount} label="gestiones abiertas" />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
      <span className="font-display text-2xl font-bold leading-none text-brand-ink tabular">{n}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-brand-muted">{label}</span>
    </div>
  );
}

function greetingFromHour(): string {
  const h = new Date().getHours();
  if (h < 12) return 'BUEN DÍA';
  if (h < 19) return 'BUENAS TARDES';
  return 'BUENAS NOCHES';
}

// =========================================================================
// Hot cards — solo las relevantes, sin orden vacío
// =========================================================================
function HotCards({
  claseHoy, webinar, oportunidades, deuda,
}: {
  claseHoy: ClientePortalDashboard['clase_hoy'];
  webinar: ClientePortalDashboard['webinar_proximo'];
  oportunidades: ClienteOportunidad[];
  deuda: ClientePortalDashboard['deuda'];
}) {
  const cards: React.ReactNode[] = [];

  if (claseHoy) {
    const mins = Math.max(0, claseHoy.minutos_para_inicio);
    const inProgress = mins <= 0 && (claseHoy.iniciado_at || claseHoy.minutos_para_inicio >= -120);
    cards.push(
      <HotCard
        key="clase"
        kicker={inProgress ? 'CLASE EN VIVO' : 'TU CLASE EMPIEZA YA'}
        titulo={claseHoy.encuentro_titulo}
        descripcion={
          inProgress
            ? `${claseHoy.curso_titulo} · En curso`
            : `${claseHoy.curso_titulo} · En ${formatMinutes(mins)}`
        }
        ctaLabel="Unirme"
        ctaHref={claseHoy.link_zoom ?? claseHoy.link_webex ?? `/portal/campus/${claseHoy.curso_slug}`}
        ctaExternal={!!(claseHoy.link_zoom || claseHoy.link_webex)}
        icon={<PlayCircle size={22} />}
        tone="urgente"
      />
    );
  }

  if (webinar) {
    const horas = Math.max(0, webinar.horas_para_inicio);
    cards.push(
      <HotCard
        key="webinar"
        kicker={webinar.status === 'en_curso' ? 'WEBINAR EN VIVO' : 'TU WEBINAR'}
        titulo={webinar.titulo}
        descripcion={
          webinar.status === 'en_curso'
            ? 'Está empezando ahora'
            : horas < 24
              ? `En ${formatHours(horas)}`
              : `En ${formatDias(Math.round(horas / 24))}`
        }
        ctaLabel={webinar.status === 'en_curso' ? 'Unirme' : 'Ver detalle'}
        ctaHref={webinar.link ?? '/portal/webinars'}
        ctaExternal={!!webinar.link && webinar.status === 'en_curso'}
        icon={<Video size={22} />}
        tone={webinar.status === 'en_curso' ? 'urgente' : 'alto'}
      />
    );
  }

  // Sólo el oportunidad más urgente como hot card (las demás van al stripe de oportunidades abajo)
  const urgente = oportunidades.find(o => o.tone === 'urgente') || oportunidades.find(o => o.tone === 'alto');
  if (urgente) {
    cards.push(
      <HotCard
        key={`op-${urgente.codigo}`}
        kicker={urgente.kicker}
        titulo={urgente.titulo}
        descripcion={urgente.descripcion}
        ctaLabel={urgente.cta_label}
        ctaHref={urgente.cta_path}
        icon={iconForOportunidad(urgente.icono)}
        // Oportunidades = verde (renovación/capacitación = bueno hacerlo)
        tone="oportunidad"
      />
    );
  }

  if (deuda.tiene_deuda) {
    cards.push(
      <HotCard
        key="deuda"
        kicker="SALDO PENDIENTE"
        titulo={`${formatARS(deuda.total)} a regularizar`}
        descripcion={`${deuda.pendientes_count} comprobante${deuda.pendientes_count > 1 ? 's' : ''} pendiente${deuda.pendientes_count > 1 ? 's' : ''}${deuda.vencidos_count > 0 ? ' · ' + deuda.vencidos_count + ' vencido' + (deuda.vencidos_count > 1 ? 's' : '') : ''}`}
        ctaLabel="Ver detalle"
        ctaHref="/portal/cuenta-corriente"
        icon={<Wallet size={22} />}
        tone={deuda.vencidos_count > 0 ? 'urgente' : 'medio'}
      />
    );
  }

  if (cards.length === 0) return null;
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards}
    </section>
  );
}

function HotCard({
  kicker, titulo, descripcion, ctaLabel, ctaHref, ctaExternal, icon, tone,
}: {
  kicker: string;
  titulo: string;
  descripcion: string;
  ctaLabel: string;
  ctaHref: string;
  ctaExternal?: boolean;
  icon: React.ReactNode;
  // urgente = rojo (clase), alto = amarillo (webinar), oportunidad = verde
  // (renovaciones), medio = cyan (info), suave = violeta (cross-sell suave)
  tone: 'urgente' | 'alto' | 'oportunidad' | 'medio' | 'suave';
}) {
  const toneClasses = {
    urgente:     'bg-gradient-to-br from-rose-50 via-white to-orange-50 ring-rose-200 hover:ring-rose-300',
    alto:        'bg-gradient-to-br from-amber-50 via-white to-yellow-50 ring-amber-200 hover:ring-amber-300',
    oportunidad: 'bg-gradient-to-br from-emerald-50 via-white to-green-50 ring-emerald-200 hover:ring-emerald-300',
    medio:       'bg-gradient-to-br from-brand-cyan-pale/60 via-white to-cyan-50 ring-cyan-200 hover:ring-brand-cyan/50',
    suave:       'bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 ring-violet-200 hover:ring-violet-300',
  }[tone];

  const iconClasses = {
    urgente:     'bg-rose-100 text-rose-700',
    alto:        'bg-amber-100 text-amber-700',
    oportunidad: 'bg-emerald-100 text-emerald-700',
    medio:       'bg-brand-cyan-pale text-brand-cyan',
    suave:       'bg-violet-100 text-violet-700',
  }[tone];

  const linkContent = (
    <div className={`group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl p-4 ring-1 ring-inset transition sm:p-5 ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl ${iconClasses}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="kicker truncate text-brand-cyan opacity-80">{kicker}</p>
          <h3 className="font-display text-lg font-bold leading-tight text-brand-ink">{titulo}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-brand-muted">{descripcion}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-end gap-1 text-sm font-semibold text-brand-ink transition group-hover:gap-2">
        <span>{ctaLabel}</span>
        <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </div>
    </div>
  );

  if (ctaExternal) {
    return <a href={ctaHref} target="_blank" rel="noopener noreferrer" className="block h-full">{linkContent}</a>;
  }
  return <Link to={ctaHref} className="block h-full">{linkContent}</Link>;
}

function iconForOportunidad(name: string): React.ReactNode {
  switch (name) {
    case 'badge-check': return <BadgeCheck size={22} />;
    case 'file-text': return <FileText size={22} />;
    case 'graduation-cap': return <GraduationCap size={22} />;
    case 'sparkles': return <Sparkles size={22} />;
    case 'video': return <Video size={22} />;
    default: return <Sparkles size={22} />;
  }
}

// =========================================================================
// Atajos principales (grid 2x2 mobile, 4 col desktop)
// Si "Mis gestiones" tiene tracking_avances no leídos, mostramos badge "X nuevos"
// =========================================================================
function Atajos({ avancesNuevos }: { avancesNuevos: number }) {
  const items = [
    { to: '/portal/campus',     icon: GraduationCap, label: 'Mis cursos',   sub: 'Clases y certificados', badge: 0 },
    { to: '/portal/gestiones',  icon: FileText,      label: 'Mis gestiones', sub: 'Trámites en curso',     badge: avancesNuevos },
    { to: '/portal/webinars',   icon: Video,         label: 'Mis webinars',  sub: 'Próximos y pasados',    badge: 0 },
    { to: '/portal/nuevo',      icon: PlusCircle,    label: 'Nuevo servicio', sub: 'Iniciar trámite',      badge: 0 },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className="group relative flex flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-cyan hover:shadow-md"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan transition group-hover:scale-105">
            <it.icon size={18} />
          </span>
          {it.badge > 0 && (
            <span
              className="absolute right-2 top-2 inline-flex items-center justify-center rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse"
              title={`${it.badge} novedad${it.badge > 1 ? 'es' : ''} sin leer`}
            >
              {it.badge > 9 ? '9+' : it.badge} {it.badge === 1 ? 'nuevo' : 'nuevos'}
            </span>
          )}
          <div>
            <p className="font-semibold text-brand-ink">{it.label}</p>
            <p className="text-[11px] text-brand-muted">{it.sub}</p>
          </div>
        </Link>
      ))}
    </section>
  );
}

// =========================================================================
// Oportunidades cross-sell (todas las que no fueron hot)
// =========================================================================
function Oportunidades({
  items,
  onPosponer,
}: {
  items: ClienteOportunidad[];
  onPosponer: (codigo: string) => void;
}) {
  // Excluir la urgente/alto que ya está en HotCards
  const restantes = items.filter((_, idx) => {
    const urgenteIdx = items.findIndex(o => o.tone === 'urgente');
    const altoIdx = items.findIndex(o => o.tone === 'alto');
    const usadoIdx = urgenteIdx >= 0 ? urgenteIdx : altoIdx;
    return idx !== usadoIdx;
  });
  if (restantes.length === 0) return null;

  return (
    <section>
      <header className="mb-3 flex items-center justify-between px-1">
        <p className="kicker text-brand-muted">SUGERIDO PARA VOS</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {restantes.map((op) => (
          <div key={op.codigo} className="relative">
            <Link
              to={op.cta_path}
              className="group flex h-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-cyan hover:shadow-md"
            >
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan">
                {iconForOportunidad(op.icono)}
              </span>
              <div className="min-w-0 flex-1 pr-5">
                <p className="kicker text-brand-cyan opacity-80">{op.kicker}</p>
                <p className="font-semibold text-brand-ink">{op.titulo}</p>
                <p className="line-clamp-2 text-xs text-brand-muted">{op.descripcion}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan transition group-hover:gap-1.5">
                  {op.cta_label} <ArrowRight size={11} />
                </p>
              </div>
            </Link>
            {/* DGG-45 · "Recordar después" — sólo en banners suaves (posponibles) */}
            {op.posponible && (
              <button
                type="button"
                onClick={() => onPosponer(op.codigo)}
                title="Recordar más tarde"
                aria-label="Recordar más tarde"
                className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-white/80 text-brand-muted ring-1 ring-inset ring-slate-200 backdrop-blur-sm transition hover:bg-white hover:text-brand-ink"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// =========================================================================
// Mis cursos compact
// =========================================================================
function MisCursosCompact({ items }: { items: ClientePortalDashboard['cursos_activos'] }) {
  return (
    <section>
      <header className="mb-3 flex items-center justify-between px-1">
        <p className="kicker text-brand-muted">MIS CURSOS ACTIVOS</p>
        <Link to="/portal/campus" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:gap-1.5 transition">
          Ver todos <ChevronRight size={11} />
        </Link>
      </header>
      <div className="space-y-2">
        {items.slice(0, 3).map((c) => (
          <Link
            key={c.matricula_id}
            to={`/portal/campus/${c.curso_slug}`}
            className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-cyan hover:shadow-sm"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-cyan-pale text-brand-cyan">
              <GraduationCap size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-brand-ink">{c.curso_titulo}</p>
              <p className="text-[11px] text-brand-muted">
                {c.modalidad}{c.vigencia_hasta ? ` · vigente hasta ${formatDateShort(c.vigencia_hasta)}` : ''}
              </p>
            </div>
            <ChevronRight size={14} className="text-brand-muted transition group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </section>
  );
}

// =========================================================================
// Próximos vencimientos
// =========================================================================
function ProximosVencimientos({ items }: { items: ClientePortalDashboard['vencimientos_proximos'] }) {
  return (
    <section>
      <header className="mb-3 flex items-center justify-between px-1">
        <p className="kicker text-brand-muted">PRÓXIMOS VENCIMIENTOS</p>
      </header>
      <div className="rounded-2xl border border-slate-200 bg-white">
        {items.map((v, idx) => {
          const isCritical = v.dias_restantes <= 15;
          return (
            <div
              key={v.id}
              className={`flex items-center gap-3 p-3 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
            >
              <span className={`grid h-9 w-9 place-items-center rounded-lg ${isCritical ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                {isCritical ? <AlertTriangle size={14} /> : <CalendarClock size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-ink">
                  {labelForTipoVencimiento(v.tipo)}{v.descripcion ? ` · ${v.descripcion}` : ''}
                </p>
                <p className="text-[11px] text-brand-muted">
                  {formatDateLong(v.fecha_vencimiento)} · en {v.dias_restantes} día{v.dias_restantes === 1 ? '' : 's'}
                </p>
              </div>
              {isCritical && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                  pronto
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// =========================================================================
// Helpers
// =========================================================================
function labelForTipoVencimiento(tipo: string): string {
  // Mig 0155 · FIX-V3 · sólo 3 tipos vivos. Histórico cancelado fallback al tipo.
  const map: Record<string, string> = {
    renovacion_rpac: 'Renovación de matrícula RPAC',
    curso_actualizacion: 'Curso de Actualización RPAC',
    ddjj_anual: 'Declaración Jurada anual',
    // Backward compat para filas históricas canceladas:
    matricula_rpac: 'Matrícula RPAC (histórico)',
    otro: 'Otro',
  };
  return map[tipo] ?? tipo;
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatHours(h: number): string {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (hours < 1) return `${mins} min`;
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
}

function formatDias(n: number): string {
  return `${n} día${n === 1 ? '' : 's'}`;
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

// =========================================================================
// Banner destacado "Tenés X avances nuevos" — aparece arriba de las
// HotCards cuando hay tracking_avances no leídos. Click → Mis gestiones.
// Tono cyan (info positivo, no urgente como deuda).
// =========================================================================
// M1 · Banner urgente cuando hay pedidos de documentación abiertos.
// Tono amber (atención requerida) + lista los tramites afectados con
// link directo a cada uno.
function DocsPendientesBanner({ items }: { items: PedidoAbiertoResumen[] }) {
  const total = items.length;
  const totalItemsPendientes = items.reduce((s, p) => s + p.items_pendientes + p.items_rechazados, 0);
  const tramiteUnico = total === 1 ? items[0] : null;
  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 shadow-sm ring-1 ring-amber-100 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-amber-500 text-white shadow-sm">
          <AlertCircle size={22} className="motion-safe:animate-[wiggle_1.2s_ease-in-out_infinite]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-amber-700">Acción requerida</p>
          <p className="font-display text-base font-bold leading-tight text-brand-ink sm:text-lg">
            {tramiteUnico
              ? 'Necesitamos documentación para tu trámite'
              : `Necesitamos documentación en ${total} de tus trámites`}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-amber-900 sm:text-sm">
            {totalItemsPendientes > 0
              ? `Hay ${totalItemsPendientes} archivo(s) por subir. Cuando los tengas todos, enviá el lote a gerencia.`
              : 'Ya enviaste los archivos — el equipo está revisando.'}
          </p>
          <ul className="mt-2 space-y-1">
            {items.slice(0, 3).map(p => (
              <li key={p.pedido_id} className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-mono text-[10px] text-amber-700">
                  {p.tramite_codigo ?? '—'}
                </span>
                <Link
                  to={`/portal/gestiones/${p.tramite_id}`}
                  className="truncate text-amber-900 hover:underline"
                >
                  {p.tramite_titulo ?? p.descripcion}
                </Link>
                {p.items_rechazados > 0 && (
                  <span className="text-[10px] font-semibold text-red-600">· {p.items_rechazados} observado(s)</span>
                )}
              </li>
            ))}
            {items.length > 3 && (
              <li className="text-[11px] text-amber-700">…y {items.length - 3} trámite(s) más</li>
            )}
          </ul>
        </div>
        {tramiteUnico && (
          <Link
            to={`/portal/gestiones/${tramiteUnico.tramite_id}`}
            className="shrink-0 self-center inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700"
          >
            Subir docs
            <ArrowRight size={13} />
          </Link>
        )}
      </div>
    </section>
  );
}

function AvancesNuevosBanner({ count }: { count: number }) {
  const plural = count > 1;
  return (
    <Link
      to="/portal/gestiones"
      className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-teal-50 p-4 shadow-sm ring-1 ring-cyan-100 transition hover:border-brand-cyan hover:shadow-md sm:p-5"
    >
      <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-brand-cyan text-white shadow-sm">
        <BellRing size={22} className="motion-safe:animate-[wiggle_1.2s_ease-in-out_infinite]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="kicker text-brand-cyan">Tenés novedades</p>
        <p className="font-display text-base font-bold leading-tight text-brand-ink sm:text-lg">
          {count} {plural ? 'nuevos avances' : 'nuevo avance'} en tus gestiones
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-brand-muted sm:text-sm">
          Entrá a Mis gestiones para ver el detalle completo y los archivos adjuntos.
        </p>
      </div>
      <ArrowRight
        size={18}
        className="shrink-0 text-brand-cyan transition group-hover:translate-x-1"
      />
    </Link>
  );
}
