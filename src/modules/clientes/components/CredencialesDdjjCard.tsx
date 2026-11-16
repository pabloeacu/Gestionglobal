// ============================================================================
// CredencialesDdjjCard · DGG-243 F5 (pedido Pablo 2026-11-16)
//
// Tarjeta de credenciales del Portal de DDJJ (misgestiones.com.ar) dentro de la
// FICHA del cliente. Desacopla la CONSULTA del trámite: antes sólo se veía/cargaba
// desde un trámite de DDJJ; ahora el gerente consulta/carga/edita/borra acá, para
// cualquier cliente y sin trámite (R14 paridad columna↔control; la carga del
// trámite queda como atajo).
//
// Espeja el UX de ClaveFiscalReveal (ARCA): dots + ojito + copiar, revelado
// on-demand. Diferencias con ARCA: también muestra el USUARIO (no secreto) y
// permite cargar/editar con el modal existente (CargarCredencialDdjjModal, que
// ya opera sólo con administracionId).
//
// Privacidad: la contraseña del Portal de DDJJ NO es un secreto del cliente — la
// IMPONE el prestador (misgestiones) y el cliente no la cambia; por eso gerencia
// la revela para soporte. El acceso igual queda AUDITADO server-side
// (credenciales_regulatorias_accesos, rol='staff') por credencial_reg_revelar (R12).
// Sin migración: reusa credencial_reg_meta / _revelar / _set / _borrar.
// ============================================================================
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  KeyRound, Eye, EyeOff, Copy, Check, Trash2, Loader2, Pencil, Plus, Lock,
} from 'lucide-react';
import { Button, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  getCredencialDdjjMeta, revelarCredencialDdjj, borrarCredencialDdjj,
  type CredencialMeta,
} from '@/services/api/ddjj';
import { CargarCredencialDdjjModal } from '@/modules/trackings/components/CargarCredencialDdjjModal';

export function CredencialesDdjjCard({ administracionId }: { administracionId: string }) {
  const confirmar = useConfirm();
  const [meta, setMeta] = useState<CredencialMeta | null>(null); // null = cargando
  const [modalOpen, setModalOpen] = useState(false);
  const [pwd, setPwd] = useState<string | null>(null); // null = no revelada aún
  const [verPwd, setVerPwd] = useState(false);
  const [revelando, setRevelando] = useState(false);
  const [copiado, setCopiado] = useState<'usr' | 'pwd' | null>(null);
  const [borrando, setBorrando] = useState(false);

  const load = useCallback(() => {
    setMeta(null);
    setPwd(null);
    setVerPwd(false);
    void getCredencialDdjjMeta(administracionId).then((r) => {
      setMeta(
        r.ok
          ? r.data
          : { existe: false, usuario: null, tienePassword: false, estado: null, updatedAt: null, pendiente: false, bannerPendiente: false },
      );
    });
  }, [administracionId]);

  useEffect(() => { load(); }, [load]);

  // Trae y cachea la contraseña una sola vez (auditada server-side); null si falló.
  async function asegurarPwd(): Promise<string | null> {
    if (pwd !== null) return pwd;
    setRevelando(true);
    const r = await revelarCredencialDdjj(administracionId);
    setRevelando(false);
    if (!r.ok) { toast.error('No pudimos mostrar la contraseña', { description: humanizeError(r.error) }); return null; }
    const v = r.data ?? '';
    setPwd(v);
    return v;
  }
  async function toggleVerPwd() {
    if (pwd !== null) { setVerPwd((v) => !v); return; }
    const v = await asegurarPwd();
    if (v !== null) setVerPwd(true);
  }
  async function copiar(which: 'usr' | 'pwd') {
    const v = which === 'usr' ? (meta?.usuario ?? '') : await asegurarPwd();
    if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
      setCopiado(which);
      toast.success(which === 'usr' ? 'Usuario copiado al portapapeles' : 'Contraseña copiada al portapapeles');
      window.setTimeout(() => setCopiado(null), 1400);
    } catch { toast.error('No pudimos copiar al portapapeles'); }
  }
  async function borrar() {
    const ok = await confirmar({
      title: 'Borrar credenciales del Portal de DDJJ',
      message:
        'Se eliminarán el usuario y la contraseña guardados de este cliente. El cliente dejará de verlos en su portal hasta que se carguen de nuevo. ¿Confirmás?',
      confirmLabel: 'Borrar',
      cancelLabel: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    setBorrando(true);
    const r = await borrarCredencialDdjj(administracionId);
    setBorrando(false);
    if (!r.ok) { toast.error('No pudimos borrar las credenciales', { description: humanizeError(r.error) }); return; }
    toast.success('Credenciales del Portal de DDJJ borradas');
    load();
  }

  const cargando = meta === null;
  // "Hay credencial" = tiene usuario y/o contraseña. OJO: credencial_reg_meta.existe
  // significa "la FILA existe", y credencial_reg_borrar NO borra la fila: nula
  // usuario+password y la conserva (por una eventual propuesta prop_*). Usar `existe`
  // dejaría una card a medias (— / —) tras borrar; el indicador real es este.
  const tieneDatos = !!(meta?.usuario || meta?.tienePassword);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-brand-cyan" />
          <p className="font-display text-sm font-bold uppercase tracking-wider text-brand-ink">
            Portal DDJJ
          </p>
          <span className="text-[11px] text-brand-muted">misgestiones.com.ar</span>
        </div>
        {!cargando && tieneDatos && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
            >
              <Pencil size={13} /> Editar
            </button>
            <button
              type="button"
              onClick={() => void borrar()}
              disabled={borrando}
              className="rounded p-1 text-brand-muted transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              aria-label="Borrar credenciales del Portal de DDJJ"
              title="Borrar credenciales"
            >
              {borrando ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            </button>
          </div>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center gap-2 py-2 text-sm text-brand-muted">
          <Loader2 size={14} className="animate-spin" /> Cargando…
        </div>
      ) : !tieneDatos ? (
        <div className="flex flex-col items-start gap-3 py-1">
          <p className="text-sm text-brand-muted">Sin credenciales cargadas.</p>
          <Button variant="secondary" onClick={() => setModalOpen(true)} className="!px-3 !py-1.5 !text-xs">
            <Plus size={14} /> Cargar credenciales
          </Button>
        </div>
      ) : (
        <dl>
          <div className="grid grid-cols-1 items-center gap-1 border-b border-slate-100 py-3 sm:grid-cols-3">
            <dt className="kicker">Usuario</dt>
            <dd className="text-sm text-brand-ink sm:col-span-2">
              {meta?.usuario ? (
                <span className="inline-flex items-center gap-2 font-mono text-sm">
                  <span className="truncate">{meta.usuario}</span>
                  <button
                    type="button"
                    onClick={() => void copiar('usr')}
                    className="rounded p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan"
                    aria-label="Copiar usuario"
                    title="Copiar usuario"
                  >
                    {copiado === 'usr' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                </span>
              ) : (
                <span className="text-brand-muted">—</span>
              )}
            </dd>
          </div>
          <div className="grid grid-cols-1 items-center gap-1 py-3 sm:grid-cols-3">
            <dt className="kicker">Contraseña</dt>
            <dd className="text-sm text-brand-ink sm:col-span-2">
              {meta?.tienePassword ? (
                <span className="inline-flex items-center gap-2 font-mono text-sm">
                  <span>{verPwd && pwd !== null ? pwd : '••••••••'}</span>
                  <button
                    type="button"
                    onClick={() => void toggleVerPwd()}
                    disabled={revelando}
                    className="rounded p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan disabled:opacity-50"
                    aria-label={verPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={verPwd ? 'Ocultar' : 'Mostrar'}
                  >
                    {revelando ? <Loader2 size={12} className="animate-spin" /> : verPwd ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copiar('pwd')}
                    disabled={revelando}
                    className="rounded p-1 text-brand-muted transition hover:bg-slate-100 hover:text-brand-cyan disabled:opacity-50"
                    aria-label="Copiar contraseña"
                    title="Copiar contraseña"
                  >
                    {copiado === 'pwd' ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                </span>
              ) : (
                <span className="text-brand-muted">—</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {/* Propuesta de gestoría sin moderar (coherencia con la cola de Moderación). */}
      {!cargando && meta?.pendiente && (
        <p className="mt-2 text-[11px] text-amber-700">
          Hay una propuesta de la gestoría pendiente de moderar ·{' '}
          <Link to="/gerencia/moderacion" className="font-semibold underline">Ir a Moderación</Link>
        </p>
      )}

      {!cargando && tieneDatos && (
        <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-brand-muted">
          <Lock size={11} /> La contraseña la asigna el Portal; al mostrarla queda registrado el acceso.
        </p>
      )}

      <CargarCredencialDdjjModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        administracionId={administracionId}
        onGuardado={() => load()}
      />
    </div>
  );
}

export default CredencialesDdjjCard;
