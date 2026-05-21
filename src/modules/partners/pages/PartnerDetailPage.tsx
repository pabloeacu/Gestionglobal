import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Handshake,
  Plus,
  Percent,
  FileBarChart,
  ListChecks,
  Pencil,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  Button,
  Tabs,
  Skeleton,
  useConfirm,
  type TabItem,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { formatDateLong } from '@/lib/dates';
import { cn } from '@/lib/cn';
import { PartnerFormDrawer } from '../components/PartnerFormDrawer';
import { ConvenioDrawer } from '../components/ConvenioDrawer';
import { NuevaRendicionModal } from '../components/NuevaRendicionModal';
import {
  getPartner,
  listConvenios,
  listRendiciones,
  listAtribuciones,
  cerrarConvenio,
  fmtMoneda,
  fmtPct,
  CONDICION_IVA_LABEL,
  RENDICION_ESTADO_BADGE,
  RENDICION_ESTADO_LABEL,
  type PartnerRow,
  type PartnerConvenioRow,
  type RendicionListItem,
  type AtribucionListItem,
  type CondicionIva,
  type RendicionEstado,
} from '@/services/api/partners';

type TabKey = 'convenios' | 'rendiciones' | 'atribuciones';

export function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const confirm = useConfirm();

  const [partner, setPartner] = useState<PartnerRow | null>(null);
  const [convenios, setConvenios] = useState<PartnerConvenioRow[]>([]);
  const [rendiciones, setRendiciones] = useState<RendicionListItem[]>([]);
  const [atribuciones, setAtribuciones] = useState<AtribucionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('convenios');
  const [editOpen, setEditOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [rendOpen, setRendOpen] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    const [p, c, r, a] = await Promise.all([
      getPartner(id),
      listConvenios(id),
      listRendiciones({ partnerId: id, limit: 100 }),
      listAtribuciones({ partnerId: id }),
    ]);
    setLoading(false);
    if (!p.ok) {
      toast.error(p.error.message);
      return;
    }
    setPartner(p.data);
    if (c.ok) setConvenios(c.data);
    if (r.ok) setRendiciones(r.data);
    if (a.ok) setAtribuciones(a.data);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtimeRefresh(
    ['partners', 'partner_convenios', 'partner_rendiciones', 'partner_atribuciones'],
    () => void load(),
  );

  const tabItems = useMemo<TabItem[]>(
    () => [
      {
        key: 'convenios',
        label: 'Convenios',
        icon: <Percent size={14} />,
        badge: convenios.length,
      },
      {
        key: 'rendiciones',
        label: 'Rendiciones',
        icon: <FileBarChart size={14} />,
        badge: rendiciones.length,
      },
      {
        key: 'atribuciones',
        label: 'Atribuciones',
        icon: <ListChecks size={14} />,
        badge: atribuciones.length,
      },
    ],
    [convenios.length, rendiciones.length, atribuciones.length],
  );

  async function onCerrarConvenio(c: PartnerConvenioRow) {
    const okConf = await confirm({
      title: 'Cerrar convenio',
      message: `¿Cerrar este convenio? Se marcará como inactivo y se fijará la fecha de fin a hoy.`,
      confirmLabel: 'Cerrar convenio',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!okConf) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const res = await cerrarConvenio(c.id, hoy);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('Convenio cerrado');
    void load();
  }

  if (loading && !partner) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!partner) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center text-brand-muted">
        Partner no encontrado.
      </div>
    );
  }

  const condicion = partner.condicion_iva as CondicionIva | null;
  const convenioVigente = convenios.find((c) => {
    const today = new Date().toISOString().slice(0, 10);
    return (
      c.activo &&
      c.vigencia_desde <= today &&
      (c.vigencia_hasta === null || c.vigencia_hasta >= today)
    );
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        to="/gerencia/partners"
        className="inline-flex items-center gap-1 text-sm text-brand-muted transition hover:text-brand-cyan"
      >
        <ArrowLeft size={14} /> Partners
      </Link>

      {/* Header premium */}
      <section className="card-premium relative overflow-hidden p-6">
        <TrianglesAccent
          position="top-right"
          size={180}
          tone="cyan"
          density="soft"
          className="opacity-25"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="kicker text-brand-cyan">
              <Handshake size={11} className="inline -translate-y-px" /> Partner
            </p>
            <h1 className="font-display text-3xl font-bold text-brand-ink sm:text-4xl">
              {partner.nombre_legal}
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              {partner.slug} ·{' '}
              {condicion ? CONDICION_IVA_LABEL[condicion] : 'Sin condición IVA'}{' '}
              · {partner.cuit ?? 'CUIT s/d'}
            </p>
            {convenioVigente && (
              <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-3 py-2 text-xs text-brand-ink">
                <span className="font-semibold">Convenio vigente:</span>
                <span>
                  {fmtPct(convenioVigente.porc_ingresos)} ingresos /{' '}
                  {fmtPct(convenioVigente.porc_costos)} costos
                </span>
                <span className="text-brand-muted">
                  · desde {formatDateLong(convenioVigente.vigencia_desde)}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setEditOpen(true)}>
              <Pencil size={14} /> Editar
            </Button>
            <Button variant="ghost" onClick={() => setConvOpen(true)}>
              <Plus size={14} /> Convenio
            </Button>
            <Button onClick={() => setRendOpen(true)}>
              <Plus size={14} /> Nueva rendición
            </Button>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <Tabs
        items={tabItems}
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {tab === 'convenios' && (
        <section className="card-premium overflow-hidden p-0">
          {convenios.length === 0 ? (
            <div className="p-8 text-center text-sm text-brand-muted">
              No hay convenios cargados. Creá uno para empezar a rendir.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-brand-zebra text-left text-[11px] uppercase tracking-wider text-brand-muted">
                <tr>
                  <th className="px-4 py-2">Vigencia</th>
                  <th className="px-4 py-2">% Ingresos</th>
                  <th className="px-4 py-2">% Costos</th>
                  <th className="px-4 py-2">Moneda</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {convenios.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-ink">
                        {formatDateLong(c.vigencia_desde)}
                      </p>
                      <p className="text-xs text-brand-muted">
                        → {c.vigencia_hasta ? formatDateLong(c.vigencia_hasta) : 'sin fin'}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-semibold">{fmtPct(c.porc_ingresos)}</td>
                    <td className="px-4 py-3 font-semibold">{fmtPct(c.porc_costos)}</td>
                    <td className="px-4 py-3">{c.moneda}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          c.activo
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-slate-50 text-slate-600',
                        )}
                      >
                        {c.activo ? 'Activo' : 'Cerrado'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.activo && (
                        <Button
                          variant="ghost"
                          className="!px-3 !py-1.5 !text-xs"
                          onClick={() => void onCerrarConvenio(c)}
                        >
                          Cerrar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'rendiciones' && (
        <section className="card-premium overflow-hidden p-0">
          {rendiciones.length === 0 ? (
            <div className="p-8 text-center text-sm text-brand-muted">
              Aún no hay rendiciones. Generá una con el botón “Nueva rendición”.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-brand-zebra text-left text-[11px] uppercase tracking-wider text-brand-muted">
                <tr>
                  <th className="px-4 py-2">Periodo</th>
                  <th className="px-4 py-2">Ingresos atribuidos</th>
                  <th className="px-4 py-2">Costos atribuidos</th>
                  <th className="px-4 py-2">Neto</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rendiciones.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-brand-ink">
                        {formatDateLong(r.periodo_desde)}
                      </p>
                      <p className="text-xs text-brand-muted">
                        → {formatDateLong(r.periodo_hasta)}
                      </p>
                    </td>
                    <td className="px-4 py-3">{fmtMoneda(r.total_ingresos_atribuidos)}</td>
                    <td className="px-4 py-3">{fmtMoneda(r.total_costos_atribuidos)}</td>
                    <td className="px-4 py-3 font-semibold">{fmtMoneda(r.neto)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          RENDICION_ESTADO_BADGE[r.estado as RendicionEstado],
                        )}
                      >
                        {RENDICION_ESTADO_LABEL[r.estado as RendicionEstado]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/gerencia/partners/${partner.id}/rendiciones/${r.id}`}
                        className="text-sm font-medium text-brand-cyan hover:underline"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'atribuciones' && (
        <section className="card-premium overflow-hidden p-0">
          {atribuciones.length === 0 ? (
            <div className="p-8 text-center text-sm text-brand-muted">
              Aún no hay atribuciones. Las generan las rendiciones.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-brand-zebra text-left text-[11px] uppercase tracking-wider text-brand-muted">
                <tr>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2">Detalle</th>
                  <th className="px-4 py-2 text-right">Base</th>
                  <th className="px-4 py-2 text-right">%</th>
                  <th className="px-4 py-2 text-right">Atribuido</th>
                  <th className="px-4 py-2">Rendición</th>
                </tr>
              </thead>
              <tbody>
                {atribuciones.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                          a.tipo === 'ingreso'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700',
                        )}
                      >
                        {a.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">
                      {a.comprobante_resumen ?? a.movimiento_resumen ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right">{fmtMoneda(a.monto_base)}</td>
                    <td className="px-4 py-3 text-right">{fmtPct(a.porcentaje)}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {fmtMoneda(a.monto_atribuido)}
                    </td>
                    <td className="px-4 py-3">
                      {a.rendicion_id ? (
                        <Link
                          to={`/gerencia/partners/${partner.id}/rendiciones/${a.rendicion_id}`}
                          className="text-xs text-brand-cyan hover:underline"
                        >
                          ver
                        </Link>
                      ) : (
                        <span className="text-xs text-brand-muted">huérfana</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <PartnerFormDrawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={partner}
        onSaved={() => void load()}
      />
      <ConvenioDrawer
        open={convOpen}
        onClose={() => setConvOpen(false)}
        partnerId={partner.id}
        partnerNombre={partner.nombre_legal}
        onSaved={() => void load()}
      />
      <NuevaRendicionModal
        open={rendOpen}
        onClose={() => setRendOpen(false)}
        partnerId={partner.id}
        partnerNombre={partner.nombre_legal}
        onCreated={() => void load()}
      />
    </div>
  );
}
