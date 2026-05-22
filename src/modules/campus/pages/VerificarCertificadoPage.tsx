import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Award,
  GraduationCap,
  Calendar,
  User,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  verificarCertificado,
  type VerificacionResultado,
} from '@/services/api/campus';

// Página PÚBLICA sin login (DGG-10 · /verificar/:codigo). Confirma la
// autenticidad de un certificado emitido por el campus. Mobile-first, branding
// Gestión Global. Llama a la RPC `verificar_certificado` (SECURITY DEFINER,
// ejecutable por anon) que sólo devuelve datos NO sensibles.
export function VerificarCertificadoPage() {
  const { codigo = '' } = useParams<{ codigo: string }>();
  const [loading, setLoading] = useState(true);
  const [res, setRes] = useState<VerificacionResultado | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const r = await verificarCertificado(codigo);
      if (cancelled) return;
      setLoading(false);
      setRes(r.ok ? r.data : { valido: false, estado: 'no_encontrado' });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [codigo]);

  const valido = res?.estado === 'valido';
  const revocado = res?.estado === 'revocado';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-cyan via-brand-cyan to-brand-teal py-10 text-white shadow">
        <TrianglesAccent
          position="top-right"
          size={260}
          tone="cyan"
          density="rich"
          className="opacity-50"
        />
        <TrianglesAccent
          position="bottom-left"
          size={180}
          tone="teal"
          density="soft"
          className="opacity-40"
        />
        <div className="relative mx-auto max-w-2xl px-6">
          <div className="flex items-center gap-2 text-sm text-white/85">
            <ShieldCheck size={16} /> Verificación de certificados · Gestión Global
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            Certificado del Campus
          </h1>
          <p className="mt-2 text-sm text-white/85">
            Constatá la autenticidad de un certificado emitido por Gestión Global
            / FUNDPLATA.
          </p>
        </div>
      </header>

      {/* Contenido */}
      <main className="mx-auto max-w-2xl px-6 py-8">
        {loading ? (
          <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white p-12 text-brand-muted shadow-sm">
            <Loader2 className="mb-2 animate-spin" />
            <p className="text-sm">Verificando el certificado…</p>
          </div>
        ) : valido ? (
          <CertificadoValido res={res!} />
        ) : revocado ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert size={18} /> Certificado revocado
            </div>
            <p className="mt-2 text-sm">
              Este certificado existió pero fue <strong>revocado</strong> por
              Gestión Global y ya no es válido.
            </p>
            {res?.codigo && (
              <p className="mt-2 font-mono text-xs text-amber-700">
                Código: {res.codigo}
              </p>
            )}
            {res?.revocado_motivo && (
              <p className="mt-1 text-xs text-amber-700/80">
                Motivo: {res.revocado_motivo}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldX size={18} /> Certificado no encontrado
            </div>
            <p className="mt-2 text-sm">
              No encontramos ningún certificado con el código{' '}
              <span className="font-mono">{codigo}</span>. Verificá que esté bien
              escrito o escaneá nuevamente el código QR.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-brand-muted">
        Gestión Global · gestionglobal.ar — Verificación pública de certificados
        del campus.
      </footer>
    </div>
  );
}

function CertificadoValido({ res }: { res: VerificacionResultado }) {
  const fecha = res.emitido_at
    ? new Date(res.emitido_at).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-emerald-800">
          <ShieldCheck size={20} /> Certificado válido
        </div>
        <p className="mt-1 text-sm text-emerald-700">
          Emitido por Gestión Global / FUNDPLATA. Este certificado es auténtico.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Award size={18} className="text-brand-cyan" />
          <span className="kicker text-brand-cyan">Datos del certificado</span>
        </div>
        <dl className="space-y-3">
          <Campo icon={<User size={14} />} label="Egresado">
            {res.alumno_nombre ?? '—'}
          </Campo>
          <Campo icon={<GraduationCap size={14} />} label="Curso">
            {res.curso_titulo ?? '—'}
          </Campo>
          {res.instructor_nombre && (
            <Campo icon={<User size={14} />} label="Instructor">
              {res.instructor_nombre}
            </Campo>
          )}
          <Campo icon={<Calendar size={14} />} label="Fecha de emisión">
            {fecha}
          </Campo>
          {res.nota_examen !== null && res.nota_examen !== undefined && (
            <Campo icon={<Award size={14} />} label="Nota del examen">
              {res.nota_examen}
            </Campo>
          )}
        </dl>
        {res.codigo && (
          <p className="mt-5 border-t border-slate-100 pt-3 font-mono text-xs text-brand-muted">
            Código: {res.codigo}
          </p>
        )}
      </div>
    </div>
  );
}

function Campo({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-brand-cyan">{icon}</span>
      <div>
        <dt className="text-[11px] font-medium uppercase tracking-wide text-brand-muted">
          {label}
        </dt>
        <dd className="text-sm font-semibold text-brand-ink">{children}</dd>
      </div>
    </div>
  );
}
