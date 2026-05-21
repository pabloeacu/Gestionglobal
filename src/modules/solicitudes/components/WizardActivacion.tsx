import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Send,
  UserPlus,
  Users,
  CalendarRange,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  Field,
  Input,
  Modal,
  Select,
  Stepper,
  StepPanel,
  Textarea,
  type Step,
} from '@/components/common';
import { toast } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import {
  activar,
  derivar,
  type CrearClienteInput,
  type SolicitudDetalle,
} from '@/services/api/solicitudes';

interface Props {
  open: boolean;
  onClose: () => void;
  solicitud: SolicitudDetalle;
  onActivated?: (trackingId: string) => void;
}

const STEPS: { key: string; label: string }[] = [
  { key: 'derivar', label: 'Derivar a gestoría' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'tracking', label: 'Tracking' },
];

// Wizard 3 pasos: derivar a gestoría externa → alta cliente (o vincular) →
// crear tracking del servicio. Cita Documento "Flujo Maestro" §6-8.
export function WizardActivacion({
  open,
  onClose,
  solicitud,
  onActivated,
}: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // PASO 1 — Derivación
  const [destinatarioEmail, setDestinatarioEmail] = useState('');
  const [destinatarioNombre, setDestinatarioNombre] = useState('');
  const [observDerivacion, setObservDerivacion] = useState('');
  const [busy1, setBusy1] = useState(false);
  const [paso1Hecho, setPaso1Hecho] = useState(false);

  // PASO 2 — Cliente (nuevo o existente)
  const [modoCliente, setModoCliente] = useState<'nuevo' | 'existente'>(
    solicitud.cliente_id ? 'existente' : 'nuevo',
  );
  const [clienteIdExistente, setClienteIdExistente] = useState<string>(
    solicitud.cliente_id ?? '',
  );
  const [clienteSearch, setClienteSearch] = useState('');
  const [clientesEncontrados, setClientesEncontrados] = useState<
    Array<{ id: string; nombre: string; cuit: string | null }>
  >([]);
  const [nuevoCliente, setNuevoCliente] = useState<CrearClienteInput>({
    nombre: solicitud.solicitante_nombre ?? '',
    email: solicitud.solicitante_email ?? null,
    telefono: solicitud.solicitante_telefono ?? null,
    cuit: null,
    responsable_nombre: solicitud.solicitante_nombre?.split(' ')[0] ?? null,
    responsable_apellido:
      solicitud.solicitante_nombre?.split(' ').slice(1).join(' ') || null,
    condicion_iva: 'monotributo',
  });

  // PASO 3 — Tracking
  const periodoDefault = new Date().getFullYear().toString();
  const [periodo, setPeriodo] = useState(periodoDefault);
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [busyActivar, setBusyActivar] = useState(false);

  // Búsqueda de clientes existentes
  useEffect(() => {
    if (modoCliente !== 'existente') return;
    const t = setTimeout(async () => {
      const q = supabase
        .from('administraciones')
        .select('id, nombre, cuit')
        .eq('activo', true)
        .order('nombre')
        .limit(10);
      const { data } =
        clienteSearch.trim().length > 0
          ? await q.ilike('nombre', `%${clienteSearch.trim()}%`)
          : await q;
      setClientesEncontrados(
        (data as Array<{ id: string; nombre: string; cuit: string | null }>) ??
          [],
      );
    }, 220);
    return () => clearTimeout(t);
  }, [modoCliente, clienteSearch]);

  const stepsWithStatus: Step[] = useMemo(
    () =>
      STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        state:
          i < step
            ? 'done'
            : i === step
              ? 'current'
              : 'pending',
      })),
    [step],
  );

  async function handleDerivar() {
    if (!destinatarioEmail.trim()) {
      toast.error('Necesitamos el email de la gestoría');
      return;
    }
    setBusy1(true);
    const res = await derivar(solicitud.id, {
      destinatario_email: destinatarioEmail.trim(),
      destinatario_nombre: destinatarioNombre.trim() || undefined,
      observaciones: observDerivacion.trim() || undefined,
    });
    setBusy1(false);
    if (!res.ok) {
      toast.error('No pudimos derivar', { description: res.error.message });
      return;
    }
    toast.success('Solicitud derivada a la gestoría', {
      description: `Se envió al ${destinatarioEmail}`,
    });
    setPaso1Hecho(true);
    setStep(1);
  }

  async function handleActivar() {
    setBusyActivar(true);
    const res = await activar(solicitud.id, {
      cliente_id:
        modoCliente === 'existente' ? clienteIdExistente || null : null,
      crear_cliente: modoCliente === 'nuevo' ? nuevoCliente : null,
      periodo,
      fecha_inicio: fechaInicio,
    });
    setBusyActivar(false);
    if (!res.ok) {
      toast.error('No pudimos activar', { description: res.error.message });
      return;
    }
    toast.success('¡Solicitud activada!', {
      description:
        modoCliente === 'nuevo'
          ? 'Cliente creado y tracking iniciado.'
          : 'Tracking iniciado en el cliente existente.',
    });
    onActivated?.(res.data.trackingId);
    onClose();
    // Llevamos al gerente al tracking recién creado
    navigate(`/gerencia/tramites/${res.data.trackingId}`);
  }

  const canSiguienteStep2 =
    (modoCliente === 'nuevo' && nuevoCliente.nombre.trim().length > 0) ||
    (modoCliente === 'existente' && clienteIdExistente.length > 0);
  const canActivar = canSiguienteStep2 && periodo.trim() && fechaInicio;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Wizard de activación"
      kicker="Solicitud · Flujo Maestro"
      width={760}
      closeOnBackdrop={false}
    >
      <div className="space-y-5">
        {/* Stepper */}
        <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-3">
          <Stepper steps={stepsWithStatus} current={step} onJump={setStep} />
        </div>

        {/* PASO 1 — Derivar */}
        {step === 0 && (
          <StepPanel
            stepKey="derivar"
            title="1 · Derivar a la gestoría externa"
            subtitle="Mandamos un correo con los datos de la solicitud y un link de acceso seguro (sin login) para que la gestoría revise la documentación."
          >
            <div className="space-y-3">
              <Field label="Email del gestor" required>
                <Input
                  type="email"
                  value={destinatarioEmail}
                  onChange={(e) => setDestinatarioEmail(e.target.value)}
                  placeholder="gestoria@ejemplo.com"
                />
              </Field>
              <Field label="Nombre del gestor (opcional)">
                <Input
                  value={destinatarioNombre}
                  onChange={(e) => setDestinatarioNombre(e.target.value)}
                  placeholder="Lic. María Pérez"
                />
              </Field>
              <Field label="Observaciones para la gestoría">
                <Textarea
                  value={observDerivacion}
                  onChange={(e) => setObservDerivacion(e.target.value)}
                  placeholder="Detalles del caso, urgencia, foco específico…"
                  rows={3}
                />
              </Field>

              <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 p-3 text-xs text-brand-ink">
                <p className="font-semibold">
                  <Send size={11} className="mr-1 inline" />
                  Lo que va a recibir
                </p>
                <ul className="mt-1 list-disc pl-4 space-y-0.5 text-brand-muted">
                  <li>
                    Solicitud:{' '}
                    <span className="font-medium text-brand-ink">
                      {solicitud.formulario_titulo}
                    </span>
                  </li>
                  <li>Adjuntos del solicitante en links descargables.</li>
                  <li>Acceso seguro de 14 días (sin requerir login).</li>
                </ul>
              </div>
            </div>

            <div className="mt-5 flex justify-between">
              <Button variant="ghost" onClick={onClose} disabled={busy1}>
                Cancelar
              </Button>
              <div className="flex gap-2">
                {paso1Hecho && (
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    Saltar <ArrowRight size={14} />
                  </Button>
                )}
                <Button onClick={handleDerivar} loading={busy1} disabled={busy1}>
                  <Send size={14} />
                  Derivar y continuar
                </Button>
              </div>
            </div>
          </StepPanel>
        )}

        {/* PASO 2 — Cliente */}
        {step === 1 && (
          <StepPanel
            stepKey="cliente"
            title="2 · Alta del cliente"
            subtitle="Si el solicitante es un cliente nuevo lo creamos ahora con sus datos. Si ya existe en el sistema lo vinculamos sin duplicar."
          >
            {/* Toggle modo */}
            <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setModoCliente('nuevo')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  modoCliente === 'nuevo'
                    ? 'bg-white text-brand-ink shadow-sm'
                    : 'text-brand-muted hover:text-brand-ink'
                }`}
              >
                <UserPlus size={14} /> Cliente nuevo
              </button>
              <button
                type="button"
                onClick={() => setModoCliente('existente')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  modoCliente === 'existente'
                    ? 'bg-white text-brand-ink shadow-sm'
                    : 'text-brand-muted hover:text-brand-ink'
                }`}
              >
                <Users size={14} /> Vincular existente
              </button>
            </div>

            {modoCliente === 'nuevo' ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Razón social / Nombre" required>
                  <Input
                    value={nuevoCliente.nombre}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({ ...p, nombre: e.target.value }))
                    }
                  />
                </Field>
                <Field label="CUIT">
                  <Input
                    value={nuevoCliente.cuit ?? ''}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({
                        ...p,
                        cuit: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Email del cliente">
                  <Input
                    type="email"
                    value={nuevoCliente.email ?? ''}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({
                        ...p,
                        email: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Teléfono">
                  <Input
                    value={nuevoCliente.telefono ?? ''}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({
                        ...p,
                        telefono: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <Field label="Condición IVA">
                  <Select
                    value={nuevoCliente.condicion_iva ?? 'monotributo'}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({
                        ...p,
                        condicion_iva: e.target.value,
                      }))
                    }
                  >
                    <option value="responsable_inscripto">
                      Responsable Inscripto
                    </option>
                    <option value="monotributo">Monotributo</option>
                    <option value="exento">Exento</option>
                    <option value="consumidor_final">Consumidor Final</option>
                  </Select>
                </Field>
                <Field label="Domicilio fiscal">
                  <Input
                    value={nuevoCliente.domicilio_fiscal ?? ''}
                    onChange={(e) =>
                      setNuevoCliente((p) => ({
                        ...p,
                        domicilio_fiscal: e.target.value || null,
                      }))
                    }
                  />
                </Field>
                <div className="sm:col-span-2">
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                    <Sparkles size={11} className="mr-1 inline" />
                    Al activar le enviaremos un correo con su usuario (
                    {nuevoCliente.email ?? 'sin email'}) y una contraseña
                    temporal para acceder al portal.
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
                  {clientesEncontrados.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-brand-muted">
                      Sin resultados. Probá otra búsqueda.
                    </p>
                  ) : (
                    clientesEncontrados.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setClienteIdExistente(c.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                          clienteIdExistente === c.id
                            ? 'border-brand-cyan bg-brand-cyan-pale/40 text-brand-ink'
                            : 'border-transparent text-brand-ink hover:bg-slate-50'
                        }`}
                      >
                        <span>
                          <span className="font-semibold">{c.nombre}</span>
                          <span className="ml-2 text-xs text-brand-muted">
                            CUIT {c.cuit ?? '—'}
                          </span>
                        </span>
                        {clienteIdExistente === c.id && (
                          <CheckCircle2
                            size={16}
                            className="text-brand-cyan"
                          />
                        )}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>
                <ArrowLeft size={14} /> Atrás
              </Button>
              <Button
                onClick={() => setStep(2)}
                disabled={!canSiguienteStep2}
              >
                Siguiente <ArrowRight size={14} />
              </Button>
            </div>
          </StepPanel>
        )}

        {/* PASO 3 — Tracking */}
        {step === 2 && (
          <StepPanel
            stepKey="tracking"
            title="3 · Crear tracking del servicio"
            subtitle="Definí el periodo y la fecha de inicio. Si ya hubo un tracking previo del mismo servicio + cliente, lo vinculamos como continuación automáticamente."
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Periodo" required hint="Ej: 2025, 2025-Q1, 2025-12">
                <Input
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value)}
                />
              </Field>
              <Field label="Fecha de inicio" required>
                <Input
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                />
              </Field>
            </div>

            <div className="mt-4 rounded-lg border border-brand-cyan/30 bg-brand-cyan-pale/30 p-3 text-xs">
              <p className="font-semibold text-brand-ink">
                <CalendarRange size={11} className="mr-1 inline" />
                Lo que va a ocurrir al activar
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-brand-muted">
                <li>Se crea el tracking del servicio para el periodo {periodo}.</li>
                <li>
                  {modoCliente === 'nuevo'
                    ? 'Se da de alta al cliente y se le envía email de bienvenida con credenciales.'
                    : 'Se vincula al cliente existente sin duplicar.'}
                </li>
                <li>El cliente puede seguir el avance desde su portal.</li>
              </ul>
            </div>

            <div className="mt-5 flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft size={14} /> Atrás
              </Button>
              <Button
                onClick={handleActivar}
                loading={busyActivar}
                disabled={!canActivar || busyActivar}
              >
                {busyActivar ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
                Activar todo
              </Button>
            </div>
          </StepPanel>
        )}
      </div>
    </Modal>
  );
}
