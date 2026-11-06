// DGG-244 F2c · Digest editorial de la EDICIÓN actual en la web.
// Las 4 secciones del molde de Pablo: intro (hilo conductor) + resumen ejecutivo
// (scan rápido) + tendencias por materia + editorial/insight. Se pisa por edición.

import { ClipboardList, BarChart3, Lightbulb } from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import type { LexphEdicionActual } from '@/services/api/lexphPublic';

// Rotación de colores de marca para las materias de "Tendencias".
const MATERIA_COLORS = ['#009ECA', '#159AA6', '#2E6FB0', '#C46A10'];
const ORANGE = '#C46A10';

function DigestHead({ kicker, titulo, icon }: { kicker: string; titulo: string; icon: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p
        className="font-gg-display flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em]"
        style={{ color: ORANGE }}
      >
        {icon} {kicker}
      </p>
      <h2 className="mt-1.5 font-display text-2xl font-extrabold tracking-tight text-brand-cyan sm:text-[1.7rem]">
        {titulo}
      </h2>
    </div>
  );
}

export function LexphDigest({ edicion }: { edicion: LexphEdicionActual }) {
  const intro = edicion.intro?.trim();
  const resumen = Array.isArray(edicion.resumen) ? edicion.resumen : [];
  const tendencias = Array.isArray(edicion.tendencias) ? edicion.tendencias : [];
  const editorial = edicion.editorial ?? {};
  const hasEditorial = Boolean(editorial.titulo || editorial.cuerpo);

  if (!intro && resumen.length === 0 && tendencias.length === 0 && !hasEditorial) return null;

  return (
    <section className="border-t border-slate-200 bg-slate-50/50">
      <div className="mx-auto max-w-4xl px-6 py-14 sm:py-16">
        {/* Intro / hilo conductor de la edición */}
        {intro && (
          <div className="lexph-chamfer-sm mb-14 border-l-4 border-brand-cyan bg-white p-6 shadow-sm sm:p-7">
            <p className="lexph-serif text-xl leading-[1.5] text-brand-ink/90 sm:text-[1.4rem]">{intro}</p>
          </div>
        )}

        {/* Resumen ejecutivo (Scan rápido) */}
        {resumen.length > 0 && (
          <div className="mb-16">
            <DigestHead kicker="Scan rápido" titulo="Resumen ejecutivo" icon={<ClipboardList size={15} />} />
            <div className="space-y-3">
              {resumen.map((b, i) => (
                <div
                  key={i}
                  className="lexph-chamfer-sm flex gap-3.5 border border-slate-200 bg-white p-5"
                >
                  <span className="mt-0.5 shrink-0 font-bold" style={{ color: ORANGE }} aria-hidden>
                    ▸
                  </span>
                  <p className="text-[15px] leading-relaxed text-brand-ink/90">
                    <strong className="text-brand-ink">{b.titulo}:</strong> {b.texto}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tendencias por materia */}
        {tendencias.length > 0 && (
          <div className="mb-16">
            <DigestHead kicker="Análisis temático" titulo="Tendencias por materia" icon={<BarChart3 size={15} />} />
            <div className="space-y-7">
              {tendencias.map((t, i) => (
                <div key={i}>
                  <span
                    className="lexph-chamfer-sm inline-block font-gg-display text-[11px] font-semibold uppercase tracking-[0.08em] text-white px-3 py-1.5"
                    style={{ backgroundColor: MATERIA_COLORS[i % MATERIA_COLORS.length] }}
                  >
                    {t.materia}
                  </span>
                  <p className="mt-3 text-[15px] leading-relaxed text-brand-ink/85">{t.texto}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Editorial / Insight — bloque destacado */}
        {hasEditorial && (
          <div
            className="lexph-chamfer relative overflow-hidden px-8 py-10 text-white sm:px-10"
            style={{ background: 'linear-gradient(130deg, #B45F0C 0%, #D9810F 55%, #E8920F 100%)' }}
          >
            <TrianglesAccent position="bottom-right" tone="cyan" density="soft" size={200} className="opacity-10" />
            <div className="relative">
              {editorial.kicker && (
                <p className="font-gg-display flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-white/90">
                  <Lightbulb size={14} /> {editorial.kicker}
                </p>
              )}
              {editorial.titulo && (
                <h2 className="mt-2.5 font-display text-2xl font-bold leading-tight sm:text-[1.7rem]">
                  {editorial.titulo}
                </h2>
              )}
              {editorial.cuerpo && (
                <div className="mt-4 space-y-3.5 text-[15.5px] leading-relaxed text-white/90">
                  {editorial.cuerpo.split('\n\n').map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
