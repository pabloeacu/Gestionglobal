#!/usr/bin/env node
// marketing/guia-bienvenida/render.mjs
//
// Renderiza guia.html -> Guia-Bienvenida-GestionGlobal.pdf (A4, 6 páginas)
// con Puppeteer (mismo motor que scripts/generate-manual-pdf.mjs).
//
// Uso:   node marketing/guia-bienvenida/render.mjs
// Salida: marketing/guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf
//
// Para publicar: subir el PDF resultante al MISMO path del bucket privado
// `email-assets` en Supabase Storage con upsert:
//   email-assets/guia-bienvenida/Guia-Bienvenida-GestionGlobal.pdf
// (los 3 edges de bienvenida ya apuntan a ese path; cero código, cero deploy).
// Ver marketing/guia-bienvenida/README.md.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// puppeteer vive en el node_modules del repo:
const require = createRequire(path.resolve(__dirname, '../../package.json'));
const puppeteer = require('puppeteer');

const HTML = 'file://' + path.join(__dirname, 'guia.html');
const OUT = path.join(__dirname, 'Guia-Bienvenida-GestionGlobal.pdf');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
await page.goto(HTML, { waitUntil: 'networkidle0' });
await page.evaluateHandle('document.fonts.ready');
await new Promise((r) => setTimeout(r, 400));
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
await browser.close();
console.log('PDF OK ->', OUT);
