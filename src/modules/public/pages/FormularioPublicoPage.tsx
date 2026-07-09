import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link, Navigate } from 'react-router-dom';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { FormularioRunner } from '@/modules/public/components/FormularioRunner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFormularioPorSlug,
  fetchClientePerfilDatosFormulario,
  type FormularioRow,
} from '@/services/api/formularios';
import { humanizeError } from '@/lib/errors';

// DGG-80 · Dependencia curso↔alianza: cada formulario de curso muestra el logo
// COMPLETO de la entidad habilitante + un subtítulo explicando la alianza
// académica. FUNDPLATA (RPAC) dicta formación + actualización RPAC; GESTAR (RPA)
// dicta la actualización RPA-CABA. Se resuelve por slug (sin columna nueva).
const subtituloAlianza = (entidad: string, registro: string) =>
  `${entidad} es una entidad habilitada para el dictado de cursos por el ${registro} que, en una alianza académica, ha encomendado la coordinación académica a Gestión Global para el desarrollo de las asignaturas con el mayor rigor profesional y estándares de excelencia en la propiedad horizontal.`;

const FORM_ENTIDAD: Record<
  string,
  { logo: string; nombre: string; subtitulo: string }
> = {
  'curso-formacion': {
    logo: '/landing/partners/fundplata.png',
    nombre: 'FundPlata',
    subtitulo: subtituloAlianza('FUNDPLATA', 'RPAC'),
  },
  'curso-actualizacion': {
    logo: '/landing/partners/fundplata.png',
    nombre: 'FundPlata',
    subtitulo: subtituloAlianza('FUNDPLATA', 'RPAC'),
  },
  'curso-actualizacion-caba': {
    logo: '/landing/partners/gestar.png',
    nombre: 'Gestar Educativa',
    subtitulo: subtituloAlianza('GESTAR EDUCATIVA', 'RPA'),
  },
};

export function FormularioPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const desdePortal = params.get('origen') === 'portal';
  const { user } = useAuth();
  const [formulario, setFormulario] = useState<FormularioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prefillValues, setPrefillValues] = useState<Record<string, unknown> | undefined>(undefined);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    void getFormularioPorSlug(slug).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(humanizeError(res.error));
        return;
      }
      setFormulario(res.data);
    });
  }, [slug]);

  // Si el cliente está logueado y entró desde el portal, traemos los datos
  // de su perfil para pre-poblar los campos del formulario que coincidan
  // (matching case-insensitive por nombre: 'cuit', 'email', 'dni', etc.).
  useEffect(() => {
    if (!user || !desdePortal) {
      setPrefillValues(undefined);
      return;
    }
    void fetchClientePerfilDatosFormulario().then((data) => {
      setPrefillValues(data);
    });
  }, [user, desdePortal]);

  // Entidad aliada del curso (logo + subtítulo de alianza), resuelta por slug.
  const entidad = formulario ? FORM_ENTIDAD[formulario.slug] : undefined;

  // Eventos (Pablo · Q2): el formulario compartido de eventos NO se muestra
  // "crudo". Su URL (/formulario/eventos) redirige a /eventos, que muestra la
  // identidad del evento vigente + el mismo formulario embebido (o el texto de
  // espera si no hay evento vigente). Así las personas entran siempre a la misma
  // dirección y ven el evento al que va direccionado el formulario.
  if (!loading && formulario?.categoria === 'evento') {
    return <Navigate to="/eventos" replace />;
  }

  return (
    <div className="min-h-screen bg-white font-sans">
      <SiteNav darkHero />

      {loading ? (
        <div className="grid min-h-[60vh] place-items-center">
          <BrandLoader size={48} label="Cargando formulario…" />
        </div>
      ) : error || !formulario ? (
        <div className="mx-auto max-w-md space-y-3 px-6 py-24 text-center">
          <AlertCircle className="mx-auto text-brand-muted" />
          <h1 className="font-display text-2xl font-bold text-brand-ink">
            Formulario no encontrado
          </h1>
          <p className="text-sm text-brand-muted">
            {error ?? 'Es posible que el enlace haya expirado o que el formulario ya no esté disponible.'}
          </p>
          <Link
            to="/"
            className="inline-flex items-center text-sm font-medium text-brand-cyan hover:underline"
          >
            ← Volver al inicio
          </Link>
        </div>
      ) : (
        <>
          <header className="relative overflow-hidden bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal py-16 text-white">
            <TrianglesAccent
              position="top-right"
              size={220}
              tone="cyan"
              density="rich"
              className="opacity-60"
            />
            <TrianglesAccent
              position="bottom-left"
              size={180}
              tone="teal"
              density="soft"
              className="opacity-40"
            />
            <div className="relative mx-auto max-w-3xl px-6">
              {entidad && (
                <div className="mb-5 inline-flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-md ring-1 ring-black/5">
                  <img
                    src={entidad.logo}
                    alt={entidad.nombre}
                    className="h-9 w-auto object-contain sm:h-10"
                  />
                </div>
              )}
              <p className="kicker text-white/80">{categoriaLabel(formulario.categoria)}</p>
              <h1 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">
                {formulario.titulo}
              </h1>
              {formulario.descripcion && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">
                  {formulario.descripcion}
                </p>
              )}
              {entidad && (
                <p className="mt-4 max-w-2xl border-l-2 border-white/40 pl-3 text-xs leading-relaxed text-white/80 sm:text-sm">
                  {entidad.subtitulo}
                </p>
              )}
            </div>
          </header>

          {/* Banner del cliente logueado: AFUERA del main para que NO quede
              tapado por el offset negativo del main. Sólo se muestra si entró
              desde el portal y hay sesión. */}
          {desdePortal && user && (
            <div className="mx-auto mt-6 max-w-3xl px-6">
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm">
                <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <div className="min-w-0">
                  <p className="font-semibold">
                    Esta solicitud quedará vinculada a tu cuenta
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/90">
                    Hola <strong>{user.fullName || user.email}</strong>. Vamos a pre-rellenar los campos que coincidan con tu perfil — solo completá lo que falte específico de esta solicitud.
                  </p>
                </div>
              </div>
            </div>
          )}

          <main className="mx-auto mt-6 max-w-3xl px-6 pb-16 sm:pb-24">
            {/* AJL #7: el WhatsAppFloatingButton ahora vive dentro del runner */}
            <FormularioRunner
              formulario={formulario}
              prefillValues={prefillValues}
              origenCanal={desdePortal && user ? 'cliente' : 'publico'}
            />

            {formulario.textos_legales && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-brand-zebra/40 p-4 text-xs leading-relaxed text-brand-muted">
                <p className="font-semibold uppercase tracking-wider text-brand-cyan">
                  Condiciones
                </p>
                <p className="mt-1 whitespace-pre-wrap">{formulario.textos_legales}</p>
              </div>
            )}
          </main>
        </>
      )}

      <SiteFooter />
    </div>
  );
}

function categoriaLabel(c: string): string {
  const map: Record<string, string> = {
    captacion: 'Captación',
    tramite: 'Trámite',
    servicio: 'Servicio',
    curso: 'Curso',
    evento: 'Evento',
    consulta: 'Consulta',
  };
  return map[c] ?? c;
}
