import { useEffect, useState } from 'react';
import { Compass, Send, BellOff, Minus } from 'lucide-react';
import {
  getOfrecimientosPreview,
  type OfrecimientosPreview,
  type OfrecimientoPreviewItem,
} from '@/services/api/perfilRegulatorio';
import { PerfilRegulatorioPanel } from '@/modules/clientes/components/PerfilRegulatorioPanel';
import { cn } from '@/lib/cn';

// Agenda · panorama del cliente al cierre (DGG-198). Al trabajar/cerrar un trámite,
// gerencia ve el panorama del cliente HACIA ADELANTE: su agenda regulatoria derivada
// (reusa PerfilRegulatorioPanel, con niveles de certeza) + qué ofrecimientos recibirá
// (gg_ofrecimientos_preview, mismo helper que el motor → sin drift; respeta "no requiero").

const OFERTAS: Array<{ key: keyof Omit<OfrecimientosPreview, 'generated_at'>; label: string }> = [
  { key: 'certificado', label: 'Certificado RPAC' },
  { key: 'curso_actualizacion', label: 'Curso de actualización' },
  { key: 'ddjj', label: 'DDJJ anual' },
  { key: 'consultoria', label: 'Consultoría jurídica' },
];

function OfertaChip({ item }: { item: OfrecimientoPreviewItem }) {
  if (item.no_requiere) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
        <BellOff size={11} /> No lo requiere
      </span>
    );
  }
  if (item.elegible) {
    // "elegible" (le corresponde por historial+cadencia), NO "se envía hoy":
    // el envío real depende del cap 40/día, el cooldown por-regla y la gracia 7d.
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <Send size={11} /> Le corresponde
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-muted">
      <Minus size={11} /> No corresponde ahora
    </span>
  );
}

export function ClientePanoramaCard({ administracionId }: { administracionId: string }) {
  const [preview, setPreview] = useState<OfrecimientosPreview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    getOfrecimientosPreview(administracionId).then((res) => {
      if (cancel) return;
      if (res.ok) setPreview(res.data);
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [administracionId]);

  return (
    <div className="space-y-4">
      {/* Ofrecimientos que el motor le enviaría (respeta el opt-out del cliente) */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-center gap-2">
          <Compass size={16} className="text-brand-cyan" />
          <p className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            Panorama del cliente · qué recibirá
          </p>
        </div>
        <p className="mb-3 text-xs text-brand-muted">
          Según su historial y las cadencias — respetando lo que marcó como "no requiero".
          {' '}El motor de ofrecimientos todavía está en pausa.
        </p>
        <div className="space-y-2">
          {OFERTAS.map((o) => (
            <div key={o.key} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
              <span className={cn('text-sm', preview && preview[o.key].no_requiere ? 'text-brand-muted' : 'text-brand-ink')}>
                {o.label}
              </span>
              {loading || !preview ? (
                <span className="text-xs text-brand-muted">…</span>
              ) : (
                <OfertaChip item={preview[o.key]} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Agenda regulatoria derivada + niveles de certeza (mismo panel que la ficha) */}
      <PerfilRegulatorioPanel administracionId={administracionId} />
    </div>
  );
}
