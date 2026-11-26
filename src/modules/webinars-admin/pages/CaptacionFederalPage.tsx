import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2, Loader2, Mail, MailX, Megaphone, RotateCcw, Search,
  ShieldCheck, ShieldAlert, UserMinus, Users, MapPin,
} from 'lucide-react';
import { Button, Input, Select, Switch, Modal, Paginador, PAGE_SIZE_DEFAULT, useConfirm } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import {
  FEDERAL_CAMPANAS_CATALOGO, FEDERAL_CAMPANAS_LANZABLES, JURISDICCIONES,
  getFederalKpis, listProspectosFederal, previewFederalCampana, enviarFederalCampana,
  darBajaProspectoManual, reactivarProspectoManual,
  type FederalKpis, type ProspectoFederalRow, type FederalCampanaPreview,
  type JurisdiccionFederal,
} from '@/services/api/prospectosFederal';
import { FormulariosWebinarsTabs } from '../components/FormulariosWebinarsTabs';

const JUR_TONE: Record<string, string> = {
  CABA: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
  PBA: 'bg-amber-50 text-amber-700 ring-amber-100',
  OTRO: 'bg-slate-100 text-slate-500 ring-slate-200',
};
function jurLabel(j: string | null): string {
  if (j === 'CABA') return 'CABA';
  if (j === 'PBA') return 'PBA';
  return 'Otros';
}
function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

type JurFiltro = JurisdiccionFederal | '';

export function CaptacionFederalPage() {
  const [kpis, setKpis] = useState<FederalKpis | null>(null);
  const [rows, setRows] = useState<ProspectoFederalRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [jurisdiccion, setJurisdiccion] = useState<JurFiltro>('');
  const [estado, setEstado] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [soloConEmail, setSoloConEmail] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = PAGE_SIZE_DEFAULT;

  const [launcherOpen, setLauncherOpen] = useState(false);
  const confirmar = useConfirm();
  const [bajaId, setBajaId] = useState<string | null>(null);
  const [reactId, setReactId] = useState<string | null>(null);

  async function recargarKpis() {
    const res = await getFederalKpis();
    if (res.ok) setKpis(res.data);
    else toast.error('No pudimos cargar los indicadores', { description: humanizeError(res.error) });
  }

  async function recargarLista() {
    setLoading(true);
    const res = await listProspectosFederal({
      jurisdiccion: jurisdiccion || null,
      estado: estado || null,
      search: debounced || null,
      soloConEmail,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    setLoading(false);
    if (res.ok) { setRows(res.data.rows); setTotal(res.data.total); }
    else toast.error('No pudimos cargar los contactos', { description: humanizeError(res.error) });
  }

  // KPIs: una sola vez (universo completo, R19). No dependen de los filtros.
  useEffect(() => { void recargarKpis(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { void recargarLista(); }, [jurisdiccion, estado, debounced, soloConEmail, page]);

  function changeJur(next: JurFiltro) { setJurisdiccion(next); setPage(1); }
  function changeEstado(next: string) { setEstado(next); setPage(1); }
  function changeSoloConEmail(next: boolean) { setSoloConEmail(next); setPage(1); }
  function toggleJurChip(key: JurisdiccionFederal) { setJurisdiccion((p) => (p === key ? '' : key)); setPage(1); }

  async function handleBaja(p: ProspectoFederalRow) {
    const ok = await confirmar({
      title: 'Dar de baja de la captación',
      message: `Vas a dar de baja a "${p.email}" y suprimir ese correo de TODOS los envíos (captación federal y newsletter LexPH). Se usa cuando alguien pide la baja por fuera del link del mail. ¿Confirmás?`,
      confirmLabel: 'Dar de baja', cancelLabel: 'Cancelar', danger: true,
    });
    if (!ok) return;
    setBajaId(p.id);
    const res = await darBajaProspectoManual(p.id);
    setBajaId(null);
    if (!res.ok || !res.data.ok) {
      toast.error('No pudimos dar de baja', { description: res.ok ? (res.data.error ?? '') : humanizeError(res.error) });
      return;
    }
    toast.success(`"${p.email}" dado de baja y suprimido de los envíos`);
    void recargarLista(); void recargarKpis();
  }

  async function handleReactivar(p: ProspectoFederalRow) {
    const ok = await confirmar({
      title: 'Reactivar en la captación',
      message: `Vas a reactivar a "${p.email}": se quita de la lista de suprimidos y vuelve a entrar en las campañas de captación federal y en el newsletter LexPH. ¿Confirmás?`,
      confirmLabel: 'Reactivar', cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setReactId(p.id);
    const res = await reactivarProspectoManual(p.id);
    setReactId(null);
    if (!res.ok) { toast.error('No pudimos reactivar', { description: humanizeError(res.error) }); return; }
    if (!res.data.ok) {
      toast.error('Casilla bloqueada', {
        description: res.data.error === 'bloqueo_duro'
          ? `"${p.email}" está suprimido por casilla muerta (rebote/queja). Para reactivarlo igual, usá Configuración → Correos suprimidos.`
          : (res.data.error ?? ''),
      });
      return;
    }
    toast.success(`"${p.email}" reactivado · vuelve a recibir correos`);
    void recargarLista(); void recargarKpis();
  }

  const jurChips = useMemo(() => {
    if (!kpis) return [];
    return [
      { key: 'CABA' as const, label: 'CABA', n: kpis.caba },
      { key: 'PBA' as const, label: 'PBA (no-padrón)', n: kpis.pba },
      { key: 'OTRO' as const, label: 'Otros', n: kpis.otro },
    ];
  }, [kpis]);

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Captación Federal</h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Administradores de CABA y del resto del país (fuera del padrón PBA), para campañas
            targeteadas: curso RPA (CABA), consultoría jurídica y webinars gratuitos.
          </p>
        </div>
        <Button variant="primary" onClick={() => setLauncherOpen(true)}>
          <Megaphone size={14} /> Lanzar campaña
        </Button>
      </header>

      {/* Estado del envío (gate) */}
      {kpis && (
        <div className={cn(
          'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm',
          kpis.activo
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-slate-200 bg-slate-50 text-slate-600',
        )}>
          {kpis.activo ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          <span className="font-semibold">{kpis.activo ? 'Envío habilitado' : 'Envío desactivado'}</span>
          <span className="text-brand-muted">
            {kpis.activo
              ? 'Las campañas que lances se encolan y salen con goteo.'
              : 'Podés ver la audiencia y previsualizar, pero nada se envía hasta habilitarlo (junto al carril SES).'}
          </span>
        </div>
      )}

      {/* KPIs del universo (R19) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Contactos" value={kpis?.total ?? '—'} icon={Users} tone="cyan"
          hint={kpis ? `${kpis.con_email.toLocaleString('es-AR')} con email` : undefined} />
        <KpiCard label="CABA" value={kpis?.caba ?? '—'} icon={MapPin} tone="navy"
          hint={kpis ? `PBA ${kpis.pba.toLocaleString('es-AR')} · otros ${kpis.otro}` : undefined} />
        <KpiCard label="Contactados" value={kpis?.contactados ?? '—'} icon={Megaphone} tone="amber"
          hint={kpis ? `${kpis.enviados_total.toLocaleString('es-AR')} envíos` : undefined} />
        <KpiCard label="Convertidos" value={kpis?.convertidos ?? '—'} icon={CheckCircle2} tone="green"
          hint={kpis ? `${kpis.bajas} bajas · ${kpis.suprimidos} suprimidos` : undefined} />
      </div>

      {/* Chips de jurisdicción */}
      <div className="flex flex-wrap items-center gap-2">
        {jurChips.map((c) => (
          <button key={c.key} type="button" onClick={() => toggleJurChip(c.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition',
              JUR_TONE[c.key], jurisdiccion === c.key ? 'ring-2 ring-offset-1' : 'opacity-90 hover:opacity-100',
            )}>
            {c.label} <span className="tabular-nums">{c.n.toLocaleString('es-AR')}</span>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select value={jurisdiccion} onChange={(e) => changeJur(e.target.value as JurFiltro)} className="max-w-[12rem]">
          <option value="">Todas las jurisdicciones</option>
          {JURISDICCIONES.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
        </Select>
        <Select value={estado} onChange={(e) => changeEstado(e.target.value)} className="max-w-[11rem]">
          <option value="">Todos los estados</option>
          <option value="nuevo">Nuevo</option>
          <option value="contactado">Contactado</option>
          <option value="interesado">Interesado</option>
          <option value="no_interesado">No interesado</option>
          <option value="convertido">Convertido</option>
          <option value="baja">Baja</option>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, matrícula…" className="pl-9" />
        </div>
        <Switch checked={soloConEmail} onChange={changeSoloConEmail} label="Solo con email" size="sm" />
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
          Cargando contactos…
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty title={total === 0 ? 'Sin contactos con ese filtro' : 'Sin resultados'}
          description="Probá cambiar la jurisdicción, el estado o limpiar la búsqueda." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Nombre</Th>
                  <Th>Contacto</Th>
                  <Th center>Jurisdicción</Th>
                  <Th>Estado</Th>
                  <Th center>Campañas</Th>
                  <Th>Último mail</Th>
                  <Th right>Acción</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-brand-ink">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{p.nombre}</span>
                        {p.nombre_pila && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                            title="Nombre de pila detectado (saludo del mail)">
                            {p.nombre_pila}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] tabular-nums text-brand-muted">
                        {p.matricula ? `Mat. ${p.matricula}` : ''}{p.origen_detalle ? `${p.matricula ? ' · ' : ''}${p.origen_detalle}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      <span className="inline-flex items-center gap-1"><Mail size={11} /> {p.email}</span>
                      {p.suprimido && (
                        <div className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                          dado de baja
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', JUR_TONE[p.jurisdiccion ?? 'OTRO'])}>
                        {jurLabel(p.jurisdiccion)}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.convertido_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                          <CheckCircle2 size={10} /> Convertido
                        </span>
                      ) : p.baja_at ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Baja</span>
                      ) : p.estado_captacion === 'contactado' ? (
                        <span className="rounded-full bg-brand-cyan/5 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan ring-1 ring-brand-cyan/20">Contactado</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Nuevo</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <FederalCampanasCoins enviadas={p.campanas_enviadas} />
                    </td>
                    <td className="px-4 py-2 text-xs text-brand-muted">
                      {p.ultimo_mail_at ? (
                        <div title={p.ultimo_mail_asunto ?? ''}>
                          <div className="truncate max-w-[12rem]">{p.ultimo_mail_asunto ?? p.ultimo_mail_slug}</div>
                          <div className="text-[10px]">{fmtFecha(p.ultimo_mail_at)}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {!p.convertido_at && !p.baja_at && !p.suprimido && (
                          <Button variant="ghost" onClick={() => void handleBaja(p)} disabled={bajaId === p.id}
                            className="hover:!bg-rose-50 hover:!text-rose-600"
                            title="Dar de baja y suprimir el correo de todos los envíos">
                            {bajaId === p.id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                          </Button>
                        )}
                        {!p.convertido_at && (p.baja_at || p.suprimido) && (
                          <Button variant="ghost" onClick={() => void handleReactivar(p)} disabled={reactId === p.id}
                            className="hover:!bg-emerald-50 hover:!text-emerald-600"
                            title="Reactivar y devolver el correo a los envíos">
                            {reactId === p.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </div>
      )}

      {launcherOpen && kpis && (
        <FederalCampanaLauncher
          activo={kpis.activo}
          onClose={() => setLauncherOpen(false)}
          onEnqueued={() => { void recargarLista(); void recargarKpis(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lanzador de campaña federal: elegir plantilla + jurisdicción + cap diario,
// previsualizar la audiencia y encolar (gateado por federal_campanas_activo).
// ---------------------------------------------------------------------------
function FederalCampanaLauncher({ activo, onClose, onEnqueued }:
  { activo: boolean; onClose: () => void; onEnqueued: () => void }) {
  const confirmar = useConfirm();
  const [slug, setSlug] = useState<string>(FEDERAL_CAMPANAS_LANZABLES[0]?.slug ?? '');
  const [jur, setJur] = useState<JurFiltro>('');
  const [cap, setCap] = useState(1500);
  const [preview, setPreview] = useState<FederalCampanaPreview | null>(null);
  const [loadingPrev, setLoadingPrev] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancel = false;
    async function run() {
      if (!slug) { setPreview(null); return; }
      setLoadingPrev(true);
      const res = await previewFederalCampana(slug, jur || null);
      if (cancel) return;
      setLoadingPrev(false);
      if (res.ok) setPreview(res.data);
      else { setPreview(null); toast.error('No pudimos previsualizar', { description: humanizeError(res.error) }); }
    }
    void run();
    return () => { cancel = true; };
  }, [slug, jur]);

  const camp = FEDERAL_CAMPANAS_LANZABLES.find((c) => c.slug === slug) ?? null;
  const elegibles = preview?.elegibles ?? 0;
  const dias = cap > 0 ? Math.ceil(elegibles / cap) : 0;

  async function handleEnviar() {
    if (!slug || elegibles === 0) return;
    const ok = await confirmar({
      title: 'Encolar campaña federal',
      message: `Vas a encolar "${camp?.label}" a ${elegibles.toLocaleString('es-AR')} contactos${jur ? ` de ${jurLabel(jur)}` : ''}, con goteo de ${cap.toLocaleString('es-AR')}/día (${dias} día${dias === 1 ? '' : 's'}). La supresión y anti-fatiga ya están aplicadas. ¿Confirmás?`,
      confirmLabel: 'Encolar', cancelLabel: 'Cancelar',
    });
    if (!ok) return;
    setSending(true);
    const res = await enviarFederalCampana(slug, jur || null, cap, false);
    setSending(false);
    if (!res.ok) { toast.error('No pudimos encolar', { description: humanizeError(res.error) }); return; }
    if (!res.data.ok) {
      if (res.data.gated) {
        toast.info('Envío desactivado', { description: 'La Captación Federal está gateada (se habilita junto al carril SES). No se encoló nada.' });
      } else {
        toast.error('No se encoló', { description: res.data.error ?? '' });
      }
      return;
    }
    toast.success(`Campaña encolada: ${res.data.encolados?.toLocaleString('es-AR')} correos en ${res.data.dias} día${res.data.dias === 1 ? '' : 's'}`);
    onEnqueued();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Lanzar campaña federal" kicker="Captación Federal"
      icon={<Megaphone size={18} />} width={620}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-brand-muted">{activo ? 'Se encola con goteo y supresión global.' : 'Gateado: no se enviará nada.'}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            <Button variant="primary" onClick={() => void handleEnviar()} disabled={sending || loadingPrev || elegibles === 0 || !preview?.template_existe}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}
              Encolar {elegibles > 0 ? `(${elegibles.toLocaleString('es-AR')})` : ''}
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {!activo && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <ShieldAlert size={14} /> El envío está desactivado. Podés previsualizar la audiencia; nada se envía hasta habilitarlo.
          </div>
        )}
        {/* Selección de campaña */}
        <div className="grid gap-2 sm:grid-cols-2">
          {FEDERAL_CAMPANAS_LANZABLES.map((c) => (
            <button key={c.slug} type="button" onClick={() => setSlug(c.slug)}
              className={cn(
                'rounded-xl border p-3 text-left transition',
                slug === c.slug ? 'border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan/30' : 'border-slate-200 hover:border-slate-300',
              )}>
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                <span className="text-sm font-semibold text-brand-ink">{c.label}</span>
              </div>
              <p className="mt-1 text-xs text-brand-muted">{c.descripcion}</p>
            </button>
          ))}
        </div>

        {/* Jurisdicción + cap */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-brand-muted">
            Jurisdicción
            <Select value={jur} onChange={(e) => setJur(e.target.value as JurFiltro)} className="mt-1 max-w-[12rem]">
              <option value="">Todas</option>
              {JURISDICCIONES.map((j) => <option key={j.key} value={j.key}>{j.label}</option>)}
            </Select>
          </label>
          <label className="text-xs font-medium text-brand-muted">
            Goteo por día
            <Input type="number" min={1} max={5000} value={cap}
              onChange={(e) => setCap(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
              className="mt-1 w-32 tabular-nums" />
          </label>
        </div>

        {/* Preview de audiencia */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          {loadingPrev ? (
            <p className="flex items-center gap-2 text-sm text-brand-muted"><Loader2 size={14} className="animate-spin" /> Calculando audiencia…</p>
          ) : !preview ? (
            <p className="text-sm text-brand-muted">Elegí una campaña para ver la audiencia.</p>
          ) : (
            <>
              {!preview.template_existe && (
                <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                  <MailX size={11} /> La plantilla no está activa
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                <PrevStat label="En segmento" value={preview.en_segmento} />
                <PrevStat label="Sin email" value={preview.sin_email} muted />
                <PrevStat label="Suprimidos" value={preview.suprimidos} muted />
                <PrevStat label="En gracia" value={preview.en_gracia} muted hint="recibió un mail hace <30d" />
                <PrevStat label="Cooldown" value={preview.en_cooldown} muted hint="ya recibió esta campaña hace <90d" />
                <PrevStat label="Elegibles" value={preview.elegibles} strong />
              </div>
              {elegibles > 0 && (
                <p className="mt-2 text-xs text-brand-muted">
                  Se encolarían <strong className="text-brand-ink tabular-nums">{elegibles.toLocaleString('es-AR')}</strong> correos,
                  escalonados de a {cap.toLocaleString('es-AR')}/día → <strong className="text-brand-ink">{dias}</strong> día{dias === 1 ? '' : 's'} de horizonte.
                  <span className="mt-0.5 block text-[11px] text-slate-400">El ritmo real de salida lo gobierna la rampa del carril SES + el freno de reputación.</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PrevStat({ label, value, muted, strong, hint }:
  { label: string; value: number; muted?: boolean; strong?: boolean; hint?: string }) {
  return (
    <div title={hint}>
      <p className={cn('font-display text-lg font-bold tabular-nums', strong ? 'text-brand-cyan' : muted ? 'text-slate-400' : 'text-brand-ink')}>
        {value.toLocaleString('es-AR')}
      </p>
      <p className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</p>
    </div>
  );
}

// Chips de campañas federales enviadas (DGG-270): marca a qué prospecto ya se le mandó
// cada campaña (RPA / Consultoría / Webinar), para no reiterarle. Espeja los "coins" de
// la página PBA; relleno con el color de la campaña cuando fue enviada.
function FederalCampanasCoins({ enviadas }: { enviadas: Record<string, string> | null }) {
  const map = enviadas ?? {};
  const algo = FEDERAL_CAMPANAS_CATALOGO.some((c) => !!map[c.slug]);
  return (
    <div className="mx-auto grid w-max grid-cols-3 gap-1" title={algo ? undefined : 'Sin campañas enviadas'}>
      {FEDERAL_CAMPANAS_CATALOGO.map((c) => {
        const sentAt = map[c.slug];
        const enviada = !!sentAt;
        const tip = c.label + (enviada ? ` · enviada ${fmtFecha(sentAt)}` : ' · aún no enviada');
        return (
          <span key={c.slug} title={tip} aria-label={tip}
            className={cn(
              'inline-flex h-[18px] w-[18px] cursor-default items-center justify-center rounded-full border text-[8px] font-bold leading-none',
              enviada ? 'border-transparent text-white' : 'border-slate-300 bg-white text-slate-400',
            )}
            style={enviada ? { background: c.color, borderColor: c.color } : undefined}>
            {c.inicial}
          </span>
        );
      })}
    </div>
  );
}

function Th({ children, center, right }: { children: ReactNode; center?: boolean; right?: boolean }) {
  return (
    <th className={cn('px-4 py-2 text-xs font-semibold uppercase tracking-wider text-brand-muted',
      center ? 'text-center' : right ? 'text-right' : 'text-left')}>
      {children}
    </th>
  );
}

function KpiCard({ label, value, icon: Icon, tone, hint }: {
  label: string; value: number | string; icon: typeof Users; tone: 'cyan' | 'green' | 'navy' | 'amber'; hint?: string;
}) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}><Icon size={16} /></div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-brand-ink">
        {typeof value === 'number' ? value.toLocaleString('es-AR') : value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-brand-muted">{hint}</p>}
    </div>
  );
}
