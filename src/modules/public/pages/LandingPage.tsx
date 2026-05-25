import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  RefreshCcw,
  FileCheck2,
  ClipboardList,
  GraduationCap,
  BookOpen,
  Monitor,
  Scale,
  PlayCircle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { HighlightMark } from '@/components/brand/HighlightMark';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';

// ---------------- data ----------------

type ServicioGrupo = {
  kicker: string;
  titulo: string;
  items: Array<{
    icon: typeof ShieldCheck;
    titulo: string;
    descripcion: string;
  }>;
};

const SERVICIOS: ServicioGrupo[] = [
  {
    kicker: 'RPAC · Provincia de Buenos Aires',
    titulo: 'Matrícula al día, sin sobresaltos',
    items: [
      {
        icon: ShieldCheck,
        titulo: 'Inscripción al RPAC',
        descripcion:
          'Te acompañamos en cada paso para que obtengas tu matrícula sin demoras ni observaciones.',
      },
      {
        icon: RefreshCcw,
        titulo: 'Renovación de matrícula',
        descripcion:
          'Gestión integral año a año, cubriendo las nuevas exigencias y con asesoría personalizada.',
      },
      {
        icon: FileCheck2,
        titulo: 'Certificado de acreditación',
        descripcion:
          'Tu matrícula vigente, lista para asambleas u organismos cuando la necesites.',
      },
      {
        icon: ClipboardList,
        titulo: 'Declaraciones juradas anuales',
        descripcion:
          'Plataforma digital guiada paso a paso: orden, respaldo y cero olvidos.',
      },
    ],
  },
  {
    kicker: 'Formación · RPAC y RPA',
    titulo: 'Capacitación que suma reputación',
    items: [
      {
        icon: GraduationCap,
        titulo: 'Curso de formación RPAC',
        descripcion:
          'Curso obligatorio de inscripción · sincrónico · con docentes expertos y campus propio.',
      },
      {
        icon: BookOpen,
        titulo: 'Actualización RPAC',
        descripcion:
          'Para renovación: clases asincrónicas con tutorías sincrónicas, pensadas para la práctica real.',
      },
      {
        icon: BookOpen,
        titulo: 'Actualización RPA · CABA',
        descripcion:
          '100% asincrónico · contenido actualizado · a tu ritmo y según tu disponibilidad.',
      },
      {
        icon: PlayCircle,
        titulo: 'Capacitaciones gratuitas',
        descripcion:
          'Webinars, podcasts y charlas con especialistas — una comunidad que aprende y crece.',
      },
    ],
  },
  {
    kicker: 'Operación profesional',
    titulo: 'Herramientas y respaldo experto',
    items: [
      {
        icon: Monitor,
        titulo: 'Plataforma de gestión',
        descripcion:
          'Plataforma web integral para consorcios: ingresos, gastos, comunicaciones y acceso a propietarios.',
      },
      {
        icon: Scale,
        titulo: 'Asesoría jurídica',
        descripcion:
          'Equipo especializado en propiedad horizontal. Respuestas claras, con fundamento y aplicabilidad.',
      },
    ],
  },
];

const PAREADOS = [
  { a: 'Menos apuro.', b: 'Más gestión.' },
  { a: 'Menos dudas.', b: 'Más seguridad.' },
  { a: 'Menos trámite.', b: 'Más profesión.' },
];

const TESTIMONIOS = [
  {
    nombre: 'Olga Romero Núñez',
    rol: 'Administradora',
    quote:
      'La atención y dedicación que recibí fue digna de difundir. Recomiendo Gestión Global a colegas sin dudar.',
  },
  {
    nombre: 'Vanesa Agote',
    rol: 'Administradora',
    quote:
      'Me sorprendió todo: la dinámica, las clases, el contenido. Lo súper recomiendo.',
  },
  {
    nombre: 'Julio Ariel Fernández',
    rol: 'Administrador',
    quote:
      'Con Gestión Global la administración de nuestros consorcios fue mucho más eficiente y organizada.',
  },
];

const PARTNERS: Array<{ nombre: string; logo: string; descripcion: string }> = [
  {
    nombre: 'FundPlata',
    logo: '/landing/partners/fundplata.png',
    descripcion: 'Certificaciones oficiales en PBA',
  },
  {
    nombre: 'Gestar',
    logo: '/landing/partners/gestar.png',
    descripcion: 'Capacitaciones en CABA',
  },
  {
    nombre: 'Centro de Graduados · UNLP',
    logo: '/landing/partners/cg-unlp.png',
    descripcion: 'Asesoramiento y beneficios',
  },
  {
    nombre: 'Asambleas Virtuales',
    logo: '/landing/partners/asambleas-virtuales.png',
    descripcion: 'Celebración legal a distancia',
  },
  {
    nombre: 'CALP',
    logo: '/landing/partners/calp.png',
    descripcion: 'Cámara de Administradores de La Plata',
  },
  {
    nombre: 'CAMEAC',
    logo: '/landing/partners/cameac.png',
    descripcion: 'Cámara Metropolitana de Administradores',
  },
];

// ---------------- page ----------------

export function LandingPage() {
  return (
    <div id="top" className="min-h-screen bg-white font-sans text-brand-ink">
      <SiteNav />

      <Hero />
      <Pareados />
      <Nosotros />
      <Servicios />
      <ComoTrabajamos />
      <Plataforma />
      <Cursos />
      <Testimonios />
      <Partners />
      <FinalCTA />

      <SiteFooter />
    </div>
  );
}

// ---------------- sections ----------------

function Hero() {
  return (
    <section className="relative overflow-hidden pt-24 sm:pt-28">
      <TrianglesAccent position="top-right" size={360} tone="cyan" density="rich" />
      <TrianglesAccent
        position="bottom-left"
        size={260}
        tone="teal"
        density="soft"
        className="opacity-70"
      />

      <div className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-28">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-cyan animate-fade-up">
          <Sparkles size={12} /> Aliados de tu tiempo
        </span>

        <h1
          className="mx-auto mt-8 max-w-4xl animate-fade-up font-display text-5xl font-extrabold leading-[1.02] tracking-tight sm:text-7xl"
          style={{ animationDelay: '80ms' }}
        >
          Respaldamos cada paso
          <br />
          de <HighlightMark tone="cyan">tu gestión</HighlightMark>.
        </h1>

        <p
          className="mx-auto mt-7 max-w-2xl animate-fade-up text-lg leading-relaxed text-brand-muted"
          style={{ animationDelay: '160ms' }}
        >
          Gestoría, capacitación, asesoramiento y plataforma de gestión
          integral para administradores de consorcios que necesitan menos
          fricción, más respaldo y una gestión profesional libre de errores.
        </p>

        <div
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row animate-fade-up"
          style={{ animationDelay: '240ms' }}
        >
          <Link
            to="/ingresar"
            className="group inline-flex items-center gap-2 rounded-full bg-brand-ink px-7 py-3.5 font-semibold text-white shadow-[0_10px_30px_-12px_rgba(18,34,48,0.5)] transition hover:bg-brand-cyan hover:shadow-[0_14px_40px_-12px_rgba(0,158,202,0.55)]"
          >
            Ingresar a la plataforma
            <ArrowRight size={17} className="transition group-hover:translate-x-1" />
          </Link>
          <a
            href="#servicios"
            className="rounded-full border border-slate-200 bg-white px-6 py-3.5 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
          >
            Conocer los servicios
          </a>
        </div>

        {/* metrics tira */}
        <div
          className="mx-auto mt-20 grid w-full max-w-3xl grid-cols-3 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-white animate-fade-up"
          style={{ animationDelay: '320ms' }}
        >
          <Metric value="+20 años" label="de trayectoria en PH" />
          <Metric value="2 jurisdicciones" label="PBA · CABA" />
          <Metric value="100%" label="online · sin moverte" />
        </div>
      </div>
    </section>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-6 py-6 text-center">
      <p className="font-display text-2xl font-extrabold text-brand-ink">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-wider text-brand-muted">{label}</p>
    </div>
  );
}

function Pareados() {
  return (
    <section className="relative border-y border-slate-100 bg-brand-zebra/40 py-20">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 sm:grid-cols-3">
        {PAREADOS.map((p) => (
          <div key={p.a} className="text-center sm:text-left">
            <p className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              <HighlightMark tone="cyan" variant="underline">
                {p.a}
              </HighlightMark>
            </p>
            <p className="mt-2 font-display text-2xl font-bold text-brand-ink sm:text-3xl">
              {p.b}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Nosotros() {
  return (
    <section id="nosotros" className="relative overflow-hidden bg-white py-24 sm:py-28">
      <TrianglesAccent
        position="top-left"
        size={220}
        tone="cyan"
        density="soft"
        className="opacity-50"
      />
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-stretch">
          {/* Panel "Quiénes somos" · foto del equipo con overlay */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 shadow-[0_24px_70px_-30px_rgba(0,93,105,0.35)] min-h-[420px]">
            <img
              src="/landing/equipo-trabajando.jpg"
              alt="Equipo Gestión Global trabajando"
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-brand-ink via-brand-ink/60 to-transparent" />
            <div className="relative flex h-full flex-col justify-end p-8 text-white">
              <p className="kicker text-brand-cyan-light">Quiénes somos</p>
              <p className="mt-3 font-display text-2xl font-bold leading-tight sm:text-3xl">
                No ofrecemos trámites: ofrecemos{' '}
                <span className="text-brand-cyan-light">respaldo real</span>,
                acompañamiento cercano y soluciones que funcionan.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-white/85">
                Gestión Global nace dentro de Global Servicios Integrados SRL
                como una división especializada para acompañar la transformación
                normativa y profesional de la administración de consorcios.
              </p>
            </div>
          </div>

          {/* Panel "Misión y visión" · texto */}
          <div className="flex flex-col justify-center">
            <p className="kicker text-brand-cyan">Misión y visión</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Simplificar tu gestión.{' '}
              <HighlightMark tone="cyan">Potenciar tu profesión.</HighlightMark>
            </h2>
            <p className="mt-5 text-brand-muted">
              Aspiramos a ser el socio que todo administrador necesita: una
              referencia nacional que combine herramientas ágiles, capacitación
              de calidad, asistencia profesional y calidez humana.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-brand-ink/90">
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
                <span>Herramientas ágiles para liberar tiempo operativo.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
                <span>Capacitación aplicable a la práctica real.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
                <span>Respaldo legal, técnico y documental.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComoTrabajamos() {
  const PASOS = [
    {
      num: '01',
      titulo: 'Diagnóstico',
      desc: 'Entendemos qué trámite, curso o soporte necesitás.',
    },
    {
      num: '02',
      titulo: 'Documentación',
      desc: 'Te guiamos para juntar, cargar y validar la información.',
    },
    {
      num: '03',
      titulo: 'Gestión',
      desc: 'Presentamos, controlamos, observamos y corregimos a tiempo.',
    },
    {
      num: '04',
      titulo: 'Resultado',
      desc: 'Te entregamos cierre claro y respaldo para seguir trabajando.',
    },
  ];
  return (
    <section
      id="proceso"
      className="relative overflow-hidden bg-brand-ink py-24 text-white sm:py-28"
    >
      <TrianglesAccent
        position="top-right"
        size={320}
        tone="cyan"
        density="rich"
        className="opacity-40"
      />
      <TrianglesAccent
        position="bottom-left"
        size={260}
        tone="teal"
        density="soft"
        className="opacity-40"
      />
      <div className="mx-auto max-w-6xl px-6">
        <header className="max-w-3xl">
          <p className="kicker text-brand-cyan-light">Cómo trabajamos</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Un camino simple, con respaldo de punta a punta.
          </h2>
          <p className="mt-5 max-w-xl text-white/75">
            El administrador no necesita más complejidad. Necesita claridad,
            seguimiento y un equipo que se haga cargo.
          </p>
        </header>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PASOS.map((p) => (
            <div
              key={p.num}
              className="group rounded-3xl border border-white/20 bg-white/[0.06] p-6 backdrop-blur transition hover:-translate-y-1 hover:border-brand-cyan-light/50 hover:bg-white/[0.1]"
            >
              <p className="font-display text-4xl font-extrabold text-brand-cyan-light">
                {p.num}
              </p>
              <h3 className="mt-3 font-display text-xl font-bold">{p.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                {p.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Servicios() {
  return (
    <section id="servicios" className="relative bg-white py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-3xl text-center">
          <p className="kicker text-brand-cyan">Servicios</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Soluciones concretas, pensadas para tu día a día.
          </h2>
          <p className="mt-5 text-brand-muted">
            No ofrecemos trámites: ofrecemos respaldo real, acompañamiento
            cercano y soluciones que funcionan.
          </p>
        </header>

        <div className="mt-16 space-y-16">
          {SERVICIOS.map((grupo) => (
            <div key={grupo.titulo}>
              <div className="mb-8 flex flex-col items-baseline gap-2 sm:flex-row sm:justify-between">
                <div>
                  <p className="kicker text-brand-cyan">{grupo.kicker}</p>
                  <h3 className="mt-1 font-display text-2xl font-bold sm:text-3xl">
                    {grupo.titulo}
                  </h3>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {grupo.items.map(({ icon: Icon, titulo, descripcion }) => (
                  <article
                    key={titulo}
                    className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.45)]"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
                      <Icon size={20} />
                    </span>
                    <h4 className="mt-5 font-display text-lg font-bold">
                      {titulo}
                    </h4>
                    <p className="mt-2 text-sm leading-relaxed text-brand-muted">
                      {descripcion}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Plataforma() {
  const FEATURES = [
    'Gestión integral de ingresos y gastos',
    'Comunicaciones unificadas con propietarios',
    'Reportes y dashboards en tiempo real',
    'Soporte personalizado, capacitaciones y asistencia',
  ];

  return (
    <section
      id="plataforma"
      className="relative overflow-hidden bg-brand-ink py-24 text-white sm:py-28"
    >
      <TrianglesAccent
        position="top-right"
        size={320}
        tone="cyan"
        density="rich"
        className="opacity-40"
      />
      <TrianglesAccent
        position="bottom-left"
        size={260}
        tone="teal"
        density="soft"
        className="opacity-40"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2">
        <div>
          <p className="kicker text-brand-cyan-light">Plataforma de gestión</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Tu gestión, en{' '}
            <HighlightMark tone="cyan">una sola pantalla.</HighlightMark>
          </h2>
          <p className="mt-5 max-w-md text-white/70">
            Plataforma web integral para administradores de consorcios.
            Diseñada para maximizar tu eficiencia y fortalecer la relación
            con los propietarios. Menos papeles, menos errores, más tiempo libre.
          </p>

          <ul className="mt-8 space-y-3">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-3 text-sm text-white/85">
                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0 text-brand-cyan-light"
                />
                {f}
              </li>
            ))}
          </ul>

          <Link
            to="/ingresar"
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-brand-ink transition hover:bg-brand-cyan hover:text-white"
          >
            Probar la plataforma <ArrowUpRight size={16} />
          </Link>
        </div>

        {/* mock visual */}
        <div className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-brand-cyan/30 to-brand-teal/30 blur-2xl" />
          <div className="relative rounded-2xl border border-white/15 bg-white/[0.06] p-2 backdrop-blur">
            <div className="overflow-hidden rounded-xl bg-brand-ink">
              <div className="flex items-center gap-1.5 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
              </div>
              <div className="grid grid-cols-3 gap-3 px-4 pb-5">
                <DashCard kicker="Facturado" value="$ 4.8 M" />
                <DashCard kicker="Cobranzas" value="$ 3.2 M" tone="cyan" />
                <DashCard kicker="Saldo" value="$ 1.6 M" />
                <div className="col-span-3 rounded-lg bg-white/[0.04] p-4">
                  <p className="kicker text-white/60">Cash flow mensual</p>
                  <div className="mt-3 flex items-end gap-1.5 h-20">
                    {[40, 65, 50, 80, 70, 90, 75, 95].map((h, i) => (
                      <span
                        key={i}
                        style={{ height: `${h}%` }}
                        className={
                          'flex-1 rounded-t ' +
                          (i % 2 === 0
                            ? 'bg-brand-cyan/80'
                            : 'bg-brand-teal/70')
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DashCard({
  kicker,
  value,
  tone,
}: {
  kicker: string;
  value: string;
  tone?: 'cyan';
}) {
  return (
    <div
      className={
        'rounded-lg p-3 ' +
        (tone === 'cyan' ? 'bg-brand-cyan/20' : 'bg-white/[0.04]')
      }
    >
      <p className="text-[10px] uppercase tracking-wider text-white/55">
        {kicker}
      </p>
      <p className="mt-1 font-display text-base font-bold text-white">
        {value}
      </p>
    </div>
  );
}

function Cursos() {
  return (
    <section
      id="cursos"
      className="relative overflow-hidden bg-white py-24 sm:py-28"
    >
      <TrianglesAccent
        position="top-left"
        size={220}
        tone="cyan"
        density="soft"
        className="opacity-60"
      />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <p className="kicker text-brand-cyan">Capacitación</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            <HighlightMark tone="cyan">Formate</HighlightMark> con los
            mejores.
          </h2>
          <p className="mt-5 max-w-xl text-brand-muted">
            Coordinamos los cursos oficiales para inscripción y renovación
            de matrícula en PBA y CABA. Modalidad flexible, contenidos
            actualizados y enfoque práctico.
          </p>

          <ul className="mt-8 space-y-4 text-sm text-brand-ink/90">
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
              <span>
                <strong className="font-semibold">Curso de Formación RPAC</strong>{' '}
                · sincrónico · con clases en vivo y campus propio.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
              <span>
                <strong className="font-semibold">Actualización RPAC</strong> ·
                asincrónico con tutorías sincrónicas.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
              <span>
                <strong className="font-semibold">Actualización RPA · CABA</strong>{' '}
                · 100% asincrónico, a tu ritmo.
              </span>
            </li>
          </ul>
        </div>

        <div className="lg:col-span-2">
          {/* Foto del campus virtual */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 shadow-[0_24px_60px_-30px_rgba(0,93,105,0.35)]">
            <img
              src="/landing/cursos-capacitacion.jpg"
              alt="Campus virtual en vivo — clase sincrónica con docentes y alumnos"
              className="block h-auto w-full object-cover"
              loading="lazy"
            />
            <span className="absolute left-4 bottom-4 inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-brand-cyan shadow">
              Campus en vivo · sincrónico
            </span>
          </div>
          {/* Mini-card aliados académicos */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-zebra p-5">
            <p className="kicker text-brand-cyan">Aliados académicos</p>
            <p className="mt-2 text-sm text-brand-muted">
              Certificaciones oficiales en PBA con{' '}
              <strong>FundPlata</strong> y capacitaciones en CABA con{' '}
              <strong>Gestar</strong>.
            </p>
            <div className="mt-4 flex items-center gap-4">
              <img
                src="/landing/partners/fundplata.png"
                alt="FundPlata"
                className="h-10 w-auto opacity-90"
                loading="lazy"
              />
              <img
                src="/landing/partners/gestar.png"
                alt="Gestar Grupo Educativo"
                className="h-10 w-auto opacity-90"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Testimonios() {
  return (
    <section
      id="nosotros"
      className="relative border-y border-slate-100 bg-brand-zebra/40 py-24"
    >
      <div className="mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="kicker text-brand-cyan">Confían en nosotros</p>
          <h2 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Lo dicen quienes ya están adentro.
          </h2>
        </header>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {TESTIMONIOS.map((t) => (
            <figure
              key={t.nombre}
              className="rounded-2xl border border-slate-200 bg-white p-7 transition hover:-translate-y-0.5 hover:border-brand-cyan/50"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-6 w-6 text-brand-cyan"
              >
                <path d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2H4v2h1a4 4 0 0 0 4-4V7Zm10 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2h-1v2h1a4 4 0 0 0 4-4V7Z" />
              </svg>
              <blockquote className="mt-4 text-[15px] leading-relaxed text-brand-ink/85">
                {t.quote}
              </blockquote>
              <figcaption className="mt-6 border-t border-slate-100 pt-4">
                <p className="text-sm font-semibold text-brand-ink">
                  {t.nombre}
                </p>
                <p className="text-xs text-brand-muted">{t.rol}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function Partners() {
  return (
    <section className="bg-white py-20">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="kicker text-brand-cyan">Alianzas</p>
          <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Nos une el compromiso con tu gestión.
          </h2>
          <p className="mt-4 text-brand-muted">
            Un ecosistema de aliados para capacitación, certificaciones,
            asambleas virtuales, beneficios y respaldo profesional.
          </p>
        </header>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PARTNERS.map((p) => (
            <article
              key={p.nombre}
              className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-brand-cyan/40 hover:shadow-[0_18px_44px_-24px_rgba(0,158,202,0.4)]"
            >
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border border-slate-100 bg-brand-zebra p-2">
                <img
                  src={p.logo}
                  alt={p.nombre}
                  className="max-h-full max-w-full object-contain"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-brand-ink">
                  {p.nombre}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-brand-muted">
                  {p.descripcion}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-white py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-brand-cyan-pale/30 to-brand-teal/15 p-12 text-center sm:p-16">
          <TrianglesAccent
            position="top-right"
            size={280}
            tone="cyan"
            density="rich"
            className="opacity-50"
          />
          <TrianglesAccent
            position="bottom-left"
            size={200}
            tone="teal"
            density="soft"
            className="opacity-50"
          />
          <div className="relative">
            <p className="kicker text-brand-cyan">Empezá hoy</p>
            <h2 className="mx-auto mt-3 max-w-2xl font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Tu gestión, con el respaldo que{' '}
              <HighlightMark tone="cyan">se nota</HighlightMark>.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-brand-muted">
              Sumate a la comunidad de administradores que ya trabajan con
              Gestión Global.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to="/ingresar"
                className="group inline-flex items-center gap-2 rounded-full bg-brand-ink px-7 py-3.5 font-semibold text-white transition hover:bg-brand-cyan"
              >
                Ingresar a la plataforma
                <ArrowRight
                  size={17}
                  className="transition group-hover:translate-x-1"
                />
              </Link>
              <a
                href="mailto:contacto@gestionglobal.ar"
                className="rounded-full border border-slate-300 bg-white/70 px-6 py-3.5 text-sm font-medium text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
              >
                Escribinos a contacto@gestionglobal.ar
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
