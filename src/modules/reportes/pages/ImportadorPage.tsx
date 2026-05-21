import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2,
  ArrowLeft, RefreshCcw, X,
} from 'lucide-react';
import { Button, Field, Select } from '@/components/common';
import { toast } from '@/lib/toast';
import {
  parsearArchivoXlsx,
  validarFilas,
  importarLote,
  fetchAdministracionesMap,
  type ColumnMapping,
  type ParsedSheet,
  type ValidacionFila,
  type ImportResult,
} from '@/services/api/importador';
import { listAdministraciones, type AdministracionListItem } from '@/services/api/administraciones';

// ============================================================================
// ImportadorPage · drag & drop → mapping → validación → confirm → resultado.
// Inserta con `origen='previo'` para no chocar con la numeración fiscal nativa
// (índice único uq_comprobantes_pv_tipo_numero excluye previo · 0004 L167-169).
// ============================================================================

const CAMPOS: Array<{ key: keyof ColumnMapping; label: string; required: boolean }> = [
  { key: 'fecha', label: 'Fecha *', required: true },
  { key: 'tipo', label: 'Tipo (X/A/B/C)', required: false },
  { key: 'puntoVenta', label: 'Punto de venta', required: false },
  { key: 'numero', label: 'Número', required: false },
  { key: 'receptorRazonSocial', label: 'Razón social *', required: true },
  { key: 'receptorCuit', label: 'CUIT / DNI *', required: true },
  { key: 'total', label: 'Importe total *', required: true },
  { key: 'observaciones', label: 'Observaciones', required: false },
  { key: 'administracion', label: 'Administración (cliente)', required: false },
];

export function ImportadorPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  const [admins, setAdmins] = useState<AdministracionListItem[]>([]);
  const [adminId, setAdminId] = useState('');
  const [adminMap, setAdminMap] = useState<Map<string, string> | null>(null);

  const [validadas, setValidadas] = useState<ValidacionFila[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    listAdministraciones({ limit: 500 }).then((res) => {
      if (res.ok) setAdmins(res.data.rows);
    });
    fetchAdministracionesMap().then((res) => {
      if (res.ok) setAdminMap(res.data);
    });
  }, []);

  const handleFile = async (f: File) => {
    setFile(f);
    setResult(null);
    setValidadas(null);
    setParsing(true);
    const res = await parsearArchivoXlsx(f);
    setParsing(false);
    if (!res.ok) {
      toast.error(res.error.message);
      setParsed(null);
      setMapping(null);
      return;
    }
    setParsed(res.data);
    setMapping(res.data.sugerencias);
    toast.success(`Archivo leído: ${res.data.rows.length} filas`);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onFilePicker = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const reset = () => {
    setFile(null);
    setParsed(null);
    setMapping(null);
    setValidadas(null);
    setResult(null);
  };

  const validar = () => {
    if (!parsed || !mapping) return;
    const v = validarFilas({
      rows: parsed.rows,
      mapping,
      administracionIdDefault: adminId || undefined,
      administracionMap: adminMap ?? undefined,
    });
    setValidadas(v);
    const validas = v.filter((f) => f.ok).length;
    const invalidas = v.length - validas;
    if (invalidas > 0) {
      toast.warning(`${validas} válidas · ${invalidas} con errores`);
    } else {
      toast.success(`${validas} filas listas para importar`);
    }
  };

  const importar = async () => {
    if (!validadas || !file) return;
    setImporting(true);
    const res = await importarLote(file.name, validadas);
    setImporting(false);
    if (!res.ok) {
      toast.error(res.error.message);
      return;
    }
    setResult(res.data);
    toast.success(
      `Importados ${res.data.insertados} · saltados ${res.data.saltados}`,
    );
  };

  const validasCount = useMemo(
    () => validadas?.filter((f) => f.ok).length ?? 0,
    [validadas],
  );
  const invalidasCount = useMemo(
    () => validadas?.filter((f) => !f.ok).length ?? 0,
    [validadas],
  );

  return (
    <div className="space-y-6 p-6 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to="/gerencia/reportes"
            className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-brand-cyan hover:underline"
          >
            <ArrowLeft size={14} /> Reportes
          </Link>
          <h1 className="mt-1 font-display text-3xl font-bold text-brand-ink">
            Importar histórico
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-muted">
            Cargá un <strong>.xlsx</strong> con comprobantes previos. Se insertan
            con <code className="rounded bg-slate-100 px-1 text-xs">origen=previo</code>{' '}
            para no chocar con la numeración fiscal nativa.
          </p>
        </div>
        {file && (
          <Button variant="ghost" onClick={reset}>
            <X size={16} /> Cargar otro archivo
          </Button>
        )}
      </header>

      {/* Paso 1: drop area */}
      {!parsed && (
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className="grid place-items-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-12 text-center"
        >
          {parsing ? (
            <div className="flex items-center gap-3 text-brand-muted">
              <Loader2 className="animate-spin" size={20} />
              Leyendo {file?.name}…
            </div>
          ) : (
            <>
              <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-cyan/10 text-brand-cyan">
                <Upload size={28} />
              </div>
              <p className="mt-4 font-display text-lg font-semibold text-brand-ink">
                Arrastrá un .xlsx acá
              </p>
              <p className="mt-1 text-sm text-brand-muted">o</p>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue">
                <FileSpreadsheet size={16} /> Elegir archivo
                <input
                  type="file"
                  accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={onFilePicker}
                />
              </label>
              <p className="mt-4 max-w-md text-xs text-brand-muted">
                Formato esperado · primera hoja con headers libres. La plataforma
                detecta automáticamente las columnas (fecha, tipo, número, receptor,
                CUIT, importe, observaciones). Podés ajustar el mapping luego.
              </p>
            </>
          )}
        </div>
      )}

      {/* Paso 2: mapping + preview */}
      {parsed && !result && (
        <div className="space-y-6">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                  Paso 1
                </p>
                <h2 className="font-display text-xl font-semibold text-brand-ink">
                  Mapeo de columnas
                </h2>
              </div>
              <span className="rounded-full bg-brand-cyan/10 px-3 py-1 text-xs font-semibold text-brand-cyan">
                {parsed.rows.length} filas detectadas
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {CAMPOS.map((c) => (
                <Field key={c.key} label={c.label}>
                  <Select
                    value={mapping?.[c.key] ?? ''}
                    onChange={(e) =>
                      setMapping(
                        (m) => ({ ...(m as ColumnMapping), [c.key]: e.target.value || null }),
                      )
                    }
                  >
                    <option value="">— No mapear —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <Field
                label="Administración por defecto"
                hint="Si todas las filas son del mismo cliente, elegilo acá. Si no, mapeá la columna 'Administración' arriba."
              >
                <Select
                  value={adminId}
                  onChange={(e) => setAdminId(e.target.value)}
                >
                  <option value="">— Usar columna mapeada —</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>

          {/* Preview de filas */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                  Paso 2
                </p>
                <h2 className="font-display text-xl font-semibold text-brand-ink">
                  Vista previa (primeras 20 filas)
                </h2>
              </div>
              <Button variant="secondary" onClick={validar}>
                <RefreshCcw size={16} /> Validar filas
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {parsed.headers.map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-brand-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 20).map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      {parsed.headers.map((h) => (
                        <td key={h} className="px-3 py-1.5 text-brand-ink">
                          {row[h] == null ? '' : String(row[h])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Resultado validación + confirm */}
          {validadas && (
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                    Paso 3
                  </p>
                  <h2 className="font-display text-xl font-semibold text-brand-ink">
                    Resultado de validación
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    Listas para importar
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold text-emerald-700">
                    {validasCount}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Con errores
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold text-amber-700">
                    {invalidasCount}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                    Total
                  </p>
                  <p className="mt-1 font-display text-2xl font-bold text-brand-ink">
                    {validadas.length}
                  </p>
                </div>
              </div>

              {invalidasCount > 0 && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Errores ({invalidasCount})
                  </p>
                  <ul className="space-y-1 text-xs text-amber-900">
                    {validadas.filter((f) => !f.ok).slice(0, 50).map((f) => (
                      <li key={f.index} className="flex items-start gap-2">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>
                          <strong>Fila {f.index}:</strong> {f.motivo}
                          {f.resumen && <em className="ml-1 opacity-70">· {f.resumen}</em>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="ghost" onClick={() => setValidadas(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={importar}
                  loading={importing}
                  disabled={validasCount === 0}
                >
                  <CheckCircle2 size={16} />
                  Importar {validasCount} comprobantes
                </Button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Resultado final */}
      {result && (
        <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/30 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-emerald-600" size={28} />
            <div>
              <h2 className="font-display text-xl font-semibold text-emerald-800">
                Importación completa
              </h2>
              <p className="text-sm text-emerald-700">
                Archivo <strong>{file?.name}</strong> procesado.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Insertados
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-emerald-700">
                {result.insertados}
              </p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Saltados
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-amber-600">
                {result.saltados}
              </p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">
                Total filas
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-brand-ink">
                {result.total}
              </p>
            </div>
          </div>

          {result.errores.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-lg border border-amber-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                Detalle de errores ({result.errores.length})
              </p>
              <ul className="space-y-1 text-xs text-amber-900">
                {result.errores.map((e, i) => (
                  <li key={i}>
                    <strong>Fila {e.fila}:</strong> {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={reset}>
              <Upload size={16} /> Importar otro archivo
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
