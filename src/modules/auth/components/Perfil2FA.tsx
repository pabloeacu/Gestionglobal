// ============================================================================
// Perfil2FA · activación opcional de 2FA TOTP (P2-#33)
//
// UI en /gerencia/perfil para que el user active o desactive 2FA.
// Soporta Google Authenticator, 1Password, Authy, Microsoft Authenticator,
// cualquier app TOTP estándar.
//
// Flujo enroll:
//   1. Click "Activar 2FA" → llama enrollTotp() → recibe QR + secret
//   2. Muestra QR + secret + input para código de 6 dígitos
//   3. User escanea con su app, ingresa el código
//   4. verifyEnroll → marca como verified
//
// Si ya tiene factors verified, muestra "2FA activo · desde DD/MM/YYYY"
// con botón "Desactivar".
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Shield,
  Smartphone,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import { Button, Field, Input, Modal, useConfirm } from '@/components/common';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import {
  enrollTotp,
  listFactors,
  unenroll,
  verifyEnroll,
  type MfaFactor,
} from '@/services/api/mfa';

export function Perfil2FA() {
  const confirm = useConfirm();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await listFactors();
    if (r.ok) setFactors(r.data);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const verified = factors.filter((f) => f.status === 'verified');

  async function startEnroll() {
    setEnrolling(true);
    setCode('');
    const r = await enrollTotp('Mi autenticador');
    setEnrolling(false);
    if (!r.ok) {
      toast.error('No pudimos iniciar la activación', { description: r.error.message });
      return;
    }
    setFactorId(r.data.factorId);
    setQrCode(r.data.qrCode);
    setSecret(r.data.secret);
    setEnrollOpen(true);
  }

  async function handleVerify() {
    if (!factorId) return;
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error('Ingresá el código de 6 dígitos');
      return;
    }
    setVerifying(true);
    const r = await verifyEnroll(factorId, code.trim());
    setVerifying(false);
    if (!r.ok) {
      toast.error('Código incorrecto', { description: r.error.message });
      return;
    }
    toast.success('2FA activado · ¡bien hecho!');
    closeEnroll();
    void refresh();
  }

  function closeEnroll() {
    setEnrollOpen(false);
    setQrCode(null);
    setSecret(null);
    setFactorId(null);
    setCode('');
  }

  async function handleDisable(f: MfaFactor) {
    const ok2 = await confirm({
      title: 'Desactivar 2FA',
      message: 'Vas a quedar sin protección extra. Si alguien obtiene tu contraseña, podría ingresar sin necesidad de tu autenticador. ¿Continuar?',
      confirmLabel: 'Desactivar',
      danger: true,
    });
    if (!ok2) return;
    setBusy(f.id);
    const r = await unenroll(f.id);
    setBusy(null);
    if (!r.ok) {
      toast.error('No pudimos desactivar', { description: r.error.message });
      return;
    }
    toast.success('2FA desactivado');
    void refresh();
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Secret copiado');
    } catch {
      toast.error('No pudimos copiar');
    }
  }

  const isActive = verified.length > 0;

  return (
    <>
      <section className="card-premium relative overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="kicker">Seguridad</p>
            <h3 className="mt-1 font-display text-lg font-bold text-brand-ink">
              Doble factor (2FA)
            </h3>
            <p className="mt-1 max-w-xl text-xs text-brand-muted">
              Agregá un segundo paso al ingresar: una app autenticadora
              (Google Authenticator, 1Password, Authy, etc.) generará un
              código de 6 dígitos que vas a tener que poner además de tu
              contraseña.
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
              isActive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-700',
            )}
          >
            {isActive ? <ShieldCheck size={11} /> : <Shield size={11} />}
            {isActive ? 'Activado' : 'Desactivado'}
          </span>
        </div>

        <div className="mt-5">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-brand-muted">
              <Loader2 size={12} className="animate-spin" /> Cargando…
            </p>
          ) : isActive ? (
            <div className="space-y-2">
              {verified.map((f) => (
                <article
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                      <Smartphone size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-ink">
                        {f.friendly_name ?? 'Autenticador TOTP'}
                      </p>
                      <p className="text-[11px] text-brand-muted">
                        Activo
                        {f.created_at &&
                          ` · desde ${new Date(f.created_at).toLocaleDateString('es-AR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => void handleDisable(f)}
                    disabled={busy === f.id}
                  >
                    {busy === f.id ? <Loader2 size={13} className="animate-spin" /> : 'Desactivar'}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <Button onClick={() => void startEnroll()} disabled={enrolling}>
              {enrolling ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ShieldCheck size={14} />
              )}
              Activar 2FA
            </Button>
          )}
        </div>
      </section>

      <Modal
        open={enrollOpen}
        onClose={closeEnroll}
        title="Activar doble factor"
        kicker="Paso 1 de 2 · Escaneá el QR"
        icon={<ShieldCheck size={16} />}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEnroll} disabled={verifying}>
              Cancelar
            </Button>
            <Button onClick={() => void handleVerify()} disabled={verifying || code.length < 6}>
              {verifying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Confirmar
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-brand-muted">
            Abrí tu app autenticadora (Google Authenticator, 1Password, Authy,
            Microsoft Authenticator, etc.) y escaneá este QR:
          </p>
          {qrCode && (
            <div className="grid place-items-center rounded-xl border border-slate-200 bg-white p-4">
              <div
                className="h-48 w-48"
                dangerouslySetInnerHTML={{ __html: qrCode }}
              />
            </div>
          )}
          {secret && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <p className="mb-1 font-medium text-brand-muted">
                ¿No podés escanear el QR? Cargá el secret manualmente:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-brand-ink">
                  {secret}
                </code>
                <button
                  type="button"
                  onClick={() => void copySecret()}
                  className="rounded-md border border-slate-200 bg-white p-1.5 text-brand-muted hover:text-brand-ink"
                  title="Copiar"
                  aria-label="Copiar secret"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>
          )}
          <Field label="Código de 6 dígitos">
            <Input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void handleVerify();
              }}
              className="text-center text-lg font-mono tabular-nums tracking-[0.4em]"
            />
          </Field>
          <p className="text-[10.5px] text-brand-muted">
            Una vez activado, cada vez que ingreses te vamos a pedir el código
            actual de tu app. Si perdés el dispositivo, contactá soporte.
          </p>
        </div>
      </Modal>
    </>
  );
}
