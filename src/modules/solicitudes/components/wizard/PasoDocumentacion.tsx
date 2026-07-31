// Paso 2 · Revisar documentación y pagos.
// Lista los archivos del formulario (submission_adjuntos) con visor + un ✓/✗
// por archivo. Según el resultado, gerencia elige cómo seguir:
//  - completa            → activación normal
//  - pedir_y_avanzar     → se activa igual; el PedidoDoc queda como primer tracking
//  - revision  (TERMINAL)→ no se activa: mail al cliente + solicitud en_revision
//  - rechazo   (TERMINAL)→ mail formal de rechazo
//  - descarte  (TERMINAL)→ descarte interno (sin mail)
// Collect-only: las acciones se ejecutan en el ProcesadorFinal (Q1/Q2).

import { useEffect, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  Send,
  Trash2,
} from 'lucide-react';
import { Field, StepPanel, Textarea } from '@/components/common';
import { fieldLabelMap, labelDeCampo } from '@/lib/formSchema';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  getVisibilidadAdjuntosForm,
  setAdjuntoVisibleGestoria,
} from '@/services/api/solicitudes';
import { adjKey, type DocOutcome, type PasoProps } from './types';

interface OutcomeOpcion {
  key: DocOutcome;
  titulo: string;
  desc: string;
  terminal?: boolean;
  icon: typeof Send;
}

const OPCIONES: OutcomeOpcion[] = [
  {
    key: 'pedir_y_avanzar',
    titulo: 'Pedir documentación y avanzar',
    desc: 'Se crea el trámite igual; el primer tracking es el pedido de documentación, con banner en el portal del cliente.',
    icon: Inbox,
  },
  {
    key: 'revision',
    titulo: 'Pedir y dejar en revisión',
    desc: 'No se activa todavía: se le pide al cliente por mail y la solicitud queda en revisión.',
    terminal: true,
    icon: Send,
  },
  {
    key: 'rechazo',
    titulo: 'Rechazar',
    desc: 'Se le avisa al cliente por mail con el motivo. No se crea el trámite.',
    terminal: true,
    icon: Ban,
  },
  {
    key: 'descarte',
    titulo: 'Descartar',
    desc: 'Se descarta internamente, sin avisarle al cliente.',
    terminal: true,
    icon: Trash2,
  },
];

function mensajeLabel(o: DocOutcome): string {
  switch (o) {
    case 'rechazo':
      return 'Motivo del rechazo (se le envía al cliente)';
    case 'descarte':
      return 'Motivo del descarte (interno)';
    default:
      return '¿Qué documentación falta o está mal? Se le comunica al cliente';
  }
}

export function PasoDocumentacion({ solicitud, state, set }: PasoProps) {
  const adjuntos = solicitud.submission_adjuntos ?? [];
  // Referencia del campo (consigna) que completa cada archivo: resolvemos el
  // slug `campo` → etiqueta humana usando el schema del formulario, para que
  // los documentos no queden sueltos sino anclados a su consigna (Pablo).
  const labelMap = useMemo(
    () => fieldLabelMap(solicitud.formulario_schema),
    [solicitud.formulario_schema],
  );

  // Inicializamos cada archivo en ✓ (correcto) la primera vez: el camino feliz
  // (todo bien) avanza con un click; gerencia marca ✗ donde corresponda.
  useEffect(() => {
    if (adjuntos.length === 0) return;
    set((s) => {
      const next = { ...s.docChecks };
      let changed = false;
      adjuntos.forEach((a, i) => {
        const k = adjKey(a.campo, a.nombre, i);
        if (!(k in next)) {
          next[k] = true;
          changed = true;
        }
      });
      return changed ? { ...s, docChecks: next } : s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjuntos.length]);

  const hayCruz = useMemo(
    () => Object.values(state.docChecks).some((v) => v === false),
    [state.docChecks],
  );

  // Coherencia outcome ↔ estado de los checks.
  useEffect(() => {
    if (!hayCruz && state.docOutcome !== 'completa') {
      set((s) => ({ ...s, docOutcome: 'completa' }));
    } else if (hayCruz && state.docOutcome === 'completa') {
      set((s) => ({ ...s, docOutcome: 'pedir_y_avanzar' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayCruz]);

  // DGG-122 · "Ocultar a gestoría" por adjunto. El estado visible se persiste
  // al instante (RPC staff-only): así ya rige cuando después se derive. Regla
  // de Pablo: al marcar ✗ Incorrecto se PRE-OCULTA solo (destildable — la
  // gerencia manda); al volver a ✓ se restaura SOLO si el ocultamiento fue
  // automático (un ocultamiento manual nunca se pisa). Jamás bloquea Siguiente.
  //
  // §6 (hallazgo crítico): vis/auto viven en el ESTADO DEL WIZARD (el shell
  // sigue montado entre pasos) y el paso re-sincroniza FRESCO desde BD en cada
  // montaje — el snapshot de la página puede estar viejo y un init stale
  // mentía ("Visible" con la BD en oculto) o pisaba un ocultamiento manual.
  const vis = state.docVisGestoria;
  const autoSet = useMemo(() => new Set(state.docVisAuto), [state.docVisAuto]);
  const [savingVis, setSavingVis] = useState<Set<string>>(new Set());

  useEffect(() => {
    const subId = solicitud.formulario_submission_id;
    if (!subId || adjuntos.length === 0) return;
    void (async () => {
      const r = await getVisibilidadAdjuntosForm(subId);
      if (!r.ok) return;
      set((s) => ({
        ...s,
        docVisGestoria: r.data,
        // Un flag "auto" solo sobrevive mientras el adjunto SIGA oculto en BD;
        // si alguien lo restauró afuera, el auto viejo no debe revivir nada.
        docVisAuto: s.docVisAuto.filter((id) => r.data[id] === false),
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud.id]);

  async function persistirVisible(adjId: string, visible: boolean) {
    setSavingVis((s) => new Set(s).add(adjId));
    set((s) => ({
      ...s,
      docVisGestoria: { ...s.docVisGestoria, [adjId]: visible },
    }));
    const r = await setAdjuntoVisibleGestoria('form', adjId, visible);
    setSavingVis((s) => {
      const n = new Set(s);
      n.delete(adjId);
      return n;
    });
    if (!r.ok) {
      set((s) => ({
        ...s,
        docVisGestoria: { ...s.docVisGestoria, [adjId]: !visible },
      }));
      toast.error('No pudimos cambiar la visibilidad para gestoría', {
        description: humanizeError(r.error),
      });
    }
  }

  function toggleVisibleManual(adjId: string) {
    if (savingVis.has(adjId)) return;
    set((s) => ({ ...s, docVisAuto: s.docVisAuto.filter((x) => x !== adjId) }));
    void persistirVisible(adjId, !(vis[adjId] ?? true));
  }

  function setCheck(k: string, val: boolean) {
    set((s) => ({ ...s, docChecks: { ...s.docChecks, [k]: val } }));
    // Presunción DGG-122: lo incorrecto se oculta al gestor (confundiría un
    // archivo que gerencia ya detectó como malo).
    const idx = adjuntos.findIndex((a, i) => adjKey(a.campo, a.nombre, i) === k);
    const adj = idx >= 0 ? adjuntos[idx] : undefined;
    if (!adj || savingVis.has(adj.id)) return;
    if (val === false && (vis[adj.id] ?? true)) {
      set((s) => ({ ...s, docVisAuto: [...s.docVisAuto.filter((x) => x !== adj.id), adj.id] }));
      void persistirVisible(adj.id, false);
    } else if (val === true && autoSet.has(adj.id)) {
      set((s) => ({ ...s, docVisAuto: s.docVisAuto.filter((x) => x !== adj.id) }));
      void persistirVisible(adj.id, true);
    }
  }
  function setOutcome(o: DocOutcome) {
    set((s) => ({ ...s, docOutcome: o }));
  }

  return (
    <StepPanel
      stepKey="documentacion"
      title="2 · Revisar documentación y pagos"
      subtitle="Revisá lo que adjuntó el solicitante, marcá cada archivo como correcto (✓) o incorrecto (✗), y elegí cómo seguir."
    >
      {/* Lista de adjuntos */}
      {adjuntos.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-brand-muted">
          <FileText size={14} className="mr-1 inline" />
          La solicitud no trae archivos adjuntos. Podés continuar o pedir documentación al
          cliente abajo.
        </div>
      ) : (
        <ul className="space-y-2">
          {adjuntos.map((a, i) => {
            const k = adjKey(a.campo, a.nombre, i);
            const val = state.docChecks[k];
            return (
              <li
                key={k}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold tracking-wide text-brand-cyan break-words">
                    {labelDeCampo(labelMap, a.campo)}
                  </p>
                  <p className="truncate text-sm font-medium text-brand-ink">{a.nombre}</p>
                  {a.url && (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline"
                    >
                      <ExternalLink size={11} /> Ver archivo
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCheck(k, true)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      val === true
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 text-brand-muted hover:bg-slate-50'
                    }`}
                  >
                    ✓ Correcto
                  </button>
                  <button
                    type="button"
                    onClick={() => setCheck(k, false)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                      val === false
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : 'border-slate-200 text-brand-muted hover:bg-slate-50'
                    }`}
                  >
                    ✗ Incorrecto
                  </button>
                  {/* DGG-122 · toggle de visibilidad para el gestor */}
                  <button
                    type="button"
                    onClick={() => toggleVisibleManual(a.id)}
                    disabled={savingVis.has(a.id)}
                    title={
                      (vis[a.id] ?? true)
                        ? 'El gestor VE este archivo. Click para ocultárselo (queda guardado para gerencia).'
                        : 'Oculto a gestoría: no viaja en el mail ni aparece en su panel. Click para mostrarlo.'
                    }
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                      (vis[a.id] ?? true)
                        ? 'border-slate-200 text-brand-muted hover:bg-slate-50'
                        : 'border-amber-300 bg-amber-50 text-amber-700'
                    }`}
                  >
                    {(vis[a.id] ?? true) ? <Eye size={13} /> : <EyeOff size={13} />}
                    {(vis[a.id] ?? true) ? 'Visible a gestoría' : 'Oculto a gestoría'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Resultado */}
      {!hayCruz ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 size={14} className="mr-1 inline" />
          <strong>Documentación completa.</strong> Todo correcto: podés continuar al
          comprobante.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-brand-ink">
            Hay documentación incorrecta o faltante. ¿Cómo seguimos?
          </p>
          <div className="grid grid-cols-1 gap-2">
            {OPCIONES.map((o) => {
              const Icon = o.icon;
              const activa = state.docOutcome === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setOutcome(o.key)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                    activa
                      ? 'border-brand-cyan bg-brand-cyan-pale/30 ring-1 ring-brand-cyan'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                      activa ? 'bg-brand-cyan text-white' : 'bg-slate-100 text-brand-muted'
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
                      {o.titulo}
                      {o.terminal && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-700">
                          termina acá
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-brand-muted">{o.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <Field label={mensajeLabel(state.docOutcome)} required>
            <Textarea
              rows={3}
              value={state.docMensajeCliente}
              onChange={(e) => set((s) => ({ ...s, docMensajeCliente: e.target.value }))}
              placeholder={
                state.docOutcome === 'rechazo' || state.docOutcome === 'descarte'
                  ? 'Detalle del motivo…'
                  : 'Ej: La copia del DNI está ilegible; reenviar el comprobante de pago…'
              }
            />
          </Field>
        </div>
      )}
    </StepPanel>
  );
}
