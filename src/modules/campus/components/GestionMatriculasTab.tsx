import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Banknote,
  Check,
  CheckCircle2,
  Circle,
  Download,
  Eye,
  FileBadge,
  Lock,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AnimatedNumber, Button, Input, Select, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  CONDICION_TIPO_LABEL,
  ESTADO_PAGO_LABEL,
  MATRICULA_ESTADO_LABEL,
  type MatriculaEstado,
  certificadoParaPdf,
  desasignarAlumno,
  emitirCertificado,
  regenerarCertificado,
  fmtFecha,
  listAlumnosEmails,
  listCertificadosPorCurso,
  listCondicionesMatricula,
  listMatriculas,
  listMejoresNotas,
  cursoFinalizado,
  resolverEsquemaParaCert,
  setEstadoPagoMatricula,
  tildarCondicion,
  verificacionUrl,
  type CertificadoRow,
  type CondicionTipo,
  type CursoDetalle,
  type EsquemaCertSnapshot,
  type EstadoPagoMatricula,
  type MatriculaCondicionItem,
  type MatriculaListItem,
  type MejorNotaExamen,
} from '@/services/api/campus';
import { generateCertificadoPdf } from '../lib/generateCertificadoPdf';
import { AsignarAlumnoDrawer } from './AsignarAlumnoDrawer';
import { CertificadoPreviewModal } from './CertificadoPreviewModal';
import { ConstanciaModal } from './ConstanciaModal';
import { RegistrarPagoModal } from './RegistrarPagoModal';
import type { CertificadoParaPdf } from '@/services/api/campus';
import { ExportButtons } from '@/components/reports/ExportButtons';
import { generateReportPdf } from '@/lib/reportPdf';
import { generateReportXls } from '@/lib/reportXls';
import { humanizeError } from '@/lib/errors';
import { parseLocalDate, hoyISO } from '@/lib/dates';

// `vigencia_hasta` es `date` (date-only) en Postgres. `fmtFecha` usa
// `new Date(str)` (UTC midnight) y retrocede un día en AR (E-GG-72), así que
// acá la parseamos como fecha LOCAL preservando el formato dd/mm/yyyy.
function fmtFechaSoloDia(s: string | null | undefined): string {
  if (!s) return '—';
  return parseLocalDate(s).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// DGG-154 · buscador + filtros de condiciones para la lista de asignados.
// Normaliza (sin acentos, minúsculas) para que "Gomez" matchee "Gómez".
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

type CatFiltro = 'todos' | 'completo' | 'pendiente';

// Estado de una CATEGORÍA de condición para un alumno: 'na' (no tiene condición
// de ese tipo), 'completo' (todas las de ese tipo cumplidas), 'pendiente' (falta
// alguna). Los sincrónicos pueden ser varios (Asambleas, IA…): 'completo' sólo
// si están TODOS. Sólo cuentan las condiciones activas.
function estadoCategoria(
  conds: MatriculaCondicionItem[],
  tipo: CondicionTipo,
): 'na' | 'completo' | 'pendiente' {
  const delTipo = conds.filter((c) => c.activa && c.tipo === tipo);
  if (delTipo.length === 0) return 'na';
  return delTipo.every((c) => c.cumplida) ? 'completo' : 'pendiente';
}

// Select compacto de filtro por categoría (Todos / Completo / Pendiente).
function FiltroCat({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CatFiltro;
  onChange: (v: CatFiltro) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-brand-muted">
      {label}
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value as CatFiltro)}
        className={cn(
          '!w-auto !py-1.5 pr-7 text-xs',
          value !== 'todos' && 'border-brand-cyan/50 bg-brand-cyan/5 text-brand-ink',
        )}
        aria-label={`Filtrar por ${label}`}
      >
        <option value="todos">Todos</option>
        <option value="completo">Completo</option>
        <option value="pendiente">Pendiente</option>
      </Select>
    </label>
  );
}

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
  // DGG-119: mejor nota aprobada por matrícula + email de login por alumno.
  const [notas, setNotas] = useState<Record<string, MejorNotaExamen>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emitiendo, setEmitiendo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pagoTarget, setPagoTarget] = useState<MatriculaListItem | null>(null);
  const [previewCert, setPreviewCert] = useState<CertificadoParaPdf | null>(null);
  const [previewEsquema, setPreviewEsquema] = useState<EsquemaCertSnapshot | null>(null);
  const [desasignando, setDesasignando] = useState<string | null>(null);
  const [regenerando, setRegenerando] = useState<string | null>(null);
  // Chunk CONST · constancia de inscripción a demanda por alumno.
  const [constanciaTarget, setConstanciaTarget] = useState<MatriculaListItem | null>(null);
  // DGG-154 · buscador (nombre/email) + filtros por categoría de condición.
  const [busqueda, setBusqueda] = useState('');
  const [fPago, setFPago] = useState<CatFiltro>('todos');
  const [fEncuesta, setFEncuesta] = useState<CatFiltro>('todos');
  const [fSincronico, setFSincronico] = useState<CatFiltro>('todos');
  const confirm = useConfirm();

  const hayFiltro =
    busqueda.trim() !== '' ||
    fPago !== 'todos' ||
    fEncuesta !== 'todos' ||
    fSincronico !== 'todos';

  function limpiarFiltros() {
    setBusqueda('');
    setFPago('todos');
    setFEncuesta('todos');
    setFSincronico('todos');
  }

  const load = useCallback(async () => {
    setLoading(true);
    const m = await listMatriculas({ cursoId: data.curso.id });
    if (!m.ok) {
      setLoading(false);
      toast.error(humanizeError(m.error));
      return;
    }
    setMatriculas(m.data);
    // DGG-119: notas del examen + emails de login, para transparencia del
    // certificado (nota visible, mail de destino). Best-effort: si fallan,
    // el tab sigue funcionando igual que antes.
    const [pares, certs, notasRes, emailsRes] = await Promise.all([
      Promise.all(
        m.data.map(async (mm) => {
          const c = await listCondicionesMatricula(mm.id);
          return [mm.id, c.ok ? c.data : []] as const;
        }),
      ),
      listCertificadosPorCurso(data.curso.id),
      listMejoresNotas(m.data.map((mm) => mm.id)),
      listAlumnosEmails(data.curso.id),
    ]);
    const acc: Record<string, MatriculaCondicionItem[]> = {};
    for (const [k, v] of pares) acc[k] = v;
    setCondiciones(acc);
    setCertificados(certs.ok ? certs.data : {});
    setNotas(notasRes.ok ? notasRes.data : {});
    setEmails(emailsRes.ok ? emailsRes.data : {});
    setLoading(false);
  }, [data.curso.id]);

  // JL #4 · Desasignar (baja manual) del curso. DELETE físico de la matrícula
  // (progreso/asistencias/exámenes/condiciones caen por CASCADE). Si tiene
  // certificado emitido, el backend lo bloquea con mensaje claro. Reasignable.
  async function onDesasignar(m: MatriculaListItem) {
    const ok = await confirm({
      title: 'Desasignar del curso',
      message: `Vas a quitar a ${m.alumno_nombre ?? 'este alumno'} del curso. Se elimina su matrícula y todo su avance (asistencias, exámenes, condiciones tildadas). Si ya tiene certificado emitido, primero hay que anularlo. Podés volver a asignarlo cuando quieras.`,
      confirmLabel: 'Desasignar',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (!ok) return;
    setDesasignando(m.id);
    const res = await desasignarAlumno(m.id);
    setDesasignando(null);
    if (!res.ok) {
      toast.error('No se pudo desasignar', { description: humanizeError(res.error) });
      return;
    }
    toast.success(`${m.alumno_nombre ?? 'Alumno'} desasignado del curso`);
    void load();
  }

  // DGG-119: cambiar el estado de pago (la BD sincroniza la condición y el
  // gate del certificado solos).
  async function onEstadoPago(m: MatriculaListItem, estado: EstadoPagoMatricula) {
    const res = await setEstadoPagoMatricula(m.id, estado);
    if (!res.ok) {
      toast.error('No se pudo cambiar el estado de pago', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success(`Estado de pago: ${ESTADO_PAGO_LABEL[estado]}`);
    void load();
  }

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

  // DGG-152 · regenerar el certificado con los datos actuales de la ficha (corrige
  // nombres mal cargados). Pisa el snapshot; conserva código y fecha de emisión.
  async function onRegenerar(m: MatriculaListItem) {
    const ok = await confirm({
      title: 'Regenerar certificado',
      message: `Vas a regenerar el certificado de ${m.alumno_nombre ?? 'este alumno'} tomando los datos ACTUALES de su ficha (nombre, nota, curso). Se pisa el contenido del certificado actual manteniendo el mismo código y fecha de emisión — sirve cuando el nombre había quedado mal cargado.`,
      confirmLabel: 'Regenerar',
      cancelLabel: 'Volver',
    });
    if (!ok) return;
    setRegenerando(m.id);
    const res = await regenerarCertificado(m.id);
    setRegenerando(null);
    if (!res.ok) {
      toast.error('No se pudo regenerar el certificado', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Certificado regenerado con los datos actuales de la ficha');
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
      const nota = notas[m.id];
      return {
        ...m,
        condiciones_resumen: total > 0 ? `${cumplidas}/${total}` : '—',
        certificado_codigo: cert?.codigo ?? '',
        certificado_emitido: !!cert,
        // DGG-119: mejor nota aprobada del examen (vacía si no rindió/aprobó).
        nota_examen: nota ? `${nota.nota}/100` : '',
        // DGG-151 · datos de contacto/ficha para el export (email = login del
        // alumno; teléfono/matrícula/legajo de la ficha del cliente).
        alumno_email: emails[m.profile_id] ?? '',
      };
    });
  }, [matriculas, condiciones, certificados, notas, emails]);

  type ExportRow = (typeof exportRows)[number];

  // DGG-154 · lista visible = universo filtrado en memoria (regla 19: los KPIs
  // y el total siguen sobre el universo completo; el filtro es sólo de la vista).
  const matriculasVisibles = useMemo(() => {
    const q = normalizar(busqueda);
    return matriculas.filter((m) => {
      if (q) {
        const enNombre = normalizar(m.alumno_nombre ?? '').includes(q);
        const enEmail = normalizar(emails[m.profile_id] ?? '').includes(q);
        const enAdmin = normalizar(m.administracion_nombre ?? '').includes(q);
        if (!enNombre && !enEmail && !enAdmin) return false;
      }
      const conds = condiciones[m.id] ?? [];
      if (fPago !== 'todos' && estadoCategoria(conds, 'pago') !== fPago) return false;
      if (fEncuesta !== 'todos' && estadoCategoria(conds, 'encuesta') !== fEncuesta) return false;
      if (fSincronico !== 'todos' && estadoCategoria(conds, 'asistencia') !== fSincronico) return false;
      return true;
    });
  }, [matriculas, condiciones, emails, busqueda, fPago, fEncuesta, fSincronico]);

  async function onExportPdf() {
    await generateReportPdf<ExportRow>({
      filename: `matriculas-${data.curso.slug || data.curso.id}-${hoyISO()}`,
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
        { key: 'alumno_nombre', label: 'Alumno', width: '24%',
          format: (r) => r.alumno_nombre ?? '—' },
        { key: 'administracion_nombre', label: 'Administración', width: '20%',
          format: (r) => r.administracion_nombre ?? '—' },
        { key: 'inscripto_at', label: 'Fecha matrícula', width: '14%',
          format: (r) => fmtFecha(r.inscripto_at) },
        { key: 'estado', label: 'Estado', width: '10%',
          // §6 DGG-142: exportar el LABEL, no el valor interno de BD.
          format: (r) => MATRICULA_ESTADO_LABEL[r.estado as MatriculaEstado] ?? r.estado },
        { key: 'condiciones_resumen', label: 'Condiciones', width: '10%',
          format: (r) => r.condiciones_resumen },
        { key: 'nota_examen', label: 'Nota examen', width: '10%',
          format: (r) => r.nota_examen || '—' },
        { key: 'certificado_emitido', label: 'Certificado', width: '12%',
          format: (r) => (r.certificado_emitido ? r.certificado_codigo || 'Emitido' : '—') },
      ],
      rows: exportRows,
    });
  }

  async function onExportXls() {
    generateReportXls<ExportRow>({
      filename: `matriculas-${data.curso.slug || data.curso.id}-${hoyISO()}`,
      sheetName: 'Matrículas',
      titulo: `Matrículas · ${data.curso.titulo}`,
      filtros: [{ label: 'Curso', value: data.curso.titulo }],
      columns: [
        { key: 'alumno_nombre', label: 'Alumno', width: 28,
          value: (r) => r.alumno_nombre ?? '' },
        { key: 'administracion_nombre', label: 'Administración', width: 26,
          value: (r) => r.administracion_nombre ?? '' },
        // DGG-151 · datos extra de contacto/ficha (sólo en el Excel, no en la grilla).
        { key: 'alumno_email', label: 'Email', width: 30,
          value: (r) => r.alumno_email ?? '' },
        { key: 'administracion_telefono', label: 'Teléfono', width: 18,
          value: (r) => r.administracion_telefono ?? '' },
        { key: 'administracion_matricula_rpac', label: 'Matrícula RPAC', width: 16,
          value: (r) => r.administracion_matricula_rpac ?? '' },
        { key: 'administracion_legajo_rpac', label: 'Legajo RPAC', width: 16,
          value: (r) => r.administracion_legajo_rpac ?? '' },
        { key: 'inscripto_at', label: 'Fecha matrícula', width: 16,
          value: (r) => r.inscripto_at ? new Date(r.inscripto_at) : null },
        { key: 'estado', label: 'Estado', width: 14,
          // §6 DGG-142: exportar el LABEL, no el valor interno de BD.
          value: (r) => MATRICULA_ESTADO_LABEL[r.estado as MatriculaEstado] ?? r.estado },
        { key: 'condiciones_resumen', label: 'Condiciones', width: 14,
          value: (r) => r.condiciones_resumen },
        { key: 'nota_examen', label: 'Nota examen', width: 14,
          value: (r) => r.nota_examen },
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
            {/* DGG-115: un curso finalizado no admite nuevas matrículas
                (la RPC además lo rechaza server-side). */}
            {cursoFinalizado(data.curso) ? (
              <span
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-brand-muted"
                title="Curso finalizado — no admite nuevas matrículas. Los alumnos ya matriculados conservan su vigencia."
              >
                <UserPlus size={14} /> Curso finalizado
              </span>
            ) : (
              <Button onClick={() => setDrawerOpen(true)}>
                <UserPlus size={14} /> Asignar alumno
              </Button>
            )}
          </div>
        </header>

        {/* DGG-154 · buscador (nombre/email) + filtros por categoría de
            condición. La lista son muchos alumnos y el scroll no alcanza. */}
        {matriculas.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-4">
            <div className="relative min-w-[220px] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted"
              />
              <Input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por nombre o email…"
                className="pl-9"
                aria-label="Buscar alumno por nombre o email"
              />
            </div>
            <FiltroCat label="Pago" value={fPago} onChange={setFPago} />
            <FiltroCat label="Encuesta" value={fEncuesta} onChange={setFEncuesta} />
            <FiltroCat label="Sincrónicos" value={fSincronico} onChange={setFSincronico} />
            {hayFiltro && (
              <button
                type="button"
                onClick={limpiarFiltros}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-muted transition hover:bg-slate-100 hover:text-brand-ink"
              >
                <X size={13} /> Limpiar
              </button>
            )}
            {hayFiltro && (
              <span className="ml-auto text-xs tabular text-brand-muted">
                {matriculasVisibles.length} de {matriculas.length}
              </span>
            )}
          </div>
        )}

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
        ) : matriculasVisibles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <Search size={26} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-brand-ink">
              Ningún alumno coincide con la búsqueda o los filtros
            </p>
            <button
              type="button"
              onClick={limpiarFiltros}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-brand-cyan transition hover:bg-brand-cyan/5"
            >
              <X size={13} /> Limpiar filtros
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {matriculasVisibles.map((m) => {
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
                        {fmtFechaSoloDia(m.vigencia_hasta)}
                      </p>
                      {/* DGG-119: estado de pago editable — 'Pago completo'
                          habilita el certificado; el resto lo retiene. */}
                      <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-brand-muted">
                        <Banknote size={12} className={m.estado_pago === 'pago_completo' ? 'text-emerald-600' : 'text-amber-500'} />
                        Pago:
                        <select
                          value={m.estado_pago}
                          onChange={(e) => void onEstadoPago(m, e.target.value as EstadoPagoMatricula)}
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[11px] font-semibold outline-none transition',
                            m.estado_pago === 'pago_completo'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700',
                          )}
                        >
                          {(Object.keys(ESTADO_PAGO_LABEL) as EstadoPagoMatricula[]).map((k) => (
                            <option key={k} value={k}>{ESTADO_PAGO_LABEL[k]}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {/* Chunk CONST · constancia de inscripción a demanda */}
                      <button
                        type="button"
                        onClick={() => setConstanciaTarget(m)}
                        title="Emitir constancia de inscripción (descargar o enviar por email)"
                        className="inline-flex items-center gap-1 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-2 py-1 text-[11px] font-semibold text-brand-cyan transition hover:bg-brand-cyan/10"
                      >
                        <FileBadge size={12} />
                        Constancia
                      </button>
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
                      <button
                        type="button"
                        onClick={() => void onDesasignar(m)}
                        disabled={desasignando === m.id}
                        title="Desasignar del curso"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-muted transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {desasignando === m.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <UserMinus size={12} />
                        )}
                        Desasignar
                      </button>
                    </div>
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
                                    {/* DGG-119: la nota del examen, al lado de la fecha */}
                                    {c.tipo === 'examen' && notas[m.id] != null && (
                                      <span className="font-semibold text-brand-ink">
                                        {' · Nota '}
                                        {notas[m.id]?.nota}/100
                                      </span>
                                    )}
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
                    <div className="mt-3 rounded-lg border border-brand-cyan/20 bg-brand-cyan/5 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-3">
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
                        {/* DGG-152 · sólo gerencia (este tab lo es): regenera el
                            certificado con los datos actuales de la ficha. */}
                        <button
                          onClick={() => void onRegenerar(m)}
                          disabled={regenerando === m.id}
                          title="Regenerar con los datos actuales de la ficha (corrige nombres mal cargados). Mantiene el mismo código y fecha de emisión."
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-cyan hover:underline disabled:opacity-50"
                        >
                          {regenerando === m.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <RefreshCw size={13} />
                          )}
                          Regenerar
                        </button>
                      </div>
                      {/* DGG-119: trazabilidad de la emisión — cuándo, a qué
                          casilla fue el mail, y si el alumno ya lo descargó. */}
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-brand-muted">
                        <span>Emitido el {fmtFecha(cert.emitido_at)}</span>
                        {cert.enviado_email_at && (
                          <span>
                            Mail enviado el {fmtFecha(cert.enviado_email_at)}
                            {emails[m.profile_id] ? ` a ${emails[m.profile_id]}` : ''}
                          </span>
                        )}
                        {cert.descargado_alumno_at ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                            <CheckCircle2 size={11} /> Descargado por el alumno el{' '}
                            {fmtFecha(cert.descargado_alumno_at)}
                          </span>
                        ) : (
                          <span className="text-amber-600">
                            El alumno todavía no lo descargó
                          </span>
                        )}
                      </p>
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
      {/* Chunk CONST · constancia de inscripción a demanda */}
      {constanciaTarget && (
        <ConstanciaModal
          open={constanciaTarget !== null}
          onClose={() => setConstanciaTarget(null)}
          matriculaId={constanciaTarget.id}
          alumnoNombre={constanciaTarget.alumno_nombre ?? 'Alumno'}
        />
      )}
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
