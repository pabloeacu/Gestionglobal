import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FileSpreadsheet,
  Upload,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Building,
  ArrowLeftRight,
} from 'lucide-react';
import { Drawer, Button, Field, Select } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { toast } from '@/lib/toast';
import { humanizeError } from '@/lib/errors';
import {
  parsearConsorciosXlsx,
  validarConsorcios,
  importarConsorcios,
  type ParsedConsorcioSheet,
  type ConsorcioColumnMapping,
  type ConsorcioImportResult,
} from '@/services/api/consorciosImport';

interface Props {
  open: boolean;
  onClose: () => void;
  administracionId: string;
  onImported?: () => void;
}

type Phase = 'upload' | 'preview' | 'done';

const CAMPOS: Array<{ key: keyof ConsorcioColumnMapping; label: string; required?: boolean }> = [
  { key: 'nombre', label: 'Nombre', required: true },
  { key: 'codigo', label: 'Código' },
  { key: 'cuit', label: 'CUIT' },
  { key: 'domicilio', label: 'Domicilio' },
  { key: 'localidad', label: 'Localidad' },
  { key: 'provincia', label: 'Provincia' },
  { key: 'codigo_postal', label: 'Código postal' },
  { key: 'unidades_funcionales', label: 'Unidades funcionales' },
  { key: 'monto_abono', label: 'Abono' },
];

export function ConsorciosImportDrawer({ open, onClose, administracionId, onImported }: Props) {
  const [phase, setPhase] = useState<Phase>('upload');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParsedConsorcioSheet | null>(null);
  const [mapping, setMapping] = useState<ConsorcioColumnMapping | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ConsorcioImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPhase('upload');
    setFileName('');
    setParsed(null);
    setMapping(null);
    setResult(null);
    setParsing(false);
    setImporting(false);
  }

  function handleClose() {
    // Si hubo import exitoso, refrescar la grilla aunque cierre con "Cerrar"/X (B3).
    if (phase === 'done' && result) onImported?.();
    reset();
    onClose();
  }

  async function onFile(file: File) {
    setParsing(true);
    setFileName(file.name);
    const res = await parsearConsorciosXlsx(file);
    setParsing(false);
    if (!res.ok) {
      toast.error('No pudimos leer el archivo', { description: humanizeError(res.error) });
      return;
    }
    setParsed(res.data);
    setMapping(res.data.sugerencias);
    setPhase('preview');
  }

  const validaciones = useMemo(
    () => (parsed && mapping ? validarConsorcios(parsed.rows, mapping) : []),
    [parsed, mapping],
  );
  const validas = validaciones.filter((v) => v.ok);
  const conError = validaciones.filter((v) => !v.ok);

  async function onImport() {
    setImporting(true);
    const res = await importarConsorcios(administracionId, fileName, validas);
    setImporting(false);
    if (!res.ok) {
      toast.error('No se pudo importar', { description: humanizeError(res.error) });
      return;
    }
    setResult(res.data);
    setPhase('done');
    const r = res.data;
    toast.success(
      `Importación lista · ${r.creados} nuevos, ${r.actualizados} actualizados, ${r.repunteados} reasignados`,
    );
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={880}
      kicker="Consorcios"
      title="Importar desde Excel"
      description="Subí la planilla de consorcios. Detectamos los que ya existen (por CUIT o código) y nunca duplicamos."
      icon={<FileSpreadsheet size={20} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-brand-muted">
            {phase === 'preview' && `${validas.length} listas · ${conError.length} con problema`}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={importing}>
              {phase === 'done' ? 'Cerrar' : 'Cancelar'}
            </Button>
            {phase === 'preview' && (
              <Button onClick={onImport} loading={importing} disabled={validas.length === 0}>
                Importar {validas.length} <ArrowRight size={14} />
              </Button>
            )}
            {phase === 'done' && (
              <Button onClick={handleClose}>
                <RefreshCw size={14} /> Listo
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="relative">
        <TrianglesAccent position="top-right" size={160} tone="cyan" density="soft" className="opacity-50" />

        {phase === 'upload' && (
          <div className="relative flex flex-col items-center justify-center gap-4 py-10 text-center">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-cyan-pale/40 text-brand-cyan">
              {parsing ? <Loader2 size={24} className="animate-spin" /> : <Upload size={24} />}
            </span>
            <div>
              <h3 className="font-display text-lg font-bold">Subí el Excel de consorcios</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-brand-muted">
                Columnas reconocidas: nombre, código, CUIT, domicilio, localidad, provincia, CP,
                unidades funcionales y abono. El <strong>nombre</strong> es lo único obligatorio.
              </p>
            </div>
            <Button onClick={() => inputRef.current?.click()} disabled={parsing}>
              <FileSpreadsheet size={15} /> Elegir archivo .xlsx
            </Button>
            <div className="mt-2 flex items-start gap-2 rounded-xl border border-brand-cyan-pale/50 bg-brand-cyan-pale/10 p-3 text-left text-xs leading-relaxed text-brand-ink/80">
              <ArrowLeftRight size={14} className="mt-0.5 shrink-0 text-brand-cyan" />
              <span>
                Si un consorcio ya existe con el <strong>mismo CUIT</strong> en otra administración,
                se interpreta como <strong>cambio de administrador</strong>: se reasigna a este
                cliente sin tocar sus comprobantes anteriores.
              </span>
            </div>
          </div>
        )}

        {phase === 'preview' && parsed && mapping && (
          <div className="relative space-y-5">
            <div className="flex items-center gap-2 text-sm text-brand-muted">
              <FileSpreadsheet size={15} className="text-brand-cyan" />
              <span className="font-medium text-brand-ink">{fileName}</span>
              <span>· {parsed.rows.length} filas</span>
            </div>

            <div>
              <h4 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-brand-ink">
                Mapeo de columnas
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CAMPOS.map((c) => (
                  <Field
                    key={c.key}
                    label={c.label + (c.required ? ' *' : '')}
                  >
                    <Select
                      value={mapping[c.key] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => (m ? { ...m, [c.key]: e.target.value || null } : m))
                      }
                    >
                      <option value="">— ninguna —</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            </div>

            <div className="flex gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                <CheckCircle2 size={14} /> {validas.length} listas
              </span>
              {conError.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                  <AlertTriangle size={14} /> {conError.length} con problema
                </span>
              )}
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-brand-zebra/60 text-left text-[11px] font-semibold uppercase tracking-wider text-brand-muted">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Consorcio</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {validaciones.slice(0, 200).map((v) => (
                    <tr key={v.index} className="border-b border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs text-brand-muted">{v.index}</td>
                      <td className="px-3 py-2 text-brand-ink">{v.resumen}</td>
                      <td className="px-3 py-2">
                        {v.ok ? (
                          <span className="text-xs font-medium text-emerald-600">Lista</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">{v.motivo}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validaciones.length > 200 && (
                <p className="px-3 py-2 text-xs text-brand-muted">
                  … y {validaciones.length - 200} filas más (se importan todas las válidas).
                </p>
              )}
            </div>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="relative space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ResumenCard label="Nuevos" value={result.creados} tone="emerald" icon={<Building size={16} />} />
              <ResumenCard label="Actualizados" value={result.actualizados} tone="cyan" icon={<RefreshCw size={16} />} />
              <ResumenCard label="Reasignados" value={result.repunteados} tone="violet" icon={<ArrowLeftRight size={16} />} />
              <ResumenCard label="Errores" value={result.errores} tone={result.errores > 0 ? 'amber' : 'slate'} icon={<AlertTriangle size={16} />} />
            </div>

            {result.repunteados > 0 && (
              <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs leading-relaxed text-violet-800">
                <ArrowLeftRight size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>{result.repunteados}</strong> consorcio(s) venían de otra administración y
                  se reasignaron a este cliente (cambio de administrador). Sus comprobantes
                  anteriores quedan intactos con el administrador que los generó.
                </span>
              </div>
            )}

            {result.detalle.some((d) => d.resultado === 'error') && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Filas con error
                </p>
                <ul className="space-y-1 text-xs text-amber-800">
                  {result.detalle
                    .filter((d) => d.resultado === 'error')
                    .slice(0, 30)
                    .map((d) => (
                      <li key={d.fila}>
                        <span className="font-mono">#{d.fila}</span> {d.nombre ?? '(sin nombre)'} —{' '}
                        {d.motivo}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ResumenCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'cyan' | 'violet' | 'amber' | 'slate';
  icon: ReactNode;
}) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    cyan: 'border-brand-cyan-pale/60 bg-brand-cyan-pale/20 text-brand-cyan',
    violet: 'border-violet-200 bg-violet-50 text-violet-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-500',
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
