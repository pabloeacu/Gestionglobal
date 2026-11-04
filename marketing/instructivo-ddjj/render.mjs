#!/usr/bin/env node
// marketing/instructivo-ddjj/render.mjs
//
// Renderiza instructivo.html -> Instructivo-DDJJ-RPAC-GestionGlobal.pdf (A4)
// con Puppeteer (mismo motor que scripts/generate-manual-pdf.mjs y la guía).
//
// Uso:   node marketing/instructivo-ddjj/render.mjs
// Salida: marketing/instructivo-ddjj/Instructivo-DDJJ-RPAC-GestionGlobal.pdf
//
// Para publicar (reemplazar sin deploy): subir el PDF al bucket PÚBLICO
// `formulario-descargas` con upsert en el MISMO path:
//   formulario-descargas/ddjj/instructivo-ddjj-rpac.pdf
// La sección DDJJ del portal apunta a su URL pública (cero código, cero deploy).

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(__dirname, '../../package.json'));
const puppeteer = require('puppeteer');

const HTML = 'file://' + path.join(__dirname, 'instructivo.html');
const OUT = path.join(__dirname, 'Instructivo-DDJJ-RPAC-GestionGlobal.pdf');

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
});
await browser.close();
console.log('OK ->', OUT);
