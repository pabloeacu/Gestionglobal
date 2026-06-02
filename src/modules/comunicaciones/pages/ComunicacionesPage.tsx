// ComunicacionesPage · panel gerencia para enviar noticias / novedades.
// Diseño:
//   - Header con CTA "Nueva comunicación"
//   - Grid de tarjetas con todas las comunicaciones (borradores y enviadas)
//   - Click sobre tarjeta abre detalle / edición en Drawer.
//   - Drawer: editor + audiencia + canales + preview destinatarios + enviar.
//
// Reglas: 4 (api en services/), 13 (DialogProvider), 8 (copy ES dominio).

import { useCallback, useEffect, useState } from 'react';
import {
  Megaphone,
  Plus,
  Mail,
  Bell,
  Monitor,
  Users as UsersIcon,
  Pencil,
  Trash2,
  Eye,
  CheckCircle2,
} from 'lucide-react';
import { Button, Skeleton, useConfirm } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  listComunicaciones,
  eliminarComunicacion,
  BANNER_ESTILO_BADGE,
  BANNER_ESTILO_LABEL,
  type ComunicacionRow,
} from '@/services/api/comunicaciones';
import { ComunicacionFormDrawer } from '../components/ComunicacionFormDrawer';
import { humanizeError } from '@/lib/errors';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ComunicacionesPage() {
  const [rows, setRows] = useState<ComunicacionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ComunicacionRow | null>(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listComunicaciones();
    if (!res.ok) {
      toast.error(`No se pudo cargar: ${humanizeError(res.error)}`);
      setRows([]);
    } else {
      setRows(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(row: ComunicacionRow) {
    setEditing(row);
    setDrawerOpen(true);
  }

  async function onDelete(row: ComunicacionRow) {
    const okBtn = await confirm({
      title: '¿Eliminar comunicación?',
      message: `"${row.titulo}" se eliminará definitivamente. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!okBtn) return;
    const res = await eliminarComunicacion(row.id);
    if (!res.ok) {
      toast.error(`No se pudo eliminar: ${humanizeError(res.error)}`);
      return;
    }
    toast.success('Comunicación eliminada');
    void load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-50 via-white to-amber-50 p-6 ring-1 ring-cyan-100">
        <TrianglesAccent position="top-right" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-cyan-100">
              <Megaphone size={22} className="text-cyan-600" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">
                Comunicaciones
              </p>
              <h1 className="text-2xl font-bold text-slate-900">
                Noticias y novedades a tus clientes
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Enviá un banner al dashboard, un email o un push (o los tres) a un
                subconjunto de administraciones.
              </p>
            </div>
          </div>
          <Button onClick={openNew} className="shrink-0">
            <Plus size={16} className="mr-1" />
            Nueva comunicación
          </Button>
        </div>
      </div>

      {/* Listado */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : rows.length === 0 ? (
        <IllustratedEmpty
          title="Todavía no enviaste ninguna comunicación"
          description="Las novedades aparecen en el portal del administrador y, opcionalmente, llegan por mail o push."
          action={
            <Button onClick={openNew}>
              <Plus size={16} className="mr-1" /> Crear la primera
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const badge = BANNER_ESTILO_BADGE[c.banner_estilo];
            const isDraft = c.estado === 'borrador';
            return (
              <div
                key={c.id}
                className="group relative flex flex-col rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-cyan-200"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${badge.bg} ${badge.text} ${badge.ring}`}
                  >
                    {BANNER_ESTILO_LABEL[c.banner_estilo]}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      isDraft
                        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                        : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    }`}
                  >
                    {isDraft ? 'Borrador' : 'Enviada'}
                  </span>
                </div>

                <h3 className="line-clamp-2 text-base font-semibold text-slate-900">
                  {c.titulo}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                  {c.cuerpo_md}
                </p>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-slate-500">
                  {c.canal_banner && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">
                      <Monitor size={11} /> Dashboard
                    </span>
                  )}
                  {c.canal_email && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">
                      <Mail size={11} /> Email
                    </span>
                  )}
                  {c.canal_push && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">
                      <Bell size={11} /> Push
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <UsersIcon size={11} />
                    {c.total_destinatarios > 0
                      ? `${c.total_destinatarios} destinatario${c.total_destinatarios === 1 ? '' : 's'}`
                      : isDraft
                        ? 'Sin enviar'
                        : '—'}
                  </span>
                  <span>
                    {isDraft
                      ? `Creada ${formatDate(c.created_at)}`
                      : `Enviada ${formatDate(c.enviado_at)}`}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => openEdit(c)}
                    className="flex-1 !py-1.5 !text-xs"
                  >
                    {isDraft ? (
                      <>
                        <Pencil size={14} className="mr-1" /> Editar
                      </>
                    ) : (
                      <>
                        <Eye size={14} className="mr-1" /> Ver
                      </>
                    )}
                  </Button>
                  {isDraft && (
                    <Button
                      variant="ghost"
                      onClick={() => void onDelete(c)}
                      title="Eliminar"
                      className="!py-1.5 !text-xs text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>

                {!isDraft && (
                  <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-emerald-500 p-1">
                    <CheckCircle2 size={12} className="text-white" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ComunicacionFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editing={editing}
        onSaved={() => void load()}
      />
    </div>
  );
}
