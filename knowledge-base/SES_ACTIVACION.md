# SES · Activación del masivo + tracking (checklist de encendido) — DGG-268 F5

> Estado al 2026-11-25: **toda la plomería está construida, probada y deployada; los flags
> `bulk_via_ses` y `federal_campanas_activo` están OFF.** Encender es decisión explícita de Pablo.
> Lo que sigue son los pasos que requieren la consola/CloudShell de AWS (clicks de Pablo: el
> usuario IAM `gestionglobal-ses-sender` es send-only a propósito) + la decisión de blast-radius.

## 1. Tracking de entrega/apertura (para que el dashboard muestre "llegó / abrió")

El webhook + `ses_feedback_ingest` ya saben procesar `delivery`/`open`/`click`; el dispatcher ya
manda `ConfigurationSetName` si existe el secret `SES_CONFIG_SET`. Falta crearlo en AWS:

```bash
# CloudShell, región us-east-1. Reusa el topic SNS que ya está suscrito al webhook (F4).
aws sesv2 create-configuration-set --configuration-set-name gestionglobal-ses --region us-east-1

aws sesv2 create-configuration-set-event-destination \
  --configuration-set-name gestionglobal-ses \
  --event-destination-name sns-feedback \
  --event-destination '{"Enabled":true,"MatchingEventTypes":["DELIVERY","OPEN"],"SnsDestination":{"TopicArn":"arn:aws:sns:us-east-1:748725066524:gestionglobal-ses-feedback"}}' \
  --region us-east-1
```

- `DELIVERY`+`OPEN` = "entregado" + "abrió" **sin tocar los links** (OPEN inyecta sólo un pixel 1x1).
- Si además querés **CLICK**, agregá `"CLICK"` al array — PERO SES envuelve los links con su dominio
  de tracking (`awstrack.me`), que se ve en el mail. Recomendación: dejarlo en DELIVERY+OPEN.

Luego, setear el secret en la edge (activa el header en el dispatcher):

```bash
npx supabase secrets set SES_CONFIG_SET=gestionglobal-ses --project-ref kaoyhkebnidzqjixvchh
```

Verificación: mandar un envío SES de prueba y mirar en el dashboard que pase a **entregado** y,
al abrirlo, a **abrió** (o en `sent_emails`: `delivered_at`/`opened_at` poblados).

> Nota: Gmail/Workspace **no** da apertura (límite de su API). Es esperado: el dashboard muestra
> "enviado" para Workspace y "entregado/abrió" para SES. Funcionalmente indistinto; informativo.

## 2. Alarmas CloudWatch de reputación (guardrail duro, además del freno DB)

```bash
# Topic para avisarte (suscribí tu mail después con aws sns subscribe … --protocol email)
aws sns create-topic --name ses-reputacion-alertas --region us-east-1

aws cloudwatch put-metric-alarm --region us-east-1 --alarm-name ses-bounce-rate \
  --namespace AWS/SES --metric-name Reputation.BounceRate --statistic Maximum \
  --period 3600 --threshold 0.05 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 --alarm-actions <ARN-del-topic-de-arriba>

aws cloudwatch put-metric-alarm --region us-east-1 --alarm-name ses-complaint-rate \
  --namespace AWS/SES --metric-name Reputation.ComplaintRate --statistic Maximum \
  --period 3600 --threshold 0.001 --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 --alarm-actions <ARN-del-topic-de-arriba>
```

(El freno DB `private.ses_freno_check` ya auto-pausa el carril a bounce>5%/total>8%/queja>0.3%;
CloudWatch es el guardrail de AWS que mira la reputación oficial de la cuenta.)

## 3. Encendido del warm-up (cuando Pablo diga)

1. **Decidir blast-radius** (el flag `bulk_via_ses` es GLOBAL — reruta TODO el marketing a SES:
   newsletter + captación PBA (motor vivo) + ofrecimiento/engagement a clientes). Confirmar que
   está OK que el engagement a clientes salga del subdominio nuevo (Reply-To sigue siendo la
   casilla real).
2. `UPDATE config_global SET ses_warmup_inicio = current_date WHERE id=1;` (arranca la rampa: día
   1-2 = 500/día, subiendo a 50k; ver `ses_warmup_cap_hoy()`).
3. `UPDATE config_global SET bulk_via_ses = true WHERE id=1;` (enciende el ruteo SES).
4. **Warm-up fuel = tráfico ENGAGED primero** (clientes/engagement + próxima edición LexPH a
   suscriptores comprometidos). El frío validado (`import_nacional`, 10.058 con dominio vivo)
   se gotea DESPUÉS, dentro del cupo diario, vigilado por el freno.
5. Para campañas federales: `UPDATE config_global SET federal_campanas_activo = true WHERE id=1;`
   (requiere el carril SES encendido).

## Lo que YA está hecho y probado (no requiere acción)
- Rampa + freno auto-pausa (mig 0728) · carril SES en lote/encadenado en el dispatcher (auditado
  §6 APTO) · validación DNS de la lista fría (162 muertos suprimidos; 10.058 vivos) · dashboard
  con etiqueta de canal + tracking (mig 0730/0731) · webhook open/click · envío de prueba real por
  SES al inbox de Pablo. Ver `PROJECT_STATUS.md` (entradas DGG-268 F5) + `reference_mass_send_gate`.
