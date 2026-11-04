// ============================================================================
// PortalDdjjPage · DGG-243 F3 — sección "Declaraciones Juradas" del portal.
//
// Visible para todo cliente (el NAV del portal no gatea por servicio; igual que
// Campus). La página maneja adentro:
//   · Banner de vencimiento por jurisdicción (PBA 31/03 · CABA 30/11) usando
//     `perfil.proxima_ddjj` — MISMA fuente que la ficha "Próximas obligaciones"
//     (coherencia aviso↔display; las fechas legales viven sólo en SQL, mig 0619).
//   · Intro (Ley 14.701 + RPAC + rol de GG), comercialmente atractiva.
//   · Gating por jurisdicción: PBA = servicio completo; CABA = sólo aviso premium
//     (GG no hace gestoría CABA); Neuquén/sin-matrícula = no aplica.
//   · 3 estados (PBA): credenciales asignadas (launcher) / solicitud en curso /
//     sin servicio (entrada comercial). Fuente: credencial_reg_meta + trámites 'dj'.
//   · Launcher premium: credenciales con copia segura + password revelado on-demand
//     (nunca al montar) + "Abrir el Portal" en nueva pestaña + instructivo descargable.
// Secreto: la contraseña se pide por `revelarCredencialDdjj` recién al click (auditado).
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, KeyRound, FileText, ExternalLink, Eye, EyeOff, Copy, Check,
  CalendarClock, ArrowRight, Info, Loader2, Sparkles, Clock, Lock,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button, CopyButton, Skeleton } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { CertezaBadge } from '../components/perfil/CertezaBadge';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { formatDateLong, daysBetween } from '@/lib/dates';
import { getPerfilRegulatorio, type PerfilRegulatorio } from '@/services/api/perfilRegulatorio';
import { jurNorm, type JurNorm } from '../components/perfil/fichaModel';
import {
  getCredencialDdjjMeta, revelarCredencialDdjj, instructivoDdjjUrl, PORTAL_DDJJ_URL,
  type CredencialMeta,
} from '@/services/api/ddjj';
import { fetchClienteTramites, type ClienteTramite } from '@/services/api/portal-dashboard';

const ESTADOS_ABIERTOS = ['abierto', 'en_progreso', 'esperando_cliente'];

type EstadoDdjj = 'asignada' | 'en_curso' | 'sin_servicio';

export function PortalDdjjPage() {
  const { user } = useAuth();
  const adminId = user?.administracionId ?? null;

  const [perfil, setPerfil] = useState<PerfilRegulatorio | null>(null);
  const [cred, setCred] = useState<CredencialMeta | null>(null);
  const [credError, setCredError] = useState(false);
  const [tramites, setTramites] = useState<ClienteTramite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!adminId) { setLoading(false); return; }
    setLoading(true); setError(null); setCredError(false);
    try {
      const [rP, rC, rT] = await Promise.all([
        getPerfilRegulatorio(adminId),
        getCredencialDdjjMeta(adminId),
        fetchClienteTramites(), // R19: universo completo, se filtra en memoria
      ]);
      if (!rP.ok) { setError(humanizeError(rP.error)); return; }
      setPerfil(rP.data);
      // §6 A#3: distinguir "sin credencial" de "no se pudo cargar" — ante error del
      // meta NO asumimos sin_servicio (no mostramos el CTA comercial a un cliente que sí la tiene).
      if (rC.ok) setCred(rC.data); else setCredError(true);
      if (rT.ok) setTramites(rT.data);
    } catch {
      // §6 A#4: cualquier rejection (offline/abort) no debe dejar el Skeleton clavado.
      setError('No pudimos cargar tus datos de DDJJ. Reintentá en un momento.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [adminId]);

  const jur: JurNorm | null = perfil ? jurNorm(perfil) : null;
  const aplica = jur === 'pba' || jur === 'caba';
  const gestoriaDisponible = jur === 'pba';
  const venc = perfil?.proxima_ddjj ?? null;

  const credAsignada = cred?.existe === true;
  // §6 A#2/C#2: una propuesta de gestoría pendiente (que el cliente NO puede ver por
  // seguridad) marca "en curso" vía el flag `pendiente` del meta, sin exponer el secreto;
  // también cuenta un trámite 'dj' abierto. Así nunca mostramos el CTA comercial si ya hay gestión.
  const credPendiente = cred?.pendiente === true;
  // §6 C#1: espeja el gate server (servicio 'rpac_ddjj' O categoría 'dj').
  const tramiteDjAbierto = useMemo(
    () => tramites.some(
      (t) => (t.categoria === 'dj' || t.servicio_codigo === 'rpac_ddjj') && ESTADOS_ABIERTOS.includes(t.estado),
    ),
    [tramites],
  );
  const estado: EstadoDdjj = credAsignada
    ? 'asignada'
    : credPendiente || tramiteDjAbierto
      ? 'en_curso'
      : 'sin_servicio';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* HERO */}
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal p-6 text-white shadow-sm">
        <TrianglesAccent position="top-right" size={160} tone="cyan" density="rich" className="opacity-40" />
        <div className="relative">
          <p className="kicker inline-flex items-center gap-1.5 text-white/85">
            <ShieldCheck size={14} /> Obligaciones RPAC
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">Declaraciones Juradas</h1>
          <p className="mt-1 max-w-xl text-sm text-white/85">
            Tu DDJJ anual, acompañada por Gestión Global de principio a fin.
          </p>
        </div>
      </header>

      {!adminId ? (
        <VinculandoCuenta />
      ) : loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
          <p className="font-semibold">No pudimos cargar tus datos de DDJJ.</p>
          <p className="mt-1">{error}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void load()}>Reintentar</Button>
        </div>
      ) : (
        <>
          {/* BANNER DE VENCIMIENTO (PBA/CABA, cuando hay fecha) */}
          {aplica && venc?.fecha && <VencimientoBanner fecha={venc.fecha} certeza={venc.certeza} />}

          {/* INTRO — sólo donde la DDJJ aplica (PBA/CABA); copy jurisdicción-aware */}
          {aplica && jur && <IntroDdjj jur={jur} gestoriaDisponible={gestoriaDisponible} />}

          {/* GATING POR JURISDICCIÓN */}
          {jur === 'pba' ? (
            <>
              {credError ? (
                <CredErrorCard onRetry={() => void load()} />
              ) : estado === 'asignada' && adminId ? (
                <LauncherCredenciales adminId={adminId} usuario={cred?.usuario ?? null} tienePassword={cred?.tienePassword ?? false} />
              ) : estado === 'en_curso' ? (
                <EnCurso />
              ) : (
                <SinServicio />
              )}
              <InstructivoCard />
            </>
          ) : jur === 'caba' ? (
            <AvisoCaba />
          ) : (
            <NoAplica />
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Banner de vencimiento ─────────────────────────
function VencimientoBanner({ fecha, certeza }: { fecha: string; certeza: PerfilRegulatorio['proxima_ddjj']['certeza'] }) {
  const dias = daysBetween(fecha); // días HASTA la fecha (positivo = futuro, negativo = vencida)
  const vencida = dias != null && dias < 0;
  const urgente = dias != null && dias >= 0 && dias <= 15;
  const alto = dias != null && dias > 15 && dias <= 30;

  const tone = vencida
    ? 'border-rose-300 bg-rose-50 text-rose-900'
    : urgente
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : alto
        ? 'border-brand-orange/40 bg-orange-50 text-brand-ink'
        : 'border-brand-cyan/30 bg-brand-cyan-pale/40 text-brand-ink';

  return (
    <section className={`flex items-start gap-3 rounded-2xl border p-4 ${tone}`}>
      <CalendarClock size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-base font-bold">
            {vencida ? 'Tu DDJJ anual está vencida' : 'Tu próxima Declaración Jurada anual'}
          </p>
          <CertezaBadge certeza={certeza} />
        </div>
        <p className="mt-0.5 text-sm">
          {vencida ? (
            <>Venció el <strong>{formatDateLong(fecha)}</strong>. Regularizala cuanto antes — escribinos y te ayudamos.</>
          ) : (
            <>Vence el <strong>{formatDateLong(fecha)}</strong>
              {dias != null && dias >= 0 && (
                <> · {dias === 0 ? 'es hoy' : `faltan ${dias} ${dias === 1 ? 'día' : 'días'}`}</>
              )}.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

// ───────────────────────── Intro (copy jurisdicción-aware) ─────────────────────────
// §6 A#6: sólo se muestra donde la DDJJ aplica (PBA/CABA); el marco legal es el real
// de cada jurisdicción (PBA = RPAC / Ley 14.701; CABA = RPA de la Ciudad).
function IntroDdjj({ jur, gestoriaDisponible }: { jur: JurNorm; gestoriaDisponible: boolean }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-cyan"><Info size={13} /> De qué se trata</p>
      <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">La DDJJ anual, en simple</h2>
      {jur === 'caba' ? (
        <p className="mt-2 text-sm text-brand-ink/85">
          Todo administrador matriculado en el <strong>Registro Público de Administradores (RPA)</strong> de la Ciudad de
          Buenos Aires debe presentar una Declaración Jurada anual sobre cómo administró cada consorcio: facturación,
          cargas sociales, seguros, capacitaciones, proveedores y juicios.
        </p>
      ) : (
        <p className="mt-2 text-sm text-brand-ink/85">
          Todo administrador matriculado en el <strong>Registro Público de Administradores de Consorcios (RPAC)</strong> de
          la Provincia de Buenos Aires debe presentar, en el marco de la <strong>Ley 14.701</strong>, una Declaración
          Jurada anual sobre cómo administró cada consorcio: facturación, cargas sociales, seguros, capacitaciones,
          proveedores y juicios.
        </p>
      )}
      <p className="mt-2 text-sm text-brand-ink/85">
        {gestoriaDisponible ? (
          <>En Gestión Global <strong>la hacemos por vos</strong>: te damos el acceso al Portal de DDJJ, preparamos la
          carga y te acompañamos paso a paso. Vos ponés los datos de tu administración; nosotros, el tiempo y la
          tranquilidad.</>
        ) : (
          <>Gestión Global te acompaña con el <strong>aviso de vencimiento</strong> para que no se te pase ninguna fecha.</>
        )}
      </p>
    </section>
  );
}

// ───────────────────────── Error al cargar credenciales (no asumir sin_servicio) ─────────────────────────
function CredErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-muted"><Info size={13} /> Un segundo</p>
      <h2 className="mt-1 font-display text-lg font-bold text-brand-ink">No pudimos cargar tu acceso al Portal</h2>
      <p className="mt-1 text-sm text-brand-ink/85">Reintentá en un momento; si sigue, escribinos y lo revisamos.</p>
      <Button variant="secondary" className="mt-3" onClick={onRetry}>Reintentar</Button>
    </section>
  );
}

// ───────────────────────── Estado: credenciales asignadas (launcher) ─────────────────────────
function LauncherCredenciales({ adminId, usuario, tienePassword }: { adminId: string; usuario: string | null; tienePassword: boolean }) {
  const [pwd, setPwd] = useState('');
  const [revelada, setRevelada] = useState(false); // §6 #10: flag de cache (pwd '' sigue "revelada")
  const [ver, setVer] = useState(false);
  const [revelando, setRevelando] = useState(false);
  const [copiadoPwd, setCopiadoPwd] = useState(false);

  // Trae y cachea la contraseña una sola vez; devuelve el valor o null si falló.
  async function asegurarRevelada(): Promise<string | null> {
    if (revelada) return pwd;
    setRevelando(true);
    const r = await revelarCredencialDdjj(adminId);
    setRevelando(false);
    if (!r.ok) { toast.error('No pudimos obtener la contraseña', { description: humanizeError(r.error) }); return null; }
    const v = r.data ?? '';
    setPwd(v); setRevelada(true);
    return v;
  }
  async function revelar() {
    if (revelada) { setVer((v) => !v); return; }
    const v = await asegurarRevelada();
    if (v !== null) setVer(true);
  }
  async function copiarPwd() {
    const v = await asegurarRevelada();
    if (v === null) return;
    await writeClipboard(v, setCopiadoPwd);
  }
  function abrirPortal() {
    window.open(PORTAL_DDJJ_URL, '_blank', 'noopener,noreferrer');
  }
  async function copiarUsuarioYAbrir() {
    if (usuario) {
      try { await navigator.clipboard.writeText(usuario); toast.success('Usuario copiado · abrimos el Portal'); }
      catch { /* igual abrimos */ }
    }
    abrirPortal();
  }

  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-brand-cyan/30 bg-gradient-to-br from-brand-cyan-pale/40 via-white to-white p-5 shadow-sm">
      <TrianglesAccent position="top-right" size={110} tone="cyan" density="soft" className="opacity-20" />
      <div className="relative">
        <p className="kicker inline-flex items-center gap-1.5 text-brand-teal"><KeyRound size={13} /> Tu acceso al Portal de DDJJ</p>
        <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">Ya tenés tus credenciales</h2>
        <p className="mt-1 text-sm text-brand-muted">
          Ingresá al Portal de Declaraciones Juradas (misgestiones.com.ar) con estos datos. Se guardan
          cifrados: nadie más que vos y Gestión Global los ve.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Usuario */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">Usuario</p>
            {usuario ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate text-sm font-semibold text-brand-ink">{usuario}</code>
                <CopyButton value={usuario} label="Usuario" />
              </div>
            ) : (
              <p className="mt-1 text-sm text-brand-muted">—</p>
            )}
          </div>
          {/* Contraseña */}
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-brand-muted">Contraseña</p>
            {tienePassword ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate text-sm font-semibold text-brand-ink">
                  {revelada && ver ? pwd : '••••••••••'}
                </code>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void revelar()}
                    disabled={revelando}
                    className="rounded-lg border border-slate-200 p-1.5 text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
                    aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={ver ? 'Ocultar' : 'Mostrar'}
                  >
                    {revelando ? <Loader2 size={14} className="animate-spin" /> : ver ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copiarPwd()}
                    disabled={revelando}
                    className="rounded-lg border border-slate-200 p-1.5 text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
                    aria-label="Copiar contraseña"
                    title="Copiar contraseña"
                  >
                    {copiadoPwd ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm text-brand-muted">Te la asignamos en breve</p>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={abrirPortal}>
            <ExternalLink size={15} /> Abrir el Portal de DDJJ
          </Button>
          <Button variant="secondary" onClick={() => void copiarUsuarioYAbrir()}>
            <Copy size={14} /> Copiar usuario y abrir
          </Button>
        </div>
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand-muted">
          <Lock size={11} /> Tu contraseña viaja cifrada y sólo se muestra cuando la pedís.
        </p>
      </div>
    </section>
  );
}

async function writeClipboard(text: string, setCopied: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Contraseña copiada al portapapeles');
    window.setTimeout(() => setCopied(false), 1400);
  } catch {
    toast.error('No pudimos copiar al portapapeles');
  }
}

// ───────────────────────── Estado: solicitud en curso ─────────────────────────
function EnCurso() {
  return (
    <section className="rounded-2xl border border-brand-orange/40 bg-orange-50/50 p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-orange"><Clock size={13} /> En preparación</p>
      <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">Estamos preparando tu acceso</h2>
      <p className="mt-2 text-sm text-brand-ink/85">
        Ya estamos trabajando en tu Declaración Jurada. En cuanto tengamos listo el acceso al Portal de DDJJ, te vas a
        encontrar acá el usuario y la contraseña. Te avisamos ni bien esté.
      </p>
      <Link to="/portal/gestiones" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-cyan hover:underline">
        Ver el estado de tu gestión <ArrowRight size={14} />
      </Link>
    </section>
  );
}

// ───────────────────────── Estado: sin servicio (entrada comercial) ─────────────────────────
function SinServicio() {
  return (
    <section className="relative overflow-hidden rounded-2xl border-2 border-brand-cyan/30 bg-gradient-to-br from-white via-white to-brand-cyan-pale/40 p-5 shadow-sm">
      <TrianglesAccent position="top-right" size={110} tone="cyan" density="soft" className="opacity-20" />
      <div className="relative">
        <p className="kicker inline-flex items-center gap-1.5 text-brand-teal"><Sparkles size={13} /> Un peso menos</p>
        <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">Dejanos tu DDJJ a nosotros</h2>
        <p className="mt-2 text-sm text-brand-ink/85">
          La Declaración Jurada anual lleva tiempo: 9 pasos por cada consorcio, documentación, cargas sociales, seguros,
          proveedores y juicios. En Gestión Global <strong>la hacemos por vos</strong> y te acompañamos hasta presentarla.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-brand-ink/85">
          <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-brand-cyan" /> Acceso al Portal de DDJJ con credenciales listas.</li>
          <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-brand-cyan" /> Carga acompañada y revisión paso a paso.</li>
          <li className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0 text-brand-cyan" /> Avisos antes del vencimiento para no llegar tarde.</li>
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a href="/formulario/ddjj-anual?origen=portal" target="_blank" rel="noopener noreferrer">
            <Button variant="primary"><ArrowRight size={15} /> Quiero el servicio de DDJJ</Button>
          </a>
          <Link to="/portal/nuevo">
            <Button variant="secondary">Ver todos los servicios</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── Instructivo ─────────────────────────
function InstructivoCard() {
  const url = useMemo(() => instructivoDdjjUrl(), []);
  return (
    <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale text-brand-cyan">
          <FileText size={18} />
        </span>
        <div>
          <p className="font-display text-sm font-bold text-brand-ink">Instructivo paso a paso</p>
          <p className="text-xs text-brand-muted">Cómo completar la DDJJ en el Portal, los 9 pasos explicados.</p>
        </div>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
        <Button variant="secondary"><FileText size={14} /> Ver instructivo</Button>
      </a>
    </section>
  );
}

// ───────────────────────── CABA (aviso premium, sin gestoría) ─────────────────────────
function AvisoCaba() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-cyan"><ShieldCheck size={13} /> Servicio premium de avisos</p>
      <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">Te avisamos de tu vencimiento</h2>
      <p className="mt-2 text-sm text-brand-ink/85">
        Para la matrícula de <strong>CABA</strong>, Gestión Global te acompaña con el <strong>aviso de vencimiento de tu
        Declaración Jurada</strong> para que no se te pase ninguna fecha. La gestoría y el aplicativo de carga de DDJJ son
        exclusivos de la Provincia de Buenos Aires, así que la presentación la hacés vos ante tu registro.
      </p>
      <p className="mt-2 text-sm text-brand-muted">
        ¿Tenés también matrícula en Provincia? Escribinos y sumamos la gestoría completa.
      </p>
    </section>
  );
}

// ───────────────────────── No aplica (Neuquén / sin matrícula) ─────────────────────────
function NoAplica() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-muted"><Info size={13} /> Según tu jurisdicción</p>
      <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">La DDJJ anual RPAC no aplica a tu matrícula</h2>
      <p className="mt-2 text-sm text-brand-ink/85">
        La Declaración Jurada anual que gestionamos corresponde al Registro Público de Administradores de Consorcios de
        la Provincia de Buenos Aires. Si creés que debería aplicarte, cargá tu matrícula en tu ficha o escribinos y lo
        revisamos.
      </p>
      <Link to="/portal/mi-ficha" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-cyan hover:underline">
        Ir a mi ficha regulatoria <ArrowRight size={14} />
      </Link>
    </section>
  );
}

// ───────────────────────── Cuenta sin vincular ─────────────────────────
function VinculandoCuenta() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="kicker inline-flex items-center gap-1.5 text-brand-cyan"><ShieldCheck size={13} /> Un momento</p>
      <h2 className="mt-1 font-display text-xl font-bold text-brand-ink">Estamos terminando de vincular tu cuenta</h2>
      <p className="mt-2 text-sm text-brand-ink/85">
        En cuanto tu administración quede vinculada vas a ver acá tu Declaración Jurada, el vencimiento y tu acceso al Portal.
      </p>
    </section>
  );
}

export default PortalDdjjPage;
