// F6 (DGG-63) · Página pública de inscripción a webinars (ruta /webinars).
//
// Disposición condicional: si hay webinar publicado+vigente → identidad branded
// + el formulario vinculado/compartido embebido (FormularioRunner). Si no →
// la página de texto de espera. Es el destino del CTA de webinar de la landing.

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { BrandLoader } from '@/components/brand/BrandLoader';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { FormularioRunner } from '@/modules/public/components/FormularioRunner';
import { getFormularioPorSlug, type FormularioRow } from '@/services/api/formularios';
import { humanizeError } from '@/lib/errors';
import {
  useWebinarVigente,
  WebinarIdentidad,
  WebinarTextoEspera,
} from './WebinarInscripcionShared';

export function WebinarInscripcionPublicaPage() {
  const { data, loading } = useWebinarVigente();

  return (
    <div className="min-h-screen bg-white font-sans">
      <SiteNav darkHero />
      <main className="relative mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-30" />
        {loading ? (
          <div className="grid min-h-[50vh] place-items-center">
            <BrandLoader size={48} label="Buscando la próxima capacitación…" />
          </div>
        ) : data ? (
          <WebinarIdentidad w={data}>
            <WebinarFormInscripcion slug={data.formulario_slug} activo={data.formulario_activo} />
          </WebinarIdentidad>
        ) : (
          <div className="py-10">
            <WebinarTextoEspera />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

// Embebe el formulario de inscripción (por slug) debajo de la identidad.
function WebinarFormInscripcion({ slug, activo }: { slug: string | null; activo: boolean | null }) {
  const [form, setForm] = useState<FormularioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void getFormularioPorSlug(slug).then((res) => {
      setLoading(false);
      if (!res.ok) {
        setError(humanizeError(res.error));
        return;
      }
      setForm(res.data);
    });
  }, [slug]);

  if (!slug || activo === false) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        La inscripción no está disponible en este momento. Volvé a intentar más tarde.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid place-items-center py-8">
        <BrandLoader size={36} label="Cargando inscripción…" />
      </div>
    );
  }
  if (error || !form) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-brand-muted">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        {error ?? 'No pudimos cargar el formulario de inscripción.'}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="kicker mb-4 text-brand-cyan">Inscribite gratis</p>
      <FormularioRunner formulario={form} origenCanal="publico" />
    </div>
  );
}
