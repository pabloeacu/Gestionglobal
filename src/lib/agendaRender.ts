// agendaRender — utilidades de renderizado mixto (eventos personales +
// proyecciones unificadas). Capitalización Ronda 6 / DGG-06: la Agenda es
// hub temporal y las vistas calendario muestran AMBAS familias in-line.
//
// `ItemCalendario` es un tipo discriminado: el render decide qué dibujar
// según `kind`. Los proyectados son read-only (icono Lock, sin drag, click
// → navegación al módulo origen).

import type { Ocurrencia } from './agendaRecurrencia';
import type { OcurrenciaUnificada, AgendaFuente } from '@/services/api/agenda';

export type ItemCalendario =
  | { kind: 'personal'; ocurrencia: Ocurrencia }
  | { kind: 'proyectada'; proyeccion: OcurrenciaUnificada };

/** Combina ocurrencias personales + proyectadas en una lista ordenada por
 *  startAt ascendente. Los `startAt` nulos (caso defensivo) van al final. */
export function mezclarItems(
  ocurrencias: Ocurrencia[],
  proyectadas: OcurrenciaUnificada[],
): ItemCalendario[] {
  const out: ItemCalendario[] = [
    ...ocurrencias.map((o) => ({ kind: 'personal' as const, ocurrencia: o })),
    ...proyectadas.map((p) => ({ kind: 'proyectada' as const, proyeccion: p })),
  ];
  const startOf = (it: ItemCalendario): string => {
    if (it.kind === 'personal') return it.ocurrencia.startAt ?? '￿';
    return it.proyeccion.startAt ?? '￿';
  };
  out.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return out;
}

/** Mapa día (YYYY-MM-DD) → ítems del día. Para proyecciones, el día se calcula
 *  a partir del `startAt` (que para fuentes "all_day" ya viene anclado al
 *  vencimiento + 9hs · ver mig 0040). */
export function agruparPorDia(
  ocurrencias: Ocurrencia[],
  proyectadas: OcurrenciaUnificada[],
): Map<string, ItemCalendario[]> {
  const map = new Map<string, ItemCalendario[]>();
  for (const o of ocurrencias) {
    if (!o.startAt) continue;
    const k = o.startAt.slice(0, 10);
    const arr = map.get(k) ?? [];
    arr.push({ kind: 'personal', ocurrencia: o });
    map.set(k, arr);
  }
  for (const p of proyectadas) {
    if (!p.startAt) continue;
    const k = p.startAt.slice(0, 10);
    const arr = map.get(k) ?? [];
    arr.push({ kind: 'proyectada', proyeccion: p });
    map.set(k, arr);
  }
  // Orden interno por hora (los all_day van primero porque su hora canónica
  // es "9hs" mientras los timed pueden ser cualquier hora — para uniformizar
  // empujamos los all_day siempre arriba).
  for (const [k, arr] of map) {
    arr.sort((a, b) => {
      const aAll = a.kind === 'personal' ? a.ocurrencia.allDay : a.proyeccion.allDay;
      const bAll = b.kind === 'personal' ? b.ocurrencia.allDay : b.proyeccion.allDay;
      if (aAll !== bAll) return aAll ? -1 : 1;
      const aS = a.kind === 'personal' ? a.ocurrencia.startAt ?? '' : a.proyeccion.startAt;
      const bS = b.kind === 'personal' ? b.ocurrencia.startAt ?? '' : b.proyeccion.startAt;
      return aS.localeCompare(bS);
    });
    map.set(k, arr);
  }
  return map;
}

/** Etiqueta corta para badge de fuente — uppercase en chips. */
export function labelFuente(fuente: AgendaFuente): string {
  switch (fuente) {
    case 'personal':
      return 'Personal';
    case 'vencimiento':
      return 'Vencimiento';
    case 'tramite':
      return 'Trámite';
    case 'comprobante':
      return 'Cobranza';
    case 'solicitud':
      return 'Solicitud';
    default:
      return 'Otro';
  }
}
