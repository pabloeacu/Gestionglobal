import { Link } from 'react-router-dom';
import {
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
} from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { BrandMark } from '@/components/brand/BrandMark';
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
    cta?: { href: string; label: string };
  }>;
};

// Cada servicio incluye `cta` con la URL al formulario público o pantalla
// relacionada — slug debe existir en `public.formularios` (publico=true, activo=true).
// Ver mig 0035 + cargas de formularios. Si un servicio no tiene CTA, se renderiza
// igual pero sin botón "Solicitar".
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
        cta: { href: '/formulario/matriculacion-rpac', label: 'Iniciar inscripción' },
      },
      {
        icon: RefreshCcw,
        titulo: 'Renovación de matrícula',
        descripcion:
          'Gestión integral año a año, cubriendo las nuevas exigencias y con asesoría personalizada.',
        cta: { href: '/formulario/renovacion-rpac', label: 'Renovar ahora' },
      },
      {
        icon: FileCheck2,
        titulo: 'Certificado de acreditación',
        descripcion:
          'Tu matrícula vigente, lista para asambleas u organismos cuando la necesites.',
        cta: { href: '/formulario/certificado-rpac', label: 'Solicitar certificado' },
      },
      {
        icon: ClipboardList,
        titulo: 'Declaraciones juradas anuales',
        descripcion:
          'Plataforma digital guiada paso a paso: orden, respaldo y cero olvidos.',
        cta: { href: '/formulario/ddjj-anual', label: 'Presentar DDJJ' },
      },
    ],
  },
  {
    kicker: 'Formación · RPAC y RPA',
    titulo: 'Capacitación que suma reputación',
    items: [
      {
        icon: GraduationCap,
        titulo: 'Curso de formación RPAC (Pcia. de Bs. As.)',
        descripcion:
          'Curso obligatorio de inscripción · sincrónico · con docentes expertos y campus propio.',
        cta: { href: '/formulario/curso-formacion', label: 'Inscribirme al curso' },
      },
      {
        icon: BookOpen,
        titulo: 'Actualización RPAC (Pcia. de Bs. As.)',
        descripcion:
          'Para renovación: clases asincrónicas con tutorías sincrónicas, pensadas para la práctica real.',
        cta: { href: '/formulario/curso-actualizacion', label: 'Inscribirme' },
      },
      {
        icon: BookOpen,
        titulo: 'Actualización RPA · CABA',
        descripcion:
          '100% asincrónico · contenido actualizado · a tu ritmo y según tu disponibilidad.',
        cta: { href: '/formulario/curso-actualizacion-caba', label: 'Inscribirme' },
      },
      {
        icon: PlayCircle,
        titulo: 'Capacitaciones y encuentros',
        descripcion:
          'Capacitaciones, charlas y encuentros presenciales con especialistas — online y presencial, para una comunidad que aprende y crece.',
        cta: { href: '/eventos', label: 'Ver próximo encuentro' },
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
        cta: { href: '/plataforma', label: 'Conocer la plataforma' },
      },
      {
        icon: Scale,
        titulo: 'Asesoría jurídica',
        descripcion:
          'Equipo especializado en propiedad horizontal. Respuestas claras, con fundamento y aplicabilidad.',
        cta: { href: '/formulario/consultoria-juridica', label: 'Consultar ahora' },
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
    logo: '/landing/partners/cameac.webp',
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
        <div className="flex justify-center animate-fade-up">
          <BrandMark variant="light" orientation="vertical" size={180} withSlogan />
        </div>

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

        {/* Cambios usuario 2026-06-02: solo queda el CTA hacia "Servicios".
            Los 2 CTAs hero/finalCTA hacia /plataforma fueron removidos para
            no duplicar el acceso del card "Plataforma de gestión" + sección
            "Tu gestión en una sola pantalla", que ya cubren ese destino. */}
        <div
          className="mt-10 flex animate-fade-up items-center justify-center"
          style={{ animationDelay: '240ms' }}
        >
          <a
            href="#servicios"
            className="rounded-full bg-brand-ink px-7 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(18,34,48,0.5)] transition hover:bg-brand-cyan hover:shadow-[0_14px_40px_-12px_rgba(0,158,202,0.55)]"
          >
            Conocer los servicios
          </a>
        </div>

      </div>
    </section>
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

// Isologo de la entidad aliada que dicta cada curso (a la derecha del ícono).
// FUNDPLATA (RPAC · PBA) dicta formación + actualización RPAC; GESTAR (RPA · CABA)
// dicta la actualización RPA-CABA. Refuerza la dependencia curso↔alianza.
const ALIANZA_ISOLOGO: Record<string, { src: string; alt: string }> = {
  'Curso de formación RPAC (Pcia. de Bs. As.)': { src: '/landing/partners/fundplata-iso.png', alt: 'FundPlata' },
  'Actualización RPAC (Pcia. de Bs. As.)': { src: '/landing/partners/fundplata-iso.png', alt: 'FundPlata' },
  'Actualización RPA · CABA': { src: '/landing/partners/gestar-iso.png', alt: 'Gestar' },
};

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
                {grupo.items.map(({ icon: Icon, titulo, descripcion, cta }) => {
                  const isologo = ALIANZA_ISOLOGO[titulo];
                  const card = (
                    <>
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan transition group-hover:bg-brand-cyan group-hover:text-white">
                          <Icon size={20} />
                        </span>
                        {isologo && (
                          <img
                            src={isologo.src}
                            alt={isologo.alt}
                            className="h-10 w-auto shrink-0 object-contain"
                            loading="lazy"
                          />
                        )}
                      </div>
                      <h4 className="mt-5 font-display text-lg font-bold">
                        {titulo}
                      </h4>
                      <p className="mt-2 text-sm leading-relaxed text-brand-muted">
                        {descripcion}
                      </p>
                      {cta && (
                        <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-cyan transition group-hover:gap-2">
                          <span>{cta.label}</span>
                          <ArrowUpRight size={14} />
                        </p>
                      )}
                    </>
                  );
                  // Card clickeable end-to-end cuando tiene CTA. Si es ruta interna
                  // usa Link de React Router; si fuese externa, <a target=_blank>.
                  if (cta) {
                    return (
                      <Link
                        key={titulo}
                        to={cta.href}
                        className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.45)]"
                      >
                        {card}
                      </Link>
                    );
                  }
                  return (
                    <article
                      key={titulo}
                      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-cyan/50 hover:shadow-[0_18px_40px_-24px_rgba(0,158,202,0.45)]"
                    >
                      {card}
                    </article>
                  );
                })}
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
            to="/plataforma"
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-brand-ink transition hover:bg-brand-cyan hover:text-white"
          >
            Probar la plataforma <ArrowUpRight size={16} />
          </Link>
        </div>

        {/* ilustración institucional · edificios SVG */}
        <div className="relative">
          <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-brand-cyan/30 to-brand-teal/30 blur-2xl" />
          <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white/[0.04] p-2 backdrop-blur">
            <EdificiosIlustracion />
          </div>
        </div>
      </div>
    </section>
  );
}

// Ilustración SVG · skyline de edificios con paleta cyan/teal de marca.
// Reemplaza el mock dashboard fake. On-brand · vectorial · sin archivo.
function EdificiosIlustracion() {
  // Cada edificio: { x, w, h, gradient }
  const BUILDINGS = [
    { x: 20,  w: 70,  h: 200, fill: 'url(#bldA)' },
    { x: 95,  w: 60,  h: 260, fill: 'url(#bldB)' },
    { x: 160, w: 90,  h: 340, fill: 'url(#bldC)' },
    { x: 255, w: 110, h: 400, fill: 'url(#bldD)' }, // central · más alto
    { x: 370, w: 65,  h: 290, fill: 'url(#bldB)' },
    { x: 440, w: 80,  h: 350, fill: 'url(#bldC)' },
    { x: 525, w: 55,  h: 220, fill: 'url(#bldA)' },
  ];
  // Ventanas: grid pequeñas en cada edificio
  function Windows({ x, w, h }: { x: number; w: number; h: number }) {
    const cols = Math.max(2, Math.floor(w / 14));
    const rows = Math.max(3, Math.floor((h - 40) / 16));
    const cellW = (w - 12) / cols;
    const cellH = 8;
    const gapY = 14;
    return (
      <g>
        {Array.from({ length: rows }).map((_, r) =>
          Array.from({ length: cols }).map((_, c) => {
            const cx = x + 6 + c * cellW;
            const cy = 460 - (r * gapY) - 16;
            // dejar algunas ventanas off (apagadas) para realismo
            const lit = (r + c) % 5 !== 0;
            if (cy < 460 - h + 18) return null;
            return (
              <rect
                key={`${r}-${c}`}
                x={cx}
                y={cy}
                width={cellW - 4}
                height={cellH}
                fill={lit ? 'rgba(186,231,247,0.7)' : 'rgba(186,231,247,0.18)'}
                rx={1}
              />
            );
          }),
        )}
      </g>
    );
  }

  return (
    <svg
      viewBox="0 0 620 460"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Skyline de edificios — gestión profesional de consorcios"
      className="block h-auto w-full rounded-xl"
    >
      <defs>
        {/* fondo cielo · gradient sutil del color brand-ink hacia cyan oscuro */}
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a2733" />
          <stop offset="60%" stopColor="#0c3845" />
          <stop offset="100%" stopColor="#0d4654" />
        </linearGradient>
        {/* gradientes edificios */}
        <linearGradient id="bldA" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0891b2" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="bldB" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0e7490" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="bldC" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5f3fc" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#155e75" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="bldD" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cffafe" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#0d4854" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* cielo */}
      <rect x="0" y="0" width="620" height="460" fill="url(#sky)" />

      {/* triángulos sutiles en el cielo (consistencia con TrianglesAccent) */}
      <g opacity="0.55">
        <polygon points="60,40 110,40 85,90" fill="#22d3ee" opacity="0.18" />
        <polygon points="540,90 580,90 560,135" fill="#67e8f9" opacity="0.22" />
        <polygon points="370,50 410,50 390,95" fill="#a5f3fc" opacity="0.12" />
      </g>

      {/* triángulos decorativos esquina inferior izquierda — marca */}
      <g opacity="0.7">
        <polygon points="0,460 70,460 0,395" fill="#22d3ee" opacity="0.35" />
        <polygon points="20,460 60,460 20,415" fill="#67e8f9" opacity="0.5" />
      </g>

      {/* edificios */}
      {BUILDINGS.map((b, i) => (
        <g key={i}>
          <rect
            x={b.x}
            y={460 - b.h}
            width={b.w}
            height={b.h}
            fill={b.fill}
          />
          {/* franja superior translúcida · línea de techo */}
          <rect
            x={b.x}
            y={460 - b.h}
            width={b.w}
            height="4"
            fill="rgba(255,255,255,0.18)"
          />
          <Windows x={b.x} w={b.w} h={b.h} />
        </g>
      ))}

      {/* línea de horizonte / vereda */}
      <line x1="0" y1="460" x2="620" y2="460" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />

      {/* triángulo decorativo grande esquina superior derecha */}
      <g opacity="0.4">
        <polygon points="540,0 620,0 620,90" fill="#22d3ee" opacity="0.18" />
        <polygon points="568,0 620,0 620,55" fill="#67e8f9" opacity="0.28" />
      </g>
    </svg>
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
                <strong className="font-semibold">Curso de Formación RPAC (Pcia. de Bs. As.)</strong>{' '}
                · sincrónico · con clases en vivo y campus propio.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-cyan" />
              <span>
                <strong className="font-semibold">Actualización RPAC (Pcia. de Bs. As.)</strong> ·
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

          {/* Highlight · trayectoria educativa */}
          <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-brand-cyan/25 bg-gradient-to-br from-brand-cyan-pale/40 via-white to-brand-teal/10 p-6 sm:flex-row sm:items-center">
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="font-display text-5xl font-extrabold leading-none text-brand-cyan">
                +400
              </span>
              <span className="text-xs uppercase tracking-wider text-brand-muted">
                alumnos
              </span>
            </div>
            <p className="font-display text-lg font-bold leading-tight text-brand-ink sm:text-xl">
              <HighlightMark tone="cyan">
                Formando una generación
              </HighlightMark>{' '}
              de administradores de excelencia.
            </p>
          </div>
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
            {/* Cambios usuario 2026-06-02: el CTA gigante "Conocer la plataforma"
                de este bloque también se removió. Queda solo el contacto por
                mail centrado. */}
            <div className="mt-8 flex items-center justify-center">
              <a
                href="mailto:contacto@gestionglobal.ar"
                className="rounded-full border border-slate-300 bg-white/70 px-7 py-3.5 text-sm font-semibold text-brand-ink transition hover:border-brand-cyan hover:text-brand-cyan"
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
