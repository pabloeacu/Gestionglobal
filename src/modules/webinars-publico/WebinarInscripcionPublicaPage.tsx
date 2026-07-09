// F6 (DGG-63) · Página pública de inscripción a eventos (ruta /eventos; /webinars
// queda como alias legacy).
//
// Disposición condicional: si hay evento publicado+vigente → identidad branded
// + el formulario vinculado/compartido embebido (FormularioRunner) con el flyer
// vertical al costado (si lo hay). Si no → la página de texto de espera. Es el
// destino del CTA de eventos de la landing.

import { useEffect, useState } from 'react';
import { AlertCircle, MapPin, Globe } from 'lucide-react';
import { cn } from '@/lib/cn';
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
      <SiteNav />
      <main className="relative mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <TrianglesAccent position="top-right" size={200} tone="cyan" density="soft" className="opacity-30" />
        {loading ? (
          <div className="grid min-h-[50vh] place-items-center">
            <BrandLoader size={48} label="Buscando la próxima capacitación…" />
          </div>
        ) : data ? (
          <WebinarIdentidad w={data}>
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <div className="min-w-0 flex-1">
                <WebinarFormInscripcion
                  slug={data.formulario_slug}
                  activo={data.formulario_activo}
                  modalidad={data.modalidad}
                />
              </div>
              {data.flyer_url && (
                <aside className="md:w-60 md:shrink-0">
                  <img
                    src={data.flyer_url}
                    alt={`Flyer de ${data.titulo}`}
                    className="mx-auto w-full max-w-[16rem] rounded-2xl border border-slate-200 shadow-[0_18px_44px_-24px_rgba(0,93,105,0.4)]"
                    loading="lazy"
                  />
                </aside>
              )}
            </div>
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
function WebinarFormInscripcion({
  slug,
  activo,
  modalidad,
}: {
  slug: string | null;
  activo: boolean | null;
  modalidad: 'online' | 'presencial' | 'mixto';
}) {
  const [form, setForm] = useState<FormularioRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Eventos mixtos: el inscripto elige cómo asiste. Default 'online'.
  const [pref, setPref] = useState<'online' | 'presencial'>('online');

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
      {modalidad === 'mixto' && (
        <div className="mb-5">
          <p className="mb-2 text-sm font-semibold text-brand-ink">¿Cómo vas a asistir?</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { val: 'presencial' as const, icon: MapPin, label: 'Presencial', desc: 'En el lugar' },
              { val: 'online' as const, icon: Globe, label: 'Online', desc: 'Por Zoom / YouTube' },
            ]).map((opt) => {
              const active = pref === opt.val;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setPref(opt.val)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition',
                    active
                      ? 'border-brand-cyan bg-brand-cyan/5 text-brand-ink'
                      : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40',
                  )}
                  aria-pressed={active}
                >
                  <Icon size={18} className={active ? 'text-brand-cyan' : 'text-slate-400'} />
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-xs">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <FormularioRunner
        formulario={form}
        origenCanal="publico"
        extraDatos={modalidad === 'mixto' ? { modalidad_preferida: pref } : undefined}
      />
    </div>
  );
}
