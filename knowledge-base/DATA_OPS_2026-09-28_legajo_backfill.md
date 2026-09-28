# DATA-OP 2026-09-28 — Backfill masivo de LEGAJO RPAC desde padrón PBA

> Operación de **datos** (no schema, no código) sobre `public.administraciones`
> en **producción**. Registrada acá para auditoría + reversibilidad (espíritu R6:
> toda mutación relevante deja rastro en el repo). Continúa DGG-206 (integración
> del legajo en el perfil regulatorio).

## Contexto

Pablo aportó `Datos matriculados en PBA.xlsx` (padrón de matriculados de la
Prov. Bs. As.: columnas `Matricula, Legajo, Nombre y apellido, CUIT, Mail,
SANCIONES`; ~2.241 filas válidas con CUIT de 11 dígitos + legajo). Pedido:
"si estamos seguros que es la misma persona, completá la ficha… avisame cuántos
casos nos quedan y pasame un excel con 'Legajo, nombre y cuit'".

**Clave de identidad usada: CUIT normalizado** (`regexp_replace(cuit,'[^0-9]','','g')`,
11 dígitos, último dígito verificador). Para las limpiezas de formato se exigió
además **coincidencia de matrícula** (doble confirmación CUIT+matrícula).

Universo: **130 clientes reales** (se excluye la cuenta de test GG Cursos,
CUIT 23123456785).

## Resultado

| Estado legajo | Antes | Después |
|---|---|---|
| Limpio (`^[0-9]{4,6}$`) | 62 | **96** |
| Junk (con prefijo/basura) | 9 | **0** |
| Vacío | 59 | **34** |

Cobertura de legajo utilizable: **48% → 74%** (+34 fichas).

- **25** legajos vacíos completados desde el padrón (3 de ellos también matrícula:
  Juárez 423, Duro 2253, Barraza 1716).
- **9** legajos "junk" limpiados a su número real confirmado (8 con prefijo
  `X/NNNNNN` o separador; **Cubas** era reparación total: los campos tenían
  "Buenos Aires"/"La Plata").
- **2** matrículas residuales limpiadas (Escudero `559 legajo 277491`→`559`,
  Santillán `193 - Legajo 275765`→`193`), confirmadas por padrón.
- **34** clientes quedan sin legajo porque **no figuran en el padrón PBA** (se
  entregó a Pablo `Clientes sin legajo - para completar.xlsx`, cols
  Legajo/Nombre/CUIT). 0 clientes fillables quedaron sin completar.

## Método (seguridad ante error de transcripción)

- **Fills (vacíos):** `SET legajo_rpac = COALESCE(NULLIF(legajo_rpac,''), '<val>')`
  → sólo escribe si el campo está vacío; nunca pisa. Guard `WHERE id=X AND
  cuit_normalizado=Y`. Peor caso de un error de transcripción = un miss, jamás
  una escritura errónea.
- **Cleanups (junk):** guard adicional `AND legajo_rpac='<valor junk exacto>'`
  → no-op si el valor actual no es el basura verificado.

## Verificación (§6 ejercitar e2e)

RPC real que consume la UI, con contexto de gerente (bypass del tenancy guard R12):

```sql
BEGIN;
SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"49aca7aa-b4fb-4855-aaf3-f05ddafa56d5","role":"authenticated"}';
SELECT public.perfil_regulatorio_get('<admin_id>')->'legajo';
ROLLBACK;
```

PALOPOLO → `{"nro":"275385","nro_certeza":"confirmado"}`, `completitud_pct=44`.
Cubas (reparado) → legajo `confirmado`. El legajo entra como factor de
completitud (DGG-206). No hay deploy de código: la superficie de display
(PerfilRegulatorioPanel / portal) ya se validó en vivo en DGG-206.

## SQL aplicado

Ver más abajo. Para **revertir**: los 25 fills escribieron `legajo_rpac`
(y 3 matrículas) sobre campos que estaban vacíos → revertir = volver esos ids a
`''` (mapping exacto en el bloque FILLS). Los cleanups reemplazaron valores junk
conocidos → revertir = volver al valor junk original (columna izquierda del bloque
CLEANUPS).

### FILLS (25) — legajo (+matrícula donde se indica)

```
20307283159 PALOPOLO           -> legajo 275385
20174229210 Escudero           -> legajo 277491
20208273303 Santillan          -> legajo 275765
27332245460 Juarez             -> legajo 276925, matricula 423
27371713714 Duro               -> legajo 299301, matricula 2253
20234419936 Barraza            -> legajo 288518, matricula 1716
23208324004 Marzal             -> legajo 279738
27290836684 Pereyra Marisa     -> legajo 278059
20244364404 Florín             -> legajo 283856
20271013168 Cerda              -> legajo 277789
20234862112 Falco              -> legajo 277792
20281289269 Althabe            -> legajo 276478
27223553945 Taraburelli        -> legajo 277006
27922198611 Marsiglia          -> legajo 291425
20168985119 Webb               -> legajo 275159
27203556840 Amado              -> legajo 275160
27289359090 Lubrano            -> legajo 276762
27204641523 Rodriguez Monica   -> legajo 291196
27113843115 Lozano             -> legajo 291339
27281295409 Sanchez Eugenia    -> legajo 290855
27254765525 Quiroga            -> legajo 291411
20140531856 Alvarez            -> legajo 278528
24260998915 Carabajal          -> legajo 280858
24188972337 Gonzalez Acosta    -> legajo 275736
20233143295 Sabino             -> legajo 278186
```

### CLEANUPS (11)

```
27172351633 Calvento    legajo '30/277078'  -> '277078'
20295937093 De Luca     legajo '279.373'    -> '279373'
23082869239 DePaoli     legajo '2/280470'   -> '280470'
20328438578 Giordanino  legajo '2/278392'   -> '278392'
23436577249 Gomez Elian legajo '2/298878'   -> '298878'
27265587289 Iglesias    legajo '23/277389'  -> '277389'
20246528773 Libano      legajo '51/277394'  -> '277394'
27251450833 Mercerat    legajo '2/276377'   -> '276377'
27256381554 Cubas       legajo 'Buenos Aires'->'283372', matricula 'La Plata'->'1339'
20174229210 Escudero    matricula '559 legajo 277491'  -> '559'
20208273303 Santillan   matricula '193 - Legajo 275765'-> '193'
```

El SQL literal ejecutado (con los guards id+cuit) quedó en la sesión de Claude
del 2026-09-28.
