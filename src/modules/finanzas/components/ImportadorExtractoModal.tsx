import { useRef, useState } from 'react';
import { Download, Upload, FileText, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Button, Field, Modal, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import { importarHistoricoLote, type CajaConSaldoRow, type HistoricoLineaInput } from '@/services/api/finanzas';
import { parseCsvExtracto, descargarPlantilla, type ParseResult } from '../lib/csvParser';
import { cn } from '@/lib/cn';

interface Props {
  cajas: CajaConSaldoRow[];
  onClose: () => void;
  onImported: (result: { nuevas: number; duplicadas: number }) => void;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export function ImportadorExtractoModal({ cajas, onClose, onImported }: Props) {
  const [cajaId, setCajaId] = useState<string>(cajas[0]?.caja_id ?? '');
  const [fileName, setFileName] = useState<string>('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onFile(file: File) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target?.result ?? '');
      const res = parseCsvExtracto(text);
      setParseResult(res);
      if (res.errores.length > 0 && !res.ok) {
        toast.error('Errores en el archivo', { description: res.errores[0] });
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  async function onImportar() {
    if (!parseResult?.ok || !cajaId) return;
    setImporting(true);
    const lineas: HistoricoLineaInput[] = parseResult.lineas;
    const res = await importarHistoricoLote(cajaId, lineas, fileName);
    setImporting(false);
    if (!res.ok) {
      toast.error('No pudimos importar', { description: res.error.message });
      return;
    }
    toast.success(`Importado: ${res.data.nuevas} nuevas, ${res.data.duplicadas} duplicadas`);
    onImported({ nuevas: res.data.nuevas, duplicadas: res.data.duplicadas });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Importar extracto bancario"
      kicker="Conciliación"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={onImportar} loading={importing} disabled={!parseResult?.ok || !cajaId}>
            <Upload size={14} /> Importar {parseResult?.ok ? `(${parseResult.lineas.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Plantilla */}
        <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-cyan">
            Formato universal
          </p>
          <p className="mt-1 text-sm text-brand-ink">
            Descargá la plantilla, completá con los datos de tu extracto (cualquier banco) y subila.
          </p>
          <p className="mt-1 text-xs text-brand-muted">
            Columnas: <strong>fecha</strong> · <strong>descripcion</strong> · <strong>ingreso</strong> · <strong>egreso</strong> · observaciones · saldo
          </p>
          <Button variant="secondary" onClick={descargarPlantilla} className="mt-2">
            <Download size={13} /> Descargar plantilla CSV
          </Button>
        </div>

        <Field label="Caja destino" required>
          <Select value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
            {cajas.map((c) => (
              <option key={c.caja_id} value={c.caja_id}>{c.nombre} · {formatMoney(c.saldo)}</option>
            ))}
          </Select>
        </Field>

        {/* Dropzone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition',
            drag ? 'border-brand-cyan bg-brand-cyan/10' : 'border-slate-300 bg-slate-50 hover:border-brand-cyan/40 hover:bg-slate-100',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
          {fileName ? (
            <div className="flex items-center justify-center gap-2">
              <FileText size={20} className="text-brand-cyan" />
              <span className="text-sm font-medium text-brand-ink">{fileName}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFileName(''); setParseResult(null); }}
                className="text-brand-muted hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <Upload size={24} className="mx-auto text-brand-muted" />
              <p className="mt-2 text-sm font-medium text-brand-ink">Arrastrá un CSV o clickeá para elegirlo</p>
              <p className="mt-1 text-xs text-brand-muted">Solo .csv · usa la plantilla de arriba como referencia</p>
            </>
          )}
        </div>

        {/* Preview */}
        {parseResult && (
          <div className="space-y-2">
            {parseResult.errores.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-red-700">
                  <AlertCircle size={13} /> Errores en el archivo
                </p>
                <ul className="mt-1 list-disc pl-4 text-red-700">
                  {parseResult.errores.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            {parseResult.ok && (
              <>
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-800">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2 size={13} />
                    {parseResult.lineas.length} línea{parseResult.lineas.length === 1 ? '' : 's'} parseada{parseResult.lineas.length === 1 ? '' : 's'} OK
                    {parseResult.totalFilas !== parseResult.lineas.length &&
                      ` (de ${parseResult.totalFilas} filas totales; ${parseResult.totalFilas - parseResult.lineas.length} se ignoran por faltar fecha/monto)`}
                  </p>
                </div>
                <details className="rounded-lg border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-brand-muted">
                    Preview de las primeras 5 líneas
                  </summary>
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase text-brand-muted">Fecha</th>
                        <th className="px-2 py-1 text-left text-[10px] font-semibold uppercase text-brand-muted">Descripción</th>
                        <th className="px-2 py-1 text-right text-[10px] font-semibold uppercase text-brand-muted">Ingreso</th>
                        <th className="px-2 py-1 text-right text-[10px] font-semibold uppercase text-brand-muted">Egreso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parseResult.lineas.slice(0, 5).map((l, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1 text-brand-muted">{l.fecha}</td>
                          <td className="px-2 py-1 text-brand-ink">{l.descripcion}</td>
                          <td className="px-2 py-1 text-right font-mono text-green-700">{l.ingreso > 0 ? formatMoney(l.ingreso) : '—'}</td>
                          <td className="px-2 py-1 text-right font-mono text-red-700">{l.egreso > 0 ? formatMoney(l.egreso) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
