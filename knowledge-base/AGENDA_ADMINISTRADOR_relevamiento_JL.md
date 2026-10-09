# Análisis — "Agenda del Administrador" (Pestaña 2 del relevamiento de JL)

> **Fecha:** 2026-10-08 · **Estado:** análisis para decisión de Pablo (NADA implementado aún).
> **Origen:** doc "Sistema Gestión Global" de JL, "Pestaña 2" — una propuesta
> arquitectónica de 23 secciones para un motor regulatorio-comercial genérico
> ("Agenda del Administrador"): perfil regulatorio progresivo con nivel de certeza,
> ciclo de vida de oportunidades, motor de fechas con anclas/recálculo, cadencias
> de comunicación por servicio (banner/email/push), flujos de descarte, orquestador
> que agrupa y prioriza, y un motor de reglas genérico para sumar servicios futuros.

## Veredicto en una línea

**~70-75% de lo que propone JL YA está construido y vivo en producción** (linaje
de decisiones DGG-45 / 142 / 145 / 197 / 198 / 199 / 202). El núcleo —perfil
regulatorio con niveles de certeza + motor de fechas con anclas/recálculo + motor
de ofrecimientos multicanal con cadencias— existe, está auditado e instrumentado.
**La diferencia principal no es que falte construir: es que el motor de ofrecimientos
está deliberadamente EN PAUSA (modo sombra, DGG-199), esperando que Pablo filtre el
negocio antes de encenderlo.** Lo genuinamente nuevo son 4 piezas acotadas.

## Qué YA existe (y cubre a JL casi punto por punto)

| Componente de la visión de JL | Dónde vive hoy |
|---|---|
| **Perfil regulatorio del administrador** | tabla `perfil_regulatorio` (datos declarados) + columnas confirmadas en `administraciones` (matrícula/fecha/vencimiento/legajo). RPC `perfil_regulatorio_get` consolida todo. |
| **Nivel de certeza por dato (Confirmado/Declarado/Inferido/Desconocido)** | enum `certeza_dato` con **los mismos 4 niveles**; se calcula server-side por cada dato. **Match exacto con JL.** |
| **Motor de fechas con anclas y recálculo** | `perfil_regulatorio_get`: renovación = última/matrícula +12m; curso +12m; DDJJ anual; certificado +90d. Anclas confirmadas pisan a inferidas. |
| **Tabla de vencimientos (calculada, no rígida) + pausa por fila** | `vencimientos` + `vencimientos_config` (offsets de alarma), RPCs `gg_vencimientos_planificar_alertas`, `vencimiento_pausar/reanudar`. Cron `dispatch-vencimientos` activo. |
| **Motor de ofrecimientos multicanal (email+push+banner) con cadencias, cap diario, gracia, opt-out** | `gg_ofrecimientos_diario()` + `gg_ofrecimiento_elegible()`. Reglas: matriculación, ddjj, curso, renovación, certificado_90, consultoría_120, capacitación, caba. **Escrito, probado en sombra, vivo — sólo falta encenderlo.** |
| **Los 3 canales** | push VAPID (`notif_emitir` + cron), email (`email_queue` + cron + throttle 5min), banner in-app (dashboard del portal). |
| **"Mi situación profesional" + declarar datos** | `/portal/mi-ficha` (`PortalFichaRegulatoriaPage`): el cliente ve y **declara** matrícula/fechas; RPC `perfil_regulatorio_declarar` con niveles de certeza. |
| **Tarjetas con CTA + secundarias (Ya lo hice / Recordar / No corresponde)** | el "tridente" ya existe en la ficha (`HechoConfirmCard`): `declarar` (ya lo hice), `snooze`/`posponer` (recordar), `setOptOut` → `no_requiere` (no corresponde). |

## Qué está PARCIAL o FALTA (lo genuinamente nuevo de JL)

1. **Máquina de estados de oportunidad explícita.** JL propone 11 estados
   (NO_APLICA→POTENCIAL→INFERIDO→PROXIMO→URGENTE→SOLICITADO→EN_TRAMITE→COMPLETADO→
   REALIZADO_EXTERNAMENTE→DESCARTADO→POSPUESTO). Hoy esos estados **existen pero
   derivados y repartidos** en 4 tablas (`perfil_regulatorio.no_requiere`, preview de
   elegibilidad, `tramites.estado`, `cliente_oportunidad_eventos.snoozed_until`). No
   hay una entidad "oportunidad" unificada con `status` y transiciones.
2. **Orquestador que AGRUPA y prioriza (digest).** Hoy el motor hace 1 toque/día
   con una cadena de prioridad, pero **no agrupa** varios avisos en un email único
   ("Tenés 3 temas para revisar"), y vencimientos y ofrecimientos corren por pipelines
   separados. JL pide jerarquía legal > requisito > renovación > oportunidad + digest.
3. **Motivos de descarte tipados + snooze configurable 3-6 meses.** Hoy el opt-out
   es binario (`no_requiere`) y el snooze es fijo 30 días. JL quiere distinguir
   "ya lo hice" vs "no me interesa" como razones tipadas, y ofrecer recordar en 3/6 meses.
4. **Cadencia nominal T-90…T+7 por servicio, incluyendo toque POST-vencimiento.**
   Hoy las "cadencias" existen como ventanas de elegibilidad / cooldowns y offsets de
   alarma, **todos pre-vencimiento**. No hay secuencia nominal escalonada ni toque T+7.

### Discrepancias menores a confirmar
- **DDJJ: JL dice "30 de marzo"; implementado "31 de marzo".** Afecta a los vencimientos
  DDJJ y al motor. Es dato legal — **confirmar la fecha correcta antes de tocar** (no lo
  cambié unilateralmente).
- **Consultoría jurídica cada 180 días:** hoy el motor no infiere una próxima consultoría;
  sólo usa un cooldown de 120 días. JL propone 180d como criterio de exposición.

## El motor está EN PAUSA a propósito (no es un bug)

- El cron agendado ejecuta **sólo la variante sombra**: `gg-ofrecimientos-sombra` corre
  `gg_ofrecimientos_diario_sombra()`, que escribe en `ofrecimientos_sombra` en lugar de
  enviar. El motor real `gg_ofrecimientos_diario()` **no está agendado en ningún cron**.
- Origen: `0507_motor_modo_sombra.sql` — *"Pablo pidió 'arrancá en modo sombra'… en ~2
  semanas Pablo mira el log y decide el encendido real con datos, sin apuro."*
- Estado: `ofrecimientos_log` = 0 filas (nunca envió nada real); `ofrecimientos_sombra` =
  262 toques simulados. Hay además un segundo interruptor por cliente
  (`administraciones.ofrecimientos_habilitados`).
- Deuda registrada (memoria `project_vencimientos_rpac_reglas`): **"filtrar el motor de
  ofrecimientos antes de reactivarlo"**.

## Recomendación: reactivar + extender, NO reconstruir

Construir el módulo "Agenda" de cero duplicaría `perfil_regulatorio_get`, los helpers
`gg_*` y los 3 canales, y violaría el método aditivo del proyecto. La ruta sensata, en
fases (cada una cerrable con §6 + prueba en vivo):

- **Fase 0 (decisión de negocio, no código):** revisar el reporte sombra
  (`gg_ofrecimientos_sombra_reporte`) y definir el **filtro** pendiente (qué clientes /
  qué reglas se encienden primero). Sin esto no se enciende nada.
- **Fase 1 — encender con cuidado:** agendar el motor real para un subconjunto (o detrás
  del switch `ofrecimientos_habilitados`), observar, ampliar.
- **Fase 2 — digest/orquestador:** agrupar vencimientos + ofrecimientos en un email único
  priorizado (legal > requisito > renovación > oportunidad). Reusa las colas existentes.
- **Fase 3 — descarte tipado + snooze 3/6 meses:** extender `no_requiere`/`posponer` con
  motivo tipado y duración elegible; alimentar el perfil.
- **Fase 4 — máquina de estados de oportunidad:** consolidar los estados derivados en una
  entidad/vista "oportunidad" con status explícito (sobre lo existente, no en paralelo).
- **Fase 5 — "Agenda" como superficie única en el portal:** una vista `/portal/agenda`
  que confluya vencimientos + requisitos + oportunidades + "completar info" (hoy repartido
  entre `/portal` y `/portal/mi-ficha`).

## Decisiones que necesito de Pablo para avanzar

1. **¿Encendemos el motor de ofrecimientos?** ¿Con qué filtro inicial (qué clientes/reglas)?
   Es TU decisión — no lo reactivo a ciegas. Puedo traerte primero el reporte del modo sombra.
2. **DDJJ: ¿30 o 31 de marzo?** (dato legal; afecta vencimientos + motor).
3. **Prioridad de fases:** ¿empezamos por el digest/orquestador (alto impacto, bajo riesgo,
   no necesita encender el motor), o por encender el motor, o por la superficie "Agenda"?
4. **Alcance:** ¿querés que esto sea un **módulo propio "Agenda del Administrador"** como
   sugiere JL, o seguimos sumando sobre `/portal/mi-ficha` + dashboard?

> **Nota de método:** esta parte NO se tocó en el chunk DGG-213/214 porque reactivar el
> motor de ofrecimientos es una decisión de negocio (deuda explícita "filtrar antes de
> reactivar") y construir un módulo de este tamaño a ciegas rompería el método aditivo y
> la premisa de cierre (no se puede live-testear un módulo a medio construir). El plan de
> arriba es el "mejor resolución a lo planteado" para una visión de esta escala.
