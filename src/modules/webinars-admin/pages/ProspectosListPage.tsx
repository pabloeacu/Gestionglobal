import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Mail, Pencil, Phone, Search, UserPlus, Users } from 'lucide-react';
import { Button, Field, Input, Modal, Select } from '@/components/common';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { toast } from '@/lib/toast';
import {
  convertirProspecto,
  listProspectos,
  type ProspectoRow,
  type ProspectoListItem,
} from '@/services/api/webinars';
import { listAdministraciones, type AdministracionListItem } from '@/services/api/administraciones';
import { cn } from '@/lib/cn';
import { FormulariosWebinarsTabs } from '../components/FormulariosWebinarsTabs';
import { ProspectoEditDrawer } from '../components/ProspectoEditDrawer';
import { humanizeError } from '@/lib/errors';

function fmtFecha(iso: string): string {
  try { return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

type Filtro = 'todos' | 'sin_convertir' | 'convertidos';

export function ProspectosListPage() {
  const [items, setItems] = useState<ProspectoListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('sin_convertir');
  const [search, setSearch] = useState('');
  const [convertirOpen, setConvertirOpen] = useState<ProspectoRow | null>(null);
  const [editing, setEditing] = useState<ProspectoRow | null>(null);

  async function recargar() {
    setLoading(true);
    const res = await listProspectos();
    setLoading(false);
    if (res.ok) setItems(res.data);
  }
  useEffect(() => { void recargar(); }, []);

  const visibles = useMemo(() => {
    return items.filter((p) => {
      if (filtro === 'sin_convertir' && p.convertido_at) return false;
      if (filtro === 'convertidos' && !p.convertido_at) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        if (!p.nombre.toLowerCase().includes(s) && !p.email.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [items, filtro, search]);

  const total = items.length;
  const convertidos = items.filter((p) => p.convertido_at).length;
  const tasa = total ? Math.round((convertidos / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <FormulariosWebinarsTabs />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="kicker">Captación</p>
          <h1 className="font-display text-2xl font-bold text-brand-ink sm:text-3xl">Prospectos</h1>
          <p className="mt-1 max-w-xl text-sm text-brand-muted">
            Leads capturados por webinars y formularios. Convertí a cliente con un click cuando contraten.
          </p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard label="Total prospectos" value={total} icon={Users} tone="cyan" />
        <KpiCard label="Convertidos" value={convertidos} icon={CheckCircle2} tone="green" />
        <KpiCard label="Tasa conversión" value={`${tasa}%`} icon={UserPlus} tone="navy" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="max-w-xs">
          <option value="todos">Todos</option>
          <option value="sin_convertir">Sin convertir</option>
          <option value="convertidos">Convertidos</option>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o email"
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-brand-muted">
          Cargando prospectos…
        </div>
      ) : visibles.length === 0 ? (
        <IllustratedEmpty
          title={items.length === 0 ? 'Todavía no hay prospectos' : 'Sin prospectos con ese filtro'}
          description={items.length === 0
            ? 'Cuando alguien se inscriba a un webinar y no sea cliente, aparecerá acá como prospecto.'
            : 'Probá cambiar el filtro o limpiar la búsqueda.'}
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Nombre</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Contacto</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Origen</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Capturado</th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-brand-muted">Estado</th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-brand-muted">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-brand-ink">{p.nombre}</td>
                  <td className="px-4 py-2 text-xs text-brand-muted">
                    <div className="flex items-center gap-1"><Mail size={11} /> {p.email}</div>
                    {p.telefono && <div className="flex items-center gap-1"><Phone size={11} /> {p.telefono}</div>}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">{p.origen}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-brand-muted">{fmtFecha(p.created_at)}</td>
                  <td className="px-4 py-2">
                    {p.convertido_at ? (
                      // E-GG-46 · Si el cliente al que se convirtió este
                      // prospecto está dado de baja, mostramos un badge
                      // adicional para que el gerente no asuma "Convertido"
                      // como cliente activo. Mismo patrón que E-GG-45.
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                          <CheckCircle2 size={10} /> Convertido
                        </span>
                        {p.cliente_activo === false && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                            title={`Estado del cliente: ${p.cliente_estado ?? 'inactivo'}`}
                          >
                            Cliente de baja
                          </span>
                        )}
                        {p.cliente_estado === 'suspendido' && p.cliente_activo !== false && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            Cliente suspendido
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Lead</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditing(p)} title="Editar prospecto">
                        <Pencil size={12} /> Editar
                      </Button>
                      {!p.convertido_at && (
                        <Button variant="tonal" onClick={() => setConvertirOpen(p)}>
                          <UserPlus size={12} /> Convertir
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {convertirOpen && (
        <ConvertirModal
          prospecto={convertirOpen}
          onClose={() => setConvertirOpen(null)}
          onConverted={() => { setConvertirOpen(null); void recargar(); }}
        />
      )}

      <ProspectoEditDrawer
        open={!!editing}
        prospecto={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void recargar(); }}
      />
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: typeof Users; tone: 'cyan' | 'green' | 'navy' }) {
  const tones: Record<string, string> = {
    cyan: 'bg-brand-cyan/5 text-brand-cyan ring-brand-cyan/20',
    green: 'bg-green-50 text-green-700 ring-green-100',
    navy: 'bg-slate-50 text-slate-700 ring-slate-100',
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={cn('grid h-9 w-9 place-items-center rounded-full ring-1', tones[tone])}>
          <Icon size={16} />
        </div>
        <p className="text-xs uppercase tracking-wider text-brand-muted">{label}</p>
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-brand-ink">{value}</p>
    </div>
  );
}

function ConvertirModal({ prospecto, onClose, onConverted }: {
  prospecto: ProspectoRow;
  onClose: () => void;
  onConverted: () => void;
}) {
  const [administraciones, setAdministraciones] = useState<AdministracionListItem[]>([]);
  const [search, setSearch] = useState('');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.trim().length < 2) {
        setAdministraciones([]);
        return;
      }
      setSearching(true);
      const res = await listAdministraciones({ search: search.trim(), limit: 10 });
      setSearching(false);
      if (res.ok) setAdministraciones(res.data.rows);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  async function onConvertir() {
    if (!seleccionada) {
      toast.error('Seleccioná una administración');
      return;
    }
    setLoading(true);
    const res = await convertirProspecto(prospecto.id, seleccionada);
    setLoading(false);
    if (!res.ok) {
      toast.error('No pudimos convertir', { description: humanizeError(res.error) });
      return;
    }
    toast.success('Prospecto convertido a cliente');
    onConverted();
  }

  return (
    <Modal open onClose={onClose} title="Convertir prospecto a cliente" width={520}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-brand-ink">{prospecto.nombre}</p>
          <p className="text-xs text-brand-muted">{prospecto.email}</p>
          {prospecto.telefono && <p className="text-xs text-brand-muted">{prospecto.telefono}</p>}
        </div>

        <Field
          label="Buscar administración existente"
          hint="Si todavía no creaste la administración, andá a /gerencia/clientes y creala primero."
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código o CUIT"
          />
        </Field>

        {searching && <p className="text-xs text-brand-muted">Buscando…</p>}

        {administraciones.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-xl border border-slate-200">
            {administraciones.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setSeleccionada(a.id)}
                  className={cn(
                    'flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50',
                    seleccionada === a.id && 'bg-brand-cyan/5 ring-1 ring-inset ring-brand-cyan/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-ink">{a.nombre}</p>
                    <p className="text-xs text-brand-muted">
                      {a.codigo ?? '—'} · {a.estado} · {a.consorcios_count} consorcios
                    </p>
                  </div>
                  {seleccionada === a.id && <CheckCircle2 size={16} className="text-brand-cyan flex-shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        )}

        {seleccionada && (
          <div className="rounded-xl bg-brand-cyan/5 p-3 text-xs text-brand-ink">
            ✓ Al confirmar: el prospecto queda marcado como convertido y sus inscripciones a webinars se relinkean a esta administración.
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onConvertir} loading={loading} disabled={!seleccionada}>
            Convertir a cliente
          </Button>
        </div>
      </div>
    </Modal>
  );
}
