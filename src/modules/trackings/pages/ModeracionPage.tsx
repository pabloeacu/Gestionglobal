// F4 (DGG-66) · Bandeja de Moderación de aportes del gestor.
// Cola de todos los aportes del gestor externo PENDIENTES de revisión. Por cada
// uno, gerencia decide: publicar (tal cual / editado / + cambiar estado),
// dejarlo interno (gerencia-only) o descartarlo (con motivo). Recién al publicar
// el cliente lo ve y se le notifica.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck, Send, EyeOff, Trash2, Pencil, X, Paperclip, Briefcase, Clock,
} from 'lucide-react';
import { Button, Select, Textarea, Skeleton, useConfirm, usePrompt, RefreshIndicator } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import { formatDateTime } from '@/lib/dates';
import {
  fetchModeracionPendientes,
  moderarGestorAvance,
  subirAdjuntoTracking,
  type ModeracionPendiente,
  type ModeracionAccion,
} from '@/services/api/trackings';
import { TRAMITE_ESTADOS, TRAMITE_ESTADO_LABEL, type TramiteEstado } from '@/services/api/tramites';

export function ModeracionPage() {
  const [items, setItems] = useState<ModeracionPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const firstRef = useRef(false);

  async function load() {
    if (firstRef.current) setRefreshing(true); else setLoading(true);
    const res = await fetchModeracionPendientes();
    setLoading(false); setRefreshing(false); firstRef.current = true;
    if (!res.ok) { toast.error('No pudimos cargar la cola', { description: humanizeError(res.error) }); return; }
    setItems(res.data);
  }
  useEffect(() => { void load(); }, []);
  useRealtimeRefresh(['tracking_lineas'], () => void load());

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
              <ModeracionCard item={it} onResuelto={() => void load()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ModeracionCard({ item, onResuelto }: { item: ModeracionPendiente; onResuelto: () => void }) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(item.descripcion);
  const [archivos, setArchivos] = useState<string[]>(item.archivos_urls ?? []);
  const [estado, setEstado] = useState<'' | TramiteEstado>('');
  const [busy, setBusy] = useState<ModeracionAccion | null>(null);
  // E-GG-91 (d) · gerencia puede adjuntar su propio archivo al aporte antes de publicar.
  const [subiendo, setSubiendo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setBusy(accion);
    const res = await moderarGestorAvance(item.linea_id, accion, {
      descripcion: (accion !== 'descartar' && editado) ? texto.trim() : undefined,
      archivosUrls: (accion !== 'descartar' && editado) ? archivos : undefined,
      estadoAsociado: accion === 'publicar' && estado ? estado : undefined,
      motivo: extra.motivo,
    });
    setBusy(null);
    if (!res.ok) { toast.error('No pudimos procesar', { description: humanizeError(res.error) }); return; }
    toast.success(
      accion === 'publicar' ? 'Publicado al cliente' : accion === 'interno' ? 'Guardado como nota interna' : 'Aporte descartado',
    );
    onResuelto();
  }

  async function onDescartar() {
    const motivo = await prompt({
      title: 'Descartar aporte',
      message: '¿Por qué lo descartás? (queda como registro de auditoría, no se publica)',
      placeholder: 'Motivo (opcional)',
      confirmLabel: 'Descartar',
    });
    if (motivo === null) return; // canceló
    await ejecutar('descartar', { motivo: motivo || undefined });
  }

  async function onInterno() {
    const ok = await confirm({
      title: 'Dejar como interno',
      message: 'Queda como registro de gerencia (NO visible al cliente). ¿Confirmás?',
      confirmLabel: 'Dejar interno',
    });
    if (!ok) return;
    await ejecutar('interno');
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
                <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-brand-cyan">
                  <Paperclip size={12} /> Adjunto {i + 1}
                </a>
                {editando && (
                  <button type="button" onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700" aria-label="Quitar adjunto">
                    <X size={11} />
                  </button>
                )}
              </li>
            ))}
          </ul>
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
            <Select value={estado} disabled={busy !== null} onChange={(e) => setEstado(e.target.value as '' | TramiteEstado)} className="h-9 w-auto py-1 text-xs" aria-label="Cambiar estado del trámite al publicar">
              <option value="">Estado: sin cambio</option>
              {TRAMITE_ESTADOS.map((e) => <option key={e} value={e}>Pasar a: {TRAMITE_ESTADO_LABEL[e]}</option>)}
            </Select>
            <Button variant="ghost" onClick={onDescartar} loading={busy === 'descartar'} disabled={busy !== null} className="text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Descartar
            </Button>
            <Button variant="secondary" onClick={onInterno} loading={busy === 'interno'} disabled={busy !== null}>
              <EyeOff size={14} /> Interno
            </Button>
            <Button onClick={() => void ejecutar('publicar')} loading={busy === 'publicar'} disabled={busy !== null}>
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
