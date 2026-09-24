import { useEffect, useState } from 'react';
import { Compass, Send, BellOff, Minus, CalendarClock } from 'lucide-react';
import {
  getOfrecimientosPreview,
  type OfrecimientosPreview,
  type OfrecimientoPreviewItem,
} from '@/services/api/perfilRegulatorio';
import { PerfilRegulatorioPanel } from '@/modules/clientes/components/PerfilRegulatorioPanel';
import { cn } from '@/lib/cn';

// Agenda · panorama del cliente al cierre (DGG-198 / DGG-200). Al trabajar/cerrar un
// trámite, gerencia ve el panorama del cliente HACIA ADELANTE: su agenda regulatoria
// derivada (reusa PerfilRegulatorioPanel, con niveles de certeza) + qué ofrecimientos
// recibirá (gg_ofrecimientos_preview, mismo helper que el motor → sin drift; respeta
// "no requiero"). Alineado a las 6 consignas: matriculación, curso y renovación por
// vencimiento, consultoría a todos.

// Sólo las claves que son OfrecimientoPreviewItem (no generated_at ni prox_venc_matricula).
type OfertaKey = 'matriculacion' | 'ddjj' | 'curso_actualizacion' | 'renovacion' | 'certificado' | 'consultoria';
const OFERTAS: Array<{ key: OfertaKey; label: string }> = [
  { key: 'matriculacion', label: 'Matriculación RPAC' },
  { key: 'ddjj', label: 'DDJJ anual' },
  { key: 'curso_actualizacion', label: 'Curso de actualización' },
  { key: 'renovacion', label: 'Renovación de matrícula' },
  { key: 'certificado', label: 'Certificado RPAC' },
  { key: 'consultoria', label: 'Consultoría jurídica' },
];

// 'YYYY-MM-DD' → 'DD/MM/YYYY' sin corrimiento de timezone (parseo por partes).
function formatFechaISO(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

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
        {preview && formatFechaISO(preview.prox_venc_matricula) && (
          <div className={cn(
            'mb-3 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
            preview.prox_venc_vencido
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-brand-ink',
          )}>
            <CalendarClock size={12} className={preview.prox_venc_vencido ? 'text-red-500' : 'text-brand-cyan'} />
            {preview.prox_venc_vencido ? 'Matrícula vencida el' : 'Próx. vencimiento de matrícula (estimado):'}{' '}
            <span className="tabular-nums">{formatFechaISO(preview.prox_venc_matricula)}</span>
          </div>
        )}
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
