import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Check,
  ChevronDown,
  HelpCircle,
  CalendarPlus,
  Clock,
  Sparkles,
  PartyPopper,
  BellRing,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPerfilRegulatorio,
  declararPerfilRegulatorio,
  setPerfilNoRequiere,
  fetchMiAgendaAvisos,
  type PerfilRegulatorio,
  type NoRequiereMap,
  type AgendaAviso,
} from '@/services/api/perfilRegulatorio';
import { Button, Field, Input, Drawer, Modal, Switch, AnimatedNumber, useConfirm, usePrompt } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { CertezaBadge, HechoValue } from '../components/perfil/CertezaBadge';
import {
  obligacionesVisibles,
  hechoDe,
  colaAccionable,
  contarPendientes,
  readSnoozed,
  writeSnoozed,
  matriculaLabel,
  jurisdiccionLabel,
  tieneRegistroOficial,
  type FieldKey,
} from '../components/perfil/fichaModel';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { formatDateShort } from '@/lib/dates';
import { cn } from '@/lib/cn';

// Agenda · progressive profiling — cara del CLIENTE (DGG-197). Enfoque validate-first:
// el cliente CONFIRMA lo que la plataforma ya sabe, nunca recarga un dato confirmado.
// Nivel de certeza siempre legible; nunca afirmamos una presunción. Backend reusado
// (getPerfilRegulatorio/_declarar/_set_no_requiere; sin cambios). Marca GG, mobile-first.

// DGG-218 F3 · etiqueta amigable de cada aviso (acción), según el TIPO de
// vencimiento. §6 #1: NUNCA se usa `descripcion` cruda (texto interno de
// gerencia, con nombres propios) — para un tipo no mapeado cae al genérico.
const AVISO_LABEL: Record<string, string> = {
  ddjj_anual: 'Tu Declaración Jurada anual',
  curso_actualizacion: 'Tu curso de actualización',
  curso_rpa_caba: 'Tu curso RPA (CABA)',
  // DGG-231 · recordatorios sobre tus datos declarados
  ddjj_anual_declarada: 'Tu Declaración Jurada anual',
  curso_actualizacion_declarado: 'Tu curso de actualización',
  certificado_declarado: 'Tu certificado de acreditación',
};
// DGG-234 F6 (E-GG-236): la etiqueta de la renovación de matrícula se rotula según la
// jurisdicción del cliente ("RPAC" para PBA, "RPA (CABA)/(Neuquén)" para los demás) —
// coherente con el pill/card del home (F6b) y los emails/push (F4b). Antes decía "RPAC"
// hardcodeado y los 3 CABA veían "Renovación de tu matrícula RPAC" en su agenda.
const AVISO_MATRICULA_TIPOS = new Set(['renovacion_rpac', 'renovacion_matricula_declarada']);
function avisoLabel(a: AgendaAviso, matLabel: string): string {
  if (AVISO_MATRICULA_TIPOS.has(a.tipo)) return `Renovación de tu matrícula ${matLabel}`;
  return AVISO_LABEL[a.tipo] ?? 'Recordatorio regulatorio';
}

export function PortalFichaRegulatoriaPage() {
  const { user } = useAuth();
  const adminId = user?.administracionId ?? null;
  const confirm = useConfirm();
  const promptDlg = usePrompt();

  const [perfil, setPerfil] = useState<PerfilRegulatorio | null>(null);
  const [avisos, setAvisos] = useState<AgendaAviso[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ field: FieldKey; label: string; pregunta: string } | null>(null);
  const [leyendaOpen, setLeyendaOpen] = useState(false);
  const [confirmadoOpen, setConfirmadoOpen] = useState(false);

  async function load() {
    if (!adminId) return;
    setLoading(true);
    setError(null);
    // DGG-218 F3 (§6 #2): perfil + agenda en paralelo; la agenda es
    // complementaria (su fallo devuelve [] sin bloquear la ficha).
    const [res, ag] = await Promise.all([getPerfilRegulatorio(adminId), fetchMiAgendaAvisos()]);
    if (res.ok) setPerfil(res.data);
    else setError(humanizeError(res.error));
    setAvisos(ag);
    setLoading(false);
  }

  useEffect(() => {
    if (!adminId) return;
    setSnoozed(readSnoozed(adminId));
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId]);

  // ── acciones ────────────────────────────────────────────────────────────────
  async function declarar(field: FieldKey, value: string) {
    if (!adminId) return;
    setBusyKey(field);
    const input = { administracionId: adminId, [field]: value } as Parameters<typeof declararPerfilRegulatorio>[0];
    const res = await declararPerfilRegulatorio(input);
    setBusyKey(null);
    if (res.ok) {
      toast.success('Listo, quedó confirmado. Un dato menos.');
      await load();
    } else {
      toast.error('No se pudo guardar', { description: humanizeError(res.error) });
    }
  }

  async function declararJurisdiccion(j: 'rpac' | 'rpa') {
    if (!adminId) return;
    setBusyKey('jurisdiccion');
    const res = await declararPerfilRegulatorio({ administracionId: adminId, jurisdiccion: j });
    setBusyKey(null);
    if (res.ok) {
      toast.success('Listo, quedó confirmado.');
      await load();
    } else {
      toast.error('No se pudo guardar', { description: humanizeError(res.error) });
    }
  }

  // DGG-206 · el legajo RPAC es la llave para consultar Mesa de Entradas. El nro es texto
  // (no una fecha), así que va por un prompt propio y NO por el editor de fechas (declarar()).
  async function cargarLegajo() {
    if (!adminId) return;
    // DGG-234 F6 · "legajo RPAC" + "Mesa de Entradas" son PBA-only; para CABA/Neuquén neutro.
    const esPbaLegajo = !perfil || tieneRegistroOficial(perfil);
    const v = await promptDlg({
      title: esPbaLegajo ? 'Tu legajo RPAC' : 'Tu legajo',
      message: esPbaLegajo
        ? 'Es la llave para consultar tu trámite en Mesa de Entradas. Lo encontrás en tu credencial / constancia de matrícula.'
        : 'Lo encontrás en tu credencial / constancia de matrícula.',
      label: 'Número de legajo',
      placeholder: 'ej. 282055',
    });
    if (v === null) return;
    const t = v.trim();
    if (!t) return;
    setBusyKey('legajoNro');
    const res = await declararPerfilRegulatorio({ administracionId: adminId, legajoNro: t });
    setBusyKey(null);
    if (res.ok) {
      toast.success('Listo, quedó confirmado. Un dato menos.');
      await load();
    } else {
      toast.error('No se pudo guardar', { description: humanizeError(res.error) });
    }
  }

  // DGG-231 · paridad R14: el Nº de matrícula es un identificador de texto (no una
  // fecha) → va por un prompt propio, igual que el legajo, para que el cliente pueda
  // cargarlo cuando figura "Pendiente" (antes se mostraba sin control alcanzable).
  async function cargarMatriculaNro() {
    if (!adminId) return;
    const v = await promptDlg({
      title: 'Tu número de matrícula',
      message: 'El número con el que figurás matriculado en el registro. Lo encontrás en tu credencial / constancia de matrícula.',
      label: 'Número de matrícula',
      placeholder: 'ej. 12345',
    });
    if (v === null) return;
    const t = v.trim();
    if (!t) return;
    setBusyKey('matriculaNro');
    const res = await declararPerfilRegulatorio({ administracionId: adminId, matriculaNro: t });
    setBusyKey(null);
    if (res.ok) {
      toast.success('Listo, quedó confirmado. Un dato menos.');
      await load();
    } else {
      toast.error('No se pudo guardar', { description: humanizeError(res.error) });
    }
  }

  // opt-out: RE-LEE fresco el no_requiere y manda el mapa COMPLETO (gerencia edita en paralelo).
  async function setOptOut(key: string, on: boolean, motivo?: string) {
    if (!adminId) return;
    setBusyKey(`opt:${key}`);
    const fresh = await getPerfilRegulatorio(adminId);
    if (!fresh.ok) {
      setBusyKey(null);
      toast.error('No se pudo guardar', { description: humanizeError(fresh.error) });
      return;
    }
    const map: NoRequiereMap = { ...(fresh.data.no_requiere ?? {}) };
    if (on) map[key] = { motivo: motivo ?? 'No me corresponde', fecha: new Date().toISOString().slice(0, 10) };
    else delete map[key];
    const res = await setPerfilNoRequiere(adminId, map);
    setBusyKey(null);
    if (res.ok) {
      toast.success(on ? 'Listo, dejamos de recordártelo.' : 'Vamos a volver a recordártelo.');
      await load();
    } else {
      toast.error('No se pudo guardar', { description: humanizeError(res.error) });
    }
  }

  function snooze(key: string) {
    if (!adminId) return;
    const next = new Set(snoozed);
    next.add(key);
    setSnoozed(next);
    writeSnoozed(adminId, next);
    toast.info('Lo dejamos para después.');
  }

  // ── derivados ────────────────────────────────────────────────────────────────
  const noRequiere = perfil?.no_requiere ?? {};
  const cola = useMemo(() => (perfil ? colaAccionable(perfil, snoozed) : []), [perfil, snoozed]);
  const necesitaJurisdiccion = !!perfil && perfil.jurisdiccion === null && !snoozed.has('jurisdiccion');
  const necesitaMatriculaFecha =
    !!perfil && perfil.matricula.fecha_certeza === 'desconocido' && perfil.matriculado.valor && !snoozed.has('matriculaFecha');
  const pendientes = perfil ? contarPendientes(perfil, snoozed) : 0;
  // "realmente completo" ignora el snooze: sólo es true si NO queda nada accionable de
  // verdad (todo confirmado/declarado u opt-outeado). Snoozear no completa la ficha.
  const realmenteCompleto = perfil ? contarPendientes(perfil, new Set<string>()) === 0 : false;

  // ── estados de página ─────────────────────────────────────────────────────────
  if (!adminId) {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center">
        <ShieldCheck className="mx-auto mb-3 text-brand-cyan" size={36} />
        <p className="font-display text-lg font-bold text-brand-ink">Estamos terminando de vincular tu cuenta</p>
        <p className="mt-1 text-sm text-brand-muted">
          En cuanto esté lista vas a poder revisar tu matrícula acá.{' '}
          <Link to="/portal/gestiones" className="text-brand-cyan underline">
            Ver mis gestiones
          </Link>
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid place-items-center p-16">
        <BrandLoader size={56} label="Cargando tu ficha" />
      </div>
    );
  }

  if (error || !perfil) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-sm font-medium text-red-700">{error ?? 'No pudimos cargar tu ficha.'}</p>
        <Button variant="secondary" className="mt-3" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const p = perfil;
  const matLabel = matriculaLabel(p); // DGG-234 F6 · rótulo de matrícula según jurisdicción
  const esPba = tieneRegistroOficial(p); // sólo PBA se verifica contra TRAMIX/registro oficial
  // "completo" = no queda NADA accionable de verdad (confirmado/declarado u opt-outeado).
  // NO se ata a completitud_pct>=100 (los opt-out dejan hechos en 'desconocido' y el pct,
  // que sólo cuenta confirmado+declarado, nunca llegaría a 100). Snoozear NO completa.
  const completo = realmenteCompleto;

  return (
    <div className="relative mx-auto max-w-2xl space-y-5 pb-16">
      {/* HERO adaptativo + anillo de completitud */}
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <TrianglesAccent position="top-right" tone="cyan" density="soft" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="kicker text-brand-cyan">Portal · Agenda profesional</p>
            <h1 className="font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
              Mi agenda de vencimientos
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              {completo
                ? 'Tu matrícula está al día. No tenés nada que hacer — te avisamos antes de cada vencimiento.'
                : pendientes > 0
                  ? `Esto es lo que sabemos. Confirmá ${pendientes === 1 ? 'un dato' : `${pendientes} datos`} y queda al día.`
                  : 'Esto es lo que sabemos de tu matrícula. Confirmá lo que esté bien y corregí lo que no.'}
            </p>
          </div>
          <RingProgress pct={p.completitud_pct} done={completo} />
        </div>
      </header>

      {/* termómetro + leyenda */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-brand-muted">
          <span className="font-semibold tabular-nums text-brand-ink">{p.completitud_pct}%</span> conocido
          {pendientes > 0 && <> · te faltan <span className="font-semibold text-brand-ink">{pendientes}</span></>}
        </p>
        <button
          onClick={() => setLeyendaOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-brand-cyan hover:underline"
        >
          <HelpCircle size={13} /> ¿Qué significan las etiquetas?
        </button>
      </div>

      {/* IDENTIDAD de matrícula */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
          <ShieldCheck size={16} className="text-brand-cyan" /> Tu matrícula
        </p>
        <dl className="space-y-2.5">
          <IdentRow label="Estado">
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span className="text-sm font-medium text-brand-ink">
                {p.matriculado.valor ? 'Matriculado' : 'Sin matrícula registrada'}
              </span>
              <CertezaBadge certeza={p.matriculado.certeza} />
            </span>
          </IdentRow>
          {p.jurisdiccion && (
            <IdentRow label="Jurisdicción">
              <span className="text-sm font-medium text-brand-ink">
                {jurisdiccionLabel(p)}
              </span>
            </IdentRow>
          )}
          <IdentRow label="Nº de matrícula">
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              {/* el nro es un identificador de texto, NO una fecha → no pasa por HechoValue */}
              {p.matricula.nro ? (
                <span
                  className={cn(
                    'tabular-nums text-brand-ink',
                    p.matricula.nro_certeza === 'confirmado' && 'font-semibold',
                  )}
                >
                  {p.matricula.nro}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void cargarMatriculaNro()}
                  disabled={busyKey === 'matriculaNro'}
                  className="text-xs font-semibold text-brand-cyan hover:underline disabled:opacity-50"
                >
                  Cargar mi N° de matrícula
                </button>
              )}
              <CertezaBadge certeza={p.matricula.nro_certeza} />
            </span>
          </IdentRow>
          {/* DGG-206 · legajo (llave para Mesa de Entradas en PBA). El cliente puede cargarlo.
              DGG-234 F6 · "RPAC" es sólo PBA; para CABA/Neuquén el rótulo es neutro ("Legajo"). */}
          <IdentRow label={esPba ? 'Legajo RPAC' : 'Legajo'}>
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              {p.legajo.nro ? (
                <span
                  className={cn(
                    'tabular-nums text-brand-ink',
                    p.legajo.nro_certeza === 'confirmado' && 'font-semibold',
                  )}
                >
                  {p.legajo.nro}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void cargarLegajo()}
                  disabled={busyKey === 'legajoNro'}
                  className="text-xs font-semibold text-brand-cyan hover:underline disabled:opacity-50"
                >
                  Cargar mi legajo
                </button>
              )}
              <CertezaBadge certeza={p.legajo.nro_certeza} />
            </span>
          </IdentRow>
          <IdentRow label="Fecha de matriculación">
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              <HechoValue hecho={{ fecha: p.matricula.fecha, certeza: p.matricula.fecha_certeza }} fallback="—" />
              <CertezaBadge certeza={p.matricula.fecha_certeza} />
            </span>
          </IdentRow>
        </dl>
      </section>

      {/* NECESITAN TU OK — la cola */}
      {(necesitaJurisdiccion || necesitaMatriculaFecha || cola.length > 0) && (
        <section className="space-y-3">
          <p className="flex items-center gap-1.5 px-1 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            <Sparkles size={15} className="text-gg-warn" /> Necesitan tu OK
          </p>

          {necesitaJurisdiccion && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-medium text-brand-ink">Para empezar: ¿dónde estás matriculado?</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button variant="primary" className="w-full justify-center sm:w-auto" loading={busyKey === 'jurisdiccion'} onClick={() => void declararJurisdiccion('rpac')}>
                  RPAC · Buenos Aires
                </Button>
                <Button variant="secondary" className="w-full justify-center sm:w-auto" disabled={busyKey === 'jurisdiccion'} onClick={() => void declararJurisdiccion('rpa')}>
                  RPA · CABA
                </Button>
                <Button variant="ghost" className="w-full justify-center sm:w-auto" disabled={busyKey === 'jurisdiccion'} onClick={() => snooze('jurisdiccion')}>
                  No estoy matriculado
                </Button>
              </div>
            </div>
          )}

          {necesitaMatriculaFecha && (
            <HechoConfirmCard
              titulo="¿Cuándo te matriculaste?"
              subtitulo="Nos ayuda a calcular tus próximos vencimientos."
              busy={busyKey === 'matriculaFecha'}
              onCargar={() => setEditor({ field: 'matriculaFecha', label: 'Fecha de matriculación', pregunta: '¿Cuándo te matriculaste?' })}
              onTodaviaNo={() => snooze('matriculaFecha')}
              optOut={null}
            />
          )}

          {cola.map((o) => (
            <HechoConfirmCard
              key={o.key}
              titulo={o.pregunta}
              subtitulo={o.factProxima ? 'Con esto calculamos tu próxima fecha automáticamente.' : undefined}
              busy={busyKey === o.field || busyKey === `opt:${o.key}`}
              onCargar={() => setEditor({ field: o.field, label: o.label, pregunta: o.pregunta })}
              onTodaviaNo={() => snooze(o.key)}
              optOut={() => void setOptOut(o.key, true)}
            />
          ))}
        </section>
      )}

      {/* YA LO SABEMOS (colapsable, read-only, baja jerarquía) */}
      {(() => {
        const yaSabemos = obligacionesVisibles(p).filter((o) => {
          const c = hechoDe(p, o.factUltima).certeza;
          return c === 'confirmado' || c === 'declarado';
        });
        if (yaSabemos.length === 0) return null;
        return (
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <button
              onClick={() => setConfirmadoOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 p-5 text-left"
            >
              <span className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
                <Check size={15} className="text-gg-ok" /> Ya lo sabemos ({yaSabemos.length})
              </span>
              <ChevronDown size={16} className={cn('text-brand-muted transition', confirmadoOpen && 'rotate-180')} />
            </button>
            {confirmadoOpen && (
              <div className="space-y-2.5 px-5 pb-5">
                {yaSabemos.map((o) => {
                  const h = hechoDe(p, o.factUltima);
                  return (
                    <div key={o.key} className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-1.5">
                      <span className="text-sm text-brand-muted">{o.label}</span>
                      <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <HechoValue hecho={h} />
                        <CertezaBadge certeza={h.certeza} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* PRÓXIMAS OBLIGACIONES (timeline read-only) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
          <Clock size={15} className="text-brand-cyan" /> Tus próximas obligaciones
        </p>
        <div className="space-y-2.5">
          {/* DGG-234 F9 · el certificado ya NO es un vencimiento (dura 30 días; el
              recordatorio cada 90 días para la asamblea lo da el ofrecimiento certificado_90).
              Se excluye de "próximas obligaciones"; su último evento sigue en "último registro". */}
          {obligacionesVisibles(p).filter((o) => o.factProxima && o.key !== 'certificado').map((o) => {
            const h = hechoDe(p, o.factProxima as keyof PerfilRegulatorio);
            const optOut = o.key in noRequiere;
            return (
              <div key={o.key} className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-1.5">
                <span className={cn('text-sm', optOut ? 'text-brand-muted line-through' : 'text-brand-muted')}>{o.label}</span>
                {optOut ? (
                  <span className="text-xs text-brand-muted">No lo requerís</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <HechoValue hecho={h} fallback="A definir" />
                    <CertezaBadge certeza={h.certeza} fuente={h.fuente} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-brand-muted">
          Calculamos estas fechas con tus datos y te avisamos antes de cada una.
          {esPba && ' Cargá tu legajo RPAC y las verificamos con el registro oficial.'}
        </p>
      </section>

      {/* DGG-218 F3 · TU AGENDA DE AVISOS — qué te vamos a recordar y cuándo */}
      {avisos.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-1 flex items-center gap-1.5 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            <BellRing size={15} className="text-brand-cyan" /> Tu agenda de avisos
          </p>
          <p className="mb-3 text-xs text-brand-muted">
            Esto es lo que te vamos a recordar —por mail, push y acá en tu portal— para que no se te pase nada.
          </p>
          <ol className="space-y-2.5">
            {avisos.map((a, i) => (
              <li
                key={`${a.tipo}-${a.fecha_aviso}-${i}`}
                className="flex items-start gap-3 border-b border-slate-100 pb-2.5 last:border-0 last:pb-0"
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-cyan-pale/40 text-brand-cyan">
                  <BellRing size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-brand-ink">
                    <span className="tabular-nums">{formatDateShort(a.fecha_aviso)}</span> · {avisoLabel(a, matLabel)}
                  </p>
                  <p className="text-xs text-brand-muted">
                    {a.dias_antes === 0
                      ? 'El día del vencimiento'
                      : a.dias_antes > 0
                        ? `${a.dias_antes} ${a.dias_antes === 1 ? 'día' : 'días'} antes de que venza`
                        : `${-a.dias_antes} ${-a.dias_antes === 1 ? 'día' : 'días'} después del vencimiento`}
                    {' '}(<span className="tabular-nums">{formatDateShort(a.fecha_vencimiento)}</span>)
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* SERVICIOS QUE NO NECESITÁS (opt-outs) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-1 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
          Servicios que no necesitás
        </p>
        <p className="mb-3 text-xs text-brand-muted">¿Alguno no aplica a tu caso? Marcalo y dejamos de recordártelo.</p>
        <div className="space-y-2.5">
          {obligacionesVisibles(p).map((o) => {
            const on = o.key in noRequiere;
            return (
              <div key={o.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-brand-ink">{o.label}</span>
                <Switch
                  checked={on}
                  disabled={busyKey === `opt:${o.key}`}
                  onChange={(next) => {
                    if (!next) {
                      // revertir un opt-out → confirmar (R13)
                      void confirm({
                        title: `¿Volver a recibir recordatorios de ${o.label.toLowerCase()}?`,
                        message: 'Vamos a incluirlo de nuevo en tu agenda regulatoria.',
                        confirmLabel: 'Sí, seguimos',
                      }).then((ok) => ok && void setOptOut(o.key, false));
                    } else {
                      void setOptOut(o.key, true);
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      {completo && (
        <section className="flex items-center gap-3 rounded-2xl border border-gg-ok/30 bg-gg-okBg p-5">
          <PartyPopper size={22} className="text-gg-ok" />
          <p className="text-sm font-medium text-gg-ok">
            ¡Todo confirmado! Te avisamos antes de cada vencimiento.
          </p>
        </section>
      )}

      <p className="px-1 text-[11px] text-brand-muted">
        Última revisión: <span className="tabular-nums">{formatDateShort(p.generated_at)}</span> · Si te equivocaste en
        un dato, escribinos por <Link to="/portal/gestiones" className="text-brand-cyan underline">tus gestiones</Link>.
      </p>

      {/* editor de fecha (Drawer con date nativo) */}
      <Drawer
        open={!!editor}
        onClose={() => setEditor(null)}
        icon={<CalendarPlus size={18} className="text-brand-cyan" />}
        kicker="Confirmá tu dato"
        title={editor?.pregunta ?? ''}
        width={480}
      >
        {editor && (
          <FechaEditor
            label={editor.label}
            busy={busyKey === editor.field}
            onGuardar={async (v) => {
              await declarar(editor.field, v);
              setEditor(null);
            }}
            onCancelar={() => setEditor(null)}
          />
        )}
      </Drawer>

      {/* leyenda de certeza (una vez) */}
      <Modal open={leyendaOpen} onClose={() => setLeyendaOpen(false)} title="¿Qué significan las etiquetas?">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <CertezaBadge certeza="confirmado" fuente="tramix" />
            <p className="text-xs text-brand-muted">Verificado con el registro oficial (TRAMIX).</p>
          </div>
          <div className="flex items-start gap-3">
            <CertezaBadge certeza="confirmado" />
            <p className="text-xs text-brand-muted">Confirmado por Gestión Global (trámite resuelto o dato cargado por nosotros).</p>
          </div>
          <div className="flex items-start gap-3">
            <CertezaBadge certeza="declarado" />
            <p className="text-xs text-brand-muted">Datos que cargaste vos. Con ellos calculamos tus próximas obligaciones y te avisamos; podés corregirlos cuando quieras.</p>
          </div>
          <div className="flex items-start gap-3">
            <CertezaBadge certeza="desconocido" />
            <p className="text-xs text-brand-muted">Todavía no lo tenemos. Cargá el dato{esPba ? ' o tu legajo RPAC' : ''}.</p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function IdentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <dt className="text-sm text-brand-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function RingProgress({ pct, done }: { pct: number; done: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  // cuando no queda nada por hacer, el anillo se completa aunque el pct sea < 100 (opt-outs).
  const off = done ? 0 : c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="relative grid h-16 w-16 flex-shrink-0 place-items-center">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" className="text-slate-100" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="currentColor"
          className={done ? 'text-gg-ok' : 'text-brand-cyan'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset 700ms ease-out' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        {done ? (
          <Check size={22} className="text-gg-ok" />
        ) : (
          <span className="text-xs font-bold tabular-nums text-brand-ink">
            <AnimatedNumber value={pct} format={(n) => `${Math.round(n)}`} />
          </span>
        )}
      </span>
    </div>
  );
}

function HechoConfirmCard({
  titulo,
  subtitulo,
  busy,
  onCargar,
  onTodaviaNo,
  optOut,
}: {
  titulo: string;
  subtitulo?: string;
  busy: boolean;
  onCargar: () => void;
  onTodaviaNo: () => void;
  optOut: (() => void) | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-medium text-brand-ink">{titulo}</p>
      {subtitulo && <p className="mt-0.5 text-xs text-brand-muted">{subtitulo}</p>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" className="w-full justify-center sm:w-auto" loading={busy} onClick={onCargar}>
          <CalendarPlus size={14} /> Cargar fecha
        </Button>
        <Button variant="ghost" className="w-full justify-center sm:w-auto" disabled={busy} onClick={onTodaviaNo}>
          Todavía no
        </Button>
        {optOut && (
          <Button variant="tonal" className="w-full justify-center sm:w-auto" disabled={busy} onClick={optOut}>
            No me corresponde
          </Button>
        )}
      </div>
    </div>
  );
}

function FechaEditor({
  label,
  busy,
  onGuardar,
  onCancelar,
}: {
  label: string;
  busy: boolean;
  onGuardar: (v: string) => void | Promise<void>;
  onCancelar: () => void;
}) {
  const [v, setV] = useState('');
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <Field label={label} hint="Elegí la fecha que recuerdes; si no es exacta, después la corregís.">
        <Input type="date" value={v} max={hoy} onChange={(e) => setV(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancelar} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="primary" loading={busy} disabled={!v} onClick={() => void onGuardar(v)}>
          <Check size={14} /> Confirmar
        </Button>
      </div>
    </div>
  );
}
