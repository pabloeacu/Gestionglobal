import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileBadge, Loader2, Mail, Send } from 'lucide-react';
import { toast } from '@/lib/toast';
import { Drawer, Button } from '@/components/common';
import { humanizeError } from '@/lib/errors';
import {
  listarEsquemas,
  type CertificadoEsquemaRow,
} from '@/services/api/certificado-esquemas';
import {
  constanciaRegistrarPdf,
  emitirConstancia,
  fechaLargaEs,
  getDatosConstancia,
  listConstanciasMatricula,
  reemplazarVariablesConstancia,
  sendConstanciaEmail,
  signedUrlConstancia,
  uploadConstanciaPdf,
  type ConstanciaRow,
  type DatosConstanciaAlumno,
} from '@/services/api/constancias';
import {
  ConstanciaPremium,
  CONST_H,
  CONST_W,
  type ConstanciaDatosRender,
  type EsquemaConstancia,
} from './ConstanciaPremium';
import { renderConstanciaPdfBlob } from '../lib/generateConstanciaPdf';

// ============================================================================
// Constancia de inscripción · modal por alumno (chunk CONST · a demanda).
// Flujo facilitado (decisión Pablo): botón → plantillas disponibles → preview A4
// con las variables reemplazadas → retoque de texto/destinatario → Descargar
// y/o Enviar por email (default al alumno; se puede sumar otro destinatario).
// La emisión registra historial (tabla constancias) y guarda el PDF en storage.
// ============================================================================

function rowToEsquemaConstancia(r: CertificadoEsquemaRow): EsquemaConstancia {
  return {
    color_acento: r.color_acento,
    color_dorado: r.color_dorado,
    visible_marca_logo: r.visible_marca_logo,
    marca_logo_url: r.marca_logo_url,
    visible_firma_1: r.visible_firma_1,
    firma_1_img_url: r.firma_1_img_url,
    firma_1_nombre: r.firma_1_nombre,
    firma_1_cargo: r.firma_1_cargo,
    visible_firma_2: r.visible_firma_2,
    firma_2_img_url: r.firma_2_img_url,
    firma_2_nombre: r.firma_2_nombre,
    firma_2_cargo: r.firma_2_cargo,
    visible_watermark: r.visible_watermark,
    watermark_url: r.watermark_url,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ConstanciaModal({
  open,
  onClose,
  matriculaId,
  alumnoNombre,
}: {
  open: boolean;
  onClose: () => void;
  matriculaId: string;
  alumnoNombre: string;
}) {
  const [plantillas, setPlantillas] = useState<CertificadoEsquemaRow[]>([]);
  const [datos, setDatos] = useState<DatosConstanciaAlumno | null>(null);
  const [historial, setHistorial] = useState<ConstanciaRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [esquemaId, setEsquemaId] = useState<string>('');
  const [texto, setTexto] = useState('');
  const [destinatario, setDestinatario] = useState('');
  const [enviarAlAlumno, setEnviarAlAlumno] = useState(true);
  const [extraEmail, setExtraEmail] = useState('');

  // Emisión memoizada. Separamos la EMISIÓN (fila en BD, capturada apenas la RPC
  // responde) del BLOB (PDF renderizado): así, si el render/upload falla, un
  // reintento del MISMO contenido reusa la emisión en vez de crear una fila
  // fantasma nueva (§6). Un retoque de texto/destinatario/plantilla invalida ambos.
  const [emision, setEmision] = useState<{ id: string; codigo: string } | null>(null);
  const [emitida, setEmitida] = useState<{ id: string; codigo: string; blob: Blob } | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  function invalidarEmision() {
    setEmision(null);
    setEmitida(null);
  }

  async function refreshHistorial() {
    const hi = await listConstanciasMatricula(matriculaId);
    if (hi.ok) setHistorial(hi.data);
  }

  const plantilla = useMemo(
    () => plantillas.find((p) => p.id === esquemaId) ?? null,
    [plantillas, esquemaId],
  );

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invalidarEmision();
    setEnviarAlAlumno(true);
    setExtraEmail('');
    void (async () => {
      const [pl, dt, hi] = await Promise.all([
        listarEsquemas('constancia'),
        getDatosConstancia(matriculaId),
        listConstanciasMatricula(matriculaId),
      ]);
      if (!pl.ok || pl.data.length === 0) {
        toast.error(
          pl.ok
            ? 'No hay plantillas de constancia. Creá una en Campus → Plantillas de constancia.'
            : humanizeError(pl.error),
        );
        setLoading(false);
        onClose();
        return;
      }
      if (!dt.ok) {
        toast.error(humanizeError(dt.error));
        setLoading(false);
        onClose();
        return;
      }
      setPlantillas(pl.data);
      setDatos(dt.data);
      setHistorial(hi.ok ? hi.data : []);
      const def = pl.data.find((p) => p.es_default) ?? pl.data[0]!;
      setEsquemaId(def.id);
      setTexto(reemplazarVariablesConstancia(def.texto_cuerpo ?? '', dt.data));
      setDestinatario(def.destinatario_bloque ?? '');
      setLoading(false);
      if (!dt.data.dni || !dt.data.apellido) {
        toast.warning('El alumno no tiene DNI y/o apellido cargados en su administración — revisá el texto antes de emitir.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matriculaId]);

  // Cambio de plantilla → re-armar texto/destinatario desde su template.
  function onCambiarPlantilla(id: string) {
    setEsquemaId(id);
    const p = plantillas.find((x) => x.id === id);
    if (p && datos) {
      setTexto(reemplazarVariablesConstancia(p.texto_cuerpo ?? '', datos));
      setDestinatario(p.destinatario_bloque ?? '');
    }
    invalidarEmision();
  }

  const esquemaRender = useMemo(
    () => (plantilla ? rowToEsquemaConstancia(plantilla) : undefined),
    [plantilla],
  );

  const datosRender: ConstanciaDatosRender = useMemo(
    () => ({
      codigo: emitida?.codigo ?? 'CONST-PREVIEW',
      lugar: plantilla?.lugar || 'Buenos Aires',
      fecha_larga: fechaLargaEs(),
      destinatario: destinatario.trim() || null,
      texto,
    }),
    [emitida, plantilla, destinatario, texto],
  );

  /** Emite (si hace falta), renderiza el PDF, lo sube y registra. Reusable. */
  async function ensureEmitida(): Promise<{ id: string; codigo: string; blob: Blob } | null> {
    if (emitida) return emitida;
    if (!plantilla || !datos) return null;
    if (!texto.trim()) {
      toast.error('El texto de la constancia no puede estar vacío.');
      return null;
    }
    // 1) Emitir SÓLO una vez: si un intento previo ya creó la fila en BD pero el
    //    render/upload falló, reusamos esa emisión en lugar de crear otra con
    //    código nuevo (§6 · evita constancias fantasma en el historial).
    let em = emision;
    if (!em) {
      const res = await emitirConstancia({
        matriculaId,
        esquemaId: plantilla.id,
        textoFinal: texto.trim(),
        destinatarioFinal: destinatario.trim() || null,
      });
      if (!res.ok) {
        toast.error(`No pudimos emitir la constancia: ${humanizeError(res.error)}`);
        return null;
      }
      em = { id: res.data.id, codigo: res.data.codigo };
      setEmision(em);
      void refreshHistorial();
    }
    // 2) Render + upload sobre la MISMA emisión (idempotente en reintentos).
    const blob = await renderConstanciaPdfBlob(
      { ...datosRender, codigo: em.codigo },
      esquemaRender,
    );
    // Guardar el PDF para historial/re-descarga y para el adjunto del email.
    const up = await uploadConstanciaPdf(em.id, em.codigo, blob);
    if (up.ok) {
      await constanciaRegistrarPdf(em.id, up.data);
    } else {
      toast.warning(
        'El PDF se generó y podés descargarlo, pero no se pudo guardar en el archivo — el envío por email y la re-descarga desde el historial pueden fallar. Reintentá si los necesitás.',
      );
    }
    const done = { id: em.id, codigo: em.codigo, blob };
    setEmitida(done);
    void refreshHistorial();
    return done;
  }

  async function onDescargar() {
    setDescargando(true);
    try {
      const em = await ensureEmitida();
      if (!em) return;
      const url = URL.createObjectURL(em.blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `constancia-${em.codigo}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      toast.success(`Constancia ${em.codigo} descargada`);
    } catch (e) {
      toast.error(humanizeError(e as { message?: string }));
    } finally {
      setDescargando(false);
    }
  }

  async function onEnviar() {
    const extra = extraEmail.trim();
    if (!enviarAlAlumno && !extra) {
      toast.error('Elegí al menos un destinatario.');
      return;
    }
    if (extra && !EMAIL_RE.test(extra)) {
      toast.error('El email adicional no es válido.');
      return;
    }
    setEnviando(true);
    try {
      const em = await ensureEmitida();
      if (!em) return;
      const res = await sendConstanciaEmail(em.id, {
        enviarAlAlumno,
        extraEmail: extra || null,
      });
      if (!res.ok) {
        toast.error(`No pudimos enviar la constancia: ${humanizeError(res.error)}`);
        return;
      }
      toast.success(`Constancia enviada a ${res.data.to.join(', ')}`);
      void refreshHistorial();
    } catch (e) {
      toast.error(humanizeError(e as { message?: string }));
    } finally {
      setEnviando(false);
    }
  }

  async function onDescargarHistorial(c: ConstanciaRow) {
    if (!c.pdf_storage_path) return;
    const r = await signedUrlConstancia(c.pdf_storage_path);
    if (!r.ok) {
      toast.error(humanizeError(r.error));
      return;
    }
    window.open(r.data, '_blank', 'noopener');
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={1060}
      kicker="Constancia de inscripción"
      title={alumnoNombre}
      description="Elegí la plantilla, retocá el texto si hace falta y descargala o enviala por email."
      icon={<FileBadge size={20} />}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={descargando || enviando}>
            Cerrar
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onDescargar()}
            disabled={loading || descargando || enviando}
          >
            {descargando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Descargar PDF
          </Button>
          <Button
            variant="primary"
            onClick={() => void onEnviar()}
            disabled={loading || descargando || enviando}
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar por email
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="grid h-64 place-items-center">
          <Loader2 size={22} className="animate-spin text-brand-muted" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Columna izquierda: plantilla + retoque + envío + historial */}
          <div className="space-y-4">
            <label className="block">
              <span className="kicker mb-1 block text-brand-muted">Plantilla</span>
              <select
                value={esquemaId}
                onChange={(e) => onCambiarPlantilla(e.target.value)}
                className="input-field w-full"
              >
                {plantillas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                    {p.es_default ? ' · predeterminada' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="kicker mb-1 block text-brand-muted">
                Destinatario impreso (editable)
              </span>
              <textarea
                rows={5}
                value={destinatario}
                onChange={(e) => {
                  setDestinatario(e.target.value);
                  invalidarEmision();
                }}
                className="input-field font-medium w-full"
              />
            </label>

            <label className="block">
              <span className="kicker mb-1 block text-brand-muted">
                Texto de esta constancia (variables ya reemplazadas · **texto** = negrita)
              </span>
              <textarea
                rows={9}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  invalidarEmision();
                }}
                className="input-field w-full"
              />
            </label>

            {/* Envío por email */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <p className="kicker mb-2 flex items-center gap-1.5 text-brand-muted">
                <Mail size={12} /> Envío por email
              </p>
              <label className="flex items-center gap-2 text-sm text-brand-ink">
                <input
                  type="checkbox"
                  checked={enviarAlAlumno}
                  onChange={(e) => setEnviarAlAlumno(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan"
                />
                Al alumno
                {datos?.email_contacto ? (
                  <span className="text-xs text-brand-muted">({datos.email_contacto})</span>
                ) : (
                  <span className="text-xs text-brand-muted">(email de su cuenta)</span>
                )}
              </label>
              <input
                type="email"
                value={extraEmail}
                onChange={(e) => setExtraEmail(e.target.value)}
                placeholder="Otro destinatario (opcional) — ej: el RPAC"
                className="input-field mt-2 w-full"
              />
            </div>

            {/* Historial */}
            {historial.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="kicker mb-2 text-brand-muted">
                  Constancias emitidas ({historial.length})
                </p>
                <ul className="space-y-1.5">
                  {historial.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-zebra/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="font-mono text-brand-muted">{c.codigo}</span>
                      <span className="text-brand-muted">
                        {new Date(c.created_at).toLocaleDateString('es-AR')}
                        {c.enviado_a ? ` · enviada a ${c.enviado_a}` : ''}
                      </span>
                      {c.pdf_storage_path && (
                        <button
                          type="button"
                          onClick={() => void onDescargarHistorial(c)}
                          className="inline-flex items-center gap-1 font-semibold text-brand-cyan hover:underline"
                        >
                          <Download size={11} /> Descargar
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Columna derecha: preview A4 en vivo */}
          <div className="rounded-xl bg-slate-100 p-3">
            <ConstanciaPreviewBox datos={datosRender} esquema={esquemaRender} />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function ConstanciaPreviewBox({
  datos,
  esquema,
}: {
  datos: ConstanciaDatosRender;
  esquema?: EsquemaConstancia;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      setScale(Math.min(1, w / CONST_W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="mx-auto w-full">
      <div
        style={{ width: CONST_W * scale, height: CONST_H * scale }}
        className="mx-auto shadow-xl ring-1 ring-black/10"
      >
        <div
          style={{
            width: CONST_W,
            height: CONST_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <ConstanciaPremium datos={datos} esquema={esquema} />
        </div>
      </div>
    </div>
  );
}
