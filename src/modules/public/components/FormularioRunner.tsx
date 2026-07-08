import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from '@/lib/toast';
import {
  Send,
  Loader2,
  CheckCircle2,
  Upload,
  X as XIcon,
  AlertCircle,
  Download,
  FileText,
  Ticket,
  Sparkles,
  Wallet,
  Copy,
  Eye,
} from 'lucide-react';
import { validarVoucher, type ValidacionVoucher } from '@/services/api/vouchers';
import { Button, Field, Input, PasswordRevealInput, Select, Textarea } from '@/components/common';
import { WhatsAppFloatingButton } from '@/components/common/WhatsAppFloatingButton';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import {
  submitFormulario,
  type FormularioRow,
  type FormularioSchemaDef,
  type FormularioFieldDef,
} from '@/services/api/formularios';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import { formatCuit, validarCuit, esCampoCuit } from '@/lib/cuit';

interface FormularioRunnerProps {
  formulario: FormularioRow;
  /**
   * Valores pre-cargados (típicamente vienen del perfil del cliente cuando
   * está logueado desde el portal). El runner hace matching case-insensitive
   * por nombre del campo y lo precarga + marca como "auto-rellenado".
   */
  prefillValues?: Record<string, unknown>;
  /**
   * Canal de origen de la solicitud. 'publico' = landing (default),
   * 'cliente' = portal logueado. Determina qué precio se aplica y
   * qué vouchers son válidos.
   */
  origenCanal?: 'publico' | 'cliente';
  /**
   * Datos extra a fusionar en el payload enviado (además de los campos del
   * schema). Se usa para pasar metadata fuera del formulario, ej. la
   * preferencia de modalidad (presencial/online) en eventos mixtos. Opcional
   * → los formularios existentes no cambian.
   */
  extraDatos?: Record<string, unknown>;
}

interface FieldState {
  value: unknown;
  touched: boolean;
  prefilled?: boolean;  // viene de perfil del cliente, mostrar badge
}

/**
 * Normaliza un nombre de campo para matching: lowercase + sin acentos + sin
 * espacios/guiones. Permite que 'Correo Electrónico' matchee con 'correo_electronico'.
 */
function normalizeKey(k: string): string {
  return k
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-]+/g, '_');
}

// Runner: renderiza un formulario desde su schema jsonb, maneja validaciones
// reactivas, lógica condicional declarativa, adjuntos múltiples por campo y
// submit al edge function. Pensado para uso público (URL `/formulario/:slug`).
export function FormularioRunner({
  formulario,
  prefillValues,
  origenCanal = 'publico',
  extraDatos,
}: FormularioRunnerProps) {
  // E-GG-48 (2026-06-04 · Pablo): cuando el cliente envía un formulario
  // desde el portal, después del submit ve la pantalla pública sin link de
  // vuelta y "siente que salió del sistema". El navigate de react-router
  // lleva al portal SIN recargar la app (la sesión se preserva en
  // memoria, no hay flash de deslogueo).
  const navigate = useNavigate();
  const schema = formulario.schema as unknown as FormularioSchemaDef;
  const [state, setState] = useState<Record<string, FieldState>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ mensaje: string; redirect: string | null } | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [prefilledCount, setPrefilledCount] = useState(0);
  // Voucher state: sólo aparece si el formulario está asociado a un servicio
  // (formularios.servicio_id != null). El bloque se expande con el checkbox.
  const tieneServicio = !!formulario.servicio_id;
  const [voucherExpanded, setVoucherExpanded] = useState(false);
  const [voucherCodigo, setVoucherCodigo] = useState('');
  const [voucherValidado, setVoucherValidado] = useState<ValidacionVoucher | null>(null);
  const [validandoVoucher, setValidandoVoucher] = useState(false);
  const [celebrar100, setCelebrar100] = useState(false);
  const es100 = voucherValidado?.valido === true && voucherValidado.es_100 === true;

  // Auto-fill al recibir prefillValues. Hace matching case-insensitive entre
  // el name de cada campo del schema y las keys del dict del perfil del cliente.
  useEffect(() => {
    if (!prefillValues || Object.keys(prefillValues).length === 0) return;

    // Normalizar keys del prefill para lookup rápido
    const lookup: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prefillValues)) {
      if (v === null || v === undefined || v === '') continue;
      if (k.startsWith('_')) continue;  // _user_id, _origen son meta
      lookup[normalizeKey(k)] = v;
    }

    const newState: Record<string, FieldState> = {};
    let count = 0;
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (['heading', 'separator', 'html', 'file', 'file_download', 'costos_info'].includes(field.type)) continue;
        const normalizedName = normalizeKey(field.name);
        const match = lookup[normalizedName];
        if (match !== undefined) {
          newState[field.name] = { value: match, touched: false, prefilled: true };
          count++;
        }
      }
    }
    if (count > 0) {
      setState(newState);
      setPrefilledCount(count);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillValues]);

  const data = useMemo(() => {
    const d: Record<string, unknown> = {};
    for (const k of Object.keys(state)) d[k] = state[k]?.value;
    return d;
  }, [state]);

  function setField(name: string, value: unknown) {
    setState((s) => ({ ...s, [name]: { value, touched: true } }));
    setTopError(null);
  }

  function isFieldVisible(field: FormularioFieldDef): boolean {
    if (!field.condition) return true;
    const actual = String(data[field.condition.field] ?? '');
    const target = field.condition.equals;
    return Array.isArray(target) ? target.includes(actual) : actual === target;
  }

  async function onValidarVoucher() {
    const codigo = voucherCodigo.trim();
    if (!codigo) {
      toast.error('Ingresá un código.');
      return;
    }
    if (!formulario.servicio_id) {
      toast.error('Este formulario no acepta vouchers.');
      return;
    }
    setValidandoVoucher(true);
    const res = await validarVoucher(
      codigo,
      formulario.servicio_id,
      origenCanal === 'cliente',
    );
    setValidandoVoucher(false);
    if (!res.ok) {
      toast.error('No pudimos validar el código.');
      return;
    }
    setVoucherValidado(res.data);
    if (res.data.valido) {
      if (res.data.es_100) {
        setCelebrar100(true);
        // Modal felicitaciones 2.5s + auto-cierre
        window.setTimeout(() => setCelebrar100(false), 2500);
      } else {
        toast.success(res.data.mensaje);
      }
    } else {
      toast.error(res.data.mensaje);
    }
  }

  function onQuitarVoucher() {
    setVoucherCodigo('');
    setVoucherValidado(null);
  }

  function validate(): string[] {
    const errors: string[] = [];
    // Bonificación 100% = no requiere comprobante de pago. Los campos file
    // requeridos del formulario quedan "soft-optional" en ese caso (caso de
    // uso: voucher 100% sobre un servicio que normalmente exige adjuntar el
    // comprobante de transferencia).
    const skipFilesRequired = es100;
    for (const section of schema.sections) {
      for (const field of section.fields) {
        if (['heading', 'separator', 'html', 'file_download', 'costos_info'].includes(field.type)) continue;
        if (!isFieldVisible(field)) continue;

        if (field.type === 'file') {
          const fl = files[field.name] ?? [];
          if (field.required && fl.length === 0 && !skipFilesRequired) {
            errors.push(`${field.label}: requerido`);
          }
          if (field.max_files && fl.length > field.max_files) {
            errors.push(`${field.label}: máximo ${field.max_files} archivos`);
          }
          continue;
        }

        const val = data[field.name];
        const empty =
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0);
        if (field.required && empty) {
          errors.push(`${field.label}: requerido`);
          continue;
        }
        if (empty) continue;

        if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(val))) {
          errors.push(`${field.label}: email inválido`);
        }
        if (field.type === 'tel') {
          const digits = String(val).replace(/\D/g, '');
          if (digits.length < 8) errors.push(`${field.label}: teléfono incompleto`);
        }
        if (field.type === 'number' && isNaN(Number(val))) {
          errors.push(`${field.label}: número inválido`);
        }
        // DGG-98 · CUIT/CUIL: cantidad de dígitos (11) + dígito verificador.
        if (esCampoCuit(field)) {
          const cuitErr = validarCuit(String(val));
          if (cuitErr) errors.push(`${field.label}: ${cuitErr}`);
        }
      }
    }
    return errors;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errors = validate();
    if (errors.length > 0) {
      setTopError(errors.join(' · '));
      toast.error('Revisá los campos marcados');
      return;
    }
    setSending(true);

    // Aplanar files a [{ field, file }]
    const flatFiles: Array<{ field: string; file: File }> = [];
    for (const k of Object.keys(files)) {
      for (const f of files[k] ?? []) flatFiles.push({ field: k, file: f });
    }

    const res = await submitFormulario({
      slug: formulario.slug,
      datos: extraDatos ? { ...data, ...extraDatos } : data,
      files: flatFiles,
      origen_canal: origenCanal,
      voucher_codigo: voucherValidado?.valido ? voucherValidado.codigo : undefined,
    });
    setSending(false);

    if (!res.ok) {
      setTopError(humanizeError(res.error));
      toast.error('No pudimos enviar el formulario', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Formulario enviado');
    setDone({ mensaje: res.data.mensaje, redirect: res.data.redirect_url });
    if (res.data.redirect_url) {
      window.setTimeout(() => { window.location.href = res.data.redirect_url!; }, 2500);
    } else if (origenCanal === 'cliente') {
      // E-GG-48 · Si el cliente vino desde el portal y no hay redirect
      // configurado, lo devolvemos al portal automáticamente para que no
      // quede "fuera del sistema" visualmente.
      window.setTimeout(() => { navigate('/portal/gestiones', { replace: true }); }, 2500);
    }
  }

  // Pantalla de confirmación post-submit
  if (done) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 size={28} />
        </div>
        <h2 className="font-display text-2xl font-bold text-brand-ink">¡Listo!</h2>
        <p className="mt-3 text-sm leading-relaxed text-brand-ink">{done.mensaje}</p>
        {done.redirect && (
          <p className="mt-4 text-xs text-brand-muted">Redirigiendo en un instante…</p>
        )}
        {/* E-GG-48 · Si el cliente vino desde el portal, mostrar link
            explícito de vuelta + leyenda de redirección automática. */}
        {origenCanal === 'cliente' && !done.redirect && (
          <>
            <p className="mt-4 text-xs text-brand-muted">
              Te llevamos de vuelta a tu portal en un instante…
            </p>
            <Link
              to="/portal/gestiones"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-cyan px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-cyan/90"
            >
              Volver a mi portal ahora
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* AJL #7: el botón flotante vive acá para que aparezca en TODOS los call
          sites del FormularioRunner (público, portal, futuros embeds). */}
      <WhatsAppFloatingButton
        mensaje={`Hola! Tengo una consulta sobre el trámite "${formulario.titulo}".`}
      />
      {prefilledCount > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 shadow-sm">
          <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} />
          <div className="min-w-0">
            <p className="font-semibold">
              Pre-rellenamos {prefilledCount} {prefilledCount === 1 ? 'campo' : 'campos'} con tus datos
            </p>
            <p className="mt-0.5 text-xs text-emerald-800/90">
              Tomamos los datos de tu perfil. Si necesitás modificarlos para esta solicitud, simplemente editá el valor.
            </p>
          </div>
        </div>
      )}
      {schema.sections.map((section, sIdx) => (
        <section
          key={sIdx}
          className="card-premium relative overflow-hidden p-6 motion-safe:animate-fade-up"
          style={{ animationDelay: `${sIdx * 60}ms` }}
        >
          <TrianglesAccent
            position="top-right"
            size={140}
            tone="cyan"
            density="soft"
            className="opacity-25"
          />
          <div className="relative space-y-4">
            {section.title && (
              <div>
                <h3 className="font-display text-lg font-bold text-brand-ink">
                  {section.title}
                </h3>
                {section.subtitle && (
                  <p className="text-sm text-brand-muted">{section.subtitle}</p>
                )}
              </div>
            )}
            {section.fields.map((field) => {
              if (!isFieldVisible(field)) return null;
              return (
                <FieldRenderer
                  key={field.name}
                  field={field}
                  value={data[field.name]}
                  prefilled={state[field.name]?.prefilled === true}
                  onChange={(v) => setField(field.name, v)}
                  files={files[field.name] ?? []}
                  onFilesChange={(fs) => setFiles((s) => ({ ...s, [field.name]: fs }))}
                />
              );
            })}
          </div>
        </section>
      ))}

      {tieneServicio && (
        <section className="card-premium relative overflow-hidden p-5 motion-safe:animate-fade-up">
          {voucherExpanded || voucherValidado?.valido ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-brand-ink">
                <Ticket size={16} className="text-brand-cyan" />
                <strong className="text-sm">Voucher / promoción</strong>
              </div>
              {voucherValidado?.valido ? (
                <div
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3 text-sm',
                    es100
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-brand-cyan/40 bg-brand-cyan-pale/30 text-brand-ink',
                  )}
                >
                  <CheckCircle2
                    size={18}
                    className={cn('mt-0.5 shrink-0', es100 ? 'text-emerald-600' : 'text-brand-cyan')}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      Código <span className="font-mono">{voucherValidado.codigo}</span> aplicado
                    </p>
                    <p className="text-xs leading-relaxed">{voucherValidado.mensaje}</p>
                    {es100 && (
                      <p className="mt-1 text-xs">
                        No necesitás adjuntar comprobante de pago para enviar la solicitud.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onQuitarVoucher}
                    className="rounded-md p-1 text-brand-muted hover:bg-white/60 hover:text-red-600"
                    aria-label="Quitar voucher"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-brand-muted">
                    Si tenés un código de descuento o promoción, ingresalo acá y validalo
                    antes de enviar. Si bonifica el 100%, no vas a necesitar adjuntar pago.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      value={voucherCodigo}
                      onChange={(e) => setVoucherCodigo(e.target.value.toUpperCase())}
                      placeholder="Ej: WELCOME50"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={() => void onValidarVoucher()}
                      disabled={validandoVoucher || !voucherCodigo.trim()}
                    >
                      {validandoVoucher ? (
                        <>
                          <Loader2 size={14} className="animate-spin" /> Validando…
                        </>
                      ) : (
                        'Validar'
                      )}
                    </Button>
                  </div>
                  {voucherValidado && !voucherValidado.valido && (
                    <p className="text-xs text-red-600">{voucherValidado.mensaje}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <label className="flex cursor-pointer items-center gap-3 text-sm text-brand-ink">
              <input
                type="checkbox"
                onChange={(e) => setVoucherExpanded(e.target.checked)}
                className="rounded text-brand-cyan focus:ring-brand-cyan/40"
              />
              <Ticket size={14} className="text-brand-cyan" />
              <span>Tengo un voucher / promoción</span>
            </label>
          )}
        </section>
      )}

      {topError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} />
            <strong>Revisá el formulario</strong>
          </div>
          <p className="mt-1 text-xs leading-relaxed">{topError}</p>
        </div>
      )}

      {/* Modal Felicitaciones · auto-cierra a los 2.5s */}
      {celebrar100 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/40 p-4 backdrop-blur-sm motion-safe:animate-fade-in">
          <div className="card-premium relative max-w-md overflow-hidden p-8 text-center motion-safe:animate-spring-in">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <Sparkles size={32} />
            </div>
            <h2 className="font-display text-2xl font-bold text-brand-ink">
              ¡Felicitaciones!
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-ink/80">
              Este será un servicio gratuito.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={sending}>
          {sending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Send size={14} /> {schema.submit_label ?? 'Enviar'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

interface FieldRendererProps {
  field: FormularioFieldDef;
  value: unknown;
  prefilled?: boolean;
  onChange: (v: unknown) => void;
  files: File[];
  onFilesChange: (f: File[]) => void;
}

/** Badge sutil que indica que el campo fue pre-rellenado desde el perfil del cliente. */
function PrefilledBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
      title="Tomado de tu perfil"
    >
      <CheckCircle2 size={10} /> de tu perfil
    </span>
  );
}

/**
 * DGG-37 (JL-PREVIEW · 2026-06-02) · Ojo con popover que muestra una imagen
 * de ejemplo del documento que el usuario tiene que adjuntar. Pensado para
 * fields tipo `file` donde el copy + hint no alcanza (constancias ARCA,
 * ARBA IIBB, etc.). El nombre del archivo aparece debajo de la imagen
 * para que el usuario tenga referencia exacta.
 *
 * Cierra con: click afuera, botón "Cerrar", o tecla ESC.
 *
 * Iteración 2026-06-02 (JL feedback):
 *   - Popover montado en `document.body` vía createPortal con position fixed
 *     y z-index 9999 → ya no queda enterrado dentro de la sección por
 *     overflow/z-index de contenedores padres (caso "renovacion-rpac" cortado).
 *   - Texto cursiva pequeña a la izquierda del ojito ("Presioná acá para ver
 *     el modelo del documento →") para guiar al usuario al ícono.
 */
function FieldPreviewEye({
  preview,
}: {
  preview: NonNullable<FormularioFieldDef['preview']>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Posicionar el popover (fixed) bajo el botón, clampeado al viewport.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    function place() {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 16);
      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(8, Math.min(window.innerWidth - width - 8, left));
      const top = rect.bottom + 8;
      setPos({ top, left, width });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Click afuera + ESC.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Override de los estilos del kicker padre (uppercase, font-semibold,
          tracking-wider) para que la leyenda luzca igual que el hint
          "Debe tener declarado el Código de Actividad 682010." (text-xs,
          minúscula natural, peso normal, tracking normal). */}
      <span className="!text-xs !font-normal !normal-case !tracking-normal text-brand-muted">
        Presioná acá para ver el modelo del documento →
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        title="Ver ejemplo del documento"
        aria-label="Ver ejemplo del documento"
        aria-expanded={open}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-brand-muted transition hover:bg-brand-cyan-pale/40 hover:text-brand-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40"
      >
        <Eye size={14} />
      </button>
      {open && pos && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Ejemplo: ${preview.filename}`}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            zIndex: 9999,
          }}
          className="rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
              Ejemplo del documento
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar ejemplo"
              className="rounded-md p-0.5 text-brand-muted transition hover:bg-slate-100 hover:text-brand-ink"
            >
              <XIcon size={14} />
            </button>
          </div>
          <img
            src={preview.url}
            alt={preview.alt ?? preview.filename}
            loading="lazy"
            className="max-h-[70vh] w-full rounded-lg border border-slate-200 bg-slate-50 object-contain"
          />
          <p
            className="mt-2 break-words text-xs font-medium text-brand-ink"
            title={preview.filename}
          >
            {preview.filename}
          </p>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Compose label con badge si está pre-rellenado + ojito si hay preview. */
function fieldLabel(field: FormularioFieldDef, prefilled: boolean): React.ReactNode {
  const hasExtras = prefilled || !!field.preview;
  if (!hasExtras) return field.label;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{field.label}</span>
      {prefilled && <PrefilledBadge />}
      {field.preview && <FieldPreviewEye preview={field.preview} />}
    </span>
  );
}

function FieldRenderer({ field, value, prefilled = false, onChange, files, onFilesChange }: FieldRendererProps) {
  switch (field.type) {
    case 'heading':
      return (
        <h4 className="font-display text-base font-bold text-brand-ink">{field.label}</h4>
      );
    case 'separator':
      return <hr className="border-slate-200" />;
    case 'html':
      return (
        <div
          className="prose-sm text-brand-muted"
          dangerouslySetInnerHTML={{ __html: field.label }}
        />
      );

    case 'textarea':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Textarea
            rows={4}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
          >
            <option value="">— Elegí una opción —</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'radio':
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options?.map((opt) => {
              const checked = String(value) === opt;
              return (
                <label
                  key={opt}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition',
                    checked
                      ? 'border-brand-cyan bg-brand-cyan-pale/30 text-brand-ink'
                      : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/40',
                  )}
                >
                  <input
                    type="radio"
                    name={field.name}
                    value={opt}
                    checked={checked}
                    onChange={() => onChange(opt)}
                    className="text-brand-cyan focus:ring-brand-cyan"
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </Field>
      );

    case 'checkbox':
      return (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 rounded text-brand-cyan focus:ring-brand-cyan/40"
          />
          <span>
            {field.label}
            {field.required && <span className="ml-1 text-red-600">*</span>}
            {field.hint && (
              <span className="block text-xs text-brand-muted">{field.hint}</span>
            )}
          </span>
        </label>
      );

    case 'file':
      return (
        <FileUploader
          field={field}
          files={files}
          onFilesChange={onFilesChange}
        />
      );

    case 'file_download':
      return <FileDownloadCard field={field} />;

    case 'costos_info':
      return <CostosInfoCard field={field} />;

    default:
      // text / email / tel / number / date
      // sensitive (AJL #5): si está en true, renderizar como password con ojito.
      if (field.sensitive && (field.type === 'text' || !field.type)) {
        return (
          <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
            <PasswordRevealInput
              value={String(value ?? '')}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          </Field>
        );
      }
      // DGG-98 · CUIT/CUIL: autocompleta guiones (XX-XXXXXXXX-X) mientras se tipea,
      // cap 11 dígitos. La validación (cantidad + verificador) corre en validate().
      if (esCampoCuit(field)) {
        return (
          <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
            <Input
              type="text"
              inputMode="numeric"
              value={formatCuit(String(value ?? ''))}
              onChange={(e) => onChange(formatCuit(e.target.value))}
              placeholder={field.placeholder || 'XX-XXXXXXXX-X'}
              required={field.required}
            />
          </Field>
        );
      }
      return (
        <Field label={fieldLabel(field, prefilled)} required={field.required} hint={field.hint}>
          <Input
            type={field.type === 'tel' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        </Field>
      );
  }
}

/**
 * Tarjeta de descarga: muestra un archivo provisto por la gerencia (plantillas,
 * instructivos, etc.) que el usuario público del formulario puede descargar.
 * No es un campo de entrada: no se valida ni se envía.
 */
function FileDownloadCard({ field }: { field: FormularioFieldDef }) {
  if (!field.download_url) {
    // Si no hay archivo cargado todavía, mostramos un placeholder discreto
    // (sólo se ve en preview del builder antes de subir el archivo).
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-brand-muted">
        <div className="flex items-center gap-3">
          <FileText size={18} className="shrink-0 text-slate-400" />
          <p>{field.label || 'Archivo a descargar'} (sin archivo cargado)</p>
        </div>
      </div>
    );
  }

  const sizeLabel =
    typeof field.download_size_bytes === 'number'
      ? field.download_size_bytes < 1024
        ? `${field.download_size_bytes} B`
        : field.download_size_bytes < 1024 * 1024
          ? `${(field.download_size_bytes / 1024).toFixed(1)} KB`
          : `${(field.download_size_bytes / (1024 * 1024)).toFixed(1)} MB`
      : null;

  return (
    <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan-pale/30 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-brand-cyan shadow-sm">
          <FileText size={18} />
        </span>
        <div className="min-w-0 flex-1">
          {field.label && (
            <p className="font-semibold text-brand-ink">{field.label}</p>
          )}
          {field.hint && (
            <p className="mt-0.5 text-xs text-brand-muted">{field.hint}</p>
          )}
          <p className="mt-1 truncate text-xs text-brand-ink/70">
            {field.download_filename ?? 'archivo'}
            {sizeLabel ? ` · ${sizeLabel}` : ''}
          </p>
        </div>
        <a
          href={field.download_url}
          download={field.download_filename}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-cyan px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-cyan/90"
        >
          <Download size={14} />
          Descargar
        </a>
      </div>
    </div>
  );
}

/**
 * CostosInfoCard · bloque informativo con tarifas + datos de cuenta MP.
 * Pedido por José Luis 2026-06-02 (E-GG-32). NO se valida, NO se envía.
 *
 * Estructura del payload `field.costos`:
 *   - items: lista de "Trámite de 15 días: $175.000"
 *   - nota_total: leyenda fuerte ("La transferencia debe ser por el total informado")
 *   - cuenta: titular/cvu/alias/cuit_cuil (para copiar)
 *   - nota_extra: notas grises adicionales (ej. tabla DDJJ por escala)
 */
function CostosInfoCard({ field }: { field: FormularioFieldDef }) {
  const costos = field.costos;
  if (!costos) return null;

  async function copiar(valor: string, etiqueta: string) {
    try {
      await navigator.clipboard.writeText(valor);
      toast.success(`${etiqueta} copiado`);
    } catch {
      toast.error('No pudimos copiar al portapapeles');
    }
  }

  return (
    <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50/50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-amber-600 shadow-sm ring-1 ring-amber-100">
          <Wallet size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="kicker text-amber-700">{field.label || 'Costos del trámite'}</p>
          {field.hint && (
            <p className="mt-0.5 text-xs text-brand-muted">{field.hint}</p>
          )}
        </div>
      </div>

      {/* Lista de items con tarifa */}
      {costos.items && costos.items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {costos.items.map((it, i) => (
            <li
              key={i}
              className="flex flex-col gap-1 rounded-xl bg-white/70 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold text-brand-ink">{it.label}</p>
                {it.nota && (
                  <p className="text-xs text-brand-muted">{it.nota}</p>
                )}
              </div>
              <p className="font-display text-lg font-bold text-brand-ink tabular">
                {it.precio}
              </p>
            </li>
          ))}
        </ul>
      )}

      {costos.nota_total && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-100/50 px-3 py-2 text-sm font-semibold text-amber-900">
          {costos.nota_total}
        </p>
      )}

      {/* Datos de cuenta para transferencia. Si la cuenta está vacía (ej. un curso
          cuyo dato de pago aún no se cargó — se envía por correo) NO mostramos el
          bloque para no dejar un recuadro vacío (DGG-80). */}
      {costos.cuenta &&
        [
          costos.cuenta.titular,
          costos.cuenta.cvu,
          costos.cuenta.alias,
          costos.cuenta.cuit_cuil,
        ].some((v) => v) && (
        <div className="mt-4">
          <p className="kicker mb-2 text-brand-muted">Datos para transferencia</p>
          <dl className="space-y-1.5 rounded-xl border border-slate-200 bg-white p-3">
            {[
              // titular es un nombre (no mono); el resto, datos de cuenta (mono).
              // 'CBU / CVU' sirve para CBU bancario (cuenta FU.DE.CO.IN de los
              // cursos RPAC, JL 2 · obs 3) y para CVU de Mercado Pago (otros forms).
              { k: 'Titular', v: costos.cuenta.titular, mono: false },
              { k: 'CBU / CVU', v: costos.cuenta.cvu, mono: true },
              { k: 'Alias', v: costos.cuenta.alias, mono: true },
              { k: 'CUIT/CUIL', v: costos.cuenta.cuit_cuil, mono: true },
            ]
              .filter((r) => r.v)
              .map(({ k, v, mono }) => (
                <div
                  key={k}
                  className="flex items-start justify-between gap-2 text-sm"
                >
                  <dt className="shrink-0 font-medium text-brand-muted">{k}</dt>
                  <dd className="flex min-w-0 items-start gap-2">
                    <span
                      className={cn(
                        'text-right text-brand-ink',
                        mono ? 'break-all font-mono' : 'break-words',
                      )}
                    >
                      {v}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copiar(v, k)}
                      className="mt-0.5 shrink-0 rounded-md p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
                      title={`Copiar ${k}`}
                      aria-label={`Copiar ${k}`}
                    >
                      <Copy size={12} />
                    </button>
                  </dd>
                </div>
              ))}
          </dl>
        </div>
      )}

      {costos.nota_extra && (
        <p className="mt-3 whitespace-pre-line text-xs text-brand-muted">
          {costos.nota_extra}
        </p>
      )}
    </section>
  );
}

function FileUploader({
  field,
  files,
  onFilesChange,
}: {
  field: FormularioFieldDef;
  files: File[];
  onFilesChange: (f: File[]) => void;
}) {
  const maxFiles = field.max_files ?? 1;
  const acceptStr = field.accept?.join(',') ?? '';

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files ?? []);
    const total = [...files, ...newFiles].slice(0, maxFiles);
    onFilesChange(total);
    e.target.value = ''; // reset input para permitir re-pick mismo archivo
  }

  function removeAt(i: number) {
    onFilesChange(files.filter((_, idx) => idx !== i));
  }

  // DGG-37 · sumar el ojito (si hay preview) al label del file uploader.
  return (
    <Field label={fieldLabel(field, false)} required={field.required} hint={field.hint}>
      <div className="space-y-2">
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <span className="truncate text-brand-ink">{f.name}</span>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="text-brand-muted hover:text-red-600"
                  aria-label="Quitar archivo"
                >
                  <XIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {files.length < maxFiles && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-brand-muted transition hover:border-brand-cyan hover:bg-brand-cyan-pale/20 hover:text-brand-cyan">
            <Upload size={16} />
            <span>
              {files.length === 0
                ? `Subir ${maxFiles > 1 ? 'archivos' : 'archivo'}`
                : `Agregar otro (${files.length}/${maxFiles})`}
            </span>
            <input
              type="file"
              accept={acceptStr}
              multiple={maxFiles > 1}
              onChange={onPick}
              className="hidden"
            />
          </label>
        )}
      </div>
    </Field>
  );
}
