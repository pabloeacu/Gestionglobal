# GG Mail Banners — banners premium para mailings

Generador de **banners de mailing marca-nativos** de Gestión Global. Aprobado por
Pablo (2026-10-11, DGG-219 — *"estos diseños son increíbles, le diste en el clavo"*).
Reusar este molde para banners de marketing y de lifecycle/ofrecimientos.

## Por qué una imagen (y no CSS)

Los clientes de mail (Gmail, Outlook, Apple Mail) **descartan** gradientes,
`backdrop-filter`, glass y 3D. Un banner "premium" hecho con CSS se degrada a un
rectángulo plano. Por eso el banner se **renderiza como PNG** con puppeteer
(Chromium headless, `deviceScaleFactor:2` retina) y en el mail entra como `<img>`.

## Firma visual (no tocar el ADN)

- Fondo degradé **tinta → petróleo → cian** `linear-gradient(116deg,#05172A,#0B1F33,#0C4F64,#13828F)`.
- Glows radiales cian/petróleo/celeste + **motivo triangular** de marca (opacidad 5–10%).
- Título **Oswald MAYÚSCULAS**, una línea en **cian** (degradé de texto `#35C9EE→#009ECA`), barra **chamfer**.
- Eyebrow lockup: `▲ GESTIÓN GLOBAL | <SLOGAN>` (Oswald, celeste el slogan).
- Cluster **glass con profundidad**: calendario frosted (chamfer) + campanita con glow + reloj.
- Tokens de marca: ver skill `gestionglobal-ui` y `CLAUDE.md`. Slogan por defecto: *Aliados de tu tiempo*.

## Uso

```bash
# Banner por defecto (DGG-219): "Mi agenda de VENCIMIENTOS profesionales"
node marketing/email-banners/gg-mail-banner.mjs

# Banner de marketing a medida
node marketing/email-banners/gg-mail-banner.mjs \
  --title "Sumá tu|consorcio|hoy" \
  --accent 1 \
  --eyebrow "Gestión Global|Aliados de tu tiempo" \
  --out public/email/campania-xyz.png \
  --bell ""          # vacío = no generar el ícono campanita
```

`--accent` es el índice (0-based) de la línea del título que va en cian.
`--bell` genera además un ícono campanita glass (fondo transparente) para decorar
cards del cuerpo; dejar `""` si no se necesita.

## Hosting

Las PNG viven en **`public/email/`** → las sirve
`https://www.gestionglobal.ar/email/<nombre>.png` (versionadas, públicas, deploy
automático por Vercel). **Nunca** usar data-URI en el mail enviado (los clientes
lo clipean/bloquean); el base64 inline es solo para previews locales.

## Integración en el template (layout `manaxer-v1`)

El banner es el masthead arriba del `cuerpo_html_visual`:

```html
<img src="https://www.gestionglobal.ar/email/mi-banner.png"
     alt="..." width="576"
     style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" />
```

Mantener `mostrar_logo=true` (logo color → hr → banner). La campanita en el card
va como tabla 2-celdas (ícono 90px | texto) sobre el box destacado `#E7F1F9`.
