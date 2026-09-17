// Íconos de marca (Instagram / Facebook / Youtube) reconstruidos localmente.
//
// lucide-react v1 REMOVIÓ los íconos de marca (política de trademarks): ya no exporta
// `Instagram`, `Facebook`, `Youtube`, etc. Se recrean acá con `createLucideIcon` (API pública
// de lucide v1) usando el SVG-node EXACTO de lucide-react v0.460.0, de modo que:
//   • renderizan idénticos a como se veían antes (mismos paths, mismo wrapper lucide);
//   • conservan TODA la API de props de un ícono lucide (size, className, color, strokeWidth,
//     absoluteStrokeWidth, aria-*, etc.), así son drop-in en los usos existentes;
//   • no agregan ninguna dependencia nueva.
// Ver DGG-188 (upgrade lucide-react v0.460 → v1.46, PR #7).
import { createLucideIcon } from 'lucide-react';

export const Instagram = createLucideIcon('Instagram', [
  ['rect', { width: '20', height: '20', x: '2', y: '2', rx: '5', ry: '5', key: '2e1cvw' }],
  ['path', { d: 'M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z', key: '9exkf1' }],
  ['line', { x1: '17.5', x2: '17.51', y1: '6.5', y2: '6.5', key: 'r4j83e' }],
]);

export const Facebook = createLucideIcon('Facebook', [
  ['path', { d: 'M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z', key: '1jg4f8' }],
]);

export const Youtube = createLucideIcon('Youtube', [
  ['path', {
    d: 'M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17',
    key: '1q2vi4',
  }],
  ['path', { d: 'm10 15 5-3-5-3z', key: '1jp15x' }],
]);
