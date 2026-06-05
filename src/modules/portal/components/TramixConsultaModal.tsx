// src/modules/portal/components/TramixConsultaModal.tsx
// DGG-46 · Modal "Consultar mi trámite en Mesa de Entradas Virtual PBA".
// Renderiza nativo el estado de los expedientes del legajo del cliente (TRAMIX/DPPJ),
// con detalle expandible (header + actuaciones), nota de fuente oficial, "i" de T&C
// y salvavidas (deep-link oficial) ante cualquier error. 100% aislado/additivo.

import { useCallback, useEffect, useState } from 'react';
import {
  Landmark, RefreshCw, ExternalLink, Info, ChevronDown, Loader2,
  AlertTriangle, Inbox, FileText, Clock,
} from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { toast } from '@/lib/toast';
import {
  consultarTramix, consultarTramixDetalle, estadoTone, TRAMIX_URL_OFICIAL,
  type TramixConsultaResp, type TramixExpediente, type TramixDetalle,
} from '@/services/api/tramix';

const refKeyOf = (e: TramixExpediente) => (e.detalle_ref ? `${e.detalle_ref.o}:${e.detalle_ref.n}:${e.detalle_ref.a}` : e.numero);

function fmtFecha(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function Salvavidas({ legajo, motivo }: { legajo?: string; motivo: string }) {
  return (
    <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-4">
      <p className="text-sm font-semibold text-brand-ink">{motivo}</p>
      <p className="mt-1 text-xs text-brand-muted">
        Podés consultarlo directamente en el sitio oficial de la Mesa de Entradas Virtual de la Provincia
        {legajo ? <> con tu legajo <span className="font-semibold text-brand-ink">{legajo}</span></> : null}.
      </p>
      <a
        href={TRAMIX_URL_OFICIAL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-cyan px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-cyan/90"
      >
        <ExternalLink size={13} /> Abrir Mesa de Entradas Virtual PBA
      </a>
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const tone = estadoTone(estado);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} /> {estado || '—'}
    </span>
  );
}

function DetalleView({ detalle }: { detalle: TramixDetalle }) {
  const h = detalle.header || {};
  const campos: { k: string; v: string }[] = [
    { k: 'Expediente', v: h['Expediente Nº'] || '' },
    { k: 'Trámite', v: h['Trámites'] || '' },
    { k: 'Tipo', v: h['Tipo de trámite'] || '' },
    { k: 'Ingresado', v: h['Ingresado el'] || '' },
    { k: 'Ubicación actual', v: h['Ubicación actual'] || '' },
    { k: 'Estado', v: h['Estado'] || '' },
    { k: 'Resolución', v: [h['Nro.de Resolución'], h['Fecha de Resolución']].filter(Boolean).join(' · ') },
  ].filter((x) => x.v);
  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {campos.map((c) => (
          <div key={c.k} className="flex flex-col">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">{c.k}</dt>
            <dd className="text-xs text-brand-ink">{c.v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Movimientos</p>
        {detalle.actuaciones.length === 0 ? (
          <p className="text-xs text-brand-muted">Sin actuaciones registradas.</p>
        ) : (
          <ol className="space-y-2">
            {detalle.actuaciones.map((a, i) => (
              <li key={i} className="relative pl-4">
                <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-brand-cyan" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink">
                    <Clock size={11} className="text-brand-muted" /> {a.fecha}
                  </span>
                  {a.estado ? <span className="text-[10px] font-medium text-brand-muted">· {a.estado}</span> : null}
                </div>
                <p className="text-xs text-brand-ink">{a.extracto}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function TramixConsultaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<TramixConsultaResp | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, { loading: boolean; data?: TramixDetalle; error?: string }>>({});
  const [showInfo, setShowInfo] = useState(false);

  const cargar = useCallback(async (force = false) => {
    setLoading(true);
    const r = await consultarTramix(force);
    setLoading(false);
    if (!r.ok) { setResp({ resultado: 'ERROR' }); toast.error('No pudimos consultar la Mesa de Entradas', { description: r.error }); return; }
    setResp(r.data);
    if (force && r.data.resultado === 'OK') toast.success('Consulta actualizada');
  }, []);

  useEffect(() => {
    if (open) { setResp(null); setDetalles({}); setExpandido(null); setShowInfo(false); cargar(false); }
  }, [open, cargar]);

  const toggleDetalle = async (e: TramixExpediente) => {
    if (!e.detalle_ref) return;
    const key = refKeyOf(e);
    if (expandido === key) { setExpandido(null); return; }
    setExpandido(key);
    if (!detalles[key]?.data) {
      setDetalles((d) => ({ ...d, [key]: { loading: true } }));
      const r = await consultarTramixDetalle(e.detalle_ref);
      if (!r.ok) setDetalles((d) => ({ ...d, [key]: { loading: false, error: r.error } }));
      else if (r.data.resultado === 'OK' && r.data.detalle) setDetalles((d) => ({ ...d, [key]: { loading: false, data: r.data.detalle } }));
      else setDetalles((d) => ({ ...d, [key]: { loading: false, error: 'No pudimos abrir el detalle. Probá desde el sitio oficial.' } }));
    }
  };

  const r = resp;
  const exps = r?.expedientes ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={640}
      kicker="MESA DE ENTRADAS VIRTUAL · PBA"
      title="Consulta de expedientes"
      icon={<Landmark size={18} className="text-brand-cyan" />}
    >
      <div className="space-y-4">
        {/* Barra de fuente + acciones */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-muted transition hover:text-brand-ink"
          >
            <Info size={13} /> ¿De dónde salen estos datos?
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => cargar(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-brand-ink transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>

        {showInfo && (
          <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-brand-muted">
            Consultamos por vos la <strong>Mesa de Entradas Virtual</strong> de la Dirección Provincial de Personas
            Jurídicas (PBA). Es información <strong>oficial pero meramente informativa</strong> (Disp. DPPJ 148/06):
            no es vinculante, puede no estar actualizada en tiempo real y solo mostramos <strong>tu</strong> legajo.
            Para gestiones formales, usá siempre el sitio oficial.
          </div>
        )}

        {/* Cuerpo según estado */}
        {loading && !r && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Loader2 size={28} className="animate-spin text-brand-cyan" />
            <p className="text-sm text-brand-muted">Consultando la Mesa de Entradas Virtual…</p>
          </div>
        )}

        {r && r.resultado === 'OK' && (
          <>
            <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-ink/5 px-3 py-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Titular · Legajo {r.legajo}</p>
                <p className="text-sm font-semibold text-brand-ink">{r.titular || '—'}</p>
              </div>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-brand-ink shadow-sm">
                {exps.length} expediente{exps.length === 1 ? '' : 's'}
              </span>
            </div>

            <ul className="space-y-2">
              {exps.map((e) => {
                const key = refKeyOf(e);
                const open = expandido === key;
                const det = detalles[key];
                return (
                  <li key={key} className="overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => toggleDetalle(e)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50"
                    >
                      <FileText size={16} className="shrink-0 text-brand-cyan" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold text-brand-ink">{e.numero}</span>
                          <EstadoBadge estado={e.estado} />
                        </div>
                        <p className="truncate text-xs text-brand-muted">
                          {e.tramite}{e.fecha ? ` · ${e.fecha}` : ''}
                        </p>
                      </div>
                      <ChevronDown size={16} className={`shrink-0 text-brand-muted transition ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <div className="px-3 pb-3">
                        {det?.loading && (
                          <div className="flex items-center gap-2 py-3 text-xs text-brand-muted">
                            <Loader2 size={14} className="animate-spin" /> Abriendo detalle…
                          </div>
                        )}
                        {det?.error && (
                          <div className="mt-2"><Salvavidas legajo={r.legajo} motivo="No pudimos abrir el detalle de este expediente." /></div>
                        )}
                        {det?.data && <DetalleView detalle={det.data} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="text-center text-[10px] text-brand-muted">
              Fuente: Mesa de Entradas Virtual DPPJ-PBA · datos al {fmtFecha(r.consultado_at)}
              {r.desde_cache ? ' (en caché)' : ''}
            </p>
          </>
        )}

        {r && r.resultado === 'NOT_FOUND' && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <Inbox size={28} className="text-brand-muted" />
              <p className="text-sm font-semibold text-brand-ink">No encontramos expedientes</p>
              <p className="max-w-sm text-xs text-brand-muted">
                No hay expedientes asociados al legajo <span className="font-semibold">{r.legajo}</span> en la Mesa de
                Entradas Virtual, o todavía no figuran cargados.
              </p>
            </div>
            <Salvavidas legajo={r.legajo} motivo="¿Esperabas ver un expediente?" />
          </div>
        )}

        {r && (r.resultado === 'SIN_LEGAJO' || r.resultado === 'SIN_ADMIN') && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle size={26} className="text-amber-500" />
            <p className="text-sm font-semibold text-brand-ink">Falta tu legajo RPAC</p>
            <p className="max-w-sm text-xs text-brand-muted">
              Para consultar la Mesa de Entradas Virtual necesitamos tu número de legajo del RPAC.
              Escribinos y lo configuramos en tu perfil.
            </p>
          </div>
        )}

        {r && r.resultado === 'RATE_LIMITED' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Clock size={26} className="text-brand-cyan" />
            <p className="text-sm font-semibold text-brand-ink">Estamos con muchas consultas</p>
            <p className="max-w-sm text-xs text-brand-muted">Probá de nuevo en unos segundos.</p>
            <button onClick={() => cargar(false)} className="rounded-lg bg-brand-cyan px-3 py-2 text-xs font-semibold text-white hover:bg-brand-cyan/90">Reintentar</button>
          </div>
        )}

        {r && ['TRAMIX_DOWN', 'TIMEOUT', 'CIRCUIT_OPEN', 'PARSE_ERROR', 'TC_BLOCKED', 'ERROR', 'NO_AUTH', 'FORBIDDEN', 'INVALID'].includes(r.resultado) && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-2 py-3 text-center">
              <AlertTriangle size={26} className="text-amber-500" />
              <p className="text-sm font-semibold text-brand-ink">La Mesa de Entradas Virtual no responde ahora</p>
              <p className="max-w-sm text-xs text-brand-muted">Es un sitio del Gobierno de la Provincia y a veces no está disponible. Podés intentar directamente desde el sitio oficial.</p>
            </div>
            <Salvavidas legajo={r.legajo} motivo="Consultá directamente en el sitio oficial" />
          </div>
        )}
      </div>
    </Modal>
  );
}
