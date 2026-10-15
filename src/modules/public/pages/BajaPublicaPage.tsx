import { useMemo, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

// BajaPublicaPage (DGG-224) · página pública de baja/unsubscribe que SÍ renderiza
// como HTML (gestionglobal.ar), a diferencia del edge email-baja — Supabase
// reescribe las respuestas HTML en GET a text/plain, así que el link visible del
// footer de los mails de marketing apunta ACÁ. El header List-Unsubscribe one-click
// (RFC 8058) sigue apuntando al edge (que procesa el POST server-side).
//
// Scanner-safe: igual que el edge, el GET (cargar esta página) NO da de baja; hace
// falta el click en "Confirmar baja" que POSTea al edge. Un prefetch/escáner sólo
// carga la página, no dispara la baja.
//   ?a=<admin>&t=<token>  → baja de cliente
//   ?p=<prospecto>&t=<token> → baja de prospecto

type Estado = 'confirmar' | 'enviando' | 'listo' | 'error' | 'invalido';

const EDGE_BASE = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');

export function BajaPublicaPage() {
  const { modo, id, token } = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    const a = (sp.get('a') ?? '').trim();
    const p = (sp.get('p') ?? '').trim();
    const t = (sp.get('t') ?? '').trim();
    if (a && t) return { modo: 'cliente' as const, id: a, token: t };
    if (p && t) return { modo: 'prospecto' as const, id: p, token: t };
    return { modo: null as null, id: '', token: '' };
  }, []);

  const [estado, setEstado] = useState<Estado>(modo ? 'confirmar' : 'invalido');

  async function confirmar() {
    if (!modo) return;
    setEstado('enviando');
    try {
      const qp = modo === 'cliente' ? `a=${encodeURIComponent(id)}` : `p=${encodeURIComponent(id)}`;
      const res = await fetch(
        `${EDGE_BASE}/functions/v1/email-baja?${qp}&t=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      setEstado(res.ok ? 'listo' : 'error');
    } catch {
      setEstado('error');
    }
  }

  const textoConfirmar =
    modo === 'cliente'
      ? 'Si confirmás, no vas a recibir más novedades ni ofertas de Gestión Global. Tus comunicaciones de servicio (comprobantes, trámites, avisos de tu cuenta) van a seguir llegando igual.'
      : 'Si confirmás, no vas a recibir más correos de captación de Gestión Global.';

  const textoListo =
    modo === 'cliente'
      ? 'No vas a recibir más novedades ni ofertas de Gestión Global. Tus comunicaciones de servicio siguen llegando normalmente. Si querés volver a recibir novedades, escribinos a contacto@gestionglobal.ar.'
      : 'No vas a recibir más correos de captación de Gestión Global. Si alguna vez querés volver a recibir novedades, escribinos a contacto@gestionglobal.ar.';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex justify-center px-8 pt-8">
          <img src="/logo-color.png" alt="Gestión Global" className="h-auto max-w-[190px]" />
        </div>
        <div className="h-[5px] bg-brand-cyan" />
        <div className="px-8 py-9 text-center">
          {estado === 'invalido' && (
            <Resultado
              tono="warn"
              titulo="Enlace no válido"
              texto="El enlace no es válido o ya expiró. Si querés dejar de recibir estos correos, escribinos a contacto@gestionglobal.ar y lo resolvemos."
            />
          )}

          {estado === 'confirmar' && (
            <>
              <h1 className="font-display text-2xl font-bold text-brand-ink">¿Querés darte de baja?</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{textoConfirmar}</p>
              <button
                type="button"
                onClick={() => void confirmar()}
                className="mt-7 inline-flex items-center justify-center rounded-lg bg-brand-cyan px-7 py-3 font-display text-sm font-bold uppercase tracking-wide text-white transition hover:opacity-90"
              >
                Confirmar baja
              </button>
            </>
          )}

          {estado === 'enviando' && (
            <div className="py-6">
              <Loader2 className="mx-auto animate-spin text-brand-cyan" size={28} />
              <p className="mt-3 text-sm text-slate-500">Procesando…</p>
            </div>
          )}

          {estado === 'listo' && <Resultado tono="ok" titulo="Listo, te diste de baja" texto={textoListo} />}

          {estado === 'error' && (
            <Resultado
              tono="warn"
              titulo="No pudimos procesar la baja"
              texto="El enlace no es válido o ya expiró. Escribinos a contacto@gestionglobal.ar y lo resolvemos."
            />
          )}
        </div>
        <div className="border-t border-slate-200 px-8 py-4">
          <p className="text-center text-xs text-slate-400">
            Gestión Global ·{' '}
            <a href="https://www.gestionglobal.ar" className="text-brand-cyan no-underline">
              gestionglobal.ar
            </a>{' '}
            · Aliados de tu tiempo
          </p>
        </div>
      </div>
    </div>
  );
}

function Resultado({ tono, titulo, texto }: { tono: 'ok' | 'warn'; titulo: string; texto: string }) {
  const Icon = tono === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <>
      <Icon className={tono === 'ok' ? 'mx-auto text-emerald-500' : 'mx-auto text-amber-500'} size={40} />
      <h1 className="mt-3 font-display text-2xl font-bold text-brand-ink">{titulo}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{texto}</p>
    </>
  );
}
