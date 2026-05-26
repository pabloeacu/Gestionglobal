// EmailManaxerPreview · render del layout MANAXER en iframe sandboxed.
// Replica EXACTA del renderer del edge function `dispatch-emails/index.ts`
// (función `buildManaxerHtml`). Si modificás uno, sincronizá el otro.

import { useMemo } from 'react';

const DOMAIN = 'gestionglobal.ar';
const LOGO_URL = `https://www.${DOMAIN}/logo-color.png`;

export interface ManaxerTemplateData {
  kicker: string;
  titulo_visual: string;
  color_acento: string;
  mostrar_logo: boolean;
  cuerpo_html_visual: string;
  firma: string | null;
  incluir_tabla_envio: boolean;
  cta_text: string | null;
  cta_url: string | null;
}

interface Props {
  template: ManaxerTemplateData;
  variables: Record<string, unknown>;
  fromEmail: string;
  replyToEmail: string;
  /** Ancho del iframe. Default 640 (desktop email-grade). */
  width?: number;
  /** Alto mínimo. Default 480. */
  minHeight?: number;
}

export function EmailManaxerPreview({
  template,
  variables,
  fromEmail,
  replyToEmail,
  width = 640,
  minHeight = 480,
}: Props) {
  const srcDoc = useMemo(
    () => buildManaxerHtml(template, variables, fromEmail, replyToEmail),
    [template, variables, fromEmail, replyToEmail],
  );

  return (
    <iframe
      title="email-preview"
      sandbox=""
      srcDoc={srcDoc}
      className="w-full rounded-2xl bg-white shadow-md ring-1 ring-slate-200"
      style={{ minHeight, width: '100%', maxWidth: width, border: 0 }}
    />
  );
}

// ---------------------------------------------------------------------
// Renderer (espejo del edge function — mantener sincronizado)
// ---------------------------------------------------------------------

export function buildManaxerHtml(
  tpl: ManaxerTemplateData,
  vars: Record<string, unknown>,
  fromEmail: string,
  replyToEmail: string,
): string {
  const accent = sanitizeHex(tpl.color_acento) ?? '#0891b2';
  const kicker = renderVars(tpl.kicker, vars);
  const titulo = renderVars(tpl.titulo_visual, vars);
  const cuerpo = renderVars(tpl.cuerpo_html_visual, vars);
  const firma = tpl.firma ? renderVars(tpl.firma, vars) : null;
  const ctaText = tpl.cta_text ? renderVars(tpl.cta_text, vars) : null;
  const ctaUrl = tpl.cta_url ? renderVars(tpl.cta_url, vars) : null;
  const hasCta = !!(ctaText && ctaUrl);

  const logoBlock = tpl.mostrar_logo
    ? `<tr><td align="center" style="padding:32px 24px 12px 24px;">
        <img src="${LOGO_URL}" alt="Gestión Global"
             style="display:block;max-width:220px;height:auto;margin:0 auto;" />
      </td></tr>`
    : '';

  const kickerBlock = kicker
    ? `<tr><td style="padding:24px 32px 4px 32px;">
        <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${accent};">${escapeAttr(kicker)}</p>
      </td></tr>`
    : '';

  const tituloBlock = titulo
    ? `<tr><td style="padding:0 32px 8px 32px;">
        <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:28px;line-height:1.18;font-weight:800;color:#0f172a;">${escapeAttr(titulo)}</h1>
      </td></tr>`
    : '';

  const separator = `<tr><td style="padding:16px 32px 0 32px;">
      <hr style="border:0;border-top:1px solid #e2e8f0;margin:0;" />
    </td></tr>`;

  const cuerpoBlock = `<tr><td style="padding:20px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.65;color:#1e293b;">${cuerpo}</td></tr>`;

  const ctaBlock = hasCta
    ? `<tr><td style="padding:8px 32px 24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="border-radius:10px;background-color:${accent};">
            <a href="${escapeAttr(ctaUrl!)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:12px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${escapeAttr(ctaText!)}
            </a>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  const firmaBlock = firma
    ? `<tr><td style="padding:12px 32px 28px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#64748b;">${escapeAttr(firma)}</td></tr>`
    : '';

  const tablaEnvio = tpl.incluir_tabla_envio
    ? `<tr><td style="padding:0 32px 16px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="border-collapse:collapse;background:#f8fafc;border-radius:10px;">
          <tr>
            <td style="padding:10px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#475569;">
              <strong style="color:#0f172a;">FROM</strong> ${escapeAttr(fromEmail)} ·
              <strong style="color:#0f172a;">REPLY-TO</strong> ${escapeAttr(replyToEmail)}
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  const footerBlock = `<tr><td style="padding:18px 32px 28px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;border-radius:0 0 16px 16px;">
      <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">
        Enviado por <strong style="color:#475569;">Gestión Global</strong> · <a href="https://www.${DOMAIN}" style="color:${accent};text-decoration:none;">${DOMAIN}</a>
      </p>
    </td></tr>`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeAttr(titulo || 'Gestión Global')}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(15,23,42,0.06);overflow:hidden;">
      ${logoBlock}
      ${kickerBlock}
      ${tituloBlock}
      ${separator}
      ${cuerpoBlock}
      ${ctaBlock}
      ${firmaBlock}
      ${tablaEnvio}
      ${footerBlock}
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeHex(s: string | null | undefined): string | null {
  if (!s) return null;
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : null;
}

function renderVars(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    if (v === null || v === undefined) return '';
    return escapeHtmlIfNeeded(String(v));
  });
}

function escapeHtmlIfNeeded(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
