import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import {
  ArrowLeft, Upload, Download, FileSpreadsheet, AlertTriangle,
  CheckCircle2, Eye, History, X, ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  importarHistoricoMasivo, listarLotesHistorico,
  type LineaImportacion, type ResultadoImportacion, type LoteHistoricoRow,
} from '@/services/api/finanzas-admin';

// Plantilla CSV con headers oficiales
const PLANTILLA_HEADERS = [
  'fecha',
  'tipo',
  'caja',
  'categoria',
  'monto',
  'descripcion',
  'administracion_codigo',
  'consorcio_codigo',
  'referencia',
];

const PLANTILLA_EJEMPLOS = [
  ['01/03/2026', 'ingreso', 'Banco principal', 'Cobranza servicios', '85000', 'Pago Sol y Luna marzo', 'AD-001', 'CONS-1', ''],
  ['05/03/2026', 'egreso', 'Banco principal', 'Servicios públicos', '12500', 'Edenor obra 1', 'AD-001', 'CONS-1', '#12345'],
  ['07/03/2026', 'egreso', 'Efectivo', 'Insumos', '4200', 'Sellos y papelería', '', '', ''],
];

function descargarPlantilla() {
  const rows = [PLANTILLA_HEADERS, ...PLANTILLA_EJEMPLOS];
  const csv = rows
    .map((r) => r.map((c) => (c.includes(',') ? `"${c}"` : c)).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-importacion-finanzas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function parseFile(file: File): Promise<{ lineas: LineaImportacion[]; errores: string[] }> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => {
        const errores: string[] = [];
        const headersFound = (result.meta.fields ?? []).map((h) => h.trim().toLowerCase());
        const requeridos = ['fecha', 'tipo', 'caja', 'monto'];
        const faltantes = requeridos.filter((h) => !headersFound.includes(h));
        if (faltantes.length > 0) {
          errores.push(`Faltan columnas requeridas: ${faltantes.join(', ')}`);
        }
        const lineas: LineaImportacion[] = result.data
          .map((row): LineaImportacion | null => {
            const fecha = (row.fecha ?? '').trim();
            const tipo = (row.tipo ?? '').trim().toLowerCase();
            const caja = (row.caja ?? '').trim();
            const montoRaw = (row.monto ?? '').trim().replace(/\./g, '').replace(',', '.');
            const monto = Number(montoRaw);
            if (!fecha && !tipo && !caja && !monto) return null;
            return {
              fecha,
              tipo: (tipo === 'ingreso' || tipo === 'egreso') ? tipo : 'egreso',
              caja,
              categoria: (row.categoria ?? '').trim() || undefined,
              monto,
              descripcion: (row.descripcion ?? '').trim() || undefined,
              administracion_codigo: (row.administracion_codigo ?? '').trim() || undefined,
              consorcio_codigo: (row.consorcio_codigo ?? '').trim() || undefined,
              referencia: (row.referencia ?? '').trim() || undefined,
            };
          })
          .filter((l): l is LineaImportacion => l !== null);
        resolve({ lineas, errores });
      },
      error: () => {
        resolve({ lineas: [], errores: ['No se pudo parsear el archivo CSV'] });
      },
    });
  });
}

export function FinanzasImportarPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [lineas, setLineas] = useState<LineaImportacion[]>([]);
  const [erroresParse, setErroresParse] = useState<string[]>([]);
  const [dryRunResult, setDryRunResult] = useState<ResultadoImportacion | null>(null);
  const [importResult, setImportResult] = useState<ResultadoImportacion | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [running, setRunning] = useState(false);
  const [lotes, setLotes] = useState<LoteHistoricoRow[]>([]);
  const [showHistorial, setShowHistorial] = useState(false);

  async function recargarHistorial() {
    const r = await listarLotesHistorico(20);
    if (r.ok) setLotes(r.data);
  }

  useEffect(() => { void recargarHistorial(); }, []);

  async function onFileChange(f: File | null) {
    setArchivo(f);
    setLineas([]);
    setErroresParse([]);
    setDryRunResult(null);
    setImportResult(null);
    if (!f) return;
    const { lineas, errores } = await parseFile(f);
    setLineas(lineas);
    setErroresParse(errores);
    if (errores.length > 0) {
      toast.error(errores[0]!);
    } else {
      toast.success(`Archivo cargado: ${lineas.length} líneas detectadas`);
    }
  }

  async function ejecutarDryRun() {
    if (lineas.length === 0) return;
    setRunning(true);
    const r = await importarHistoricoMasivo(lineas, {
      archivoNombre: archivo?.name,
      observaciones,
      dryRun: true,
    });
    setRunning(false);
    if (r.ok) {
      setDryRunResult(r.data);
      toast.success(`Preview: ${r.data.importadas} válidas · ${r.data.duplicadas} dups · ${r.data.errores} errores`);
    } else {
      toast.error(r.error.message);
    }
  }

  async function ejecutarImport() {
    if (lineas.length === 0) return;
    setRunning(true);
    const r = await importarHistoricoMasivo(lineas, {
      archivoNombre: archivo?.name,
      observaciones,
      dryRun: false,
    });
    setRunning(false);
    if (r.ok) {
      setImportResult(r.data);
      toast.success(`Importadas ${r.data.importadas} líneas`);
      void recargarHistorial();
    } else {
      toast.error(r.error.message);
    }
  }

  function resetear() {
    setArchivo(null);
    setLineas([]);
    setErroresParse([]);
    setDryRunResult(null);
    setImportResult(null);
    setObservaciones('');
    if (fileRef.current) fileRef.current.value = '';
  }

  const previewLineas = useMemo(() => lineas.slice(0, 20), [lineas]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/gerencia/finanzas"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-brand-ink/70 hover:bg-slate-100 hover:text-brand-ink"
        >
          <ArrowLeft size={16} /> Finanzas
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-brand-ink">
            Importar histórico
          </h1>
          <p className="text-sm text-brand-muted">
            Subí un Excel/CSV con tus movimientos históricos. La plantilla está estandarizada.
          </p>
        </div>
      </div>

      {/* Paso 1 · Plantilla */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-brand-cyan/10 p-3 text-brand-cyan">
            <FileSpreadsheet size={22} />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-brand-ink">1. Descargá la plantilla</h3>
            <p className="mt-1 text-sm text-brand-muted">
              Usá nuestra plantilla con las columnas correctas. Tiene 3 ejemplos para guiarte.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={descargarPlantilla}>
                <Download size={15} /> Plantilla CSV
              </Button>
              <button
                type="button"
                onClick={() => {
                  const docEl = document.getElementById('columnas-plantilla');
                  if (docEl) docEl.classList.toggle('hidden');
                }}
                className="inline-flex items-center gap-1 text-sm text-brand-cyan hover:underline"
              >
                Ver detalle de columnas <ChevronDown size={14} />
              </button>
            </div>
            <div id="columnas-plantilla" className="mt-3 hidden text-xs text-brand-muted">
              <table className="w-full max-w-2xl border-separate border-spacing-y-0.5">
                <tbody>
                  <ColumnaInfo nombre="fecha" tipo="Obligatoria" desc="DD/MM/YYYY o YYYY-MM-DD" />
                  <ColumnaInfo nombre="tipo" tipo="Obligatoria" desc="ingreso o egreso" />
                  <ColumnaInfo nombre="caja" tipo="Obligatoria" desc="Nombre exacto de una caja existente" />
                  <ColumnaInfo nombre="monto" tipo="Obligatoria" desc="Número positivo (acepta coma o punto decimal)" />
                  <ColumnaInfo nombre="categoria" tipo="Opcional" desc="Nombre exacto de una categoría existente" />
                  <ColumnaInfo nombre="descripcion" tipo="Opcional" desc="Texto libre" />
                  <ColumnaInfo nombre="administracion_codigo" tipo="Opcional" desc="Código de la administración cliente" />
                  <ColumnaInfo nombre="consorcio_codigo" tipo="Opcional" desc="Código del consorcio (requiere administración)" />
                  <ColumnaInfo nombre="referencia" tipo="Opcional" desc="Texto libre" />
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Paso 2 · Upload */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-brand-cyan/10 p-3 text-brand-cyan">
            <Upload size={22} />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-brand-ink">2. Subí tu archivo</h3>
            <p className="mt-1 text-sm text-brand-muted">
              Completá la plantilla con tus datos y subila acá.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
              className="mt-3 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-cyan file:px-4 file:py-2 file:text-white hover:file:bg-brand-cyan/90"
            />

            {erroresParse.length > 0 && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                {erroresParse.map((e, i) => (
                  <p key={i} className="flex items-center gap-2 text-sm text-rose-700">
                    <AlertTriangle size={14} /> {e}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Paso 3 · Preview y resultado */}
      {lineas.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-brand-cyan/10 p-3 text-brand-cyan">
              <Eye size={22} />
            </div>
            <div className="flex-1">
              <h3 className="font-medium text-brand-ink">
                3. Preview ({lineas.length} líneas detectadas)
              </h3>
              <p className="mt-1 text-sm text-brand-muted">
                Validá primero con un preview (dry-run). Después confirmá la importación real.
              </p>

              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Observaciones del lote (opcional)…"
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={2}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  onClick={ejecutarDryRun}
                  disabled={running}
                >
                  {running ? 'Validando…' : 'Validar (preview)'}
                </Button>
                {dryRunResult && dryRunResult.importadas > 0 && (
                  <Button
                    onClick={ejecutarImport}
                    disabled={running}
                  >
                    {running ? 'Importando…' : `Importar ${dryRunResult.importadas} líneas`}
                  </Button>
                )}
                <Button variant="ghost" onClick={resetear}>
                  <X size={15} /> Limpiar
                </Button>
              </div>

              {dryRunResult && !importResult && (
                <ResultadoCard result={dryRunResult} esDryRun />
              )}
              {importResult && <ResultadoCard result={importResult} />}
            </div>
          </div>

          {/* Tabla preview primeras 20 líneas */}
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-brand-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left">#</th>
                  <th className="px-2 py-1.5 text-left">Fecha</th>
                  <th className="px-2 py-1.5 text-left">Tipo</th>
                  <th className="px-2 py-1.5 text-left">Caja</th>
                  <th className="px-2 py-1.5 text-left">Categoría</th>
                  <th className="px-2 py-1.5 text-right">Monto</th>
                  <th className="px-2 py-1.5 text-left">Descripción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {previewLineas.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5 text-brand-muted">{i + 1}</td>
                    <td className="px-2 py-1.5 tabular-nums">{l.fecha}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn(
                        'inline-flex rounded-full px-1.5 py-0.5 text-[10px]',
                        l.tipo === 'ingreso'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-rose-50 text-rose-700',
                      )}>
                        {l.tipo}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">{l.caja}</td>
                    <td className="px-2 py-1.5 text-brand-muted">{l.categoria ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {new Intl.NumberFormat('es-AR').format(l.monto)}
                    </td>
                    <td className="px-2 py-1.5 max-w-[200px] truncate text-brand-muted">
                      {l.descripcion ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lineas.length > 20 && (
              <div className="bg-slate-50 px-2 py-1.5 text-center text-xs text-brand-muted">
                ... y {lineas.length - 20} líneas más
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historial de lotes */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowHistorial((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <History size={18} className="text-brand-muted" />
            <span className="font-medium text-brand-ink">Historial de importaciones</span>
            <span className="text-xs text-brand-muted">({lotes.length})</span>
          </div>
          <ChevronDown size={16} className={cn('transition', showHistorial && 'rotate-180')} />
        </button>
        {showHistorial && (
          <div className="border-t border-slate-100 px-5 py-3">
            {lotes.length === 0 ? (
              <p className="py-4 text-center text-sm text-brand-muted">Sin importaciones previas.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-brand-muted">
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Archivo</th>
                    <th className="py-2 text-right">Total</th>
                    <th className="py-2 text-right">Importadas</th>
                    <th className="py-2 text-right">Dups</th>
                    <th className="py-2 text-right">Errores</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lotes.map((l) => (
                    <tr key={l.lote_id}>
                      <td className="py-2 text-xs text-brand-muted tabular-nums">
                        {new Date(l.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="py-2 text-xs">{l.archivo_nombre ?? '—'}</td>
                      <td className="py-2 text-right tabular-nums">{l.total_lineas}</td>
                      <td className="py-2 text-right tabular-nums text-emerald-700">{l.total_importadas}</td>
                      <td className="py-2 text-right tabular-nums text-amber-600">{l.total_duplicadas}</td>
                      <td className="py-2 text-right tabular-nums text-rose-600">{l.total_errores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnaInfo({ nombre, tipo, desc }: { nombre: string; tipo: string; desc: string }) {
  return (
    <tr>
      <td className="pr-3 align-top"><code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">{nombre}</code></td>
      <td className="pr-3 align-top">
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[10px] uppercase',
          tipo === 'Obligatoria' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600',
        )}>{tipo}</span>
      </td>
      <td className="align-top">{desc}</td>
    </tr>
  );
}

function ResultadoCard({ result, esDryRun }: { result: ResultadoImportacion; esDryRun?: boolean }) {
  return (
    <div className={cn(
      'mt-4 rounded-lg border p-4',
      esDryRun ? 'border-slate-200 bg-slate-50' : 'border-emerald-200 bg-emerald-50',
    )}>
      <div className="mb-3 flex items-center gap-2">
        {esDryRun
          ? <Eye size={18} className="text-slate-600" />
          : <CheckCircle2 size={18} className="text-emerald-600" />}
        <p className="font-medium text-brand-ink">
          {esDryRun ? 'Resultado del preview (sin guardar)' : '¡Importación completada!'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total líneas" value={result.total} />
        <Stat label="A importar" value={result.importadas} tone="emerald" />
        <Stat label="Duplicadas" value={result.duplicadas} tone="amber" />
        <Stat label="Con errores" value={result.errores} tone={result.errores > 0 ? 'rose' : undefined} />
      </div>

      {result.detalles_errores.length > 0 && (
        <details className="mt-3 rounded-lg border border-rose-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-rose-700">
            Ver {result.detalles_errores.length} errores
          </summary>
          <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto text-xs">
            {result.detalles_errores.slice(0, 100).map((e, i) => (
              <div key={i} className="rounded bg-rose-50 px-2 py-1.5">
                <span className="font-medium text-rose-700">Fila {e.fila}:</span>{' '}
                <span className="text-brand-ink">{e.error}</span>
              </div>
            ))}
            {result.detalles_errores.length > 100 && (
              <p className="text-center text-brand-muted">... y {result.detalles_errores.length - 100} más</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: number; tone?: 'emerald' | 'amber' | 'rose' }) {
  const color = tone === 'emerald' ? 'text-emerald-700'
    : tone === 'amber' ? 'text-amber-700'
    : tone === 'rose' ? 'text-rose-700'
    : 'text-brand-ink';
  return (
    <div>
      <p className="text-xs text-brand-muted">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
    </div>
  );
}
