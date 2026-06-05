// src/modules/portal/components/TramixConsultaModal.tsx
// DGG-46 · Modal "Consultar mi trámite en Mesa de Entradas Virtual PBA".
// Renderiza nativo el estado de los expedientes de un legajo (TRAMIX/DPPJ),
// con detalle expandible (header + actuaciones), nota de fuente oficial, "i" de T&C
// y salvavidas (deep-link oficial) ante cualquier error. 100% aislado/additivo.
//
// Legajo EDITABLE (pedido Pablo, 2026-06-05): el número viene autocompletado
// desde la ficha de la administración o desde la última consulta (localStorage),
// pero el usuario puede cambiarlo y consultar cualquier legajo.
//   · modo 'form'    → campo editable + "Buscar"     (primera vez / "Cambiar de legajo")
//   · modo 'results' → barra [legajo][Actualizar][Cambiar de legajo] + resultados
// Al reabrir, auto-busca el último legajo cargado (gana los pasos intermedios).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Landmark, RefreshCw, ExternalLink, Info, ChevronDown, Loader2,
  AlertTriangle, Inbox, FileText, Clock, FileDown, Search, Pencil,
} from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { toast } from '@/lib/toast';
import {
  consultarTramix, consultarTramixDetalle, consultarTramixActuacion,
  descargarTramixDocumento, triggerDownload, estadoTone, TRAMIX_URL_OFICIAL,
  type TramixConsultaResp, type TramixExpediente, type TramixDetalle,
  type TramixDetalleRef, type TramixActuacion, type TramixActuacionDetalle,
} from '@/services/api/tramix';

const LS_KEY = 'gg.tramix.legajo';
const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
const readLast = () => { try { return onlyDigits(localStorage.getItem(LS_KEY) || ''); } catch { return ''; } };
const saveLast = (l: string) => { try { if (l) localStorage.setItem(LS_KEY, l); } catch { /* noop */ } };

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
        {legajo ? <> con el legajo <span className="font-semibold text-brand-ink">{legajo}</span></> : null}.
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

function ActuacionItem({ detalleRef, act, legajo }: { detalleRef: TramixDetalleRef | null; act: TramixActuacion; legajo: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TramixActuacionDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const puedeExpandir = !!(detalleRef && act.actIdx != null);

  const toggle = async () => {
    if (!puedeExpandir) return;
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!data) {
      setLoading(true); setError(null);
      const r = await consultarTramixActuacion(detalleRef!, act.actIdx!, legajo);
      setLoading(false);
      if (!r.ok) setError(r.error);
      else if (r.data.resultado === 'OK' && r.data.actuacion) setData(r.data.actuacion);
      else setError('No pudimos abrir el detalle de esta actuación.');
    }
  };

  const descargar = async () => {
    if (!detalleRef || act.actIdx == null) return;
    setDescargando(true);
    const r = await descargarTramixDocumento(detalleRef, act.actIdx, legajo);
    setDescargando(false);
    if (!r.ok) { toast.error('No pudimos descargar el documento', { description: r.error }); return; }
    if (r.data.resultado === 'OK' && r.data.url) { triggerDownload(r.data.url, r.data.nombre); toast.success('Descargando documento…'); }
    else if (r.data.resultado === 'SIN_DOCUMENTO') toast.info('Esta actuación no tiene documento descargable.');
    else toast.error('No se pudo obtener el documento ahora. Probá de nuevo en unos segundos.');
  };

  return (
    <li className="relative pl-4">
      <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-brand-cyan" />
      <button
        type="button"
        onClick={toggle}
        disabled={!puedeExpandir}
        className={`flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left ${puedeExpandir ? 'transition hover:bg-slate-50' : 'cursor-default'}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-ink">
              <Clock size={11} className="text-brand-muted" /> {act.fecha}
            </span>
            {act.estado ? <span className="text-[10px] font-medium text-brand-muted">· {act.estado}</span> : null}
          </div>
          <p className="text-xs text-brand-ink">{act.extracto}</p>
        </div>
        {puedeExpandir && <ChevronDown size={14} className={`mt-0.5 shrink-0 text-brand-muted transition ${open ? 'rotate-180' : ''}`} />}
      </button>

      {open && (
        <div className="ml-1.5 mt-1.5">
          {loading && (
            <div className="flex items-center gap-2 py-1.5 text-[11px] text-brand-muted">
              <Loader2 size={12} className="animate-spin" /> Abriendo actuación…
            </div>
          )}
          {error && <Salvavidas legajo={legajo} motivo="No pudimos abrir esta actuación." />}
          {data && (
            <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              {(data.extracto_actuacion || data.fecha_firma) && (
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
                  {data.extracto_actuacion && (
                    <span><span className="font-semibold text-brand-muted">Extracto:</span> <span className="text-brand-ink">{data.extracto_actuacion}</span></span>
                  )}
                  {data.fecha_firma && (
                    <span><span className="font-semibold text-brand-muted">Firmada:</span> <span className="text-brand-ink">{data.fecha_firma}</span></span>
                  )}
                </div>
              )}
              {data.texto && (
                <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2 text-[11px] leading-relaxed text-brand-ink">
                  {data.texto}
                </div>
              )}
              {data.tiene_documento && (
                <button
                  type="button"
                  onClick={descargar}
                  disabled={descargando}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-60"
                >
                  {descargando ? <Loader2 size={12} className="animate-spin" /> : <FileDown size={12} />} Descargar documento (.doc)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function DetalleView({ detalle, detalleRef, legajo }: { detalle: TramixDetalle; detalleRef: TramixDetalleRef | null; legajo: string }) {
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
          <ol className="space-y-1.5">
            {detalle.actuaciones.map((a, i) => (
              <ActuacionItem key={i} detalleRef={detalleRef} act={a} legajo={legajo} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function TramixConsultaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'form' | 'results'>('results');
  const [legajoInput, setLegajoInput] = useState('');
  const [searchedLegajo, setSearchedLegajo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<TramixConsultaResp | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, { loading: boolean; data?: TramixDetalle; error?: string }>>({});
  const [showInfo, setShowInfo] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Busca un legajo concreto y muestra resultados (modo 'results').
  const buscar = useCallback(async (rawLegajo: string, force: boolean) => {
    const legajo = onlyDigits(rawLegajo);
    if (!legajo) { setMode('form'); setTimeout(() => inputRef.current?.focus(), 30); return; }
    setMode('results');
    setLoading(true);
    setExpandido(null);
    setDetalles({});
    const r = await consultarTramix(legajo, force);
    setLoading(false);
    if (!r.ok) {
      setResp({ resultado: 'ERROR', legajo });
      setSearchedLegajo(legajo);
      toast.error('No pudimos consultar la Mesa de Entradas', { description: r.error });
      return;
    }
    setResp(r.data);
    const used = r.data.legajo || legajo;
    setSearchedLegajo(used);
    setLegajoInput(used);
    saveLast(used);
    if (force && r.data.resultado === 'OK') toast.success('Consulta actualizada');
  }, []);

  // Primera apertura sin legajo recordado: usa el de la ficha (server) o pide uno.
  const initFromFicha = useCallback(async () => {
    setMode('results');
    setLoading(true);
    const r = await consultarTramix(undefined, false);
    setLoading(false);
    if (!r.ok) { setResp({ resultado: 'ERROR' }); return; }
    setResp(r.data);
    if (r.data.resultado === 'SIN_ADMIN') { setMode('results'); return; }
    const def = onlyDigits(r.data.legajo || r.data.legajo_default || '');
    if (r.data.resultado === 'SIN_LEGAJO' || !def) {
      // No hay legajo en la ficha → formulario para que el usuario lo ingrese.
      setLegajoInput(def);
      setMode('form');
      setTimeout(() => inputRef.current?.focus(), 30);
      return;
    }
    setSearchedLegajo(def);
    setLegajoInput(def);
    saveLast(def);
  }, []);

  useEffect(() => {
    if (!open) return;
    setResp(null);
    setDetalles({});
    setExpandido(null);
    setShowInfo(false);
    const remembered = readLast();
    if (remembered) {
      // Reapertura: gano los pasos intermedios y auto-busco el último legajo.
      setLegajoInput(remembered);
      buscar(remembered, false);
    } else {
      initFromFicha();
    }
  }, [open, buscar, initFromFicha]);

  const cambiarLegajo = () => {
    setMode('form');
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
  };

  const toggleDetalle = async (e: TramixExpediente) => {
    if (!e.detalle_ref) return;
    const key = refKeyOf(e);
    if (expandido === key) { setExpandido(null); return; }
    setExpandido(key);
    if (!detalles[key]?.data) {
      setDetalles((d) => ({ ...d, [key]: { loading: true } }));
      const r = await consultarTramixDetalle(e.detalle_ref, searchedLegajo);
      if (!r.ok) setDetalles((d) => ({ ...d, [key]: { loading: false, error: r.error } }));
      else if (r.data.resultado === 'OK' && r.data.detalle) setDetalles((d) => ({ ...d, [key]: { loading: false, data: r.data.detalle } }));
      else setDetalles((d) => ({ ...d, [key]: { loading: false, error: 'No pudimos abrir el detalle. Probá desde el sitio oficial.' } }));
    }
  };

  const r = resp;
  const exps = r?.expedientes ?? [];
  const initialLoading = loading && !r;

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
        {/* Barra de fuente (info de T&C) — siempre disponible */}
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-muted transition hover:text-brand-ink"
        >
          <Info size={13} /> ¿De dónde salen estos datos?
        </button>

        {showInfo && (
          <div className="rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-brand-muted">
            Consultamos por vos la <strong>Mesa de Entradas Virtual</strong> de la Dirección Provincial de Personas
            Jurídicas (PBA). Es información <strong>oficial pero meramente informativa</strong> (Disp. DPPJ 148/06):
            no es vinculante y puede no estar actualizada en tiempo real.
            Para gestiones formales, usá siempre el sitio oficial.
          </div>
        )}

        {/* Carga inicial */}
        {initialLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Loader2 size={28} className="animate-spin text-brand-cyan" />
            <p className="text-sm text-brand-muted">Consultando la Mesa de Entradas Virtual…</p>
          </div>
        )}

        {/* ════════ MODO FORMULARIO (puntos 1 y 2) ════════ */}
        {mode === 'form' && !initialLoading && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (legajoInput) buscar(legajoInput, false); }}
            className="space-y-3"
          >
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <label htmlFor="tramix-legajo" className="mb-1.5 block text-xs font-semibold text-brand-ink">
                Número de legajo (RPAC)
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="tramix-legajo"
                  ref={inputRef}
                  value={legajoInput}
                  onChange={(e) => setLegajoInput(onlyDigits(e.target.value))}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Ej. 12345"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-brand-ink outline-none transition focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                />
                <button
                  type="submit"
                  disabled={!legajoInput || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Buscar
                </button>
              </div>
              {r?.resultado === 'SIN_LEGAJO' ? (
                <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-amber-600">
                  <AlertTriangle size={13} className="mt-px shrink-0" />
                  No tenés un legajo guardado en tu ficha. Ingresá uno para consultar.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-brand-muted">
                  Lo autocompletamos desde tu ficha o tu última consulta. Podés editarlo y consultar cualquier legajo.
                </p>
              )}
            </div>
          </form>
        )}

        {/* ════════ MODO RESULTADOS (punto 4) ════════ */}
        {mode === 'results' && r && !initialLoading && (
          <>
            {/* Barra superior: campo legajo + Actualizar + Cambiar de legajo */}
            {r.resultado !== 'SIN_ADMIN' && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (legajoInput) buscar(legajoInput, true); }}
                className="rounded-xl border border-slate-200 bg-white p-2.5"
              >
                <label htmlFor="tramix-legajo-bar" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
                  Legajo RPAC
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="tramix-legajo-bar"
                    ref={inputRef}
                    value={legajoInput}
                    onChange={(e) => setLegajoInput(onlyDigits(e.target.value))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Número de legajo"
                    className="min-w-0 flex-1 basis-32 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold text-brand-ink outline-none transition focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
                  />
                  <button
                    type="submit"
                    disabled={loading || !legajoInput}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-cyan/90 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Actualizar
                  </button>
                  <button
                    type="button"
                    onClick={cambiarLegajo}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-brand-ink transition hover:bg-slate-50"
                  >
                    <Pencil size={12} /> Cambiar de legajo
                  </button>
                </div>
              </form>
            )}

            {/* Cuerpo de resultados */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-brand-muted">
                <Loader2 size={18} className="animate-spin text-brand-cyan" /> Consultando…
              </div>
            ) : (
              <>
                {r.resultado === 'OK' && (
                  <>
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-brand-ink/5 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Titular · Legajo {r.legajo}</p>
                        <p className="truncate text-sm font-semibold text-brand-ink">{r.titular || '—'}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-brand-ink shadow-sm">
                        {exps.length} expediente{exps.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <ul className="space-y-2">
                      {exps.map((e) => {
                        const key = refKeyOf(e);
                        const isOpen = expandido === key;
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
                              <ChevronDown size={16} className={`shrink-0 text-brand-muted transition ${isOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3">
                                {det?.loading && (
                                  <div className="flex items-center gap-2 py-3 text-xs text-brand-muted">
                                    <Loader2 size={14} className="animate-spin" /> Abriendo detalle…
                                  </div>
                                )}
                                {det?.error && (
                                  <div className="mt-2"><Salvavidas legajo={searchedLegajo} motivo="No pudimos abrir el detalle de este expediente." /></div>
                                )}
                                {det?.data && <DetalleView detalle={det.data} detalleRef={e.detalle_ref} legajo={searchedLegajo} />}
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

                {r.resultado === 'NOT_FOUND' && (
                  <div className="space-y-4 py-2">
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <Inbox size={28} className="text-brand-muted" />
                      <p className="text-sm font-semibold text-brand-ink">No encontramos expedientes</p>
                      <p className="max-w-sm text-xs text-brand-muted">
                        No hay expedientes asociados al legajo <span className="font-semibold">{r.legajo}</span> en la Mesa de
                        Entradas Virtual, o todavía no figuran cargados. Verificá el número o probá con otro.
                      </p>
                    </div>
                    <Salvavidas legajo={r.legajo} motivo="¿Esperabas ver un expediente?" />
                  </div>
                )}

                {r.resultado === 'SIN_ADMIN' && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <AlertTriangle size={26} className="text-amber-500" />
                    <p className="text-sm font-semibold text-brand-ink">Tu usuario todavía no está vinculado</p>
                    <p className="max-w-sm text-xs text-brand-muted">
                      No encontramos tu administración. Escribinos y lo configuramos para que puedas consultar la Mesa de Entradas Virtual.
                    </p>
                  </div>
                )}

                {r.resultado === 'RATE_LIMITED' && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <Clock size={26} className="text-brand-cyan" />
                    <p className="text-sm font-semibold text-brand-ink">Estamos con muchas consultas</p>
                    <p className="max-w-sm text-xs text-brand-muted">Probá de nuevo en unos segundos.</p>
                    <button onClick={() => buscar(legajoInput || searchedLegajo, false)} className="rounded-lg bg-brand-cyan px-3 py-2 text-xs font-semibold text-white hover:bg-brand-cyan/90">Reintentar</button>
                  </div>
                )}

                {['TRAMIX_DOWN', 'TIMEOUT', 'CIRCUIT_OPEN', 'PARSE_ERROR', 'TC_BLOCKED', 'ERROR', 'NO_AUTH', 'FORBIDDEN', 'INVALID'].includes(r.resultado) && (
                  <div className="space-y-4 py-2">
                    <div className="flex flex-col items-center gap-2 py-3 text-center">
                      <AlertTriangle size={26} className="text-amber-500" />
                      <p className="text-sm font-semibold text-brand-ink">La Mesa de Entradas Virtual no responde ahora</p>
                      <p className="max-w-sm text-xs text-brand-muted">Es un sitio del Gobierno de la Provincia y a veces no está disponible. Podés intentar directamente desde el sitio oficial.</p>
                    </div>
                    <Salvavidas legajo={searchedLegajo} motivo="Consultá directamente en el sitio oficial" />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
