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
import {
  listCertsCelebrarCliente,
  marcarCelebracionVista,
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

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <article
          key={it.cert_id}
          className="relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 via-white to-cyan-50 p-5 shadow-md sm:p-6 motion-safe:animate-fade-up"
        >
          {/* Botón Cerrar */}
          <button
            type="button"
            onClick={() => void descartar(it)}
            disabled={busyId === it.cert_id}
            aria-label="Cerrar"
            className="absolute right-3 top-3 rounded-full p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700 disabled:opacity-40"
          >
            <X size={16} />
          </button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Icono ceremonial */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-3xl text-white shadow-lg shadow-amber-200">
              🎓
            </div>

            {/* Texto */}
            <div className="min-w-0 flex-1">
              <p className="kicker text-amber-600">Logro alcanzado</p>
              <h3 className="font-display text-xl font-bold text-brand-ink sm:text-2xl">
                ¡FELICITACIONES! Terminaste el curso<br />
                <span className="text-brand-cyan">{it.curso_titulo}</span>
              </h3>
              <blockquote className="mt-3 border-l-4 border-amber-400 bg-amber-50/70 px-4 py-2 text-sm italic leading-relaxed text-amber-900 sm:text-base">
                Sin lugar a dudas, tu esfuerzo valió la pena.<br />
                Recordá: <strong>el éxito no se basa en encajar, sino en sobresalir</strong>.
              </blockquote>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => void descargar(it)}
              disabled={busyId === it.cert_id}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200 transition hover:from-amber-600 hover:to-amber-700 disabled:opacity-60"
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
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-medium text-brand-muted transition hover:bg-slate-50"
            >
              <GraduationCap size={13} /> Ver verificación pública
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
