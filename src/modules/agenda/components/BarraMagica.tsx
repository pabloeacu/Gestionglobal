// BarraMagica — input NL + preview live (handoff C7). El parser convierte
// la entrada en un draft; Enter crea el evento directo. Nada se persiste
// antes del Enter (regla E1).
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { parseEntradaAgenda, previewLabel } from '@/lib/agendaParse';
import { crearEvento, type AgendaCategoria } from '@/services/api/agenda';

interface Props {
  categorias: AgendaCategoria[];
  onCreated: () => void;
}

export function BarraMagica({ categorias, onCreated }: Props) {
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);
  const parsed = useMemo(
    () => (valor.trim() ? parseEntradaAgenda(valor, categorias) : null),
    [valor, categorias],
  );

  async function crear() {
    if (!parsed || !parsed.title) {
      toast.error('Anotá algo para arrancar.');
      return;
    }
    setEnviando(true);
    const res = await crearEvento({
      title: parsed.title,
      categoryId: parsed.categoryId,
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      allDay: parsed.allDay,
      priority: parsed.priority,
      recurrence: parsed.recurrence,
      recurrenceWeekdays: parsed.recurrenceWeekdays,
      recurrenceMonthday: parsed.recurrenceMonthday,
    });
    setEnviando(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    toast.success('¡Anotado! 📌');
    setValor('');
    onCreated();
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan-pale/40 text-brand-cyan">
          <Sparkles size={18} />
        </div>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !enviando) {
              e.preventDefault();
              void crear();
            }
          }}
          placeholder='Ej: "Llamar a la administración mañana 9am #cobranzas"   ·   "Pagar AFIP 15/06 !alta"'
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/20"
        />
        <Button onClick={() => void crear()} disabled={enviando || !valor.trim()}>
          {enviando ? 'Anotando...' : 'Agregar'}
        </Button>
      </div>
      {parsed && parsed.title && (
        <div className="mt-2 rounded-lg bg-brand-zebra px-3 py-2 text-xs text-brand-muted">
          Voy a anotar: <span className="font-medium text-brand-ink">«{parsed.title}»</span>
          <span className="mx-1.5 text-slate-300">·</span>
          {previewLabel(parsed)}
        </div>
      )}
    </div>
  );
}
