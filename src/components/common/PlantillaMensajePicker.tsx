import { useEffect, useRef, useState } from 'react';
import { MessageSquareText, Save, ChevronDown, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from '@/lib/toast';
import { useConfirm, usePrompt } from './DialogProvider';
import { cn } from '@/lib/cn';
import { humanizeError } from '@/lib/errors';
import {
  listTrackingPlantillas,
  createTrackingPlantilla,
  type TrackingPlantillaRow,
} from '@/services/api/trackingPlantillas';

// Picker de "mensajes modelo" para las líneas de tracking (mig 0517, pedido Pablo 2026-09-27).
// Reusable en las 3 superficies donde gerencia redacta el texto de una línea: Agregar línea,
// Moderación (editar aporte) y Cierre. Dos acciones: (1) insertar una plantilla en el textarea
// —con confirmación si ya había texto— y (2) guardar el texto actual como plantilla nueva.
// El panel se expande EN FLUJO (no overlay absoluto) para no chocar con el overflow de drawers/modales.

interface PlantillaMensajePickerProps {
  /** Texto actual del textarea destino (para decidir el reemplazo y habilitar "guardar"). */
  currentText: string;
  /** Reemplaza el contenido del textarea destino con el cuerpo de la plantilla elegida. */
  onInsert: (text: string) => void;
  className?: string;
}

export function PlantillaMensajePicker({
  currentText,
  onInsert,
  className,
}: PlantillaMensajePickerProps) {
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [open, setOpen] = useState(false);
  const [plantillas, setPlantillas] = useState<TrackingPlantillaRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void refetch();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refetch() {
    const res = await listTrackingPlantillas({ soloActivas: true });
    if (!mounted.current) return;
    if (res.ok) setPlantillas(res.data);
    setLoaded(true);
  }

  async function handlePick(p: TrackingPlantillaRow) {
    setOpen(false);
    const actual = currentText.trim();
    if (actual.length > 0 && actual !== p.cuerpo.trim()) {
      const okReemplazar = await confirm({
        title: 'Reemplazar el texto',
        message: `Ya escribiste algo. ¿Reemplazarlo por la plantilla «${p.titulo}»?`,
        confirmLabel: 'Reemplazar',
        cancelLabel: 'Cancelar',
      });
      if (!okReemplazar) return;
    }
    onInsert(p.cuerpo);
  }

  async function handleGuardar() {
    const cuerpo = currentText.trim();
    if (!cuerpo) {
      toast.error('Escribí un mensaje antes de guardarlo como plantilla');
      return;
    }
    const titulo = await prompt({
      title: 'Guardar como plantilla',
      label: 'Nombre de la plantilla',
      message: 'Vas a poder reusar este mensaje desde acá y administrarlo en Configuración.',
      placeholder: 'Ej.: Renovación finalizada',
    });
    if (titulo === null) return;
    const t = titulo.trim();
    if (!t) {
      toast.error('Poné un nombre para la plantilla');
      return;
    }
    setSaving(true);
    const res = await createTrackingPlantilla({ titulo: t, cuerpo });
    if (!mounted.current) return;
    setSaving(false);
    if (!res.ok) {
      toast.error('No pudimos guardar la plantilla', { description: humanizeError(res.error) });
      return;
    }
    setPlantillas((prev) =>
      [...prev, res.data].sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo)),
    );
    toast.success('Plantilla guardada', { description: 'Ya la podés reusar desde acá.' });
  }

  const puedeGuardar = currentText.trim().length > 0 && !saving;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan"
          aria-expanded={open}
        >
          <MessageSquareText size={13} /> Usar plantilla
          <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
        <button
          type="button"
          onClick={() => void handleGuardar()}
          disabled={!puedeGuardar}
          title={
            puedeGuardar
              ? 'Guardar el texto actual como una plantilla reutilizable'
              : 'Escribí un mensaje para poder guardarlo'
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-brand-muted transition hover:border-brand-cyan hover:text-brand-cyan disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-brand-muted"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Guardar como plantilla
        </button>
      </div>

      {open && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="max-h-64 overflow-y-auto py-1">
            {!loaded ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-brand-muted">
                <Loader2 size={13} className="animate-spin" /> Cargando plantillas…
              </div>
            ) : plantillas.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-brand-muted">
                No hay plantillas todavía. Escribí un mensaje y tocá «Guardar como plantilla».
              </div>
            ) : (
              plantillas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handlePick(p)}
                  className="block w-full border-b border-slate-100 px-3 py-2 text-left transition last:border-0 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-brand-ink">{p.titulo}</span>
                    {p.categoria && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-muted">
                        {p.categoria}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-xs text-brand-muted">
                    {p.cuerpo}
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-right">
            <Link
              to="/gerencia/configuracion/plantillas-tracking"
              className="text-[11px] font-medium text-brand-muted hover:text-brand-cyan"
            >
              Administrar plantillas →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
