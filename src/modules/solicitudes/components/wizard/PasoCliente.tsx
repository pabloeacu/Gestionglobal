// Paso 1 · Cliente (detectar vía de solicitud).
// Portal → cliente ya conocido (vinculación automática). Landing → detecta si
// ya existe (cross-match por email/CUIT/DNI) o es nuevo. Collect-only: sólo
// setea el estado; el alta/vínculo real ocurre en el ProcesadorFinal.

import { useEffect, useState } from 'react';
import { CheckCircle2, Sparkles, UserPlus, Users } from 'lucide-react';
import { Field, Input, Select, StepPanel } from '@/components/common';
import { toast } from '@/lib/toast';
import { formatCuit, soloDigitosCuit } from '@/lib/cuit';
import { matchClienteParaSolicitud } from '@/services/api/solicitudes';
import { quickSearchAdministraciones } from '@/services/api/administraciones';
import type { PasoProps } from './types';

interface MatchRow {
  administracion_id: string;
  administracion_nombre: string;
  match_por: string;
}

export function PasoCliente({ solicitud, flags, state, set }: PasoProps) {
  const [matchSugerido, setMatchSugerido] = useState<MatchRow | null>(null);
  const [matchIgnorado, setMatchIgnorado] = useState(false);
  const [clienteSearch, setClienteSearch] = useState('');
  const [encontrados, setEncontrados] = useState<
    Array<{ id: string; nombre: string; cuit: string | null }>
  >([]);

  // Cross-match (Bloque J / obs 14): si la solicitud no está vinculada,
  // cruzamos email/CUIT/DNI contra administraciones existentes.
  useEffect(() => {
    if (solicitud.cliente_id) return;
    if (!solicitud.formulario_submission_id) return;
    void matchClienteParaSolicitud(solicitud.formulario_submission_id).then((res) => {
      if (res.ok && res.data) setMatchSugerido(res.data as unknown as MatchRow);
    });
  }, [solicitud.cliente_id, solicitud.formulario_submission_id]);

  // Búsqueda de clientes existentes.
  useEffect(() => {
    if (state.modoCliente !== 'existente') return;
    const t = setTimeout(async () => {
      const res = await quickSearchAdministraciones(clienteSearch, 10);
      if (res.ok) setEncontrados(res.data);
    }, 220);
    return () => clearTimeout(t);
  }, [state.modoCliente, clienteSearch]);

  function aceptarMatch() {
    if (!matchSugerido) return;
    set((s) => ({
      ...s,
      modoCliente: 'existente',
      clienteIdExistente: matchSugerido.administracion_id,
    }));
    toast.success('Cliente vinculado', {
      description: `El servicio se añadirá a ${matchSugerido.administracion_nombre}`,
    });
  }

  const subtitle =
    flags.origen === 'portal'
      ? 'La solicitud entró por el portal de un cliente: ya sabemos a quién anexar el servicio. Confirmá o cambiá el vínculo.'
      : 'Entró por la landing pública. Detectamos si el solicitante ya es cliente (para no duplicar) o si hay que darlo de alta.';

  return (
    <StepPanel stepKey="cliente" title="1 · Cliente" subtitle={subtitle}>
      {/* Acción sugerida por origen */}
      {flags.origen === 'portal' && flags.clienteConocido && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">
            <Sparkles size={12} className="mr-1 inline" /> Vinculación automática
          </p>
          <p className="mt-0.5 text-emerald-800">
            Vino por el portal de{' '}
            <strong>{solicitud.cliente_nombre ?? 'un cliente existente'}</strong>. Lo
            dejamos vinculado; podés cambiarlo si fuese necesario.
          </p>
        </div>
      )}

      {/* Cross-match landing */}
      {matchSugerido &&
        !matchIgnorado &&
        state.clienteIdExistente !== matchSugerido.administracion_id && (
          <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Coincidencia detectada
            </p>
            <p className="mt-1 text-sm text-brand-ink">
              Coincide por <strong>{matchSugerido.match_por}</strong> con{' '}
              <strong>{matchSugerido.administracion_nombre}</strong>. ¿Añadir el servicio a
              esa cuenta en vez de crear un cliente nuevo?
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={aceptarMatch}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
              >
                Vincular a {matchSugerido.administracion_nombre}
              </button>
              <button
                type="button"
                onClick={() => setMatchIgnorado(true)}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                Es un cliente nuevo
              </button>
            </div>
          </div>
        )}

      {/* Toggle modo */}
      <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => set((s) => ({ ...s, modoCliente: 'nuevo' }))}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
            state.modoCliente === 'nuevo'
              ? 'bg-white text-brand-ink shadow-sm'
              : 'text-brand-muted hover:text-brand-ink'
          }`}
        >
          <UserPlus size={14} /> Cliente nuevo
        </button>
        <button
          type="button"
          onClick={() => set((s) => ({ ...s, modoCliente: 'existente' }))}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
            state.modoCliente === 'existente'
              ? 'bg-white text-brand-ink shadow-sm'
              : 'text-brand-muted hover:text-brand-ink'
          }`}
        >
          <Users size={14} /> Vincular existente
        </button>
      </div>

      {state.modoCliente === 'nuevo' ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Razón social / Nombre" required>
            <Input
              value={state.nuevoCliente.nombre}
              onChange={(e) =>
                set((s) => ({ ...s, nuevoCliente: { ...s.nuevoCliente, nombre: e.target.value } }))
              }
            />
          </Field>
          <Field label="CUIT">
            <Input
              inputMode="numeric"
              value={formatCuit(state.nuevoCliente.cuit ?? '')}
              onChange={(e) =>
                set((s) => ({
                  ...s,
                  nuevoCliente: {
                    ...s.nuevoCliente,
                    cuit: soloDigitosCuit(e.target.value) || null,
                  },
                }))
              }
              placeholder="XX-XXXXXXXX-X"
            />
          </Field>
          <Field label="Email del cliente">
            <Input
              type="email"
              value={state.nuevoCliente.email ?? ''}
              onChange={(e) =>
                set((s) => ({
                  ...s,
                  nuevoCliente: { ...s.nuevoCliente, email: e.target.value || null },
                }))
              }
            />
          </Field>
          <Field label="Teléfono">
            <Input
              value={state.nuevoCliente.telefono ?? ''}
              onChange={(e) =>
                set((s) => ({
                  ...s,
                  nuevoCliente: { ...s.nuevoCliente, telefono: e.target.value || null },
                }))
              }
            />
          </Field>
          <Field label="Condición IVA">
            <Select
              value={state.nuevoCliente.condicion_iva ?? 'monotributo'}
              onChange={(e) =>
                set((s) => ({
                  ...s,
                  nuevoCliente: { ...s.nuevoCliente, condicion_iva: e.target.value },
                }))
              }
            >
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="monotributo">Monotributo</option>
              <option value="exento">Exento</option>
              <option value="consumidor_final">Consumidor Final</option>
            </Select>
          </Field>
          <Field label="Domicilio fiscal">
            <Input
              value={state.nuevoCliente.domicilio_fiscal ?? ''}
              onChange={(e) =>
                set((s) => ({
                  ...s,
                  nuevoCliente: { ...s.nuevoCliente, domicilio_fiscal: e.target.value || null },
                }))
              }
            />
          </Field>
          <div className="sm:col-span-2">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
              <Sparkles size={11} className="mr-1 inline" />
              Al procesar le enviaremos un correo con su usuario (
              {state.nuevoCliente.email ?? 'sin email'}) y una contraseña temporal para
              acceder al portal.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Field label="Buscar administración">
            <Input
              value={clienteSearch}
              onChange={(e) => setClienteSearch(e.target.value)}
              placeholder="Nombre, razón social…"
            />
          </Field>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {encontrados.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-brand-muted">
                Sin resultados. Probá otra búsqueda.
              </p>
            ) : (
              encontrados.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set((s) => ({ ...s, clienteIdExistente: c.id }))}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    state.clienteIdExistente === c.id
                      ? 'border-brand-cyan bg-brand-cyan-pale/40 text-brand-ink'
                      : 'border-transparent text-brand-ink hover:bg-slate-50'
                  }`}
                >
                  <span>
                    <span className="font-semibold">{c.nombre}</span>
                    <span className="ml-2 text-xs text-brand-muted">CUIT {c.cuit ?? '—'}</span>
                  </span>
                  {state.clienteIdExistente === c.id && (
                    <CheckCircle2 size={16} className="text-brand-cyan" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </StepPanel>
  );
}
