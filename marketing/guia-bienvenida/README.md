# Guía de Bienvenida (PDF adjunto al mail del cliente)

Este es el **source versionado** del PDF que se adjunta al mail de bienvenida
del cliente (el que abre para recorrer la plataforma). Antes vivía sólo en
Storage y su fuente se había perdido — ahora vive acá para poder actualizarlo
sin rehacerlo desde cero.

## Qué hay acá

- `guia.html` — el folleto completo (6 páginas A4), tema **gg-brand**
  (Oswald + Archivo, navy/petróleo/cyan, biselados, motivo triangular).
  Las "capturas" son **mockups gg-brand inline** (no capturas reales → sin
  datos de clientes). Todo self-contained (fuentes/logos/QR por ruta relativa).
- `render.mjs` — renderiza `guia.html` → PDF A4 con Puppeteer.
- `fonts/` — GG Oswald + GG Archivo (woff2, las mismas de la app).
- `logo.png` / `logo-white.png` — logo horizontal con eslogan (claro / blanco).
- `wa-qr.png` — QR de WhatsApp (wa.me/5492214317914), generado con la lib `qrcode`.

## Regenerar el PDF

```bash
node marketing/guia-bienvenida/render.mjs
# -> marketing/guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf
```

## Publicar (reemplaza el vivo — va a TODOS los clientes nuevos)

El PDF vive en Supabase Storage, bucket privado **`email-assets`**, path
**`guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf`**. Los 3 edges de
bienvenida (`alta-cliente-portal`, `reenviar-bienvenida`,
`corregir-email-acceso`) apuntan a ese path y `dispatch-emails` lo baja al
enviar. **Actualizar = re-subir al mismo path con upsert. Cero código, cero deploy.**

Subida (service_role revelable vía Management API; NO imprimir la key):

```bash
SRK=$(curl -s -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
  "https://api.supabase.com/v1/projects/kaoyhkebnidzqjixvchh/api-keys?reveal=true" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((k['api_key'] for k in d if k.get('name')=='service_role'),''))")
curl -s -X POST -H "Authorization: Bearer $SRK" -H "apikey: $SRK" \
  -H "x-upsert: true" -H "Content-Type: application/pdf" \
  --data-binary @marketing/guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf \
  "https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/email-assets/guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf"
```

Verificar: re-descargar y comparar `md5`. Pedir OK antes de subir (es
client-facing). Regenerar el QR: `node -e "require('qrcode').toFile('marketing/guia-bienvenida/wa-qr.png','https://wa.me/5492214317914',{color:{dark:'#0B1F33',light:'#FFFFFF'},margin:1,width:340})"`.

Publicado por primera vez en gg-brand: 2026-08-24.
