// UsuariosPage · panel de gestión de usuarios (configuración).
// Lista todos los users con telemetría PWA + push + último login + permite
// crear nuevos gerentes y eliminar gerentes existentes (excepto a uno mismo).
//
// Citas: regla 4 (queries en services/), regla 13 (DialogProvider, no
// window.confirm), regla 12 (assert tenancy - acá no aplica, es staff-only).

import { useEffect, useState } from 'react';
import {
  UserPlus,
  Smartphone,
  Bell,
  Mail,
  Clock,
  Trash2,
  Pencil,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import {
  Drawer,
  Field,
  Input,
  Button,
  Skeleton,
  useConfirm,
  useAlert,
} from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { IllustratedEmpty } from '@/components/brand/IllustratedEmpty';
import { CopyButton } from '@/components/common/CopyButton';
import { toast } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  listarUsuarios,
  crearGerente,
  eliminarGerente,
  type UsuarioRow,
} from '@/services/api/usuarios';
import { humanizeError } from '@/lib/errors';
import { UsuarioEditDrawer, type UsuarioEditTarget } from '../components/UsuarioEditDrawer';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function ROLE_BADGE(role: string): string {
  switch (role) {
    case 'gerente':
      return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
    case 'operador':
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'administrador':
      return 'bg-amber-50 text-amber-700 ring-amber-200';
    default:
      return 'bg-slate-50 text-slate-700 ring-slate-200';
  }
}

export function UsuariosPage() {
  const { user } = useAuth();
  const currentId = user?.id;
  const confirm = useConfirm();
  const alert = useAlert();
  const [users, setUsers] = useState<UsuarioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ email: '', nombre: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<UsuarioEditTarget | null>(null);

  async function load() {
    setLoading(true);
    const res = await listarUsuarios();
    setLoading(false);
    if (!res.ok) {
      toast.error('No se pudo cargar usuarios: ' + humanizeError(res.error));
      return;
    }
    setUsers(res.data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCrearGerente() {
    if (!draft.email.trim() || !draft.nombre.trim()) {
      toast.error('Email y nombre son obligatorios');
      return;
    }
    setSubmitting(true);
    const res = await crearGerente(draft.email.trim(), draft.nombre.trim());
    setSubmitting(false);
    if (!res.ok) {
      toast.error('No se pudo crear: ' + humanizeError(res.error));
      return;
    }
    setCreating(false);
    setDraft({ email: '', nombre: '' });
    await alert({
      title: '¡Gerente creado!',
      message: (
        <div className="space-y-3 text-sm">
          <p>
            Se creó la cuenta de <strong>{draft.nombre}</strong> (
            <code className="font-mono text-xs">{draft.email}</code>).
          </p>
          {res.data.password_temporal && (
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs uppercase tracking-wide text-brand-muted">
                Contraseña temporal
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-sm">
                  {res.data.password_temporal}
                </code>
                <CopyButton value={res.data.password_temporal} />
              </div>
              <p className="mt-2 text-xs text-brand-muted">
                Guardala y enviásela al nuevo gerente por un canal seguro. Por
                seguridad, debería cambiarla en su primer ingreso.
              </p>
            </div>
          )}
        </div>
      ),
    });
    await load();
  }

  function handleEditar(u: UsuarioRow) {
    setEditing({
      id: u.user_id,
      full_name: u.full_name,
      role: u.role as 'gerente' | 'operador',
    });
  }

  async function handleEliminar(u: UsuarioRow) {
    const ok = await confirm({
      title: '¿Eliminar gerente?',
      message: `Vas a eliminar a ${u.full_name} (${u.email}). Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const res = await eliminarGerente(u.user_id);
    if (!res.ok) {
      toast.error('No se pudo eliminar: ' + humanizeError(res.error));
      return;
    }
    toast.success('Gerente eliminado');
    await load();
  }

  const gerentes = users.filter((u) => u.role === 'gerente' || u.role === 'operador');
  const administradores = users.filter((u) => u.role === 'administrador');
  const otros = users.filter(
    (u) => !['gerente', 'operador', 'administrador'].includes(u.role),
  );

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <section className="card-premium relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={170}
          tone="cyan"
          density="soft"
          className="opacity-30"
        />
        <div className="relative flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="kicker text-brand-muted">CONFIGURACIÓN</p>
            <h1 className="font-display text-3xl font-bold text-brand-ink">
              Usuarios
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-brand-muted">
              Listado de cuentas activas, telemetría de la app instalada y
              últimos accesos. Desde acá creás nuevos gerentes.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <UserPlus size={16} /> Nuevo gerente
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <IllustratedEmpty
          illustration="lista"
          title="Sin usuarios cargados"
          description="Todavía no hay cuentas activas en la plataforma."
        />
      ) : (
        <>
          <UserSection
            titulo="Gerencia"
            users={gerentes}
            currentId={currentId}
            onEliminar={handleEliminar}
            onEditar={handleEditar}
          />
          <UserSection
            titulo="Administradores (clientes)"
            users={administradores}
            currentId={currentId}
            onEliminar={() => Promise.resolve()}
            readOnly
          />
          {otros.length > 0 && (
            <UserSection
              titulo="Otros"
              users={otros}
              currentId={currentId}
              onEliminar={() => Promise.resolve()}
              readOnly
            />
          )}
        </>
      )}

      {/* Drawer editar usuario · DGG-34 */}
      {editing && (
        <UsuarioEditDrawer
          open={!!editing}
          usuario={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}

      {/* Drawer crear gerente */}
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        title="Nuevo gerente"
        width={520}
      >
        <div className="space-y-4 p-4">
          <p className="text-sm text-brand-muted">
            Creamos la cuenta con una contraseña temporal y te la mostramos para
            que se la pases al nuevo gerente.
          </p>
          <Field label="Nombre completo" required>
            <Input
              value={draft.nombre}
              onChange={(e) => setDraft({ ...draft, nombre: e.target.value })}
              placeholder="Juan García"
              autoFocus
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              placeholder="juan@gestionglobal.ar"
            />
          </Field>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button
              variant="ghost"
              onClick={() => setCreating(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button onClick={handleCrearGerente} loading={submitting}>
              <ShieldCheck size={16} /> Crear gerente
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function UserSection({
  titulo,
  users,
  currentId,
  onEliminar,
  onEditar,
  readOnly,
}: {
  titulo: string;
  users: UsuarioRow[];
  currentId: string | undefined;
  onEliminar: (u: UsuarioRow) => Promise<void>;
  onEditar?: (u: UsuarioRow) => void;
  readOnly?: boolean;
}) {
  if (users.length === 0) return null;
  return (
    <section className="card-premium relative overflow-hidden">
      <div className="relative p-5">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-brand-ink">
            {titulo}{' '}
            <span className="ml-2 text-sm font-normal text-brand-muted">
              {users.length}
            </span>
          </h2>
        </header>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-brand-muted">
              <tr>
                <th className="w-[26%] px-3 py-2">Usuario</th>
                <th className="w-[18%] px-3 py-2">Rol</th>
                <th className="w-[18%] px-3 py-2">Último login</th>
                <th className="w-[12%] px-3 py-2 text-center">App PWA</th>
                <th className="w-[12%] px-3 py-2 text-center">Push</th>
                <th className="w-[14%] px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.user_id}
                  className="border-t border-slate-100 hover:bg-brand-zebra/30"
                >
                  <td className="truncate px-3 py-2.5">
                    <p className="truncate font-medium text-brand-ink">
                      {u.full_name}
                      {u.user_id === currentId && (
                        <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          vos
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-brand-muted">
                      {u.email}
                    </p>
                    {u.administracion_nombre && (
                      <p className="truncate text-[11px] text-brand-muted">
                        <Mail size={9} className="mr-0.5 inline" /> {u.administracion_nombre}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset ${ROLE_BADGE(u.role)}`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-brand-muted">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} /> {formatDate(u.last_sign_in_at)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {u.pwa_installed_at ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
                        title={`Instalada: ${formatDate(u.pwa_installed_at)}`}
                      >
                        <Smartphone size={13} />
                        <CheckCircle2 size={11} />
                      </span>
                    ) : (
                      <span className="text-xs text-brand-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {u.push_activo ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"
                        title={`${u.push_subs_count} dispositivo(s) suscripto(s)`}
                      >
                        <Bell size={13} />
                        <span>{u.push_subs_count}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-brand-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!readOnly ? (
                      <div className="inline-flex items-center gap-1">
                        {onEditar && (
                          <button
                            type="button"
                            onClick={() => onEditar(u)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-ink/70 transition hover:bg-slate-100"
                            title="Editar nombre y rol"
                          >
                            <Pencil size={12} /> Editar
                          </button>
                        )}
                        {u.user_id !== currentId && (
                          <button
                            type="button"
                            onClick={() => void onEliminar(u)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-600 transition hover:bg-rose-50"
                          >
                            <Trash2 size={12} /> Eliminar
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-brand-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
