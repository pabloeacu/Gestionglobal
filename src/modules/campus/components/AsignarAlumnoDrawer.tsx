import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Loader2, Search, UserPlus } from 'lucide-react';
import { Button, Drawer, Field, Input } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  asignarAlumno,
  listAdministracionesParaAsignar,
  type AdministracionParaAsignar,
} from '@/services/api/campus';
import { humanizeError } from '@/lib/errors';

// Drawer de asignación manual de alumnos a un curso (DGG-10: sin autoservicio).
// Busca administraciones cliente y crea la matrícula vía RPC curso_asignar_alumno.
export function AsignarAlumnoDrawer({
  open,
  cursoId,
  cursoTitulo,
  onClose,
  onAsignado,
}: {
  open: boolean;
  cursoId: string;
  cursoTitulo: string;
  onClose: () => void;
  onAsignado: () => void;
}) {
  const [search, setSearch] = useState('');
  const [admins, setAdmins] = useState<AdministracionParaAsignar[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AdministracionParaAsignar | null>(null);
  const [asignando, setAsignando] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await listAdministracionesParaAsignar(search);
      if (cancel) return;
      setLoading(false);
      if (res.ok) setAdmins(res.data);
    }, 220);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [search, open]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelected(null);
    }
  }, [open]);

  const empty = useMemo(
    () => !loading && admins.length === 0,
    [loading, admins],
  );

  async function asignar() {
    if (!selected) return;
    setAsignando(true);
    const res = await asignarAlumno({
      cursoId,
      administracionId: selected.id,
    });
    setAsignando(false);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success(`Listo · ${selected.nombre} quedó asignado`);
    onAsignado();
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      kicker="Campus"
      title="Asignar alumno"
      description={`Habilitá el acceso de un cliente al curso “${cursoTitulo}”.`}
      icon={<UserPlus size={18} />}
      width={560}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={asignar} disabled={!selected} loading={asignando}>
            <GraduationCap size={14} /> Asignar al curso
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Buscar administración cliente">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre o código…"
              className="pl-9"
              autoFocus
            />
          </div>
        </Field>

        {loading ? (
          <div className="grid h-24 place-items-center text-brand-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : empty ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-brand-muted">
            No encontramos administraciones con ese criterio.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {admins.map((a) => {
              const isSel = selected?.id === a.id;
              return (
                <li key={a.id}>
                  <button
                    onClick={() => setSelected(a)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition',
                      isSel
                        ? 'border-brand-cyan bg-brand-cyan/5 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-brand-cyan/40 hover:bg-slate-50',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-brand-ink">
                        {a.nombre}
                      </p>
                      <p className="text-xs text-brand-muted">#{a.codigo}</p>
                    </div>
                    {isSel && (
                      <span className="shrink-0 rounded-full bg-brand-cyan px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Elegido
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-brand-muted">
          La matrícula se crea para el usuario administrador de la cuenta. Si la
          administración aún no tiene acceso habilitado, generalo primero desde
          su ficha.
        </p>
      </div>
    </Drawer>
  );
}
