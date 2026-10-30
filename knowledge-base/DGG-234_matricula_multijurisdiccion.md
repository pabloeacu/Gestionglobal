# DGG-234 — Matrícula multi-jurisdicción (PBA · CABA · Neuquén)

> Estado: **EN CONSTRUCCIÓN** (spec aprobado por Pablo 2026-10-28; método canónico,
> build por fases, cada fase cierra con §6 + prueba en vivo).
> Raíz de bug asociada: **E-GG-236** (jurisdicción derivada de la columna →
> CABA computa como PBA). Capitaliza las 2 quejas de 2026-10-28 (SANCLAUDIO:
> aviso de matrícula "RPAC" sin tener RPAC; y una clienta CABA que recibió
> `ofrecimiento-rpac-certificado`).

## 1. Problema y causa raíz (E-GG-236)

Hoy la **jurisdicción es binaria y derivada de EN QUÉ COLUMNA está la matrícula**:
`administraciones.matricula_rpac` ⇒ `'rpac'` (PBA); `matricula_rpa` ⇒ `'rpa'`
(CABA). La columna `matricula_rpa` está **100% vacía**, así que **todos computan
PBA**. Hay 143 clientes PBA (con `legajo_rpac`) + **3 CABA** (SANCLAUDIO 20143,
Baldonccini 18427, Avolio 20014) cuya matrícula CABA está cargada en
`matricula_rpac` con `legajo_rpac` NULL.

La misma raíz se manifiesta en **3 consumidores**:
1. `private.perfil_regulatorio_calc` (deriva `v_jur` por columna) → vencimientos
   declarados rotulados "RPAC" a CABA (queja SANCLAUDIO).
2. `gg_ofrecimientos_diario` / `private.gg_admin_es_solo_caba` → el gate de
   jurisdicción existe pero se anula (porque `gg_admin_es_rpac` mira
   `matricula_rpac`, no el legajo) → ofertas PBA (certificado/renovación/curso)
   a CABA (2ª queja).
3. Plantillas de email + `TIPO_LABEL` del edge `dispatch-vencimientos` +
   copy de push → hardcodean "RPAC".

**Contención provisoria aplicada (2026-10-28, reversible):** vencimientos
declarados de los CABA pausados (`pausado_at`); `ofrecimientos_habilitados=false`
en los 3 CABA. Se revierte al completar el modelo (el fix real re-habilita).

## 2. Modelo de dominio (decidido con Pablo)

3 jurisdicciones con registro público: **PBA = RPAC**, **CABA = RPA**,
**Neuquén = RPA-Neuquén**. Matrícula **anual (+12m desde el otorgamiento)** en
las 3. **Legajo: sólo PBA.** Cardinalidad **N por cliente, máx. 1 por
jurisdicción** (ej. SANCLAUDIO: CABA hoy, PBA pronto).

### 2.1 Matriz de obligaciones (lo que se agenda)
| Obligación | PBA | CABA | Neuquén |
|---|---|---|---|
| Renovación matrícula (+12m) | agenda | agenda | agenda (sólo aviso) |
| Curso actualización | ✅ | ✅ | ❌ (no hay convenio) |
| DDJJ | 31-mar + gestión | sólo aviso si el cliente la carga | — (no tiene) |
| Certificado | ✅ | ❌ | ❌ |
| Consultoría jurídica | on-demand | on-demand | on-demand |

### 2.2 Matriz de servicios ofrecibles
| Servicio | PBA | CABA | Neuquén |
|---|---|---|---|
| Curso certificado | FUNDPLATA | Gestión Global | — |
| Gestión DDJJ / certificado / gestoría | ✅ | ❌ | ❌ |
| Consultoría jurídica | ✅ | ✅ | ✅ |
| Webinars / eventos | ✅ | ✅ | ✅ |

### 2.3 Reglas transversales
- **Inferencia por punto de entrada (certeza dura):** el slug del formulario fija
  la jurisdicción — curso-actualizacion/certificado-rpac/renovacion-rpac/ddjj →
  PBA; curso-actualizacion-caba → CABA; gestoría/TRAMIX → PBA. **El ruteo se basa
  en el slug/jurisdicción, NUNCA en el nombre del campo** (hoy el form CABA
  captura en un campo llamado `matricula_rpac` — trampa que causó el bug).
- **Asimetría de inferencia:** PBA = inferimos y avisamos (TRAMIX da datos
  reales). CABA/Neuquén = **sólo lo que el cliente declara**; "no inferir" =
  no inventar fechas que no nos dio, pero SÍ aplicar la regla +12m a una fecha
  que él declaró. Nunca `confirmado` por fuente oficial (TRAMIX es PBA-only).
- **Cambio de jurisdicción:** el cliente **agrega** otra jurisdicción libre;
  **editar/borrar** una matrícula de origen TRAMIX = con fricción (se presume
  error) + aviso a gerencia (dashboard + push).
- **Ocultar lo que no aplica** por jurisdicción en la ficha y en gerencia.

## 3. Decisiones de arquitectura

**D1 — "Opción B segura" (no mover la columna caliente).** El fan-out mostró
**37 objetos DB** que leen `matricula_rpac`/`legajo_rpac` directo. Mover esas
columnas (B literal) rompería los 37 con 173 clientes vivos. Entonces:
- **PBA se queda en `administraciones.matricula_rpac*` + `legajo_rpac`** (ruta
  caliente intacta — los 37 consumidores no se tocan).
- **Tabla hija `public.matricula_extra`** sólo para CABA/Neuquén (1 fila por
  `(administracion, jurisdiccion)`, sin legajo). CHECK `jurisdiccion <> 'pba'`.
- **Vista unificada `public.v_matriculas`** = PBA (de columnas) ∪ extra. La leen
  los primitivos y la UI nueva; es la fuente única de lectura multi-jurisdicción.

**D2 — Enum de 1ª clase** `public.jurisdiccion_matricula` = `('pba','caba','neuquen')`.
Alinea con `cursos.jurisdiccion` (ya usa 'pba'/'caba'). Mapeo del enum viejo de
`perfil_regulatorio.jurisdiccion`: `rpac→pba`, `rpa→caba`.

**D3 — El backfill arregla los primitivos sin tocarlos.** `es_solo_caba` depende
de que la matrícula NO esté en `matricula_rpac`. Al mover los 3 CABA a
`matricula_extra` (y nulear su `matricula_rpac`) + setear su jurisdicción,
`es_rpac→false` y `es_solo_caba→true` solos. Ahí se **revierte la contención**
(`ofrecimientos_habilitados=true`) ya bien clasificados. **El cutover se hace al
final**, cuando los lectores ya consultan la vista (para no dejar a los 3 CABA
"sin matrícula" a mitad de build).

**D4 — Escrituras multi-tabla por RPC `SECURITY DEFINER`** (R5). PBA sigue por
columnas; CABA/NEU por RPC a `matricula_extra`. Al extender firmas públicas
(`perfil_regulatorio_declarar`, etc.) usar **DROP + CREATE**, no
`CREATE OR REPLACE` (R16, overload ambiguo).

**D5 — Procedencia de la jurisdicción.** `matricula_extra.origen` +
`certeza` registran de dónde vino (`formulario:<slug>` | `gerencia` | `cliente`
| `backfill`) para el candado anti-cambio y para distinguir "PBA-TRAMIX" de
"PBA-presumido".

## 4. Schema (Fase 1 — aditivo, inerte)

```sql
CREATE TYPE public.jurisdiccion_matricula AS ENUM ('pba','caba','neuquen');

CREATE TABLE public.matricula_extra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administracion_id uuid NOT NULL REFERENCES public.administraciones(id) ON DELETE CASCADE,
  jurisdiccion public.jurisdiccion_matricula NOT NULL,
  matricula_nro text,
  matricula_fecha date,            -- otorgamiento
  matricula_vencimiento date,
  certeza public.certeza_dato NOT NULL DEFAULT 'declarado',
  origen text,
  verificado_at timestamptz,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid,
  CONSTRAINT matricula_extra_no_pba  CHECK (jurisdiccion <> 'pba'),
  CONSTRAINT matricula_extra_uq_adm_jur UNIQUE (administracion_id, jurisdiccion)
);
ALTER TABLE public.matricula_extra ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matricula_extra TO authenticated;
CREATE POLICY matricula_extra_cliente_select ON public.matricula_extra
  FOR SELECT TO authenticated USING (administracion_id = private.current_administracion_id());
CREATE POLICY matricula_extra_staff ON public.matricula_extra
  FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE INDEX idx_matricula_extra_admin ON public.matricula_extra(administracion_id);

-- Vista unificada de lectura (PBA desde columnas ∪ no-PBA desde la hija)
CREATE VIEW public.v_matriculas AS
  SELECT a.id AS administracion_id, 'pba'::public.jurisdiccion_matricula AS jurisdiccion,
         a.matricula_rpac AS matricula_nro, a.matricula_rpac_fecha AS matricula_fecha,
         a.matricula_rpac_vencimiento AS matricula_vencimiento, a.legajo_rpac AS legajo_nro,
         COALESCE(a.matricula_rpac_vencimiento_certeza,'confirmado')::public.certeza_dato AS certeza,
         a.matricula_rpac_vencimiento_origen AS origen, a.matricula_rpac_vencimiento_verificado_at AS verificado_at
  FROM public.administraciones a
  WHERE a.matricula_rpac IS NOT NULL OR a.matricula_rpac_vencimiento IS NOT NULL
  UNION ALL
  SELECT me.administracion_id, me.jurisdiccion, me.matricula_nro, me.matricula_fecha,
         me.matricula_vencimiento, NULL::text, me.certeza, me.origen, me.verificado_at
  FROM public.matricula_extra me;
```

## 5. Plan por fases (cada una: §6 + prueba en vivo)

- **F1 — Estructura (aditiva, inerte):** enum + `matricula_extra` + `v_matriculas`
  + RLS/GRANTs. No mueve datos. Riesgo nulo (nada la referencia aún).
- **F2 — Lectores jurisdiction-aware:** `perfil_regulatorio_calc` (v_jur por
  vista, no por columna), primitivos (`es_rpac`/`es_solo_caba`/`matricula_conocida`/
  `prox_venc_matricula` consultan la vista), `cliente_portal_dashboard`,
  `cliente_perfil_datos_formulario`, `campus.listMatriculas`. Deben seguir dando
  idéntico resultado para PBA (0 regresión) y correcto para CABA/NEU.
- **F3 — Catálogo de obligaciones/servicios por jurisdicción + gating del motor:**
  `gg_ofrecimiento_elegible`/`gg_ofrecimientos_diario` por jurisdicción real;
  `gg_ofrecimientos_preview`. Nunca FUNDPLATA/gestoría/certificado/DDJJ a CABA/NEU.
- **F4 — Emails/push por jurisdicción:** `dispatch-vencimientos` `TIPO_LABEL` +
  `TEMPLATE_BY_TIPO` + push; `_gg_ofrecimiento_tocar` push copy. 3 plantillas de
  renovación de matrícula: PBA (curso FUNDPLATA+gestoría) · CABA (sólo curso GG) ·
  Neuquén (sólo aviso). Sacar "RPAC" fijo de `vencimiento-declarado-cliente`
  (línea "cargá tu legajo RPAC").
- **F5 — Punto de entrada + write-paths:** `sync_submission_a_administracion` y
  `backfill_admin_desde_tramite_submission` rutean por slug/jurisdicción (PBA→
  columnas; CABA/NEU→`matricula_extra`). Renombrar/neutralizar el campo
  `matricula_rpac` del form CABA. Extender `perfil_regulatorio_declarar`
  (DROP+CREATE, enum nuevo, por jurisdicción). **Smoke e2e obligatorio (R18).**
- **F6 — Frontend:** formulario dinámico progresivo en la **agenda de
  vencimientos profesionales** ("¿Tenés matrícula en otra jurisdicción?", sólo
  faltantes, máx 1 por jur.); ocultar lo que no aplica (ficha + gerencia);
  paridad R14 en gerencia (editor de N matrículas + candado TRAMIX); labels y
  selectores con las 3 jurisdicciones; Neuquén en UI.
- **F7 — Cutover + reversión de contención:** mover los 3 CABA a `matricula_extra`,
  nulear su `matricula_rpac`, setear jurisdicción; `ofrecimientos_habilitados=true`;
  despausar y recrear sus vencimientos ya bien rotulados. §6 + prueba en vivo del
  caso SANCLAUDIO end-to-end en las 4 superficies.

## 6. Consumidores a tocar (fan-out completo)

**DB (37 objetos; los que cambian):** `perfil_regulatorio_calc`,
`gg_admin_es_rpac`, `gg_admin_es_solo_caba`, `gg_admin_matricula_conocida`,
`gg_admin_prox_venc_matricula`, `gg_admin_ficha_incompleta`,
`gg_ofrecimiento_elegible`, `gg_ofrecimientos_diario`, `_gg_ofrecimiento_tocar`,
`sync_submission_a_administracion`, `backfill_admin_desde_tramite_submission`,
`perfil_regulatorio_declarar`, `cliente_portal_dashboard`,
`cliente_perfil_datos_formulario`, `cliente_confirmar_vencimiento_matricula`,
`tracking_programar_vencimientos_rpac`, `admin_venc_certeza_default` (candado),
`vw_agenda_unificada`. (PBA-only, se dejan explícitos: `tracking_cargar_otorgamiento`,
`tramix_*`, `reverify_enqueue`, `prospectos_*`, `agente_cierre_detectar`.)

**Frontend (crítico/alto):** `src/modules/portal/components/perfil/fichaModel.ts`
(OBLIGACIONES sin gate), `PortalFichaRegulatoriaPage.tsx` (selector one-shot binario
→ formulario dinámico; render de obligaciones sin filtrar; legajo/TRAMIX PBA-only),
`services/api/perfilRegulatorio.ts` (contrato binario → enum + multi),
`PerfilRegulatorioHotCard.tsx`, `PortalHome.tsx` (Hero/vencimientos labels RPAC),
`AdministracionFormDrawer.tsx` (selector + N matrículas + candado TRAMIX),
`AdministracionDetailPage.tsx` TabRegistral (R14), `PerfilRegulatorioPanel.tsx`,
`PerfilRegulatorioDeclararDrawer.tsx`, `ClientePanoramaCard.tsx`,
`VencimientoFormDrawer.tsx`/`vencimientos.ts` (labels/tipos RPAC),
`administraciones.ts` (leer vista; write no-PBA por RPC).

**Edges/plantillas:** `dispatch-vencimientos` (`TIPO_LABEL`, `TEMPLATE_BY_TIPO`,
push), `dispatch-emails` (sin cambio obligatorio de alias), plantillas
`ofrecimiento-rpac-*` (gatear a PBA), `vencimiento-declarado-cliente` (sacar copy
legajo RPAC), **crear** `aviso-matricula-neuquen` y una renovación CABA.

## 7. Riesgos / mitigaciones (barrido §6 2-bis)
- **(a) Fan-out:** mover CABA a la hija sin migrar lectores = "sin matrícula" en
  dashboard/ficha/Hero/campus → por eso lectores (F2) ANTES del cutover (F7).
- **(b) Estado×superficie:** matriz jurisdicción × {email, push, agenda, home,
  ficha, grilla} — cada celda CABA/NEU verificada (hoy vacías = bug).
- **(c) Bordes/backfill:** los 3 CABA pre-existentes; declarada que nace vencida;
  "no inferir" para CABA/NEU es decisión, confirmada.
- **(d) Caso reportado:** SANCLAUDIO seguida end-to-end en las 4 superficies.
- **(e) Coherencia aviso↔display:** agenda/home muestran exactamente lo que
  dispatch envía; label y push coherentes con el email (hoy el push miente "RPAC").
- **R18:** smoke e2e real en F5 (triggers de submission). **R14/R15:** paridad en
  gerencia. **R16:** DROP+CREATE al extender RPCs. **0 regresión PBA** en cada fase.

## 8. Estado de ejecución (log vivo)

- **F1 — HECHA** (mig `0605`, commit `eae8515`): enum + `matricula_extra` + `v_matriculas`
  + RLS/GRANTs. e2e ROLLBACK OK, inerte. 0 riesgo.
- **F2 — HECHA** (mig `0606`, commit `d7d5e3e`): `gg_admin_matricula_conocida` y
  `gg_admin_es_solo_caba` conscientes de la hija. 0 regresión (144 idénticos) + e2e.
  _Pendiente de F2 que se movió a F5/F6 a propósito:_ `perfil_regulatorio_calc`
  (deriva `v_jur` por columna y NO lee `matricula_extra` — es la raíz E-GG-236 del
  display de ficha; se corrige cuando lea `v_matriculas`) y los lectores del portal.
- **F3 — HECHA** (mig `0607`, commit `e7e7a91`): gating del motor por jurisdicción
  positiva (`gg_admin_es_rpac` en vez de `NOT es_solo_caba`). 0 regresión exacta
  (178 admins, 8 reglas). **OJO (hallazgo §6-C de F4):** `es_rpac` keyea
  `matricula_rpac`, así que los 3 CABA (matrícula en esa columna) siguen computando
  `es_rpac=true` → el motor los trata como PBA. Es el estado DISEÑADO (D3): contenidos
  por `ofrecimientos_habilitados=false` hasta el **cutover F7**, que mueve su matrícula
  a `matricula_extra` → `es_rpac→false` solo. El gating F3 protege a los CABA/NEU
  PUROS (sin nº en `matricula_rpac`) y a Neuquén.
- **F4a — HECHA** (mig `0608`, commit `77b9153`): columna `vencimientos.jurisdiccion`
  (backfill pba=252/caba=6 + trigger `venc_jurisdiccion_default_fn`; default declarada→pba).
- **F4b — HECHA + §6 + deploy** (mig `0609` + edge `dispatch-vencimientos` **v18**, 2026-10-29):
  - Plantillas: `vencimiento-declarado-cliente` parametriza la nota PBA-only como
    `{{nota_verificacion}}`; **nuevas** `vencimiento-matricula-caba` (ofrece curso GG,
    CTA `/formulario/curso-actualizacion-caba?origen=aviso`) y `aviso-matricula-neuquen`
    (sólo aviso, CTA ficha). Sin fuga RPAC/legajo/FUNDPLATA a CABA/NEU.
  - Edge: `resolveLabel`/`resolveTemplate`/`notaVerificacion` por jurisdicción +
    `jurMap` (bulk de la columna) + `labelMinus` que preserva acrónimos/topónimos.
  - **§6 (3 agentes A/B/C + e2e):** label/ruteo correctos para el universo real;
    0 regresión PBA byte-idéntica; e2e Neuquén real (planner→columna→`aviso-matricula-neuquen`,
    ROLLBACK); caso SANCLAUDIO real → "Matrícula RPA (CABA)" + plantilla CABA (bug cerrado
    en la superficie de vencimientos). Fixes del §6: fail-closed ante error de lectura de
    jurisdicción (A#3); `renovacion_rpac` fuera de `MATRICULA_TIPOS` (label↔plantilla, A#4/C#4);
    `labelMinus` en push no-declarado (A#6).
  - **Trampa (E-GG-234, 3ª vez):** `deploy_edge_function` MCP pisa `verify_jwt→true` si no
    se pasa explícito → se re-deployó con `verify_jwt:false` + smoke (401 propio = boot+gate OK).
  - **`_gg_ofrecimiento_tocar` NO se tocó:** tras F3, los códigos con copy "RPAC" sólo
    disparan para `es_rpac` (PBA); los alcanzables por CABA/NEU (cj_120/perfil_incompleto/
    capacitación) son neutrales. El leak histórico a los 3 CABA es por la columna legacy →
    lo cierra F7, no un cambio de copy.
- **Items para F6** (paridad de etiqueta / lectores): `src/services/api/vencimientos.ts`
  `VENCIMIENTO_TIPO_LABEL` (jur-blind en grilla gerencia/portal); `perfil_regulatorio_calc`
  (leer `v_matriculas` para v_jur y datos CABA/NEU).
- **Dudas de política para Pablo** (sin bloqueo): el aviso CABA ofrece curso pago pero va
  por `vencimientos` (no pasa por opt-out de marketing — 0 CABA suprimidos hoy); doble-escape
  pre-existente de `{{nombre}}` en títulos de `dispatch-emails` (tarea aparte, requiere
  redeploy del drainer); declarada vieja de Baldonccini (2024) queda muda al despausar →
  refrescar su dato en el cutover F7.
- **F5 — Backend jurisdiction-aware (HECHA + §6, 2026-10-29).** Todo ADITIVO/0-regresión
  (la hija está vacía → inerte hasta el cutover F7). 4 migraciones:
  - **0610 (F5a lectores):** `perfil_regulatorio_calc` lee la matrícula NO-PBA desde
    `matricula_extra` como fallback tras las columnas (caba/neuquen → 'rpa' back-compat).
    **0 regresión probada**: hash de calc (sin generated_at) IDÉNTICO para los 178 admins
    antes/después. e2e CABA post-cutover (jurisdiccion='rpa', matrícula/prox_renov de la hija).
  - **0611 (F5b materializador):** `perfil_declarado_sync_venc` estampa `vencimientos.jurisdiccion`
    desde la hija ('pba' si vacía = default trigger F4a). e2e: declarada CABA → jurisdiccion=caba.
  - **0612 (F5b entry-points):** `sync_submission_a_administracion` + `backfill_admin_desde_tramite_submission`
    + `cliente_confirmar_vencimiento_matricula` + `perfil_regulatorio_declarar` rutean la matrícula
    por JURISDICCIÓN DEL SERVICIO (servicio `rpa_actualizacion`=CABA; resto=PBA), NUNCA por el
    nombre del campo. Cierra la "trampa" (el form curso-actualizacion-caba capta `matricula_rpac`
    → antes iba a la columna → es_rpac=true). `declarar` acepta el enum nuevo (pba/caba/neuquen)
    + viejo (rpac/rpa) y aplica la regla +12m a la fecha declarada. **R18 e2e (ROLLBACK, 4 escenarios):**
    CABA-form→extra/matricula_rpac NULL · PBA-form→columna/extra 0 · declarar-CABA→extra(+12m)/pr NULL ·
    declarar-PBA→pr/extra 0. 0-regresión PBA byte-idéntica, 0 residuo.
  - **0613 (§6-A#6c):** CHECK `matricula_extra.certeza <> 'confirmado'` (CABA/NEU sin fuente oficial
    tipo TRAMIX → nunca 'confirmado', si no el materializador dejaría al cliente sin recordatorio).
  - **§6 (5 agentes + e2e):** chunk-1 (calc+materializer) 3 agentes — A correcto/0-regresión,
    B fan-out, C barrido/triggers; chunk-2 (entry-points) 2 agentes. Hallazgos accionables ya
    aplicados (#6c CHECK); #6b (stamp vs calc en cliente DUAL futuro) diferido a F6 (no alcanzable:
    hija vacía / los 3 CABA son CABA-puros).
- **F6 — EN CURSO. Items (frontend + funciones de display que lo alimentan):**
  - **✅ HECHO (mig 0614, backend):** `cliente_portal_dashboard` CABA-aware — lee `matricula_extra`
    (v_has_matricula/v_matriculado/v_jur), expone `matricula_nro`/`matricula_vencimiento`/`jurisdiccion`
    en el header, el card declarado rutea al curso CABA / ficha NEU (PBA byte-idéntico), y los cards
    PBA-only (certificado, ddjj_diciembre) + "Matriculate" se gatean por jurisdicción. **0 REGRESIÓN
    PBA PROBADA** (hash de `oportunidades`+header idéntico para 4 admins reales) + e2e CABA (SANCLAUDIO
    post-cutover: Hero mat_nro=20143/jur=caba + card → curso CABA).
  - **✅ HECHO (frontend cliente, F6b):** `PortalHome.tsx` Hero pill lee `matricula_nro` + sufijo de
    jurisdicción (`· RPA (CABA)` / `· RPA (Neuquén)`; PBA sin sufijo = visual idéntico) + `portal-dashboard.ts`
    (tipo con `matricula_nro`/`matricula_vencimiento`/`jurisdiccion`). `fichaModel.ts` gana `aplicaEn` por
    jurisdicción + `obligacionesVisibles()`/`jurNorm()` (oculta el certificado a CABA; PBA/null = TODAS,
    0 regresión). `PortalFichaRegulatoriaPage` usa `obligacionesVisibles(p)` en las 3 listas; el label de
    jurisdicción ya mostraba 'rpa'→"RPA · CABA". Build tsc/vite limpio. Prueba en vivo CABA = parte de F7
    (no hay cliente CABA en el portal hasta el cutover; el PBA 0-regresión se testea ya).
  - **PENDIENTE F6 (capacidad nuevo cliente / gerencia):** formulario dinámico "¿Tenés matrícula en otra
    jurisdicción?" (hoy el selector binario rpac/rpa sigue andando) + enum pleno en `perfilRegulatorio.ts`
    + N-matrículas; editor de gerencia `AdministracionFormDrawer`/`patchField` + `tracking_cargar_otorgamiento`
    (rutear a `matricula_extra`, R14); `vencimientos.ts VENCIMIENTO_TIPO_LABEL` jur-aware (grilla);
    `cliente_perfil_datos_formulario` + `gg_admin_prox_venc_matricula` (prefill/preview).
  - Display/prefill (diferible): `cliente_perfil_datos_formulario` (autofill), `gg_admin_prox_venc_matricula`
    (preview), `AdministracionDetailPage` TabRegistral, `AdministracionFormDrawer` (editor N-matrículas +
    candado TRAMIX, R14), `campus.listMatriculas`, `TrackingDetailPage`/`ModeracionPage`.
  - Contrato front `PerfilRegulatorio.jurisdiccion` 'rpac'|'rpa'|null → enum nuevo + lista N-matrículas;
    formulario dinámico "¿Tenés matrícula en otra jurisdicción?" en la agenda de vencimientos; ocultar
    lo que no aplica (fichaModel OBLIGACIONES por jurisdicción); labels CABA/Neuquén; #6b (alinear stamp
    con calc en el modelo N-matrículas); DDJJ declarada CABA (#6d).
  - **Huecos de ESCRITURA de gerencia (fan-out §6, pueden re-meter una matrícula CABA en `matricula_rpac`
    → `es_rpac`=true):** (a) `AdministracionFormDrawer` (`createAdministracion`/`updateAdministracion`) —
    el campo libre "Matrícula RPAC" escribe la columna sin guard de jurisdicción; el editor debe rutear a
    `matricula_extra` para CABA/NEU y NO hay UI que escriba la hija (0 refs en src/). El campo "Matrícula RPA"
    escribe a la columna **inerte** `matricula_rpa` (no sustituye el ruteo). (b) quick-edit `patchField`
    (`AdministracionDetailPage`) — update genérico, mismo vector crudo. (c) `tracking_cargar_otorgamiento`
    (RPC gerencia) — escribe `matricula_rpac*` gateado sólo por `categoria IN (matricula,renovacion)`, no por
    servicio/jurisdicción (un trámite PBA mal-creado para un CABA lo re-metería). Los demás escritores RPAC
    (`tracking_programar_vencimientos_rpac`, `tracking_moderar_gestor_avance`, `tracking_cerrar_ciclo`,
    `trg_tramite_cierre_setea_vencimiento_fn`) están gateados por `servicio IN (rpac_*)` → PBA-only, OK.
  - **Hardening del ruteo (F6):** el mapeo servicio→jurisdicción es hoy un allowlist de 1
    (`rpa_actualizacion`→caba; resto→pba). Un form no-PBA futuro caería en 'pba' → re-trampa. Mejor:
    atributo `jurisdiccion` en `servicios` (o en el form) en vez del slug hardcodeado.
- **F7 — HECHO + verificado DB (mig 0615, 2026-10-29).** Cutover de los 3 CABA: matrícula movida a
  `matricula_extra` (caba, certeza declarado), `matricula_rpac*` nula, `perfil_regulatorio.jurisdiccion='rpa'`,
  declaradas recientes despausadas + añejas re-pausadas (guard anti-card-engañoso), `perfil_declarado_sync_venc`
  explícito, y contención revertida (`ofrecimientos_habilitados=true`) SÓLO tras verificar `es_rpac=false`
  (abort de seguridad en la mig). **Verificado (4 superficies):** es_rpac=false los 3 → motor ofrece 0
  servicios RPAC (renov/cert/curso/matric=false) = **2ª queja cerrada estructuralmente**; calc/ficha → matrícula
  CABA; home SANCLAUDIO (impersonado real) = pill "20143 · RPA (CABA)" + card → curso CABA; su declarada
  2026-10-17 activa/caba → edge F4b la rotula "Matrícula RPA (CABA)" = **1ª queja cerrada**; Baldonccini añeja
  2024 pausada (sin card engañoso). **Pendiente:** confirmación visual en browser (sesión del portal) + la UX
  nuevo-cliente (ver F6 pendiente).
- **F7 (nota original). Cutover (mover los 3 CABA a `matricula_extra`, nular `matricula_rpac`, setear
  jurisdicción; revertir contención `ofrecimientos_habilitados=true`). Notas del §6-C para el plan:**
  - Hacer `cliente_portal_dashboard` CABA-aware (F6) ANTES del cutover (si no, Hero/banner rotos).
  - El materializador NO re-estampa una declarada existente a la misma fecha → el cutover debe
    RECONCILIAR la `jurisdiccion` de las declaradas pre-existentes de los 3 CABA (ya están en 'caba'
    por el backfill F4a — verificar que sigan) y llamar `perfil_declarado_sync_venc(admin)` EXPLÍCITO
    post-cutover (no esperar al cron; hay ventana tras retirar el `renovacion_rpac`).
  - Re-habilitar `ofrecimientos_habilitados=true` SÓLO tras verificar `gg_admin_es_rpac→false`.
  - Opcional: setear `app.venc_declarado='on'` durante el cutover (preservar certeza; benigno).
  - Hygiene: `matricula_extra` sin trigger de audit/touch (`updated_at` lo setean los write-paths;
    evaluar touch trigger). Refrescar el dato viejo de Baldonccini (declarada 2024 → muda al despausar).
  - Prueba en vivo SANCLAUDIO end-to-end en las 4 superficies.

---

## F6c/F6d — Residuos destapados por la prueba en vivo (2026-10-29)

La confirmación visual del cutover (rol-swap §5 sobre SANCLAUDIO, browser Chrome logueado
de Pablo) confirmó **ambas quejas cerradas** (home pill "20143 · RPA (CABA)", card → curso
CABA, ficha "RPA · CABA", sin certificado; PBA Lozano intacto) **y** destapó 3 residuos que
F6b no cubría (capitalizados por §6-2bis fan-out). Ver E-GG-236 addendum.

- **F6c (commit 957753c) · ficha jur-aware.** `fichaModel` gana `matriculaLabel` /
  `jurisdiccionLabel` / `tieneRegistroOficial`. La ficha ya no hardcodea "RPAC": agenda de
  avisos, fila Jurisdicción, rótulo "Legajo" (RPAC sólo PBA), copy TRAMIX (sólo PBA), prompt
  de legajo y hint de certeza. 0 regresión PBA por construcción. Verificado en vivo.
- **F6d (commit 6719c3c) · gerencia + guards.**
  - **Editor de gerencia (R14/R15):** `AdministracionFormDrawer` — el campo "Matrícula RPA ·
    CABA" lee/escribe `matricula_extra` (certeza 'declarado'), no la columna legacy
    `matricula_rpa` (deprecada, 0 filas). Antes los CABA del cutover se veían VACÍOS en
    gerencia. Servicios `fetchMatriculasExtra`/`setMatriculaExtraCaba`. Guard R13 dual-jur.
  - **mig 0616 · guard de otorgamiento:** `tracking_cargar_otorgamiento` rechaza el
    otorgamiento RPAC a un cliente puramente no-PBA. Smoke R18 OK (CABA bloqueado, PBA intacto,
    overloads=1).
  - **TRAMIX gate:** botón "Mesa de Entradas Virtual PBA" oculto para CABA/Neuquén
    (`fetchMiEsNoPba`). Default visible → 0 regresión PBA.
  - **Nota arquitectura:** el calc honra 3 fuentes CABA en orden: `matricula_rpac`(PBA) →
    `matricula_rpa`(col legacy, 'confirmado') → `matricula_extra`(hija, 'declarado'). Canon =
    `matricula_extra` (preserva certeza declarada honesta; la columna inflaba a 'confirmado').
  - **e2e BD (BEGIN/ROLLBACK):** gerencia→CABA produce jur=rpa/nro=20143/cert=declarado/
    es_rpac=false; RLS `is_staff` permite el INSERT en `matricula_extra`.

## F8 — Enum pleno + Neuquén (2026-10-29)

Cierra los 2 pendientes de fondo de F6 (**enum pleno** + **Neuquén en gerencia**). Diseño
ESTRICTAMENTE ADITIVO: 0 regresión para 173 PBA + 3 CABA (probado byte-idéntico), 0 Neuquén hoy.

- **mig 0617 · `perfil_regulatorio_calc` gana `jurisdiccion_code`** (pba/caba/neuquen/null) SIN
  tocar el `jurisdiccion` binario legacy (sigue alimentando el gate de DDJJ `v_jur='rpac'` y los
  null-checks del front). Prioridad: `matricula_rpac`→pba · `matricula_rpa`(legacy)→caba ·
  `matricula_extra`→su enum · declarada rpac/rpa→pba/caba · else null. e2e BEGIN/ROLLBACK: NEU
  sintético → code=neuquen, binario=rpa, ddjj_cert=desconocido (gate preservado); PBA/CABA reales
  byte-idénticos. Prod real: 3 CABA→caba, PBA→pba.
- **Front:** `PerfilRegulatorio.jurisdiccion_code` (tipo) · `jurNorm()` prefiere el code, cae al
  binario si falta · pill de gerencia (`PerfilRegulatorioPanel`), card Registral y KPI "Vence …"
  del detalle (`AdministracionDetailPage`) y nota read-only del declarar-drawer ahora enum-aware.
  Los helpers de ficha (matriculaLabel/jurisdiccionLabel/obligacionesVisibles) ya tenían la rama
  'neuquen' desde F6 → ahora por fin la reciben.
- **Gerencia alta/edición (`AdministracionFormDrawer`):** el campo de otra jurisdicción gana un
  **selector CABA / Neuquén** + Nº → `setMatriculaExtra(adminId, jurisdiccion, nro, previa)`.
- **mig 0618 · `gg_admin_ficha_incompleta` jurisdicción-aware:** espeja `obligacionesVisibles`
  (no cuenta 'certificado' para CABA/Neuquén; ni 'curso'/'ddjj' para Neuquén) → cierra el
  dead-end del ofrecimiento 'perfil_incompleto' (aviso "Completá tu perfil" sin nada por
  completar). Verificado old-vs-new sobre los 178: pba 174→0 cambios, caba 4→0 cambios
  (byte-idéntico HOY; sólo cierra el callejón futuro). 0 regresión en quién recibe ofertas.

**§6 adversarial (workflow 3 revisores + verificación, 9 agentes):** 3 falsos positivos
descartados con datos de prod (KPI, doble-fetch, ORDER BY del calc). 1 CONFIRMADO + 2 fixes
aplicados en el mismo chunk:
- **CONFIRMADO (pérdida de datos latente, era mayor→menor):** `setMatriculaExtra` borraba en
  silencio la OTRA fila no-PBA de un cliente con CABA+Neuquén simultáneas (el drawer carga sólo
  la 1ª). **Fix:** los borrados se ACOTAN a la jurisdicción cargada (`previa`) o elegida — nunca
  una fila hermana que el form no mostró. 0 impacto hoy (0 Neuquén, 0 multi-fila) pero cerrado
  antes de habilitar Neuquén en vivo.
- **Hardening:** el drawer carga la jurisdicción no-PBA AUNQUE el Nº esté vacío (una fila de
  sólo-vencimiento ya no cae al default 'caba' del Select → no reclasifica/borra al guardar).

### Pendiente post-F8 (documentado — 0 clientes hoy, no bloqueante)

- **N-matrículas duales** (un cliente con PBA + CABA, o CABA + Neuquén a la vez): el form
  gestiona UNA matrícula no-PBA por vez (y ya NO destruye la hermana — fix §6 F8); falta UI para
  listar/editar varias matrículas simultáneas. Combinación atípica, 0 clientes.
- **`completitud_pct` del calc usa `v_total=9` fijo** → un CABA/Neuquén "completo" nunca llega a
  100% (el anillo muestra ~89% permanente). COSMÉTICO — deferido a propósito para no re-abrir el
  scoring del calc por un %; mismo root que el fix 0618. (Reportado explícito a Pablo.)
- **Labels de grilla de gerencia** (`vencimientos.ts VENCIMIENTO_TIPO_LABEL`): los tipos
  `renovacion_rpac`/`curso_actualizacion`/`ddjj_anual` son PBA-intrínsecos (el declarado CABA/NEU
  usa `renovacion_matricula_declarada`), así que "RPAC" es correcto para esas filas; no es un
  mislabel. Revisado, sin acción.

## F9 — Reframe del certificado + saneamiento del mecanismo de avisos declarados (2026-10-30, mig 0619, E-GG-238)

Capitalización de la **auditoría §6** (workflow de 3 auditores + verificación adversarial; 20
hallazgos, 0 refutados). Disparador: **Avolio Mariana Edith** (PBA) recibió *"tu certificado de
acreditación vence el 05/11/2026"* — falso. Decisiones de Pablo en el camino:

- **Certificado de acreditación:** dura **30 días**; GG recuerda **cada 90 días** para tener uno
  vigente listo para la **asamblea**. O sea "último + 90d" es una **cadencia de recordatorio**, NO
  un vencimiento. **Decisión: dejar de modelarlo como vencimiento** (ya lo hace bien, con 90d, el
  ofrecimiento `certificado_90`/`certificado_acreditacion`, vivo). → fuera del materializador; 17
  `certificado_declarado` retirados (→'renovado'); `proximo_certificado` queda informativo y
  **sólo PBA** (gate en el calc); el front lo saca de "próximas obligaciones" (ficha + panel).
- **DDJJ de CABA (regla nueva de Pablo):** DGDyPC · Disposición 2615/DGDYPC/26 art. 3° — la DDJJ
  de los consorcios administrados del período anterior vence el **30/11** de cada año (actividad
  2025 → 30/11/2026). El calc la infiere para CABA igual que la de PBA (31/03). Cierra el hueco
  inverso (la ficha la prometía pero nunca se avisaba).

Otros fixes del mismo chunk (del barrido §6):
- **Dedup del planner por `(administracion_id, tipo, fecha_vencimiento)`** en vez de
  `vencimiento_id` + **materializador id-ESTABLE** (UPDATE in-place al cambiar la fecha; retiro
  sólo por razón POSITIVA: no-aplica-por-jur / oficial / opt-out) → fin del "doble aviso" (Avolio).
- **Gate de jurisdicción en el BACKEND** (no sólo en la UI): `aplica_jur` en el sync, gate en el
  calc y en `perfil_regulatorio_declarar`, y drawer "Anclar datos" de gerencia jur-aware.
  certificado={pba}, curso/ddjj={pba,caba}, renovación/consultoría universales.
- **Home** (`cliente_portal_dashboard`): excluye `origen='declarado'` del card "Próximos
  vencimientos"; el front nunca renderiza `descripcion` cruda (texto interno). Copy de offset
  negativo en la agenda del cliente ("…días después del vencimiento").

Verificado: e2e §6 (BEGIN/DO RAISE EXCEPTION, 0 residuo): Neuquén → sólo renovación; CABA →
renovación + DDJJ@30/11 + curso, SIN certificado; churn 2ª corrida 1/1 (id estable). R16
overloads=0, tsc+build limpios.

**Nota (dato de prod) + operación de cierre (2026-10-30):** los 3 CABA reales (Avolio Marcela,
Baldonccini, SANCLAUDIO) habían marcado ellos mismos **DDJJ "No me corresponde"** (opt-out vía su
portal, 29/10) → el sistema respetaba el opt-out y no les avisaba. Probablemente opt-outearon
porque la ficha vieja mostraba la DDJJ **sin avisar nunca** (el hueco inverso que F9 cerró).
**Pablo decidió limpiar ese opt-out** → operación de datos puntual: `no_requiere = no_requiere -
'ddjj'` en los 3 (preservando sus OTROS opt-outs: renovación de Avolio Marcela, certificado de
SANCLAUDIO) + re-materialización (`perfil_declarado_sync_venc`). Resultado verificado: los 3
tienen `ddjj_anual_declarada@2026-11-30` y reciben el recordatorio en la próxima corrida del cron
de vencimientos (copy neutro CABA, sin "RPAC"). **Snapshot previo** (reversible): Avolio Marcela
`{ddjj,renovacion}` · Baldonccini `{ddjj}` · SANCLAUDIO `{ddjj,certificado}`.
