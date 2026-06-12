import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Banknote,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  Lock,
  Loader2,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { AnimatedNumber, Button } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  CONDICION_TIPO_LABEL,
  certificadoParaPdf,
  emitirCertificado,
  fmtFecha,
  listCertificadosPorCurso,
  listCondicionesMatricula,
  listMatriculas,
  resolverEsquemaParaCert,
  tildarCondicion,
  verificacionUrl,
  type CertificadoRow,
  type CondicionTipo,
  type CursoDetalle,
  type EsquemaCertSnapshot,
  type MatriculaCondicionItem,
  type MatriculaListItem,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';
import { AsignarAlumnoDrawer } from './AsignarAlumnoDrawer';
import { CertificadoPreviewModal } from './CertificadoPreviewModal';
import { RegistrarPagoModal } from './RegistrarPagoModal';
import type { CertificadoParaPdf } from '@/services/api/campus';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';

// Tab de gestión de matrículas: lista de alumnos asignados al curso con su
// checklist de condiciones tildable por staff (DGG-10). El examen aparece
// auto-tildado y read-only.
export function GestionMatriculasTab({ data }: { data: CursoDetalle }) {
  const [matriculas, setMatriculas] = useState<MatriculaListItem[]>([]);
  const [condiciones, setCondiciones] = useState<
    Record<string, MatriculaCondicionItem[]>
  >({});
  const [certificados, setCertificados] = useState<Record<string, CertificadoRow>>(
    {},
  );
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pagoTarget, setPagoTarget] = useState<MatriculaListItem | null>(null);
  const [previewCert, setPreviewCert] = useState<CertificadoParaPdf | null>(null);
  const [previewEsquema, setPreviewEsquema] = useState<EsquemaCertSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const m = await listMatriculas({ cursoId: data.curso.id });
    if (!m.ok) {
      setLoading(false);
      toast.error(humanizeError(m.error));
      return;
    }
    setMatriculas(m.data);
    const [pares, certs] = await Promise.all([
      Promise.all(
        m.data.map(async (mm) => {
          const c = await listCondicionesMatricula(mm.id);
          return [mm.id, c.ok ? c.data : []] as const;
        }),
      ),
      listCertificadosPorCurso(data.curso.id),
    ]);
    const acc: Record<string, MatriculaCondicionItem[]> = {};
    for (const [k, v] of pares) acc[k] = v;
    setCondiciones(acc);
    setCertificados(certs.ok ? certs.data : {});
    setLoading(false);
  }, [data.curso.id]);

  async function onEmitir(matriculaId: string) {
    setEmitiendo(matriculaId);
    const res = await emitirCertificado(matriculaId);
    setEmitiendo(null);
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success('Certificado emitido');
    void load();
  }

  async function onDescargar(cert: CertificadoRow) {
    try {
      const esquema = await resolverEsquemaParaCert(cert);
      await generateCertificadoPdf(
        certificadoParaPdf(cert),
        esquema ?? undefined,
      );
    } catch (err) {
      // catch silencioso anterior tragaba la causa raíz. Ahora logueamos
      // siempre + mostramos al usuario una pista del error para que pueda
      // reportar (fonts no cargadas, imágenes 4xx, CORS, etc.).
      console.error('[cert-pdf] descarga falló:', err);
      const detalle =
        err instanceof Error
          ? err.message.slice(0, 180)
          : 'Error desconocido';
      toast.error('No pudimos generar el PDF.', { description: detalle });
    }
  }

  // Abre el preview cargando el esquema del cert (snapshot persistido o,
  // en su defecto, el del curso actual).
  async function abrirPreview(cert: CertificadoRow) {
    const esquema = await resolverEsquemaParaCert(cert);
    setPreviewEsquema(esquema);
    setPreviewCert(certificadoParaPdf(cert));
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function onTildar(c: MatriculaCondicionItem) {
    if (c.tipo === 'examen' || c.tipo === 'encuesta') return; // read-only, auto (examen al aprobar / encuesta al responder)
    if (c.tipo === 'pago' && !c.cumplida) {
      // El pago se registra con asiento; abrir el modal.
      const m = matriculas.find((mm) => mm.id === c.matricula_id) ?? null;
      setPagoTarget(m);
      return;
    }
    const res = await tildarCondicion({
      matriculaCondicionId: c.id,
      cumplida: !c.cumplida,
    });
    if (!res.ok) {
      toast.error(humanizeError(res.error));
      return;
    }
    toast.success(c.cumplida ? 'Condición destildada' : 'Condición acreditada');
    void load();
  }

  // DGG-26 · Export a PDF/XLS de las matrículas del curso, con su resumen de
  // condiciones cumplidas y certificado emitido.
  const exportRows = useMemo(() => {
    return matriculas.map((m) => {
      const conds = (condiciones[m.id] ?? []).filter((c) => c.activa);
      const total = conds.length;
      const cumplidas = conds.filter((c) => c.cumplida).length;
      const cert = certificados[m.id] ?? null;
      return {
        ...m,
        condiciones_resumen: total > 0 ? `${cumplidas}/${total}` : '—',
        certificado_codigo: cert?.codigo ?? '',
        certificado_emitido: !!cert,
      };
    });
  }, [matriculas, condiciones, certificados]);

  type ExportRow = (typeof exportRows)[number];

  async function onExportPdf() {
    await generateReportPdf<ExportRow>({
      filename: `matriculas-${data.curso.slug || data.curso.id}-${new Date().toISOString().slice(0, 10)}`,
      titulo: 'Matrículas del curso',
      subtitulo: data.curso.titulo,
      filtros: [{ label: 'Curso', value: data.curso.titulo }],
      kpis: [
        { label: 'Alumnos', value: String(matriculas.length), tone: 'cyan' },
        {
          label: 'Con certificado',
          value: String(Object.keys(certificados).length),
          tone: 'emerald',
        },
      ],
      columns: [
        { key: 'alumno_nombre', label: 'Alumno', width: '26%',
          format: (r) => r.alumno_nombre ?? '—' },
        { key: 'administracion_nombre', label: 'Administración', width: '22%',
          format: (r) => r.administracion_nombre ?? '—' },
        { key: 'inscripto_at', label: 'Fecha matrícula', width: '14%',
          format: (r) => fmtFecha(r.inscripto_at) },
        { key: 'estado', label: 'Estado', width: '12%' },
        { key: 'condiciones_resumen', label: 'Condiciones', width: '12%',
          format: (r) => r.condiciones_resumen },
        { key: 'certificado_emitido', label: 'Certificado', width: '14%',
          format: (r) => (r.certificado_emitido ? r.certificado_codigo || 'Emitido' : '—') },
      ],
      rows: exportRows,
    });
  }

  async function onExportXls() {
    generateReportXls<ExportRow>({
      filename: `matriculas-${data.curso.slug || data.curso.id}-${new Date().toISOString().slice(0, 10)}`,
      sheetName: 'Matrículas',
      titulo: `Matrículas · ${data.curso.titulo}`,
      filtros: [{ label: 'Curso', value: data.curso.titulo }],
      columns: [
        { key: 'alumno_nombre', label: 'Alumno', width: 28,
          value: (r) => r.alumno_nombre ?? '' },
        { key: 'administracion_nombre', label: 'Administración', width: 26,
          value: (r) => r.administracion_nombre ?? '' },
        { key: 'inscripto_at', label: 'Fecha matrícula', width: 16,
          value: (r) => r.inscripto_at ? new Date(r.inscripto_at) : null },
        { key: 'estado', label: 'Estado', width: 14 },
        { key: 'condiciones_resumen', label: 'Condiciones', width: 14,
          value: (r) => r.condiciones_resumen },
        { key: 'certificado_emitido', label: 'Certificado emitido', width: 16,
          value: (r) => (r.certificado_emitido ? 'Sí' : 'No') },
        { key: 'certificado_codigo', label: 'Código certificado', width: 22,
          value: (r) => r.certificado_codigo },
      ],
      rows: exportRows,
    });
  }

  if (loading) {
    return (
      <div className="grid h-40 place-items-center text-brand-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card-premium p-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-brand-cyan" />
            <h2 className="font-display text-lg font-semibold text-brand-ink">
              Alumnos asignados{' '}
              <span className="ml-1 text-sm text-brand-muted">
                (<AnimatedNumber value={matriculas.length} />)
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons
              onExportPdf={onExportPdf}
              onExportXls={onExportXls}
              disabled={matriculas.length === 0}
              hint="Matrículas"
            />
            <Button onClick={() => setDrawerOpen(true)}>
              <UserPlus size={14} /> Asignar alumno
            </Button>
          </div>
        </header>

        {matriculas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Users size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-brand-ink">
              Todavía no hay alumnos asignados
            </p>
            <p className="mt-1 text-sm text-brand-muted">
              El acceso al curso lo habilitás vos: tocá “Asignar alumno”.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {matriculas.map((m) => {
              const conds = (condiciones[m.id] ?? []).filter((c) => c.activa);
              const total = conds.length;
              const cumplidas = conds.filter((c) => c.cumplida).length;
              const todasOk = total > 0 && cumplidas === total;
              const cert = certificados[m.id] ?? null;
              return (
                <li
                  key={m.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-ink">
                        {m.alumno_nombre ?? 'Alumno'}
                      </p>
                      <p className="text-xs text-brand-muted">
                        {m.administracion_nombre ?? 'Sin administración'} · vigencia{' '}
                        {fmtFecha(m.vigencia_hasta)}
                      </p>
                    </div>
                    {cert ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-semibold text-brand-cyan">
                        <Award size={12} /> Certificado emitido
                      </span>
                    ) : todasOk ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        <Award size={12} /> Condiciones cumplidas
                      </span>
                    ) : total > 0 ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        {cumplidas}/{total} condiciones
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        Sin condiciones
                      </span>
                    )}
                  </header>

                  {conds.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {conds.map((c) => {
                        const auto = c.tipo === 'examen' || c.tipo === 'encuesta';
                        return (
                          <li
                            key={c.id}
                            className="flex items-center justify-between gap-3 rounded-lg bg-brand-zebra/40 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              {c.cumplida ? (
                                <CheckCircle2
                                  size={16}
                                  className="shrink-0 text-emerald-600"
                                />
                              ) : (
                                <Circle size={16} className="shrink-0 text-slate-300" />
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm text-brand-ink">
                                  {c.etiqueta}
                                </p>
                                {c.cumplida && c.cumplida_at && (
                                  <p className="text-[11px] text-brand-muted">
                                    {auto ? 'Automática · ' : ''}
                                    {fmtFecha(c.cumplida_at)}
                                  </p>
                                )}
                              </div>
                            </div>
                            {auto ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-brand-muted">
                                <Lock size={11} /> Auto
                              </span>
                            ) : c.tipo === 'pago' && !c.cumplida ? (
                              <Button
                                variant="tonal"
                                className="!px-2.5 !py-1 text-xs"
                                onClick={() => void onTildar(c)}
                              >
                                <Banknote size={12} /> Registrar pago
                              </Button>
                            ) : (
                              <button
                                onClick={() => void onTildar(c)}
                                className={cn(
                                  'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                                  c.cumplida
                                    ? 'border-slate-200 bg-white text-brand-muted hover:bg-slate-50'
                                    : 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan hover:bg-brand-cyan/10',
                                )}
                              >
                                {c.cumplida ? (
                                  'Destildar'
                                ) : (
                                  <>
                                    <Check size={12} /> Acreditar
                                  </>
                                )}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Certificado: emitido (ver/descargar) o botón de emisión
                      manual si el motor todavía no lo hizo. */}
                  {cert ? (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand-cyan/20 bg-brand-cyan/5 px-3 py-2">
                      <span className="font-mono text-[11px] text-brand-muted">
                        {cert.codigo}
                      </span>
                      <button
                        onClick={() => void abrirPreview(cert)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-cyan hover:underline"
                      >
                        <Eye size={13} /> Vista previa
                      </button>
                      <button
                        onClick={() => void onDescargar(cert)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-cyan hover:underline"
                      >
                        <Download size={13} /> Descargar
                      </button>
                      <a
                        href={verificacionUrl(cert.codigo)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted hover:text-brand-ink"
                      >
                        <ShieldCheck size={13} /> Verificar
                      </a>
                    </div>
                  ) : (
                    todasOk && (
                      <div className="mt-3">
                        <Button
                          variant="tonal"
                          className="text-xs"
                          disabled={emitiendo === m.id}
                          onClick={() => void onEmitir(m.id)}
                        >
                          {emitiendo === m.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Award size={13} />
                          )}
                          Emitir certificado
                        </Button>
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AsignarAlumnoDrawer
        open={drawerOpen}
        cursoId={data.curso.id}
        cursoTitulo={data.curso.titulo}
        onClose={() => setDrawerOpen(false)}
        onAsignado={() => void load()}
      />
      <RegistrarPagoModal
        open={pagoTarget !== null}
        matriculaId={pagoTarget?.id ?? null}
        alumnoNombre={pagoTarget?.alumno_nombre ?? 'el alumno'}
        montoSugerido={
          data.curso.precio_lista !== null ? Number(data.curso.precio_lista) : null
        }
        onClose={() => setPagoTarget(null)}
        onRegistrado={() => void load()}
      />
      <CertificadoPreviewModal
        cert={previewCert}
        open={previewCert !== null}
        onClose={() => {
          setPreviewCert(null);
          setPreviewEsquema(null);
        }}
        esquema={previewEsquema ?? undefined}
      />
    </div>
  );
}

// Etiqueta legible del tipo (export utilitario por si se reusa).
export function condicionLabel(tipo: CondicionTipo): string {
  return CONDICION_TIPO_LABEL[tipo];
}
