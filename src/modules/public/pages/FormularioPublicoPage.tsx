import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { FormularioRunner } from '@/modules/public/components/FormularioRunner';
import { useAuth } from '@/contexts/AuthContext';
import {
  getFormularioPorSlug,
  type FormularioRow,
} from '@/services/api/formularios';

export function FormularioPublicoPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const desdePortal = params.get('origen') === 'portal';
  const { user } = useAuth();
  const [formulario, setFormulario] = useState<FormularioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    void getFormularioPorSlug(slug).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setFormulario(res.data);
    });
  }, [slug]);

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
              <p className="kicker text-white/80">{categoriaLabel(formulario.categoria)}</p>
              <h1 className="mt-2 font-display text-3xl font-bold leading-tight sm:text-4xl">
                {formulario.titulo}
              </h1>
              {formulario.descripcion && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">
                  {formulario.descripcion}
                </p>
              )}
            </div>
          </header>

          <main className="mx-auto -mt-8 max-w-3xl px-6 pb-16 sm:pb-24">
            {desdePortal && user && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm">
                <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={18} />
                <div className="min-w-0">
                  <p className="font-semibold">
                    Esta solicitud quedará vinculada a tu cuenta
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/90">
                    Hola <strong>{user.fullName || user.email}</strong>. Tus datos personales ya los tenemos registrados — solo completá lo que el formulario te pida específicamente. No vas a tener que volver a cargar tu nombre, email o DNI.
                  </p>
                </div>
              </div>
            )}
            <FormularioRunner formulario={formulario} />

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
