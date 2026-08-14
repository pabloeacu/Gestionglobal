// ============================================================================
// MisCertificadosSection · DGG-121 (2026-07-29) · pedido Pablo
//
// Sección PERMANENTE de certificados de curso del alumno en "Mis cursos".
// Cierra el gap detectado en la consulta de cierre de trámites: al vencer la
// ventana de gracia (DGG-82) el curso desaparece del campus y el bloqueo de
// acceso tapaba también el botón del certificado — el alumno perdía el camino
// self-service para re-descargar su diploma (la RLS de `certificados` siempre
// lo permitió; el bloqueo era 100% de UI).
//
// Diseño:
//   - Lista via listMisCertificados() (RLS por alumno_profile_id; solo certs
//     de curso no revocados). Independiente del estado de la matrícula.
//   - Título/nota/fecha salen del payload_snapshot congelado al emitir
//     (certificadoParaPdf) → cero joins a `cursos` (que puede estar oculto).
//   - Descarga: mismo pipeline probado del CertCelebracionBanner
//     (resolverEsquemaParaCert → generateCertificadoPdf → marca DGG-119).
//   - Si el alumno no tiene certificados, la sección no se renderiza.
// ============================================================================
import { useEffect, useState } from 'react';
import { Award, Download, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  fmtFecha,
  listMisCertificados,
  marcarCertDescargadoAlumno,
  resolverEsquemaParaCert,
  certificadoParaPdf,
  type CertificadoRow,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';

export function MisCertificadosSection() {
  const [certs, setCerts] = useState<CertificadoRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await listMisCertificados();
      if (!r.ok) {
        // Sección opcional: no interrumpir al alumno con un toast.
        console.warn('[MisCertificadosSection] no se pudo cargar:', r.error);
        return;
      }
      setCerts(r.data);
    })();
  }, []);

  async function descargar(c: CertificadoRow) {
    setBusyId(c.id);
    try {
      const esquema = await resolverEsquemaParaCert(c);
      if (!esquema) {
        toast.error('No pudimos cargar el diseño del certificado', {
          description: 'Escribile a tu administrador y te lo enviamos por email.',
        });
        return;
      }
      await generateCertificadoPdf(certificadoParaPdf(c), esquema);
      void marcarCertDescargadoAlumno(c.id);
      toast.success('¡Tu certificado se descargó!');
    } catch (e) {
      toast.error('No pudimos generar el PDF', {
        description: String((e as Error)?.message ?? e),
      });
    } finally {
      setBusyId(null);
    }
  }

  if (certs.length === 0) return null;

  return (
    <section className="card-premium relative overflow-hidden p-5">
      <header className="mb-4"><span data-gg-secico className="hidden" aria-hidden><Award size={21} strokeWidth={1.7} /></span>
        <p className="kicker text-amber-600">Tus logros</p>
        <h2 className="font-display text-xl font-bold text-brand-ink">
          Mis certificados
        </h2>
        <p className="mt-1 text-sm text-brand-muted">
          Tus certificados quedan disponibles acá para siempre, incluso cuando
          termina el acceso al curso.
        </p>
      </header>
      <ul className="space-y-2">
        {certs.map((c) => {
          const cert = certificadoParaPdf(c);
          return (
            <li
              key={c.id}
              className="flex flex-col gap-3 rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50/60 to-white p-4 sm:flex-row sm:items-center"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/90 text-white shadow-sm">
                <Award size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold text-brand-ink">
                  {cert.curso_titulo || 'Certificado de curso'}
                </h3>
                <p className="mt-0.5 text-xs text-brand-muted">
                  Emitido el {fmtFecha(cert.emitido_at)} · {cert.codigo}
                  {cert.nota_examen !== null && ` · Nota ${cert.nota_examen}/100`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void descargar(c)}
                  disabled={busyId === c.id}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-amber-600 hover:to-amber-700 disabled:opacity-60"
                >
                  {busyId === c.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  Descargar PDF
                </button>
                <a
                  href={`/verificar/${cert.codigo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-brand-muted transition hover:bg-slate-50"
                  title="Verificación pública de autenticidad"
                >
                  <ExternalLink size={12} /> Verificar
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
