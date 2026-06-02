import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/lib/toast';
import { Mail, Send, X, Paperclip, Loader2 } from 'lucide-react';
import { Modal, Button, Field, Input, Textarea } from '@/components/common';
import { TrianglesAccent } from '@/components/brand/TrianglesAccent';
import { useAuth } from '@/contexts/AuthContext';
import {
  sendComprobanteEmail,
  listAdminEmailsParaFacturacion,
  type AdministracionEmailRow,
} from '@/services/api/sendComprobante';
import {
  generateComprobantePdf,
  pdfToBase64,
} from '../lib/generateComprobantePdf';
import type {
  ComprobanteRow,
  ComprobanteItemRow,
} from '@/services/api/comprobantes';
import { humanizeError } from '@/lib/errors';

interface EnviarComprobanteModalProps {
  open: boolean;
  onClose: () => void;
  comprobante: ComprobanteRow;
  items: ComprobanteItemRow[];
  onSent?: () => void;
}

export function EnviarComprobanteModal({
  open,
  onClose,
  comprobante,
  items,
  onSent,
}: EnviarComprobanteModalProps) {
  const { user } = useAuth();
  const [destinatarios, setDestinatarios] = useState<string[]>([]);
  const [inputDestino, setInputDestino] = useState('');
  const [sugeridos, setSugeridos] = useState<AdministracionEmailRow[]>([]);
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [adjuntarPdf, setAdjuntarPdf] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const numStr = useMemo(
    () =>
      comprobante.numero
        ? `${String(comprobante.punto_venta).padStart(5, '0')}-${String(comprobante.numero).padStart(8, '0')}`
        : 'SIN NÚMERO',
    [comprobante],
  );

  useEffect(() => {
    if (!open) return;
    setSubject(`Comprobante ${comprobante.tipo} ${numStr} · Gestión Global`);
    setMensaje('');
    setInputDestino('');
    setDestinatarios([]);
    setCc('');
    setAdjuntarPdf(true);

    void (async () => {
      const res = await listAdminEmailsParaFacturacion(comprobante.administracion_id);
      if (res.ok) {
        setSugeridos(res.data);
        // Preseleccionar el principal o todos si no hay uno principal
        const principal = res.data.find((r) => r.es_principal);
        if (principal) setDestinatarios([principal.email]);
        else if (res.data.length === 1) setDestinatarios([res.data[0]!.email]);
      } else {
        setSugeridos([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, comprobante.id]);

  function toggleDestino(email: string) {
    setDestinatarios((arr) =>
      arr.includes(email) ? arr.filter((e) => e !== email) : [...arr, email],
    );
  }

  function agregarManual() {
    const v = inputDestino.trim();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast.error('Email inválido');
      return;
    }
    if (destinatarios.includes(v)) {
      toast.info('Ya está en la lista');
      return;
    }
    setDestinatarios((arr) => [...arr, v]);
    setInputDestino('');
  }

  async function onEnviar() {
    if (destinatarios.length === 0) {
      toast.error('Agregá al menos un destinatario');
      return;
    }
    setEnviando(true);

    let pdf_base64: string | undefined;
    let pdf_filename: string | undefined;
    if (adjuntarPdf) {
      try {
        const doc = await generateComprobantePdf({ comprobante, items });
        pdf_base64 = pdfToBase64(doc);
        pdf_filename = `comprobante-${numStr}.pdf`;
      } catch (e) {
        setEnviando(false);
        toast.error('No pudimos generar el PDF', {
          description: (e as Error).message,
        });
        return;
      }
    }

    const ccList = cc
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const res = await sendComprobanteEmail({
      comprobante_id: comprobante.id,
      to: destinatarios,
      cc: ccList.length > 0 ? ccList : undefined,
      subject: subject.trim() || undefined,
      pdf_base64,
      pdf_filename,
    });

    setEnviando(false);
    if (!res.ok) {
      toast.error('No pudimos enviar el comprobante', {
        description: humanizeError(res.error),
      });
      return;
    }
    toast.success('Comprobante enviado', {
      description: `${destinatarios.length} destinatario${destinatarios.length === 1 ? '' : 's'}`,
    });
    onSent?.();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div className="relative overflow-hidden">
        <TrianglesAccent
          position="top-right"
          size={160}
          tone="cyan"
          density="soft"
          className="opacity-40"
        />
        <div className="relative px-6 pb-6 pt-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-cyan-pale/50 text-brand-cyan">
              <Mail size={18} />
            </span>
            <div className="min-w-0">
              <p className="kicker text-brand-cyan">Enviar por email</p>
              <h2 className="font-display text-lg font-bold text-brand-ink">
                {comprobante.tipo} {numStr}
              </h2>
              <p className="text-xs text-brand-muted">
                A {comprobante.receptor_razon_social}
              </p>
            </div>
          </div>

          {/* Destinatarios sugeridos */}
          {sugeridos.length > 0 && (
            <div className="mb-4">
              <p className="kicker mb-1.5 text-brand-muted">
                Sugeridos de la administración
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sugeridos.map((s) => {
                  const active = destinatarios.includes(s.email);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleDestino(s.email)}
                      className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        active
                          ? 'border-brand-cyan bg-brand-cyan text-white'
                          : 'border-slate-200 bg-white text-brand-muted hover:border-brand-cyan/60 hover:text-brand-cyan'
                      }`}
                    >
                      {s.email}
                      {s.es_principal && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            active
                              ? 'bg-white/20'
                              : 'bg-brand-cyan-pale/40 text-brand-cyan'
                          }`}
                        >
                          principal
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Input + chips de destinatarios */}
          <Field label="Para" required>
            <div className="space-y-2">
              {destinatarios.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {destinatarios.map((d) => (
                    <span
                      key={d}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-cyan-pale/40 px-2 py-0.5 text-xs font-medium text-brand-cyan"
                    >
                      {d}
                      <button
                        type="button"
                        onClick={() => toggleDestino(d)}
                        className="text-brand-cyan/70 hover:text-brand-cyan"
                        aria-label="Quitar"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={inputDestino}
                  onChange={(e) => setInputDestino(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      agregarManual();
                    }
                  }}
                  placeholder="Otro email…"
                />
                <Button variant="secondary" type="button" onClick={agregarManual}>
                  Agregar
                </Button>
              </div>
            </div>
          </Field>

          <Field label="CC (opcional)" hint="Separá múltiples emails con coma.">
            <Input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder={user?.email ?? ''}
            />
          </Field>

          <Field label="Asunto">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>

          <Field
            label="Mensaje (opcional)"
            hint="Por ahora usamos plantilla por defecto; este campo se ignorará en este push y se agregará en el próximo."
          >
            <Textarea
              rows={3}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Agregá una nota personalizada (próximamente)"
              disabled
            />
          </Field>

          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <input
              type="checkbox"
              checked={adjuntarPdf}
              onChange={(e) => setAdjuntarPdf(e.target.checked)}
              className="h-4 w-4 rounded text-brand-cyan focus:ring-brand-cyan/40"
            />
            <Paperclip size={14} className="text-brand-cyan" />
            <span className="text-sm text-brand-ink">
              Adjuntar PDF del comprobante
            </span>
            <span className="ml-auto text-xs text-brand-muted">
              comprobante-{numStr}.pdf
            </span>
          </label>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={() => void onEnviar()} disabled={enviando}>
              {enviando ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Enviando…
                </>
              ) : (
                <>
                  <Send size={14} /> Enviar
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
