// F4 (DGG-66) · Bandeja de Moderación de aportes del gestor.
// Cola de todos los aportes del gestor externo PENDIENTES de revisión. Por cada
// uno, gerencia decide: publicar (tal cual / editado / + cambiar estado),
// dejarlo interno (gerencia-only) o descartarlo (con motivo). Recién al publicar
// el cliente lo ve y se le notifica.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Send, EyeOff, Trash2, Pencil, X, Paperclip, Briefcase, Clock, FileInput,
  Award, AlertCircle,
} from 'lucide-react';
import { Button, Select, Textarea, Skeleton, useConfirm, usePrompt, RefreshIndicator } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { formatDateTime, formatDateShort } from '@/lib/dates';
import { abrirArchivoProtegido } from '@/lib/storageUrls';
import {
  fetchModeracionPendientes,
  moderarGestorAvance,
  subirAdjuntoTracking,
  type ModeracionPendiente,
  type ModeracionAccion,
} from '@/services/api/trackings';
import { TRAMITE_ESTADOS, TRAMITE_ESTADO_LABEL, type TramiteEstado } from '@/services/api/tramites';
import { crearPedidoDoc } from '@/services/api/tramitePedidosDoc';
import { ProgramarVencimientoModal } from '../components/ProgramarVencimientoModal';

export function ModeracionPage() {
  const [items, setItems] = useState<ModeracionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const firstRef = useRef(false);
  // DGG-142 E3 (V7) · al publicar un aporte que CIERRA el trámite, ofrecer
  // programar el próximo vencimiento. Vive a nivel página porque la card se
  // desmonta al recargar la cola (el aporte sale de pendientes).
  const [programar, setProgramar] = useState<{
    tramiteId: string;
    codigo: string;
    vigenciaMeses: number | null;
  } | null>(null);

  async function load() {
    if (firstRef.current) setRefreshing(true); else setLoading(true);
    const res = await fetchModeracionPendientes();
    setLoading(false); setRefreshing(false); firstRef.current = true;
    if (!res.ok) { toast.error('No pudimos cargar la cola', { description: humanizeError(res.error) }); return; }
    setItems(res.data);
  }
  useEffect(() => { void load(); }, []);
  // §6 C#8 (E5): la columna "En la ficha hoy" del diff de otorgamiento sale de
  // administraciones — refrescar también cuando la ficha cambia por otra vía.
  useRealtimeRefresh(['tracking_lineas', 'administraciones'], () => void load());

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <RefreshIndicator show={refreshing} />
      <header>
        <p className="kicker text-brand-cyan">Operación</p>
        <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">Moderación de aportes</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-muted">
          Lo que envía la gestoría externa entra acá para tu revisión. Publicá (tal cual o editado),
          dejalo como nota interna o descartalo. El cliente sólo ve lo que publicás.
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : items.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="No hay aportes pendientes"
          description="Cuando la gestoría externa cargue un avance, aparecerá acá para que lo revises antes de publicarlo al cliente."
        />
      ) : (
        <ul className="space-y-4">
          {items.map((it) => (
            <li key={it.linea_id}>
              <ModeracionCard
                item={it}
                onResuelto={() => void load()}
                onCerradoTramite={(t) => setProgramar(t)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* DGG-142 E3 · ofrecimiento post-cierre desde moderación (V7). */}
      {programar && (
        <ProgramarVencimientoModal
          key={programar.tramiteId}
          open
          onClose={() => setProgramar(null)}
          trackingId={programar.tramiteId}
          trackingTitulo={programar.codigo}
          periodoSugeridoDias={
            programar.vigenciaMeses != null
              ? Math.round(programar.vigenciaMeses * 30.4375)
              : undefined
          }
          onProgramado={() => setProgramar(null)}
        />
      )}
    </div>
  );
}

export function ModeracionCard({ item, onResuelto, onCerradoTramite }: {
  item: ModeracionPendiente;
  onResuelto: () => void;
  /** DGG-142 E3 (V7) · avisa al host que la publicación CERRÓ el trámite, para
   *  ofrecer "Programar próximo vencimiento". Vive en el host (página o detail)
   *  porque esta card se desmonta al salir de la cola de pendientes. */
  onCerradoTramite?: (t: { tramiteId: string; codigo: string; vigenciaMeses: number | null }) => void;
}) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.descripcion);
  const [archivos, setArchivos] = useState<string[]>(item.archivos_urls ?? []);
  const [estado, setEstado] = useState<'' | TramiteEstado>('');
  const [busy, setBusy] = useState<ModeracionAccion | null>(null);
  // DGG-108 · convertir el aporte del gestor en un Pedido de Documentación accionable
  // (le abre la casilla de subida al cliente) sin salir de Moderación.
  const [creandoPedido, setCreandoPedido] = useState(false);
  // Idempotencia: si el pedido ya se creó y sólo falló sacar el aporte de la cola,
  // un reintento NO debe crear un 2º pedido (evita doble email/push/casilla al cliente).
  const pedidoCreadoRef = useRef(false);
  // E-GG-91 (d) · gerencia puede adjuntar su propio archivo al aporte antes de publicar.
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // DGG-142 E5 (mig 0448) · otorgamiento RPAC propuesto por la gestoría.
  // `propuesto` es inmutable (lo que cargó el gestor); acá gerencia lo edita
  // antes de asentarlo. `aplicarOtorg` permite publicar SIN tocar la ficha.
  // §6 A#8/C#7: sin administración vinculada la RPC rechaza el asiento (22023)
  // → arranca destildado y deshabilitado con copy, en vez de fallar al publicar.
  const propuesto = item.otorgamiento?.propuesto ?? null;
  const tienePropuesta = !!propuesto && Object.values(propuesto).some((v) => !!v);
  const [aplicarOtorg, setAplicarOtorg] = useState(!!item.administracion_id);
  // §6 A#4/B GAP-1: los valores del propuesto vienen de un jsonb que pudo
  // forjarse — se re-validan acá (largo 40 / fecha ISO) antes de entrar a
  // inputs controlados, porque un date input renderiza VACÍO un valor no-ISO
  // pero el estado lo retendría y viajaría invisible al publicar.
  const fechaISO = (v: string | undefined) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
  const [otorgEdit, setOtorgEdit] = useState({
    matricula: (propuesto?.matricula ?? '').slice(0, 40),
    legajo: (propuesto?.legajo ?? '').slice(0, 40),
    fecha_emision: fechaISO(propuesto?.fecha_emision),
    fecha_vencimiento: fechaISO(propuesto?.fecha_vencimiento),
  });
  const otorgEditTiene = Object.values(otorgEdit).some((v) => v.trim().length > 0);
  const otorgFechasIncoherentes =
    !!otorgEdit.fecha_emision &&
    !!otorgEdit.fecha_vencimiento &&
    otorgEdit.fecha_vencimiento < otorgEdit.fecha_emision;

  const editado = texto.trim() !== item.descripcion.trim() || archivos.length !== (item.archivos_urls?.length ?? 0);

  async function onAgregarArchivo(file: File) {
    setSubiendo(true);
    const r = await subirAdjuntoTracking(item.tramite_id, file);
    setSubiendo(false);
    if (!r.ok) {
      toast.error('No pudimos subir el archivo', { description: humanizeError(r.error) });
      return;
    }
    setArchivos((a) => [...a, r.data]);
    toast.success('Archivo agregado');
  }

  async function ejecutar(accion: ModeracionAccion, extra: { motivo?: string } = {}) {
    if (accion === 'publicar' && !texto.trim()) { toast.error('El texto no puede quedar vacío'); return; }
    // DGG-142 E5 · el otorgamiento SOLO viaja al publicar (la RPC rechaza
    // interno/descartar con otorgamiento — 22023) y sólo si gerencia dejó
    // activo "Asentar en la ficha". Se envían los valores EDITADOS.
    const mandaOtorg = accion === 'publicar' && tienePropuesta && aplicarOtorg && otorgEditTiene;
    if (mandaOtorg && otorgFechasIncoherentes) {
      toast.error('La fecha de vencimiento de la matrícula no puede ser anterior a la de emisión.');
      return;
    }
    setBusy(accion);
    const res = await moderarGestorAvance(item.linea_id, accion, {
      descripcion: (accion !== 'descartar' && editado) ? texto.trim() : undefined,
      archivosUrls: (accion !== 'descartar' && editado) ? archivos : undefined,
      estadoAsociado: accion === 'publicar' && estado ? estado : undefined,
      motivo: extra.motivo,
      // §6 B GAP-1 (cinturón): sólo viajan fechas ISO estrictas — cualquier
      // literal raro que hubiera sobrevivido en el estado se descarta acá y
      // el sanitizador de BD (0449) lo rechazaría igual.
      otorgamiento: mandaOtorg
        ? {
            ...(otorgEdit.matricula.trim() ? { matricula: otorgEdit.matricula.trim() } : {}),
            ...(otorgEdit.legajo.trim() ? { legajo: otorgEdit.legajo.trim() } : {}),
            ...(/^\d{4}-\d{2}-\d{2}$/.test(otorgEdit.fecha_emision)
              ? { fecha_emision: otorgEdit.fecha_emision }
              : {}),
            ...(/^\d{4}-\d{2}-\d{2}$/.test(otorgEdit.fecha_vencimiento)
              ? { fecha_vencimiento: otorgEdit.fecha_vencimiento }
              : {}),
          }
        : undefined,
    });
    setBusy(null);
    if (!res.ok) { toast.error('No pudimos procesar', { description: humanizeError(res.error) }); return; }
    toast.success(
      accion === 'publicar' ? 'Publicado al cliente' : accion === 'interno' ? 'Guardado como nota interna' : 'Aporte descartado',
      mandaOtorg
        ? { description: 'Otorgamiento asentado en la ficha del cliente.' }
        : undefined,
    );
    // DGG-142 E3 (V7) · publicar con "Pasar a: Cerrado" es una vía de cierre →
    // el host ofrece programar el próximo vencimiento. Antes de onResuelto:
    // la recarga desmonta esta card. Sin administración no se ofrece
    // (tracking_cerrar_ciclo la exige — mismo guard que kanban/lista/detail).
    // E5: si el otorgamiento recién asentado trae fecha de vencimiento, el
    // sync ficha→agenda (mig 0444) YA creó la alarma 45/30/15 — ofrecer el
    // modal duplicaría el pedido de una fecha que ya quedó agendada.
    // §6 A#7/B#15: el toast sólo afirma lo que el sync realmente hizo —
    // (a) fecha IGUAL a la de la ficha: el trigger no dispara (IS DISTINCT
    //     FROM) → se sigue ofreciendo el modal (adopta la fila canónica si
    //     existe; la crea si no — sin duplicados, cerrar_ciclo v4);
    // (b) fecha PASADA: el sync la nace 'vencido' sin alarma → warning honesto.
    if (accion === 'publicar' && estado === 'cerrado' && item.administracion_id) {
      const fechaAplicada = mandaOtorg ? otorgEdit.fecha_vencimiento : '';
      const cambiaFicha =
        !!fechaAplicada && fechaAplicada !== (item.ficha_matricula_rpac_vencimiento ?? '');
      const hoyISO = new Date().toISOString().slice(0, 10);
      if (cambiaFicha && fechaAplicada > hoyISO) {
        toast.info('Próximo vencimiento agendado', {
          description: 'La alarma 45/30/15 al cliente quedó programada desde el otorgamiento.',
        });
      } else if (cambiaFicha) {
        toast.warning('Fecha de vencimiento ya pasada', {
          description:
            'La ficha quedó con la matrícula VENCIDA; no se agenda alarma de aviso al cliente.',
        });
      } else {
        onCerradoTramite?.({
          tramiteId: item.tramite_id,
          codigo: item.tramite_codigo,
          vigenciaMeses: item.servicio_vigencia_meses,
        });
      }
    }
    onResuelto();
  }

  // §6 A#11: si el aporte trae un otorgamiento propuesto, Interno/Descartar/
  // Pedir doc lo dejan sólo como registro — avisarlo antes de confirmar.
  const notaOtorgPerdido = tienePropuesta
    ? ' Este aporte trae un otorgamiento propuesto que NO se asentará en la ficha.'
    : '';

  async function onDescartar() {
    const motivo = await prompt({
      title: 'Descartar aporte',
      message: `¿Por qué lo descartás? (queda como registro de auditoría, no se publica)${notaOtorgPerdido}`,
      placeholder: 'Motivo (opcional)',
      confirmLabel: 'Descartar',
    });
    if (motivo === null) return; // canceló
    await ejecutar('descartar', { motivo: motivo || undefined });
  }

  async function onInterno() {
    const ok = await confirm({
      title: 'Dejar como interno',
      message: `Queda como registro de gerencia (NO visible al cliente).${notaOtorgPerdido} ¿Confirmás?`,
      confirmLabel: 'Dejar interno',
    });
    if (!ok) return;
    await ejecutar('interno');
  }

  // DGG-108 · atajo: convierte el aporte del gestor en un Pedido de Documentación
  // (misma RPC que Trámites → le abre al cliente la casilla de subida + aviso por
  // portal/push/email). Luego deja el aporte original como interno para vaciar la cola.
  async function onConvertirEnPedido() {
    const desc = texto.trim();
    if (!desc) { toast.error('Escribí qué le pedís al cliente antes de convertir'); return; }
    setCreandoPedido(true);
    const ok = await confirm({
      title: 'Pedir documentación al cliente',
      message: `Se le abre al cliente una casilla para subir lo pedido y se le avisa por portal, push y email.${notaOtorgPerdido} ¿Confirmás?`,
      confirmLabel: 'Pedir al cliente',
    });
    if (!ok) { setCreandoPedido(false); return; }
    // Si un intento previo ya creó el pedido (y sólo falló sacar el aporte de la cola),
    // NO lo volvemos a crear: reintentamos únicamente el paso 'interno'.
    if (!pedidoCreadoRef.current) {
      // JL-R3 (2026-08-20): NO pasar `desc` como descripción Y como ítem — el pedido
      // tiene un encabezado (pedido.descripcion) + una lista de ítems; duplicar el
      // texto lo mostraba al cliente dos veces ("lo que pones en texto también queda
      // como título"). El texto que se escribe ES lo que se le pide → va como único
      // ítem; el encabezado queda en el default limpio ('Documentación requerida').
      const res = await crearPedidoDoc(item.tramite_id, '', [desc]);
      if (!res.ok) {
        setCreandoPedido(false);
        toast.error('No pudimos crear el pedido', { description: humanizeError(res.error) });
        return;
      }
      pedidoCreadoRef.current = true;
    }
    // Sacar el aporte original de la cola: ya lo transformamos en un pedido accionable
    // (el pedido genera su propia línea visible al cliente).
    const mod = await moderarGestorAvance(item.linea_id, 'interno', editado ? { descripcion: desc, archivosUrls: archivos } : undefined);
    setCreandoPedido(false);
    if (!mod.ok) {
      // El pedido ya se creó y cumplió su objetivo; sólo quedó el aporte en la cola.
      // El botón puede reintentarse sin duplicar (pedidoCreadoRef ya está en true).
      toast.warning('Pedido enviado, pero el aporte quedó en la cola', { description: 'Tocá "Pedir doc al cliente" de nuevo (no se duplica) o marcalo Interno.' });
      onResuelto();
      return;
    }
    toast.success('Pedido enviado al cliente', { description: 'Le avisamos por portal, push y email. Puede subir o responder desde su gestión.' });
    onResuelto();
  }

  return (
    <article className="card-premium relative overflow-hidden p-5">
      <TrianglesAccent position="top-right" size={90} tone="cyan" density="soft" className="opacity-20" />
      <div className="relative">
        <header className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            to={`/gerencia/tramites/${item.tramite_id}`}
            className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 font-mono uppercase tracking-wider text-brand-muted hover:text-brand-cyan"
          >
            <Briefcase size={11} /> {item.tramite_codigo}
          </Link>
          <span className="font-medium text-brand-ink">{item.servicio_nombre}</span>
          {item.cliente_nombre && <span className="text-brand-muted">· {item.cliente_nombre}</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-brand-muted">
            <Clock size={11} /> {formatDateTime(item.created_at)}
          </span>
        </header>

        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
          Aporte de {item.gestor_label ?? 'gestoría externa'} · pendiente
        </p>

        {editando ? (
          <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="mt-3" />
        ) : (
          <p className="mt-3 whitespace-pre-wrap text-sm text-brand-ink/85">{texto}</p>
        )}

        {archivos.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {archivos.map((u, i) => (
              <li key={i} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-brand-ink">
                {/* E-GG-126: bucket privado → firmar on-click */}
                <button type="button" onClick={() => void abrirArchivoProtegido(u)} className="inline-flex items-center gap-1 hover:text-brand-cyan">
                  <Paperclip size={12} /> Adjunto {i + 1}
                </button>
                {editando && (
                  <button type="button" onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700" aria-label="Quitar adjunto">
                    <X size={11} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* DGG-142 E5 · diff "Propuesto | En la ficha hoy" del otorgamiento RPAC.
            Gerencia edita los valores propuestos y decide si se asientan en la
            ficha al publicar. La propuesta original queda inmutable en la línea
            (auditoría propuesto vs aplicado). */}
        {tienePropuesta && (
          <div className="mt-4 rounded-xl border border-brand-orange/40 bg-orange-50/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="kicker inline-flex items-center gap-1 text-brand-orange">
                <Award size={12} /> Otorgamiento informado por la gestoría
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-brand-ink">
                <input
                  type="checkbox"
                  checked={aplicarOtorg}
                  onChange={(e) => setAplicarOtorg(e.target.checked)}
                  disabled={busy !== null || creandoPedido || !item.administracion_id}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/30"
                />
                Asentar en la ficha al publicar
              </label>
            </div>
            {/* §6 A#8: sin administración la RPC rechaza el asiento — decirlo acá. */}
            {!item.administracion_id && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <AlertCircle size={12} className="shrink-0" />
                Este trámite no tiene administración vinculada — vinculala primero
                para poder asentar el otorgamiento en la ficha.
              </p>
            )}

            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-muted">
                  Propuesto (editable)
                </p>
                <div className="space-y-1.5">
                  <label className="block">
                    <span className="text-[11px] font-semibold text-brand-ink">Nº de matrícula</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={otorgEdit.matricula}
                      onChange={(e) => setOtorgEdit((p) => ({ ...p, matricula: e.target.value }))}
                      disabled={!aplicarOtorg || busy !== null || creandoPedido}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 disabled:bg-slate-50 disabled:text-brand-muted"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-brand-ink">Nº de legajo</span>
                    <input
                      type="text"
                      maxLength={40}
                      value={otorgEdit.legajo}
                      onChange={(e) => setOtorgEdit((p) => ({ ...p, legajo: e.target.value }))}
                      disabled={!aplicarOtorg || busy !== null || creandoPedido}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 disabled:bg-slate-50 disabled:text-brand-muted"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-brand-ink">Fecha de emisión</span>
                    <input
                      type="date"
                      min="1990-01-01"
                      max="2100-12-31"
                      value={otorgEdit.fecha_emision}
                      onChange={(e) => setOtorgEdit((p) => ({ ...p, fecha_emision: e.target.value }))}
                      disabled={!aplicarOtorg || busy !== null || creandoPedido}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 disabled:bg-slate-50 disabled:text-brand-muted"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-brand-ink">Fecha de vencimiento</span>
                    <input
                      type="date"
                      min="1990-01-01"
                      max="2100-12-31"
                      value={otorgEdit.fecha_vencimiento}
                      onChange={(e) => setOtorgEdit((p) => ({ ...p, fecha_vencimiento: e.target.value }))}
                      disabled={!aplicarOtorg || busy !== null || creandoPedido}
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-brand-ink shadow-sm transition focus:border-brand-cyan focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 disabled:bg-slate-50 disabled:text-brand-muted"
                    />
                  </label>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-muted">
                  En la ficha hoy
                </p>
                <dl className="space-y-1.5 rounded-lg bg-white/70 p-2.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-brand-muted">Matrícula</dt>
                    <dd className="font-medium text-brand-ink">{item.ficha_matricula_rpac || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-brand-muted">Legajo</dt>
                    <dd className="font-medium text-brand-ink">{item.ficha_legajo_rpac || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-brand-muted">Emisión</dt>
                    <dd className="font-medium text-brand-ink">
                      {item.ficha_matricula_rpac_fecha ? formatDateShort(item.ficha_matricula_rpac_fecha) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-brand-muted">Vencimiento</dt>
                    <dd className="font-medium text-brand-ink">
                      {item.ficha_matricula_rpac_vencimiento
                        ? formatDateShort(item.ficha_matricula_rpac_vencimiento)
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {otorgFechasIncoherentes && aplicarOtorg && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-600">
                <AlertCircle size={12} className="shrink-0" />
                La fecha de vencimiento no puede ser anterior a la de emisión.
              </p>
            )}
            {/* §6 A#7/A#9/B#15: cada rama dice EXACTAMENTE lo que va a pasar. */}
            {!aplicarOtorg ? (
              <p className="mt-2 text-[11px] text-brand-muted">
                La ficha del cliente NO se toca; la propuesta queda sólo como
                registro en el aporte.
              </p>
            ) : !otorgEditTiene ? (
              <p className="mt-2 text-[11px] text-brand-muted">
                Sin datos cargados — al publicar no se asienta nada en la ficha.
              </p>
            ) : otorgEdit.fecha_vencimiento &&
              otorgEdit.fecha_vencimiento <= new Date().toISOString().slice(0, 10) ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                <AlertCircle size={12} className="shrink-0" />
                Esta fecha ya pasó: la ficha quedará con la matrícula VENCIDA y no
                se agenda alarma de aviso al cliente.
              </p>
            ) : otorgEdit.fecha_vencimiento ? (
              <p className="mt-2 text-[11px] text-brand-muted">
                Al publicar, la alarma de renovación (45/30/15 días) al cliente se
                agenda automáticamente con esta fecha de vencimiento.
              </p>
            ) : null}
            {aplicarOtorg && (
              <p className="mt-1 text-[11px] text-brand-muted">
                Un campo vacío conserva el valor actual de la ficha (no lo borra).
              </p>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => { if (editando) { setTexto(item.descripcion); setArchivos(item.archivos_urls ?? []); } setEditando((v) => !v); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
          >
            <Pencil size={13} /> {editando ? 'Cancelar edición' : 'Editar'}
          </button>

          {editando && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onAgregarArchivo(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={subiendo || busy !== null}
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan disabled:opacity-50"
              >
                <Paperclip size={13} /> {subiendo ? 'Subiendo…' : 'Agregar archivo'}
              </button>
            </>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={estado} disabled={busy !== null || creandoPedido} onChange={(e) => setEstado(e.target.value as '' | TramiteEstado)} className="h-9 w-auto py-1 text-xs" aria-label="Cambiar estado del trámite al publicar">
              <option value="">Estado: sin cambio</option>
              {TRAMITE_ESTADOS.map((e) => <option key={e} value={e}>Pasar a: {TRAMITE_ESTADO_LABEL[e]}</option>)}
            </Select>
            <Button variant="secondary" onClick={onConvertirEnPedido} loading={creandoPedido} disabled={busy !== null || creandoPedido} title="Convierte este aporte en un pedido de documentación: al cliente se le abre una casilla para subir lo pedido">
              <FileInput size={14} /> Pedir doc al cliente
            </Button>
            <Button variant="ghost" onClick={onDescartar} loading={busy === 'descartar'} disabled={busy !== null || creandoPedido} className="text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Descartar
            </Button>
            <Button variant="secondary" onClick={onInterno} loading={busy === 'interno'} disabled={busy !== null || creandoPedido}>
              <EyeOff size={14} /> Interno
            </Button>
            <Button onClick={() => void ejecutar('publicar')} loading={busy === 'publicar'} disabled={busy !== null || creandoPedido}>
              <Send size={14} /> {editado || estado ? 'Publicar (editado)' : 'Publicar'}
            </Button>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1 text-[11px] text-brand-muted">
          <ShieldCheck size={12} /> Al publicar, el cliente lo ve en su portal y recibe el aviso.
        </p>
      </div>
    </article>
  );
}
