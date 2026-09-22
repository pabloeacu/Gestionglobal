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
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPerfilRegulatorio,
  declararPerfilRegulatorio,
  setPerfilNoRequiere,
  type PerfilRegulatorio,
  type NoRequiereMap,
} from '@/services/api/perfilRegulatorio';
import { Button, Field, Input, Drawer, Modal, Switch, AnimatedNumber, useConfirm } from '@/components/common';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { CertezaBadge, HechoValue, CERTEZA_META } from '../components/perfil/CertezaBadge';
import {
  OBLIGACIONES,
  hechoDe,
  colaAccionable,
  contarPendientes,
  readSnoozed,
  writeSnoozed,
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

export function PortalFichaRegulatoriaPage() {
  const { user } = useAuth();
  const adminId = user?.administracionId ?? null;
  const confirm = useConfirm();

  const [perfil, setPerfil] = useState<PerfilRegulatorio | null>(null);
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
    const res = await getPerfilRegulatorio(adminId);
    if (res.ok) setPerfil(res.data);
    else setError(humanizeError(res.error));
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
            <p className="kicker text-brand-cyan">Portal · Matrícula</p>
            <h1 className="font-display text-2xl font-bold leading-tight text-brand-ink sm:text-3xl">
              Mi ficha regulatoria
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
          <HelpCircle size={13} /> ¿Qué significan los colores?
        </button>
      </div>

      {/* IDENTIDAD de matrícula */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
          <ShieldCheck size={16} className="text-brand-cyan" /> Tu matrícula
        </p>
        <dl className="space-y-2.5">
          <IdentRow label="Estado">
            <span className="flex items-center gap-2">
              <span className="text-sm font-medium text-brand-ink">
                {p.matriculado.valor ? 'Matriculado' : 'Sin matrícula registrada'}
              </span>
              <CertezaBadge certeza={p.matriculado.certeza} />
            </span>
          </IdentRow>
          {p.jurisdiccion && (
            <IdentRow label="Jurisdicción">
              <span className="text-sm font-medium text-brand-ink">
                {p.jurisdiccion === 'rpac' ? 'RPAC · Buenos Aires' : 'RPA · CABA'}
              </span>
            </IdentRow>
          )}
          <IdentRow label="Nº de matrícula">
            <span className="flex items-center gap-2">
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
                <span className="text-brand-muted">—</span>
              )}
              <CertezaBadge certeza={p.matricula.nro_certeza} />
            </span>
          </IdentRow>
          <IdentRow label="Fecha de matriculación">
            <span className="flex items-center gap-2">
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
              subtitulo="Nos ayuda a estimar tus próximos vencimientos."
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
        const yaSabemos = OBLIGACIONES.filter((o) => {
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
                    <div key={o.key} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
                      <span className="text-sm text-brand-muted">{o.label}</span>
                      <span className="flex items-center gap-2">
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
          {OBLIGACIONES.filter((o) => o.factProxima).map((o) => {
            const h = hechoDe(p, o.factProxima as keyof PerfilRegulatorio);
            const optOut = o.key in noRequiere;
            return (
              <div key={o.key} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
                <span className={cn('text-sm', optOut ? 'text-brand-muted line-through' : 'text-brand-muted')}>{o.label}</span>
                {optOut ? (
                  <span className="text-xs text-brand-muted">No lo requerís</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <HechoValue hecho={h} fallback="A definir" />
                    <CertezaBadge certeza={h.certeza} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-brand-muted">
          Las fechas <span className="italic text-[#8A4A00]">≈estimadas</span> son orientativas hasta que las confirmes.
        </p>
      </section>

      {/* SERVICIOS QUE NO NECESITÁS (opt-outs) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <p className="mb-1 font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
          Servicios que no necesitás
        </p>
        <p className="mb-3 text-xs text-brand-muted">¿Alguno no aplica a tu caso? Marcalo y dejamos de recordártelo.</p>
        <div className="space-y-2.5">
          {OBLIGACIONES.map((o) => {
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
      <Modal open={leyendaOpen} onClose={() => setLeyendaOpen(false)} title="¿Qué significan los colores?">
        <div className="space-y-3">
          {(Object.keys(CERTEZA_META) as Array<keyof typeof CERTEZA_META>).map((c) => (
            <div key={c} className="flex items-start gap-3">
              <CertezaBadge certeza={c} />
              <p className="text-xs text-brand-muted">{CERTEZA_META[c].hint}</p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function IdentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-sm text-brand-muted">{label}</dt>
      <dd>{children}</dd>
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
      <Field label={label} hint="Elegí la fecha aproximada; después la podés corregir.">
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
