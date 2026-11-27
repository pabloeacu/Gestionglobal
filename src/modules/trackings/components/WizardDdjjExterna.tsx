import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  UserPlus,
  Building2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  KeyRound,
  AlertTriangle,
  Receipt,
  FileUp,
  ExternalLink,
  X,
} from 'lucide-react';
import { Drawer, Button, Field, Input, Select, Stepper, StepPanel, type Step } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  quickSearchAdministraciones,
  adminPrecheckIdentidad,
  getAdministracionContacto,
  type AdministracionQuickRow,
} from '@/services/api/administraciones';
import { fetchAccesoEstado, altaClientePortal, type AccesoEstado } from '@/services/api/usuarios';
import { iniciarDdjjExterna, type DdjjExternaResult } from '@/services/api/ddjjExterna';
import { subirAdjunto } from '@/services/api/tramites';
import { WizardCierreDdjj } from './WizardCierreDdjj';

type Paso = 'cliente' | 'presentacion' | 'procesando' | 'done';
type ModoCliente = 'existente' | 'nuevo';

const CONDICIONES_IVA = [
  { v: '', l: 'Sin especificar' },
  { v: 'consumidor_final', l: 'Consumidor final' },
  { v: 'responsable_inscripto', l: 'Responsable inscripto' },
  { v: 'monotributo', l: 'Monotributo' },
  { v: 'exento', l: 'Exento' },
] as const;

interface NuevoCliente {
  nombre: string;
  cuit: string;
  email: string;
  telefono: string;
  condicion_iva: string;
  localidad: string;
  provincia: string;
  direccion: string;
  responsable_nombre: string;
  responsable_apellido: string;
}

const NUEVO_VACIO: NuevoCliente = {
  nombre: '', cuit: '', email: '', telefono: '', condicion_iva: '',
  localidad: '', provincia: '', direccion: '', responsable_nombre: '', responsable_apellido: '',
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Si viene de la ficha de un cliente, arranca con ese cliente resuelto. */
  clientePreseleccionado?: { id: string; nombre: string; cuit?: string | null } | null;
  /** Se llama tras crear el trámite (para refrescar listas). */
  onCreado?: (tramiteId: string) => void;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function anioActual(): string {
  return String(new Date().getFullYear());
}

export function WizardDdjjExterna({ open, onClose, clientePreseleccionado, onCreado }: Props) {
  const navigate = useNavigate();
  const [paso, setPaso] = useState<Paso>('cliente');
  const [modo, setModo] = useState<ModoCliente>('existente');

  // Cliente existente
  const [search, setSearch] = useState('');
  const [resultados, setResultados] = useState<AdministracionQuickRow[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [elegido, setElegido] = useState<AdministracionQuickRow | null>(null);
  const [acceso, setAcceso] = useState<AccesoEstado | null>(null);
  const [emailElegido, setEmailElegido] = useState<string | null>(null);
  const [crearAccesoExistente, setCrearAccesoExistente] = useState(false);

  // Cliente nuevo
  const [nuevo, setNuevo] = useState<NuevoCliente>(NUEVO_VACIO);
  const [twinMsg, setTwinMsg] = useState<string | null>(null);

  // Presentación
  const [periodo, setPeriodo] = useState(anioActual());
  const [fechaInicio, setFechaInicio] = useState(hoyISO());

  // Proceso / resultado
  const [result, setResult] = useState<DdjjExternaResult | null>(null);
  const [portalMsg, setPortalMsg] = useState<string | null>(null);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [facturado, setFacturado] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [adjuntos, setAdjuntos] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const procesandoRef = useRef(false); // guard anti doble-submit (no crear 2 trámites)

  const reset = useCallback(() => {
    setPaso(clientePreseleccionado ? 'presentacion' : 'cliente');
    setModo('existente');
    setSearch(''); setResultados([]); setBuscando(false);
    setNuevo(NUEVO_VACIO); setTwinMsg(null);
    setPeriodo(anioActual()); setFechaInicio(hoyISO());
    setResult(null); setPortalMsg(null); setCierreOpen(false); setFacturado(false);
    setSubiendo(false); setAdjuntos([]);
    setCrearAccesoExistente(false);
    procesandoRef.current = false;
    if (clientePreseleccionado) {
      setElegido({ id: clientePreseleccionado.id, nombre: clientePreseleccionado.nombre, cuit: clientePreseleccionado.cuit ?? null });
      void cargarDatosElegido(clientePreseleccionado.id);
    } else {
      setElegido(null); setAcceso(null); setEmailElegido(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientePreseleccionado]);

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Búsqueda con debounce (mismo patrón que PasoCliente).
  useEffect(() => {
    if (!open || modo !== 'existente' || elegido) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setBuscando(true);
      const res = await quickSearchAdministraciones(search, 10);
      if (cancelled) return; // evita que una respuesta lenta pise resultados nuevos
      if (res.ok) setResultados(res.data);
      setBuscando(false);
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, modo, search, elegido]);

  // Precheck de identidad (gemelos por CUIT) al tipear el CUIT del nuevo cliente.
  useEffect(() => {
    if (modo !== 'nuevo') return;
    const cuit = nuevo.cuit.replace(/[^0-9]/g, '');
    if (cuit.length < 8) {
      setTwinMsg(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await adminPrecheckIdentidad(nuevo.cuit, null, null);
      if (res.ok && res.data.cuit_twin) {
        setTwinMsg(
          `Ya existe un cliente con ese CUIT: "${res.data.cuit_twin.nombre}". Si es el mismo, cancelá y elegilo como cliente existente.`,
        );
      } else {
        setTwinMsg(null);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [modo, nuevo.cuit]);

  async function cargarDatosElegido(id: string) {
    const [acc, adm] = await Promise.all([fetchAccesoEstado(id), getAdministracionContacto(id)]);
    if (acc.ok) setAcceso(acc.data);
    setEmailElegido(adm.ok ? (adm.data.email?.trim() || null) : null);
  }

  function elegirCliente(c: AdministracionQuickRow) {
    setElegido(c);
    setResultados([]);
    setCrearAccesoExistente(false);
    void cargarDatosElegido(c.id);
  }

  function limpiarElegido() {
    setElegido(null);
    setAcceso(null);
    setEmailElegido(null);
    setCrearAccesoExistente(false);
  }

  const clienteListo = modo === 'existente' ? !!elegido : nuevo.nombre.trim().length > 0;

  const steps: Step[] = [
    { key: 'cliente', label: 'Cliente' },
    { key: 'presentacion', label: 'Presentación' },
    { key: 'done', label: 'Listo' },
  ];
  const stepIdx = paso === 'cliente' ? 0 : paso === 'done' ? 2 : 1;

  async function procesar() {
    if (procesandoRef.current) return;
    procesandoRef.current = true;
    setPaso('procesando');
    setPortalMsg(null);
    const input =
      modo === 'existente'
        ? { clienteId: elegido!.id, periodo, fechaInicio }
        : {
            crearCliente: {
              nombre: nuevo.nombre.trim(),
              cuit: nuevo.cuit.trim() || null,
              email: nuevo.email.trim() || null,
              telefono: nuevo.telefono.trim() || null,
              condicion_iva: nuevo.condicion_iva || null,
              localidad: nuevo.localidad.trim() || null,
              provincia: nuevo.provincia.trim() || null,
              direccion: nuevo.direccion.trim() || null,
              responsable_nombre: nuevo.responsable_nombre.trim() || null,
              responsable_apellido: nuevo.responsable_apellido.trim() || null,
            },
            periodo,
            fechaInicio,
          };
    const res = await iniciarDdjjExterna(input);
    if (!res.ok) {
      toast.error('No se pudo crear la presentación', { description: humanizeError(res.error) });
      setPaso(clientePreseleccionado ? 'presentacion' : 'cliente');
      procesandoRef.current = false;
      return;
    }
    const data = res.data;
    setResult(data);
    onCreado?.(data.tramite_id);

    // Acceso al portal:
    //  · cliente NUEVO con email → lo provisiona el trigger de BD
    //    (trg_admin_provision_user, AFTER INSERT) que crea el user + bienvenida.
    //    NO llamamos altaClientePortal acá para no competir con el trigger
    //    (evita la carrera y el falso-negativo "no se pudo crear"). Idempotente.
    //  · cliente EXISTENTE sin usuario → no hay INSERT, el trigger no corre, así
    //    que lo creamos explícito sólo si gerencia tildó el checkbox.
    const email = data.email_cliente ?? (modo === 'nuevo' ? nuevo.email.trim() : emailElegido) ?? '';
    const nombre = data.nombre_cliente ?? (modo === 'nuevo' ? nuevo.nombre.trim() : elegido?.nombre) ?? 'Cliente';

    if (data.cliente_creado) {
      setPortalMsg(
        email.length > 0
          ? `El acceso al portal y la bienvenida con credenciales se envían automáticamente a ${email}.`
          : 'Cliente creado sin email: no se generó acceso al portal (podés agregarlo luego en la ficha).',
      );
    } else if (crearAccesoExistente && acceso?.tiene_user === false && email.length > 0) {
      const alta = await altaClientePortal({ administracion_id: data.administracion_id, email, nombre });
      if (alta.ok) {
        const pwSet = (alta.data as { password_set?: boolean } | null)?.password_set;
        setPortalMsg(
          pwSet
            ? `Acceso al portal creado — bienvenida con credenciales enviada a ${email}.`
            : `El cliente ya tenía acceso al portal (${email}).`,
        );
      } else {
        setPortalMsg(`No se pudo crear el acceso al portal: ${humanizeError(alta.error)}`);
      }
    }

    setPaso('done');
    toast.success('Presentación DDJJ creada');
  }

  async function subirDocs(files: FileList | null) {
    if (!files || files.length === 0 || !result) return;
    setSubiendo(true);
    for (const file of Array.from(files)) {
      const res = await subirAdjunto(result.tramite_id, file);
      if (res.ok) setAdjuntos((p) => [...p, file.name]);
      else toast.error(`No se pudo subir ${file.name}`, { description: humanizeError(res.error) });
    }
    setSubiendo(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function cerrarTodo() {
    reset();
    onClose();
  }

  const accesoBadge = useMemo(() => {
    if (!acceso) return null;
    if (!acceso.tiene_user) return { cls: 'bg-red-50 text-red-700 ring-red-200', txt: 'Sin acceso al portal' };
    if (!acceso.ya_ingreso) return { cls: 'bg-amber-50 text-amber-700 ring-amber-200', txt: 'Acceso creado, nunca ingresó' };
    return { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', txt: 'Portal activo' };
  }, [acceso]);

  return (
    <Drawer
      open={open}
      onClose={cerrarTodo}
      width={820}
      kicker="Declaración jurada"
      title="Nueva presentación de DDJJ externa"
      description="Dar de alta o identificar el cliente, abrir el trámite y facturar la presentación"
      icon={<Building2 size={20} />}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-brand-muted">
            {paso === 'cliente' && modo === 'existente' && elegido && `Cliente: ${elegido.nombre}`}
            {paso === 'presentacion' && `Período ${periodo || '—'}`}
          </div>
          <div className="flex items-center gap-2">
            {paso === 'cliente' && (
              <Button onClick={() => setPaso('presentacion')} disabled={!clienteListo}>
                Siguiente <ArrowRight size={14} />
              </Button>
            )}
            {paso === 'presentacion' && (
              <>
                <Button variant="secondary" onClick={() => setPaso('cliente')}>
                  <ArrowLeft size={14} /> Atrás
                </Button>
                <Button onClick={() => void procesar()}>
                  Crear presentación <ArrowRight size={14} />
                </Button>
              </>
            )}
            {paso === 'done' && (
              <Button variant="secondary" onClick={cerrarTodo}>
                Cerrar
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {paso !== 'procesando' && (
          <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-3">
            <Stepper steps={steps} current={stepIdx} compact />
          </div>
        )}

        {/* ── Paso 1: Cliente ── */}
        {paso === 'cliente' && (
          <StepPanel title="¿Quién presenta?" subtitle="Elegí un cliente existente o dá de alta uno nuevo." stepKey="cliente">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setModo('existente'); setNuevo(NUEVO_VACIO); setTwinMsg(null); }}
                className={`flex-1 rounded-xl border-2 p-3 text-left text-sm transition ${
                  modo === 'existente' ? 'border-brand-cyan bg-brand-cyan-pale/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Search size={16} className="mb-1 text-brand-cyan" />
                <div className="font-semibold text-brand-ink">Cliente existente</div>
                <div className="text-xs text-brand-muted">Buscar por nombre</div>
              </button>
              <button
                type="button"
                onClick={() => { setModo('nuevo'); limpiarElegido(); }}
                className={`flex-1 rounded-xl border-2 p-3 text-left text-sm transition ${
                  modo === 'nuevo' ? 'border-brand-cyan bg-brand-cyan-pale/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <UserPlus size={16} className="mb-1 text-brand-cyan" />
                <div className="font-semibold text-brand-ink">Cliente nuevo</div>
                <div className="text-xs text-brand-muted">Alta de ficha (histórico sin usuario)</div>
              </button>
            </div>

            {modo === 'existente' && (
              <div className="space-y-3">
                {!elegido ? (
                  <>
                    <Field label="Buscar cliente">
                      <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Nombre de la administración…"
                        autoFocus
                      />
                    </Field>
                    <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                      {buscando ? (
                        <div className="flex items-center gap-2 p-4 text-sm text-brand-muted">
                          <Loader2 size={14} className="animate-spin" /> Buscando…
                        </div>
                      ) : resultados.length === 0 ? (
                        <div className="p-4 text-sm text-brand-muted">
                          {search.trim() ? 'Sin resultados.' : 'Escribí para buscar.'}
                        </div>
                      ) : (
                        resultados.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => elegirCliente(c)}
                            className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm hover:bg-slate-50"
                          >
                            <span className="font-medium text-brand-ink">{c.nombre}</span>
                            {c.cuit && <span className="tabular text-xs text-brand-muted">{c.cuit}</span>}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-brand-cyan-pale/60 bg-brand-cyan-pale/10 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-display text-base font-bold text-brand-ink">{elegido.nombre}</div>
                        {elegido.cuit && <div className="tabular text-xs text-brand-muted">{elegido.cuit}</div>}
                        {accesoBadge && (
                          <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${accesoBadge.cls}`}>
                            {accesoBadge.txt}
                          </span>
                        )}
                      </div>
                      <button type="button" onClick={limpiarElegido} className="text-brand-muted hover:text-brand-ink" aria-label="Cambiar cliente">
                        <X size={16} />
                      </button>
                    </div>
                    {acceso?.tiene_user === false && (
                      <label className="mt-3 flex items-start gap-2 text-xs text-brand-ink/80">
                        <input
                          type="checkbox"
                          checked={crearAccesoExistente}
                          onChange={(e) => setCrearAccesoExistente(e.target.checked)}
                          className="mt-0.5 accent-brand-cyan"
                          disabled={!emailElegido}
                        />
                        <span>
                          Crear acceso al portal y enviar la bienvenida con credenciales
                          {emailElegido ? ` a ${emailElegido}` : ' (este cliente no tiene email cargado — agregalo en la ficha)'}.
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {modo === 'nuevo' && (
              <div className="space-y-3">
                <Field label="Nombre de la administración" required>
                  <Input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} autoFocus />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="CUIT">
                    <Input value={nuevo.cuit} onChange={(e) => setNuevo({ ...nuevo, cuit: e.target.value })} placeholder="30-XXXXXXXX-X" />
                  </Field>
                  <Field label="Email (acceso al portal)">
                    <Input value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} placeholder="correo@dominio" />
                  </Field>
                </div>
                {twinMsg && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>{twinMsg}</span>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Teléfono">
                    <Input value={nuevo.telefono} onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })} />
                  </Field>
                  <Field label="Condición IVA">
                    <Select value={nuevo.condicion_iva} onChange={(e) => setNuevo({ ...nuevo, condicion_iva: e.target.value })}>
                      {CONDICIONES_IVA.map((c) => (
                        <option key={c.v} value={c.v}>{c.l}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Localidad">
                    <Input value={nuevo.localidad} onChange={(e) => setNuevo({ ...nuevo, localidad: e.target.value })} />
                  </Field>
                  <Field label="Provincia">
                    <Input value={nuevo.provincia} onChange={(e) => setNuevo({ ...nuevo, provincia: e.target.value })} />
                  </Field>
                </div>
                <p className="text-xs text-brand-muted">
                  Al dar de alta un cliente con email, el sistema le crea el acceso al portal y le envía la bienvenida con sus credenciales.
                </p>
              </div>
            )}
          </StepPanel>
        )}

        {/* ── Paso 2: Presentación ── */}
        {paso === 'presentacion' && (
          <StepPanel title="Datos de la presentación" subtitle="Período y fecha del trámite de DDJJ." stepKey="presentacion">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Período">
                <Input value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="2025" />
              </Field>
              <Field label="Fecha de inicio">
                <Input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
              </Field>
            </div>
            <div className="rounded-xl border border-slate-200 bg-brand-zebra/30 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">Resumen</div>
              <div className="mt-1 text-brand-ink">
                {modo === 'existente' ? elegido?.nombre : nuevo.nombre || 'Cliente nuevo'}
                {' · '}Declaraciones juradas anuales (RPAC){periodo ? ` · ${periodo}` : ''}
              </div>
              <div className="mt-1 text-xs text-brand-muted">
                Se abre el trámite sin comprobante. La facturación se hace en el paso siguiente.
              </div>
            </div>
          </StepPanel>
        )}

        {/* ── Procesando ── */}
        {paso === 'procesando' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Loader2 size={28} className="animate-spin text-brand-cyan" />
            <p className="text-sm text-brand-muted">Creando la presentación…</p>
          </div>
        )}

        {/* ── Done ── */}
        {paso === 'done' && result && (
          <StepPanel title="Presentación creada" subtitle="El trámite DDJJ quedó abierto. Ahora podés facturarlo." stepKey="done">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 size={18} />
                <span className="font-semibold">Trámite abierto</span>
                {result.cliente_creado && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    Cliente nuevo
                  </span>
                )}
              </div>
              {portalMsg && (
                <div className="mt-2 flex items-start gap-2 text-xs text-emerald-900/80">
                  <KeyRound size={13} className="mt-0.5 shrink-0" />
                  <span>{portalMsg}</span>
                </div>
              )}
            </div>

            {/* Documentos opcionales */}
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-brand-ink">Documentos (opcional)</div>
                <Button variant="secondary" onClick={() => fileRef.current?.click()} loading={subiendo}>
                  <FileUp size={14} /> Adjuntar
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void subirDocs(e.target.files)}
                />
              </div>
              {adjuntos.length === 0 ? (
                <p className="text-xs text-brand-muted">
                  Constancia de presentación RPAC, Excel de rendición, etc. También podés cargarlos luego desde el trámite.
                </p>
              ) : (
                <ul className="space-y-1 text-xs text-brand-ink">
                  {adjuntos.map((a, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <CheckCircle2 size={12} className="text-emerald-600" /> {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={() => setCierreOpen(true)} disabled={facturado}>
                {facturado ? <CheckCircle2 size={15} /> : <Receipt size={15} />}
                {facturado ? 'Presentación facturada' : 'Facturar la presentación'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { navigate(`/gerencia/trackings/${result.tramite_id}`); cerrarTodo(); }}
              >
                <ExternalLink size={15} /> Ir al trámite
              </Button>
            </div>
          </StepPanel>
        )}
      </div>

      {/* Wizard de cierre/emisión F3, encadenado */}
      {result && (
        <WizardCierreDdjj
          open={cierreOpen}
          onClose={() => setCierreOpen(false)}
          tramiteId={result.tramite_id}
          administracionId={result.administracion_id}
          servicioId={result.servicio_id}
          servicioNombre="Declaraciones juradas anuales (RPAC)"
          onGenerado={() => {
            setCierreOpen(false);
            setFacturado(true);
            onCreado?.(result.tramite_id);
          }}
        />
      )}
    </Drawer>
  );
}
