// Drawer · editor de comunicaciones (crear / editar / enviar)
// Secciones:
//   1. Contenido (título, cuerpo, CTA opcional)
//   2. Audiencia (todos | manual | by_servicios | by_convenio)
//   3. Canales (banner + email + push) y estilo del banner
//   4. Vigencia (desde / hasta)
//   5. Vista previa de destinatarios resueltos por la audiencia
//   6. Acciones: guardar borrador / enviar
//
// Reglas: 4 (api en services/), 13 (DialogProvider).

import { useEffect, useMemo, useState } from 'react';
import {
  Megaphone,
  Users as UsersIcon,
  Mail,
  Bell,
  Monitor,
  Send,
  Save,
  Eye,
  AlertCircle,
} from 'lucide-react';
import {
  Drawer,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  useConfirm,
} from '@/components/common';
import { toast } from '@/lib/toast';
import {
  crearComunicacion,
  actualizarComunicacion,
  enviarComunicacion,
  previewDestinatarios,
  BANNER_ESTILO_LABEL,
  type Audiencia,
  type AudienciaTipo,
  type BannerEstilo,
  type ComunicacionRow,
  type DestinatarioPreview,
} from '@/services/api/comunicaciones';
import {
  listAdministraciones,
  type AdministracionListItem,
} from '@/services/api/administraciones';
import { listServiciosActivos } from '@/services/api/servicios';

const ESTILOS: BannerEstilo[] = ['info', 'novedad', 'aviso', 'urgente'];
const TIPOS: { value: AudienciaTipo; label: string; hint: string }[] = [
  { value: 'todos', label: 'Todos los clientes activos', hint: 'Envía a todas las administraciones activas.' },
  { value: 'manual', label: 'Selección manual', hint: 'Elegí uno por uno los clientes.' },
  { value: 'by_servicios', label: 'Por servicios contratados', hint: 'Quienes hayan tenido al menos un trámite de los servicios elegidos.' },
  { value: 'by_convenio', label: 'Por convenio', hint: 'Filtrá por convenio (Mutualidad, Asociación…).' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  editing: ComunicacionRow | null;
  onSaved?: () => void;
}

export function ComunicacionFormDrawer({ open, onClose, editing, onSaved }: Props) {
  const confirm = useConfirm();
  const isEdit = !!editing;
  const isReadonly = !!editing && editing.estado !== 'borrador';

  // Form state
  const [titulo, setTitulo] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [audienciaTipo, setAudienciaTipo] = useState<AudienciaTipo>('todos');
  const [adminIds, setAdminIds] = useState<string[]>([]);
  const [servicioIds, setServicioIds] = useState<string[]>([]);
  const [convenios, setConvenios] = useState<string[]>([]);
  const [convenioInput, setConvenioInput] = useState('');
  const [canalBanner, setCanalBanner] = useState(true);
  const [canalEmail, setCanalEmail] = useState(false);
  const [canalPush, setCanalPush] = useState(false);
  const [bannerEstilo, setBannerEstilo] = useState<BannerEstilo>('novedad');
  const [visibleHasta, setVisibleHasta] = useState('');

  // Catálogos / preview
  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [servicios, setServicios] = useState<{ id: string; nombre: string }[]>([]);
  const [convenioOptions, setConvenioOptions] = useState<string[]>([]);
  const [preview, setPreview] = useState<DestinatarioPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Mutating
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  // Hidratar al abrir
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setTitulo(editing.titulo);
      setCuerpo(editing.cuerpo_md);
      setCtaLabel(editing.cta_label ?? '');
      setCtaUrl(editing.cta_url ?? '');
      setAudienciaTipo(editing.audiencia.type);
      setAdminIds(
        editing.audiencia.type === 'manual'
          ? editing.audiencia.administracion_ids
          : [],
      );
      setServicioIds(
        editing.audiencia.type === 'by_servicios'
          ? editing.audiencia.servicio_ids
          : [],
      );
      setConvenios(
        editing.audiencia.type === 'by_convenio'
          ? editing.audiencia.convenios
          : [],
      );
      setCanalBanner(editing.canal_banner);
      setCanalEmail(editing.canal_email);
      setCanalPush(editing.canal_push);
      setBannerEstilo(editing.banner_estilo);
      setVisibleHasta(
        editing.visible_hasta
          ? editing.visible_hasta.slice(0, 10)
          : '',
      );
    } else {
      // reset a defaults
      setTitulo('');
      setCuerpo('');
      setCtaLabel('');
      setCtaUrl('');
      setAudienciaTipo('todos');
      setAdminIds([]);
      setServicioIds([]);
      setConvenios([]);
      setConvenioInput('');
      setCanalBanner(true);
      setCanalEmail(false);
      setCanalPush(false);
      setBannerEstilo('novedad');
      setVisibleHasta('');
    }
  }, [open, editing]);

  // Cargar catálogos
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [rAdm, rSvc] = await Promise.all([
        listAdministraciones({ estado: 'activo', limit: 500 }),
        listServiciosActivos(),
      ]);
      if (rAdm.ok) {
        setAdmins(rAdm.data.rows);
        const convs = Array.from(
          new Set(
            rAdm.data.rows
              .map((a) => a.convenio?.trim())
              .filter((c): c is string => Boolean(c)),
          ),
        ).sort();
        setConvenioOptions(convs);
      }
      if (rSvc.ok) {
        setServicios(
          rSvc.data.map((s) => ({ id: s.id, nombre: s.nombre })),
        );
      }
    })();
  }, [open]);

  // Construir audiencia actual
  const audiencia: Audiencia = useMemo(() => {
    if (audienciaTipo === 'todos') return { type: 'todos' };
    if (audienciaTipo === 'manual')
      return { type: 'manual', administracion_ids: adminIds };
    if (audienciaTipo === 'by_servicios')
      return { type: 'by_servicios', servicio_ids: servicioIds };
    return { type: 'by_convenio', convenios };
  }, [audienciaTipo, adminIds, servicioIds, convenios]);

  // Refrescar preview de destinatarios cuando cambia la audiencia
  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setPreviewLoading(true);
    void (async () => {
      const res = await previewDestinatarios(audiencia);
      if (cancel) return;
      if (res.ok) setPreview(res.data);
      else setPreview([]);
      setPreviewLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [open, audiencia]);

  function validar(): string | null {
    if (titulo.trim().length === 0) return 'El título es obligatorio.';
    if (cuerpo.trim().length === 0) return 'El cuerpo no puede estar vacío.';
    if (ctaLabel.trim() && !ctaUrl.trim())
      return 'El CTA tiene texto pero no URL.';
    if (!canalBanner && !canalEmail && !canalPush)
      return 'Tenés que activar al menos un canal.';
    if (audienciaTipo === 'manual' && adminIds.length === 0)
      return 'Elegí al menos un cliente.';
    if (audienciaTipo === 'by_servicios' && servicioIds.length === 0)
      return 'Elegí al menos un servicio.';
    if (audienciaTipo === 'by_convenio' && convenios.length === 0)
      return 'Elegí al menos un convenio.';
    return null;
  }

  async function saveBorrador(): Promise<ComunicacionRow | null> {
    const err = validar();
    if (err) {
      toast.error(err);
      return null;
    }
    setSaving(true);
    const payload = {
      titulo: titulo.trim(),
      cuerpo_md: cuerpo.trim(),
      cta_label: ctaLabel.trim() || null,
      cta_url: ctaUrl.trim() || null,
      audiencia,
      canal_banner: canalBanner,
      canal_email: canalEmail,
      canal_push: canalPush,
      banner_estilo: bannerEstilo,
      visible_hasta: visibleHasta ? new Date(visibleHasta).toISOString() : null,
    };
    const res = isEdit
      ? await actualizarComunicacion(editing!.id, payload)
      : await crearComunicacion(payload);
    setSaving(false);
    if (!res.ok) {
      toast.error(`No se pudo guardar: ${res.error.message}`);
      return null;
    }
    toast.success(isEdit ? 'Borrador actualizado' : 'Borrador guardado');
    onSaved?.();
    return res.data;
  }

  async function onSaveClick() {
    const row = await saveBorrador();
    if (row && !isEdit) onClose();
  }

  async function onSendClick() {
    const total = preview.length;
    if (total === 0) {
      toast.error('No hay destinatarios resueltos. Revisá la audiencia.');
      return;
    }
    const okBtn = await confirm({
      title: '¿Enviar comunicación?',
      message: `Se enviará a ${total} cliente${total === 1 ? '' : 's'}${
        canalEmail || canalPush
          ? ` por ${[canalBanner && 'dashboard', canalEmail && 'email', canalPush && 'push']
              .filter(Boolean)
              .join(' + ')}.`
          : ' por banner en el dashboard.'
      } Esta acción no se puede deshacer.`,
      confirmLabel: 'Enviar ahora',
    });
    if (!okBtn) return;
    const row = await saveBorrador();
    if (!row) return;
    setSending(true);
    const res = await enviarComunicacion(row.id);
    setSending(false);
    if (!res.ok) {
      toast.error(`No se pudo enviar: ${res.error.message}`);
      return;
    }
    toast.success(
      `Enviada · ${res.data.destinatarios} destinatarios · ${res.data.emails_encolados} emails · ${res.data.pushes_encolados} pushes`,
    );
    onSaved?.();
    onClose();
  }

  function toggleAdmin(id: string) {
    setAdminIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleServicio(id: string) {
    setServicioIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }
  function toggleConvenio(c: string) {
    setConvenios((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }
  function addConvenioCustom() {
    const c = convenioInput.trim();
    if (!c) return;
    if (!convenios.includes(c)) setConvenios((prev) => [...prev, c]);
    setConvenioInput('');
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? (isReadonly ? 'Comunicación enviada' : 'Editar comunicación') : 'Nueva comunicación'}
      kicker="Noticias / Novedades"
      description="El contenido va al dashboard del cliente. Opcionalmente por mail y push."
      icon={<Megaphone size={18} />}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving || sending}>
            Cerrar
          </Button>
          {!isReadonly && (
            <>
              <Button
                variant="secondary"
                onClick={() => void onSaveClick()}
                disabled={saving || sending}
              >
                <Save size={14} className="mr-1" />
                {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Guardar borrador'}
              </Button>
              <Button onClick={() => void onSendClick()} disabled={saving || sending}>
                <Send size={14} className="mr-1" />
                {sending ? 'Enviando…' : 'Enviar ahora'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* 1. Contenido */}
        <section className="space-y-3">
          <SectionTitle index="1" label="Contenido" />
          <Field label="Título" required>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Nuevo módulo de Webinars en el portal"
              disabled={isReadonly}
              maxLength={140}
            />
          </Field>
          <Field label="Cuerpo del mensaje" required hint="Lo que ven los clientes en el banner.">
            <Textarea
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={4}
              disabled={isReadonly}
              placeholder="A partir de hoy podés inscribir matriculados a los webinars semanales desde…"
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Texto del botón (opcional)">
              <Input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Ej: Conocer más"
                disabled={isReadonly}
              />
            </Field>
            <Field label="URL del botón (opcional)">
              <Input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="/portal/webinars o https://…"
                disabled={isReadonly}
              />
            </Field>
          </div>
        </section>

        {/* 2. Audiencia */}
        <section className="space-y-3">
          <SectionTitle index="2" label="Audiencia" />
          <Field label="Tipo de audiencia">
            <Select
              value={audienciaTipo}
              onChange={(e) => setAudienciaTipo(e.target.value as AudienciaTipo)}
              disabled={isReadonly}
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              {TIPOS.find((t) => t.value === audienciaTipo)?.hint}
            </p>
          </Field>

          {audienciaTipo === 'manual' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Clientes elegidos ({adminIds.length})
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
                {admins.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">Cargando…</p>
                ) : (
                  admins.map((a) => (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-cyan-50"
                    >
                      <input
                        type="checkbox"
                        checked={adminIds.includes(a.id)}
                        onChange={() => toggleAdmin(a.id)}
                        disabled={isReadonly}
                        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="flex-1 truncate">{a.nombre}</span>
                      {a.email && (
                        <span className="truncate text-xs text-slate-400">{a.email}</span>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {audienciaTipo === 'by_servicios' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Servicios elegidos ({servicioIds.length})
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
                {servicios.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">Cargando…</p>
                ) : (
                  servicios.map((s) => (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-cyan-50"
                    >
                      <input
                        type="checkbox"
                        checked={servicioIds.includes(s.id)}
                        onChange={() => toggleServicio(s.id)}
                        disabled={isReadonly}
                        className="rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                      />
                      <span className="flex-1 truncate">{s.nombre}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          {audienciaTipo === 'by_convenio' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Convenios elegidos ({convenios.length})
              </p>
              {convenioOptions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {convenioOptions.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleConvenio(c)}
                      disabled={isReadonly}
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition ${
                        convenios.includes(c)
                          ? 'bg-cyan-600 text-white ring-cyan-700'
                          : 'bg-white text-slate-700 ring-slate-200 hover:bg-cyan-50'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  value={convenioInput}
                  onChange={(e) => setConvenioInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addConvenioCustom();
                    }
                  }}
                  placeholder="Convenio personalizado…"
                  disabled={isReadonly}
                />
                <Button variant="secondary" onClick={addConvenioCustom} disabled={isReadonly}>
                  Añadir
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* 3. Canales */}
        <section className="space-y-3">
          <SectionTitle index="3" label="Canales de envío" />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <CanalToggle
              icon={<Monitor size={16} />}
              label="Banner dashboard"
              hint="Aparece arriba en el portal del cliente hasta que lo cierre."
              checked={canalBanner}
              onChange={setCanalBanner}
              disabled={isReadonly}
            />
            <CanalToggle
              icon={<Mail size={16} />}
              label="Email"
              hint="Llega al mail registrado del cliente."
              checked={canalEmail}
              onChange={setCanalEmail}
              disabled={isReadonly}
            />
            <CanalToggle
              icon={<Bell size={16} />}
              label="Push (app)"
              hint="Notificación push web (sólo clientes con el portal instalado)."
              checked={canalPush}
              onChange={setCanalPush}
              disabled={isReadonly}
            />
          </div>

          {canalBanner && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Estilo del banner">
                <Select
                  value={bannerEstilo}
                  onChange={(e) => setBannerEstilo(e.target.value as BannerEstilo)}
                  disabled={isReadonly}
                >
                  {ESTILOS.map((e) => (
                    <option key={e} value={e}>
                      {BANNER_ESTILO_LABEL[e]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Visible hasta (opcional)" hint="Si lo dejás vacío el banner queda hasta que el cliente lo cierre.">
                <Input
                  type="date"
                  value={visibleHasta}
                  onChange={(e) => setVisibleHasta(e.target.value)}
                  disabled={isReadonly}
                />
              </Field>
            </div>
          )}
        </section>

        {/* 4. Preview */}
        <section className="space-y-2">
          <SectionTitle
            index="4"
            label={
              <span className="flex items-center gap-2">
                Vista previa de destinatarios
                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                  <UsersIcon size={11} className="-mt-0.5 mr-0.5 inline" />
                  {previewLoading ? '…' : preview.length}
                </span>
              </span>
            }
          />
          {previewLoading ? (
            <p className="text-sm text-slate-500">Resolviendo audiencia…</p>
          ) : preview.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
              <AlertCircle size={16} />
              <span>
                Ninguna administración matchea con esta audiencia. Ajustá los filtros antes de enviar.
              </span>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
              {preview.map((d) => (
                <div
                  key={d.administracion_id}
                  className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="truncate font-medium text-slate-800">{d.nombre}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                    {d.email ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Mail size={11} /> sí
                      </span>
                    ) : (
                      <span className="text-rose-500">sin mail</span>
                    )}
                    {d.tiene_user ? (
                      <span className="inline-flex items-center gap-0.5">
                        <Eye size={11} /> portal
                      </span>
                    ) : (
                      <span className="text-amber-600">sin portal</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {isReadonly && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200">
            Esta comunicación ya fue enviada. Sólo lectura — no se puede modificar.
          </div>
        )}
      </div>
    </Drawer>
  );
}

// -----------------------------------------------------------------------------
// Helpers UI privados
// -----------------------------------------------------------------------------
function SectionTitle({
  index,
  label,
}: {
  index: string;
  label: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-100 text-[10px] font-bold text-cyan-700">
        {index}
      </span>
      <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
    </div>
  );
}

function CanalToggle({
  icon,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`group flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition ${
        checked
          ? 'border-cyan-300 bg-cyan-50 ring-2 ring-cyan-200'
          : 'border-slate-200 bg-white hover:border-cyan-200'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <span className={checked ? 'text-cyan-700' : 'text-slate-500'}>{icon}</span>
          {label}
        </span>
        <span
          className={`flex h-4 w-4 items-center justify-center rounded border ${
            checked
              ? 'border-cyan-500 bg-cyan-500 text-white'
              : 'border-slate-300 bg-white'
          }`}
        >
          {checked && (
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
              <path d="M13.854 3.146a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3-3a.5.5 0 11.708-.708L6.5 9.793l6.646-6.647a.5.5 0 01.708 0z" />
            </svg>
          )}
        </span>
      </div>
      <p className="text-xs leading-snug text-slate-500">{hint}</p>
    </button>
  );
}
