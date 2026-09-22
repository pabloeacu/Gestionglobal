import { useEffect, useState } from 'react';
import { ShieldCheck, HelpCircle, Sparkles, FileCheck2, RefreshCw, AlertCircle, Pencil } from 'lucide-react';
import {
  getPerfilRegulatorio,
  type PerfilRegulatorio,
  type CertezaDato,
  type HechoConCerteza,
} from '@/services/api/perfilRegulatorio';
import { Button } from '@/components/common';
import { PerfilRegulatorioDeclararDrawer } from './PerfilRegulatorioDeclararDrawer';
import { formatDateShort } from '@/lib/dates';
import { humanizeError } from '@/lib/errors';
import { cn } from '@/lib/cn';

// Agenda Fase 1 (DGG-195) — visibiliza el perfil con NIVELES DE CERTEZA en la ficha
// de gerencia. Solo lectura: la plataforma sigue siendo la fuente confirmada; el
// anclado de datos declarados (progressive profiling) llega en una fase posterior.

const CERTEZA_META: Record<
  CertezaDato,
  { label: string; cls: string; hint: string }
> = {
  confirmado: {
    label: 'Confirmado',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    hint: 'Lo sabe la plataforma (matrícula cargada o trámite resuelto).',
  },
  declarado: {
    label: 'Declarado',
    cls: 'bg-sky-50 text-sky-700 border-sky-200',
    hint: 'Lo declaró el cliente o lo ancló gerencia.',
  },
  inferido: {
    label: 'Inferido',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    hint: 'Estimado por cálculo (aniversario / fecha legal). Conviene confirmarlo.',
  },
  desconocido: {
    label: 'Sin dato',
    cls: 'bg-slate-100 text-slate-500 border-slate-200',
    hint: 'No lo sabemos todavía.',
  },
};

function CertezaChip({ certeza }: { certeza: CertezaDato }) {
  const m = CERTEZA_META[certeza];
  return (
    <span
      title={m.hint}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        m.cls,
      )}
    >
      {m.label}
    </span>
  );
}

function FactRow({
  label,
  hecho,
  fallback = 'Sin dato',
}: {
  label: string;
  hecho: HechoConCerteza;
  fallback?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-sm text-brand-muted">{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            'text-sm tabular-nums',
            hecho.fecha ? 'font-medium text-brand-ink' : 'text-brand-muted',
          )}
        >
          {hecho.fecha ? formatDateShort(hecho.fecha) : fallback}
        </span>
        <CertezaChip certeza={hecho.certeza} />
      </span>
    </div>
  );
}

export function PerfilRegulatorioPanel({ administracionId }: { administracionId: string }) {
  const [data, setData] = useState<PerfilRegulatorio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getPerfilRegulatorio(administracionId);
    if (res.ok) setData(res.data);
    else setError(humanizeError(res.error));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [administracionId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2 text-sm text-brand-muted">
          <RefreshCw size={14} className="animate-spin" />
          Cargando perfil regulatorio…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={14} />
          {error ?? 'No se pudo cargar el perfil regulatorio.'}
        </div>
        <button
          onClick={() => void load()}
          className="mt-2 text-xs font-semibold text-red-700 underline"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const noRequiereEntries = Object.entries(data.no_requiere ?? {});

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-brand-cyan" />
          <p className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            Perfil regulatorio · certeza
          </p>
        </div>
        {/* completitud: cuánto SABEMOS (confirmado/declarado), no lo que inferimos */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-cyan transition-all"
                style={{ width: `${data.completitud_pct}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-brand-ink">
              {data.completitud_pct}% conocido
            </span>
          </div>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)} className="!py-1 !px-2.5 text-xs">
            <Pencil size={12} /> Anclar datos
          </Button>
        </div>
      </div>

      {/* Estado de matrícula */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
        <FileCheck2 size={14} className="text-brand-muted" />
        <span className="text-sm font-medium text-brand-ink">
          {data.matriculado.valor ? 'Matriculado' : 'Sin matrícula registrada'}
        </span>
        <CertezaChip certeza={data.matriculado.certeza} />
        {data.matricula.nro && (
          <span className="text-sm text-brand-muted">
            · Mat. <span className="tabular-nums text-brand-ink">{data.matricula.nro}</span>
          </span>
        )}
        {data.jurisdiccion && (
          <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase text-brand-muted ring-1 ring-slate-200">
            {data.jurisdiccion === 'rpac' ? 'RPAC · PBA' : 'RPA · CABA'}
          </span>
        )}
      </div>

      {/* Próximas obligaciones (fechas hacia adelante, con su certeza) */}
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
        <Sparkles size={12} /> Próximas obligaciones
      </p>
      <div className="mb-3">
        <FactRow label="Renovación de matrícula" hecho={data.proxima_renovacion} />
        <FactRow label="DDJJ anual" hecho={data.proxima_ddjj} />
        <FactRow label="Curso de actualización" hecho={data.proximo_curso_actualizacion} />
        <FactRow label="Certificado" hecho={data.proximo_certificado} />
      </div>

      {/* Qué sabemos (último hecho registrado) */}
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
        <HelpCircle size={12} /> Último registro
      </p>
      <div>
        <FactRow label="Fecha de matriculación" hecho={{ fecha: data.matricula.fecha, certeza: data.matricula.fecha_certeza }} />
        <FactRow label="Última renovación" hecho={data.ultima_renovacion} />
        <FactRow label="Última DDJJ" hecho={data.ultima_ddjj} />
        <FactRow label="Último curso" hecho={data.ultimo_curso_actualizacion} />
        <FactRow label="Última consultoría jurídica" hecho={data.ultima_consultoria} />
      </div>

      {noRequiereEntries.length > 0 && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-brand-muted">
            No requiere / no desea
          </p>
          <ul className="space-y-0.5">
            {noRequiereEntries.map(([svc, info]) => (
              <li key={svc} className="text-xs text-brand-muted">
                <span className="font-medium text-brand-ink">{svc}</span>
                {info?.motivo ? ` — ${info.motivo}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-snug text-brand-muted">
        <span className="font-semibold">Cómo leerlo:</span> Confirmado = lo sabe la
        plataforma · Declarado = lo dijo el cliente · Inferido = estimado por cálculo
        (conviene confirmarlo) · Sin dato = falta relevar.
      </p>

      <PerfilRegulatorioDeclararDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        administracionId={administracionId}
        perfil={data}
        onSaved={() => void load()}
      />
    </div>
  );
}
