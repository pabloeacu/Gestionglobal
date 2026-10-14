# PEDIDOS_PABLO.md — Tracker vivo de consignas

> **Método para no perder el hilo (acordado 2026-10-14).** Cada pedido de Pablo
> entra acá con estado + **verificación OBSERVABLE** (no un status interno). Lo
> actualizo CADA turno y lo reconcilio antes de cerrar cualquier bloque de trabajo.
>
> **Regla de cierre observable:** nada se marca ✅ HECHO sin una prueba end-to-end
> que yo pueda *mostrar* (una captura, un dato verificado, una confirmación de que
> LLEGÓ al destinatario). "El sistema dice 'enviado'" NO alcanza — lo que importa
> es que Pablo lo reciba/vea.
>
> Estados: 🟢 hecho+verificado · 🟡 en curso · 🔵 pendiente · ⚠️ bloqueado/necesita a Pablo

## Abiertos / recientes

| # | Pedido | Estado | Verificación observable |
|---|--------|--------|--------------------------|
| P1 | Mail con el reporte de cómo quedó la nutrición de captación (¿manual? ¿automático? ¿depende de compu/Claude?) | 🟡 | Mail reenviado 2026-10-14 + **contenido dado en el chat** (garantizado). FALLA previa: dije "enviado" sin confirmar que te llegara; quedó enterrado entre 28+ notifs/día. Pendiente: que confirmes recepción / mejorar entregabilidad. |
| P2 | Mail de seguridad de Supabase: ¿qué es? ¿acción? | 🟢 | Advisors en vivo: 0 tablas public sin RLS (crítico del 11-Oct ya resuelto). WARN `prospecto_segmento` corregido. Commit `00d77ab` pusheado. |
| P3 | DGG-220 captación: activar motor en vivo (50/día, server-side) | 🟢 | Motor ENVIANDO (panel en vivo); 2º envío real "Laura…" salió con saludo correcto; crons activos. |
| P4 | Saludo por nombre de pila (no apellido) — E-GG-225 | 🟢 | 0 regresiones / 2530 filas; §6 3 agentes; deploy Vercel READY. |
| P5 | DGG-222 Agente de cierre de trámites (4 fases, autónomo, con IA) | 🟡 | **F1** (detección+reporte seco) 🟢 pusheado `3c4a06e`. **F2** (cierre real) 🟢 **GO-LIVE**: §6 3 agentes (A cazó+corrigió 1 crítico), 5 trámites cerrados reales + clientes avisados, verificado en vivo (TRM-00074 CERRADO), pusheado `d31ccb7`. **F4-cron** (correr diario 10am) → en curso. **Cursos + jurídica** (tracks) 🔵. **Dashboard/comando UI** 🔵. **F3** (IA, requiere decisión de infra con Pablo) 🔵. |
| P6 | Metodología para no perder el hilo + trabajar en equipo | 🟢 | Este archivo (tracker vivo) + regla de cierre observable. Integrado al mail de P1. |

## Autorizaciones permanentes de Pablo (para operar autónomo)
- Avanzar fase a fase SIN esperar confirmaciones, salvo que sean **imprescindibles**, siempre que **todas las auditorías §6 pasen**.
- Compu encendida toda la noche para que siga trabajando. No detenerse.
- Go-live (activar fases que cierran trámites reales / escriben a clientes) es parte de lo autorizado, con §6 + prueba en vivo como garantía (no requiere confirmación manual salvo algo imprescindible).

## Deuda / a mejorar
- **Entregabilidad de reportes a Pablo:** su casilla recibe 28+ notifs de gerencia/día → los reportes se entierran. Propuesta: canal de bajo volumen o surfacearlos también en el chat por defecto. (Pendiente de decidir con Pablo.)
