// ============================================================================
// CertCelebracionBanner · DGG-41 (2026-06-02) · José Luis
//
// Banner premium con la frase de José Luis. Se muestra cuando el alumno
// completa un curso y se emite su certificado (sea por cert auto del
// Campus o cierre manual del trámite).
//
// Comportamiento:
//   - Lista los certs sin "celebración vista" del alumno logueado.
//   - Muestra un banner cyan/dorado por cert con frase + CTA "Descargar".
//   - Click "Descargar certificado" → fetch cert + esquema + genera PDF +
//     marca la celebración como vista (banner se va).
//   - Click "Cerrar" (X) → marca la celebración como vista sin descargar.
//
// Se usa en:
//   - PortalHome (todos los certs pendientes).
//   - PortalGestionDetailPage (filtrado por curso del trámite — opcional).
//
// Frase fija acordada con JL: la del ¡FELICITACIONES! con la cita final
// "el éxito no se basa en encajar, sino en sobresalir".
// ============================================================================
import { useEffect, useState } from 'react';
import { GraduationCap, Download, X, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { BANNER_TONES, premiumCtaClass, premiumGhostCtaClass } from '@/modules/portal/components/premiumBanner';
import {
  listCertsCelebrarCliente,
  marcarCelebracionVista,
  marcarCertDescargadoAlumno,
  getCertCompleto,
  resolverEsquemaParaCert,
  certificadoParaPdf,
  type CertCelebrarItem,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';

interface Props {
  /**
   * Opcional. Si se pasa, filtra a un curso específico. En el portal
   * actual no hay vínculo estructural trámite↔curso, así que en
   * `PortalHome` se omite y el banner muestra TODOS los certs sin ver.
   */
  cursoId?: string;
}

export function CertCelebracionBanner({ cursoId }: Props) {
  const [items, setItems] = useState<CertCelebrarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const r = await listCertsCelebrarCliente();
    setLoading(false);
    if (!r.ok) {
      // No interrumpir al alumno con un toast — el banner es opcional.
      // Sólo lo logueamos para que aparezca en Salud del sistema si pasa.
      console.warn('[CertCelebracionBanner] no se pudo cargar:', r.error);
      return;
    }
    const filtered = cursoId ? r.data.filter((c) => c.curso_id === cursoId) : r.data;
    setItems(filtered);
  }

  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [cursoId]);

  async function descargar(item: CertCelebrarItem) {
    setBusyId(item.cert_id);
    try {
      const r = await getCertCompleto(item.cert_id);
      if (!r.ok) {
        toast.error('No pudimos abrir tu certificado', { description: humanizeError(r.error) });
        return;
      }
      const esquema = await resolverEsquemaParaCert(r.data);
      if (!esquema) {
        toast.error('No pudimos cargar el diseño del certificado');
        return;
      }
      await generateCertificadoPdf(certificadoParaPdf(r.data), esquema);
      // DGG-119 (§6 A#1): el banner es el PRIMER camino de descarga del alumno
      // — sin esta marca, gerencia vería "todavía no lo descargó" para siempre.
      void marcarCertDescargadoAlumno(item.cert_id);
      // Marcar como vista (el banner desaparece después de la descarga).
      await marcarCelebracionVista(item.cert_id);
      setItems((prev) => prev.filter((x) => x.cert_id !== item.cert_id));
      toast.success('¡Tu certificado se descargó!');
    } catch (e) {
      toast.error('No pudimos generar el PDF', { description: String((e as Error)?.message ?? e) });
    } finally {
      setBusyId(null);
    }
  }

  async function descartar(item: CertCelebrarItem) {
    setBusyId(item.cert_id);
    const r = await marcarCelebracionVista(item.cert_id);
    setBusyId(null);
    if (!r.ok) {
      toast.error('No pudimos cerrar el banner', { description: humanizeError(r.error) });
      return;
    }
    setItems((prev) => prev.filter((x) => x.cert_id !== item.cert_id));
  }

  if (loading || items.length === 0) return null;

  // DGG-254-b · tono 'logro' (verde laurel): logro de certificado, distinto del
  // verde 'exito' de la oportunidad/"matrícula vencida" (que Pablo dejó fijo).
  const T = BANNER_TONES.logro;
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <article
          key={it.cert_id}
          className={`relative overflow-hidden gg-chamfer bg-gradient-to-br p-4 text-white motion-safe:animate-fade-up sm:p-5 ${T.grad}`}
        >
          <TrianglesAccent position="top-right" size={140} tone={T.tri} density="rich" className="opacity-20" />
          {/* Botón Cerrar */}
          <button
            type="button"
            onClick={() => void descartar(it)}
            disabled={busyId === it.cert_id}
            aria-label="Cerrar"
            className="absolute right-2.5 top-2.5 rounded-md p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X size={16} />
          </button>

          <div className="relative flex flex-col gap-4 pr-7 sm:flex-row sm:items-center">
            {/* Icono ceremonial */}
            <div className={`grid h-14 w-14 shrink-0 place-items-center gg-chamfer-sm bg-white/10 ring-1 ring-white/25 ${T.accent}`}>
              <GraduationCap size={26} />
            </div>

            {/* Texto */}
            <div className="min-w-0 flex-1">
              <p className={`kicker ${T.accent}`}>Logro alcanzado</p>
              <h3 className="font-display text-lg uppercase leading-tight tracking-tight sm:text-xl">
                ¡FELICITACIONES! {it.origen === 'evento' ? 'Asististe a' : 'Terminaste el curso'}<br />
                <span className="text-emerald-200">{it.curso_titulo}</span>
              </h3>
              <blockquote className="mt-3 border-l-4 border-emerald-300 bg-white/10 px-4 py-2 text-sm italic leading-relaxed text-white/90">
                Sin lugar a dudas, tu esfuerzo valió la pena.<br />
                Recordá: <strong>el éxito no se basa en encajar, sino en sobresalir</strong>.
              </blockquote>
            </div>
          </div>

          {/* CTA */}
          <div className="relative mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => void descargar(it)}
              disabled={busyId === it.cert_id}
              className={premiumCtaClass('logro')}
            >
              {busyId === it.cert_id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              Descargar mi certificado
            </button>
            <a
              href={it.link_verificacion}
              target="_blank"
              rel="noopener noreferrer"
              className={premiumGhostCtaClass}
            >
              <GraduationCap size={13} /> Ver verificación pública
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
