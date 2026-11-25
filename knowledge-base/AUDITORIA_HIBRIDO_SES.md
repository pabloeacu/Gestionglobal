# GATE OBLIGATORIO · Auditoría integral del sistema híbrido de correo (Gmail API + Amazon SES)

> **Estándar rector definido por Pablo (2026-11-25).** NO es un prompt a ejecutar al pie de la
> letra: es el **gate obligatorio e ineludible ANTES de cualquier disparo masivo** por SES — por
> ejemplo, mandar el newsletter actual a todo el bloque de mails faltantes y dejar de depender del
> goteo. **No se prende `config_global.bulk_via_ses` ni `federal_campanas_activo` para un envío
> masivo real sin pasar esta auditoría y entregar su evidencia.** Las revisiones son enunciativas y
> **no limitativas**: cada agente amplía el alcance según lo que encuentre.

## Nociones que NO se pueden omitir (resumen operativo del estándar)

1. **Aditivo + fail-closed.** SES no debe alterar jamás lo que ya funciona por Gmail (Workspace).
   Prohibido el traspaso automático de marketing a Workspace o de operativo a SES ante falla/cuota/
   suspensión: cada mensaje se mantiene en SU circuito de error. *(Ya aplicado en `dispatch-emails`:
   con el flag ON y marketing, si faltan credenciales IAM la fila se DIFIERE, no cae a Gmail.)*
2. **Ruteo decidido en backend, no salteable.** Ni la UI, ni una importación, ni un job, ni una
   llamada directa a la API, ni un reintento pueden saltarse la decisión de ruta. La ruta se
   registra por mensaje.
3. **Clasificación por finalidad.** Marketing (captación/campañas/newsletter) → SES subdominio.
   Operativo/soporte/avisos a clientes → Gmail. Un newsletter a un cliente suscripto → SES (decide
   la finalidad del mensaje, no el destinatario). Mensaje ambiguo/mixto/nuevo → revisión previa.
4. **Identidad del remitente + alineación.** Subdominio exacto publicado, DKIM/SPF/DMARC alineados
   leídos del mensaje REAL recibido, MAIL FROM personalizado y su comportamiento ante error de DNS,
   Reply-To y recepción real de respuestas, dominios en remitente/enlaces/tracking.
5. **Bajas y supresión unificadas y efectivas ANTES del despacho.** Baja visible + one-click (RFC
   8058), aplicada en todas las campañas pertinentes; rebotes permanentes/temporales y quejas de
   SES → supresión de la app (vía SNS→webhook→`email_suppression`, **pendiente F4**); contactos que
   reaparecen por import; baja con campaña ya encolada.
6. **Capacidad, colas y resiliencia.** Capacidad teórica vs probada vs ritmo recomendado; idempotencia
   (sin doble envío); **resultado incierto** (SES aceptó pero el worker cayó antes de guardar la
   respuesta) → reconciliación, NO reenvío a ciegas; una cola de marketing saturada no degrada
   Workspace. **La prueba de 10.000 mide capacidad SIN disparar una campaña real.**
7. **Trazabilidad por mensaje/destinatario** con estados diferenciados (en cola / aceptado por
   proveedor / aceptado por servidor receptor / rebote / queja / baja / ubicación observada en
   bandeja de prueba) + id interno ↔ id del proveedor. Eventos duplicados/demorados/fuera de orden
   no deben inflar métricas ni retroceder estados.
8. **Seguridad.** Permisos mínimos AWS (sólo enviar), credenciales por entorno, rotación, sin
   secretos en front/repo/logs; autenticidad e integridad de eventos entrantes; permisos para
   crear/aprobar/reprogramar/cancelar; sin PII en URLs/trazas.
9. **Entregabilidad real** en Gmail/Outlook/otros (cuentas de prueba controladas), con umbrales de
   alerta/pausa y responsables. "Aceptado por el servidor receptor" ≠ "llegó a bandeja".
10. **Operación/alertas/recuperación.** Qué ve el equipo si crece la cola / se agota cuota / suben
    rebotes-quejas / se corta la telemetría / SES restringe; cómo pausar, resolver inciertos,
    reanudar sin duplicados, y revertir confirmando que Workspace sigue OK con SES pausado.

## Entrega esperada al cerrar el gate

Mapa del flujo real · matriz de hallazgos (criticidad/impacto/evidencia/fix/responsable/re-test) ·
matriz de pruebas (aprobado/fallido/pendiente + limitaciones) · diagnóstico de capacidad y
entregabilidad con **plan gradual de volumen** (criterios medibles para subir/mantener/pausar hacia
los 10.000/día) · evidencia de regresión de Workspace (normal, carga concurrente, falla de SES,
reversión) · procedimiento operativo · **veredicto: apto para piloto / apto condicionado / bloqueado**.
Cierre: tomar **un newsletter real de prueba** y **una comunicación operativa real de prueba** y
demostrar con registros de AMBOS recorridos qué ruta tomó cada uno, con qué identidad salió, qué
confirmó cada proveedor, dónde se observó y cómo respondió el sistema ante una falla inyectada.

## Organización (cuando se corra)

Agentes: arquitectura y regresión · AWS SES y DNS · entregabilidad y reputación · colas y
resiliencia · seguridad y datos · trazabilidad y observabilidad · QA e2e. Coordinador integra,
resuelve discrepancias y pide segunda revisión de los controles críticos. Pruebas sin bases reales
de destinatarios ni cambios de DNS/credenciales/cuotas/rutas de producción fuera de lo autorizado;
simulación para alto volumen/destructivo, cuentas controladas para envíos reales.

---

## Texto íntegro del estándar (tal cual lo definió Pablo)

<!-- Fuente de verdad del gate. No editar salvo que Pablo lo actualice. -->

Actuá como responsable técnico de una auditoría integral del sistema híbrido de correo de Gestión
Global. Coordiná un equipo de agentes especializados que revise la implementación real, ejecute
pruebas autorizadas, corrija los hallazgos dentro del alcance y entregue evidencia verificable del
funcionamiento de punta a punta. [Objetivo: SES con subdominio dedicado para marketing, objetivo
inicial hasta 10.000 envíos/día sujeto a cuota AWS/capacidad/entregabilidad; lo operativo sigue por
Gmail API. Incorporación ADITIVA; descartar que un cambio/clasificación/error de proveedor/falla de
cola altere lo que ya funciona. Tabla de ruteo: marketing→SES subdominio; operativo→Gmail;
newsletter a cliente suscripto→SES (decide la finalidad); ambiguo/mixto/nuevo→revisión previa;
falla/cuota/suspensión→mantener en su circuito de error, PROHIBIDO el traspaso automático
marketing→Workspace y operativo→SES. Ruteo en backend y registrado; ni UI/import/job/API/reintento
lo saltean; relevar flujos preexistentes, plantillas y pendientes/programados antes de tocar el
ruteo. Revisiones enunciativas y NO limitativas. Agentes: arquitectura/regresión, AWS SES/DNS,
entregabilidad/reputación, colas/resiliencia, seguridad/datos, trazabilidad/observabilidad, QA e2e;
coordinador integra y pide 2da revisión de críticos. Inventariar puntos de envío y qué está
implementado/configurado/desplegado/probado; consola+backend, jobs/colas, BD, credenciales, config
por entorno, Vercel/Supabase/Cloudflare; contrastar AWS/Google con doc oficial vigente y cuentas
reales; si falta acceso, decir qué validación queda pendiente y qué evidencia se necesita. Alcance
técnico mínimo: (1) separación de rutas y regresión Workspace; (2) AWS SES/DNS/identidad; (3)
mailing/bajas/supresión; (4) capacidad/colas/resiliencia; (5) trazabilidad por mensaje/destinatario;
(6) seguridad y datos; (7) entregabilidad/reputación; (8) operación/alertas/recuperación. Pruebas
obligatorias e2e (unitarias/integración/regresión/carga/seguridad/recuperación/entregabilidad real;
simulación para alto volumen/destructivo; cuentas controladas para envíos reales; la prueba de
10.000 mide capacidad SIN disparar campaña real). Escenarios mínimos: newsletter+aviso operativo al
mismo cliente; SES suspendido/sin cuota/credenciales inválidas; SES acepta y el worker cae antes de
guardar (incierto→reconciliación); dos workers toman el mismo destinatario o doble disparo
(idempotencia); baja con mensaje en cola + reimport; rebote/queja repetidos/demorados/fuera de orden;
entrega ausente o spam; campaña masiva concurrente con el tráfico habitual (tiempos Workspace dentro
de tolerancia); campaña pausada/cancelada a mitad de lote; error de DNS/alineación del subdominio;
evento falsificado/acceso no autorizado/cambiar ruta desde API; reversión con pendientes. Registrar
por prueba entorno/precondiciones/fecha/pasos/esperado/observado/evidencia; clasificar
aprobado/fallido/pendiente; evidencia sanitizada. Entrega: mapa de flujo real; matriz de hallazgos;
matriz de pruebas; diagnóstico de capacidad/entregabilidad con plan gradual medible hacia 10.000;
evidencia de regresión de Workspace (normal/carga/falla SES/reversión); procedimiento operativo;
veredicto apto-piloto/apto-condicionado/bloqueado. Cierre: un newsletter real de prueba y una
comunicación operativa real de prueba, demostrando con registros de ambos recorridos qué ruta tomó
cada uno, con qué identidad salió, qué confirmó cada proveedor, dónde se observó y cómo respondió el
sistema ante una falla inyectada. La recomendación de volumen parte de esa evidencia y del piloto.
