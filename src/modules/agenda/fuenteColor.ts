// 3.D · paleta de fuentes proyectadas. Mismos hex que `FUENTES_FILTROS` en
// AgendaPage para que el chip y el borde izquierdo de la proyectada hablen
// el mismo idioma visual (DGG-06 — proyección, no duplicación).
//
// 3.E · usado también por la leyenda colapsable de chips.

import type { AgendaFuente } from '@/services/api/agenda';

export const FUENTE_COLORES: Record<AgendaFuente, string> = {
  personal: '#06b6d4', // cyan
  vencimiento: '#f59e0b', // ambar
  tramite: '#8b5cf6', // violeta
  comprobante: '#ef4444', // rojo
  solicitud: '#06b6d4', // cyan (igual a personal por afinidad)
  tracking_alarma: '#dc2626', // rojo intenso — Bloque A · Fase 2
};

export const FUENTE_LABEL: Record<AgendaFuente, string> = {
  personal: 'Personal',
  vencimiento: 'Vencimientos',
  tramite: 'Trámites',
  comprobante: 'Cobranzas',
  solicitud: 'Solicitudes',
  tracking_alarma: 'Alarmas tracking',
};

export const FUENTE_DESCRIPCION: Record<AgendaFuente, string> = {
  personal: 'Eventos tuyos creados directamente acá. Son editables.',
  vencimiento: 'Vencimientos administrativos proyectados desde el módulo.',
  tramite: 'Trámites y trackings con fecha estimada o próximo paso.',
  comprobante: 'Comprobantes con vencimiento de cobro (factura por cobrar).',
  solicitud: 'Solicitudes recibidas con fecha de seguimiento.',
  tracking_alarma: 'Recordatorios de seguimiento configurados en los avances de tracking.',
};

export function colorDeFuente(f: AgendaFuente): string {
  return FUENTE_COLORES[f] ?? '#06b6d4';
}
