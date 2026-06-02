// PrimerosMinutos · checklist "Primeros 5 minutos" para nuevos gerentes (J1).
// Card colapsable en el dashboard. Se autocompleta al detectar la acción real
// (no requiere check manual obligatorio). Cliente puede hacer "ocultar" cuando
// quiera. Si vuelve, lo levanta del campo profiles.onboarding_checklist.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  Users,
  Inbox,
  CalendarClock,
  Mail,
  Smartphone,
  X,
  Sparkles,
} from 'lucide-react';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import {
  getChecklist,
  setChecklistItem,
  type ChecklistKey,
  type ChecklistState,
} from '@/services/api/onboardingChecklist';
import { humanizeError } from '@/lib/errors';

interface Item {
  key: ChecklistKey;
  label: string;
  hint: string;
  to: string;
  icon: typeof Users;
}

const ITEMS: Item[] = [
  {
    key: 'crear_cliente',
    label: 'Crear tu primer cliente',
    hint: 'Una administración con su CUIT y datos fiscales.',
    to: '/gerencia/clientes',
    icon: Users,
  },
  {
    key: 'registrar_tramite',
    label: 'Registrar un trámite',
    hint: 'Matriculación, renovación RPAC, DDJJ — lo que tengas a mano.',
    to: '/gerencia/tramites',
    icon: Inbox,
  },
  {
    key: 'ver_agenda',
    label: 'Mirar tu agenda de hoy',
    hint: 'Vencimientos, trámites y compromisos en un solo panel.',
    to: '/gerencia/agenda',
    icon: CalendarClock,
  },
  {
    key: 'configurar_email',
    label: 'Configurar la casilla de email',
    hint: 'Vincular Google Workspace para envíos transaccionales.',
    to: '/gerencia/configuracion/emails/templates',
    icon: Mail,
  },
  {
    key: 'instalar_pwa',
    label: 'Instalar la plataforma en tu dispositivo',
    hint: 'Acceso rápido + notificaciones push desde el dock.',
    to: '/gerencia',
    icon: Smartphone,
  },
];

export function PrimerosMinutos() {
  const [state, setState] = useState<ChecklistState | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    void (async () => {
      const r = await getChecklist();
      if (r.ok) setState(r.data);
      else setState({});
    })();
  }, []);

  const completados = useMemo(() => {
    if (!state) return 0;
    return ITEMS.filter((i) => state[i.key]).length;
  }, [state]);

  const dismissed = state?.dismissed === true;
  const done = state && completados === ITEMS.length;

  const toggle = useCallback(
    async (key: ChecklistKey, value: boolean) => {
      setState((prev) => ({ ...(prev ?? {}), [key]: value }));
      const r = await setChecklistItem(key, value);
      if (!r.ok) {
        toast.error(`No se pudo guardar: ${humanizeError(r.error)}`);
      }
    },
    [],
  );

  const dismiss = useCallback(async () => {
    setState((prev) => ({ ...(prev ?? {}), dismissed: true }));
    await setChecklistItem('dismissed', true);
  }, []);

  if (state === null) return null;
  if (dismissed) return null;
  // Si ya completó los 5 ítems y no hizo dismiss, seguimos mostrándolo apenas
  // colapsado con el resumen "5/5 listo". Una sesión más y se oculta solo.

  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-100 bg-gradient-to-br from-cyan-50/50 via-white to-amber-50/30 shadow-sm">
      <TrianglesAccent
        position="top-right"
        size={160}
        tone="cyan"
        density="soft"
        className="opacity-25"
      />
      <div className="relative flex items-start justify-between gap-3 p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-start gap-3 text-left"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-cyan-700 shadow-sm ring-1 ring-cyan-100">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">
              Primeros 5 minutos
            </p>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">
              {done ? '¡Listo! Ya conocés la plataforma.' : 'Bienvenida, dejame ayudarte a arrancar'}
            </h2>
            <p className="text-xs text-slate-600">
              {done
                ? `Completaste los 5 pasos. Podés ocultar este panel cuando quieras.`
                : `${completados}/${ITEMS.length} pasos completados · cada uno suma para sacarle el jugo a Gestión Global.`}
            </p>
          </div>
          <span className="rounded-lg p-1.5 text-slate-500 hover:bg-white">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Ocultar checklist"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"
          title="Ocultar para siempre"
        >
          <X size={16} />
        </button>
      </div>

      {open && (
        <div className="relative space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
          {ITEMS.map((it) => {
            const checked = !!state[it.key];
            const Icon = it.icon;
            return (
              <div
                key={it.key}
                className={`group flex items-start gap-3 rounded-xl border bg-white p-3 transition ${
                  checked
                    ? 'border-emerald-100 ring-1 ring-emerald-50'
                    : 'border-slate-100 hover:border-cyan-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void toggle(it.key, !checked)}
                  aria-label={checked ? 'Desmarcar' : 'Marcar como hecho'}
                  className="shrink-0"
                >
                  {checked ? (
                    <CheckCircle2 size={22} className="text-emerald-500" />
                  ) : (
                    <Circle size={22} className="text-slate-300 transition group-hover:text-cyan-400" />
                  )}
                </button>
                <Link
                  to={it.to}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Icon
                    size={18}
                    className={checked ? 'text-emerald-600' : 'text-cyan-600'}
                  />
                  <div className="min-w-0">
                    <p
                      className={`text-sm font-semibold ${
                        checked ? 'text-slate-500 line-through' : 'text-slate-900'
                      }`}
                    >
                      {it.label}
                    </p>
                    <p className="text-xs text-slate-500">{it.hint}</p>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
