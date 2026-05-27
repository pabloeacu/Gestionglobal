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
  BadgeCheck,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  verificarCertificado,
  type VerificacionResultado,
} from '@/services/api/campus';

// Página PÚBLICA sin login (DGG-10/DGG-13 · /verificar/:codigo). Confirma la
// autenticidad de un certificado emitido por el campus. Branding premium
// consistente con la web (gradiente navy→cyan, acentos triangulares, marca).
// Llama a la RPC `verificar_certificado` (SECURITY DEFINER, ejecutable por anon)
// que sólo devuelve datos NO sensibles.
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
    <div className="min-h-screen bg-gradient-to-b from-brand-night via-[#0c2236] to-slate-50">
      {/* Hero */}
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-night via-brand-night-2 to-brand-cyan py-14 text-white">
        <TrianglesAccent
          position="top-right"
          size={300}
          tone="cyan"
          density="rich"
          className="opacity-40"
        />
        <TrianglesAccent
          position="bottom-left"
          size={200}
          tone="teal"
          density="soft"
          className="opacity-30"
        />
        <div className="relative mx-auto max-w-2xl px-6">
          <img
            src="/logo-h-white.png"
            alt="Gestión Global"
            className="h-24 w-auto sm:h-28"
          />
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur">
            <ShieldCheck size={14} /> Verificación pública de certificados
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight sm:text-4xl">
            Certificados del Campus
          </h1>
          <p className="mt-2 max-w-md text-sm text-white/80">
            Constatá la autenticidad de un certificado emitido por Gestión Global
            en el marco de la habilitación de FU.DE.CO.IN / FUNDPLATA.
          </p>
        </div>
      </header>

      {/* Contenido — la tarjeta "monta" sobre el hero */}
      <main className="relative z-10 mx-auto -mt-8 max-w-2xl px-6 pb-16">
        {loading ? (
          <div className="grid place-items-center rounded-3xl border border-slate-200 bg-white p-14 text-brand-muted shadow-xl">
            <Loader2 className="mb-3 animate-spin text-brand-cyan" />
            <p className="text-sm">Verificando el certificado…</p>
          </div>
        ) : valido ? (
          <CertificadoValido res={res!} />
        ) : revocado ? (
          <EstadoCard
            tone="amber"
            icon={<ShieldAlert size={20} />}
            titulo="Certificado revocado"
          >
            <p className="text-sm">
              Este certificado existió pero fue <strong>revocado</strong> por
              Gestión Global y ya no es válido.
            </p>
            {res?.codigo && (
              <p className="mt-3 font-mono text-xs opacity-80">Código: {res.codigo}</p>
            )}
            {res?.revocado_motivo && (
              <p className="mt-1 text-xs opacity-70">Motivo: {res.revocado_motivo}</p>
            )}
          </EstadoCard>
        ) : (
          <EstadoCard
            tone="rose"
            icon={<ShieldX size={20} />}
            titulo="Certificado no encontrado"
          >
            <p className="text-sm">
              No encontramos ningún certificado con el código{' '}
              <span className="font-mono">{codigo}</span>. Verificá que esté bien
              escrito o escaneá nuevamente el código QR.
            </p>
          </EstadoCard>
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
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
      {/* Banner de validez */}
      <div className="relative overflow-hidden bg-gradient-to-r from-emerald-600 to-emerald-500 px-7 py-6 text-white">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="teal"
          density="soft"
          className="opacity-25"
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15 ring-1 ring-white/30">
            <BadgeCheck size={26} />
          </span>
          <div>
            <p className="font-display text-xl font-bold">Certificado válido</p>
            <p className="text-sm text-white/85">
              Auténtico · emitido por Gestión Global / FUNDPLATA
            </p>
          </div>
        </div>
      </div>

      {/* Datos */}
      <div className="px-7 py-6">
        <div className="mb-5 flex items-center gap-2">
          <Award size={16} className="text-brand-cyan" />
          <span className="kicker text-brand-cyan">Datos del certificado</span>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
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
            <Campo icon={<Award size={14} />} label="Calificación">
              {res.nota_examen} / 100
            </Campo>
          )}
        </dl>
        {res.codigo && (
          <p className="mt-6 flex items-center gap-2 border-t border-slate-100 pt-4 font-mono text-xs text-brand-muted">
            <ShieldCheck size={13} className="text-emerald-600" />
            Código de verificación: <span className="font-semibold">{res.codigo}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function EstadoCard({
  tone,
  icon,
  titulo,
  children,
}: {
  tone: 'amber' | 'rose';
  icon: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-rose-200 bg-rose-50 text-rose-800';
  return (
    <div className={`rounded-3xl border p-7 shadow-xl ${styles}`}>
      <div className="flex items-center gap-2 font-display text-lg font-semibold">
        {icon} {titulo}
      </div>
      <div className="mt-3">{children}</div>
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
