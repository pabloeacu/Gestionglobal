# tests/sql — smokes R18 de las RPC de dinero

Red de QA de la **base de datos** (Auditoría 2026-09 · Fase B / B1). Complementa
los tests unitarios de `tests/unit/` (funciones puras de front): acá se **ejercita
la lógica plpgsql real** contra el esquema vivo, porque Postgres compila plpgsql
en runtime y una columna inexistente pasa `apply_migration` sin fallar (regla **R18**,
capitalizada de E-GG-42).

## Por qué no corren en el CI de GitHub

El workflow `.github/workflows/ci.yml` **no** ejecuta estos smokes: el runner de
GitHub Actions no tiene una base con los datos de producción (harían falta todas las
migraciones + datos sintéticos representativos). Son un **gate manual** que se corre
contra la base (vía el MCP de Supabase o `psql`) **antes de mergear cualquier
migración que toque el `INSERT`/`UPDATE` de una RPC de dinero** — que es exactamente
lo que exige R18. El CI cubre tipos + tests de libs puras + build; estos cubren el
comportamiento transaccional que el CI no puede ver.

## Cómo correrlos

Cada archivo es un bloque `DO $$ … $$` autocontenido que:
1. elige en runtime los datos base (un comprobante/matrícula, una caja, un gerente),
2. fija `request.jwt.claims` a un gerente para que `is_staff()` sea `true`. **Ojo:** bajo
   esa identidad la RPC hace **escrituras reales** (movimientos, imputaciones, y los
   triggers que recalculan saldo / estado de pago). No es una operación de sólo-lectura:
   lo que la hace segura es el **ROLLBACK garantizado**, no que no escriba.
3. ejercita la RPC,
4. verifica los invariantes, y
5. termina **siempre** con `RAISE EXCEPTION 'SMOKE_OK …'` que **fuerza el ROLLBACK** — no
   existe camino de finalización normal, así que **no persiste NADA** (ni movimientos,
   ni el push/mail del trigger de aviso a gerentes: queda contenido por el rollback + MVCC).

**Interpretación del resultado** (la ejecución SIEMPRE "falla" con un mensaje — es un
smoke que aborta a propósito):
- El mensaje **empieza con el token exacto `SMOKE_OK`** → **PASA**. El invariante se cumple; todo se revirtió.
- El mensaje empieza con `SMOKE_FAIL:` → **regresión**: la RPC dejó de ser idempotente/consistente. No mergear.
- El mensaje empieza con `SMOKE_SKIP:` → faltan datos base para ejercitar (p. ej. ningún comprobante con saldo).
- **Cualquier otro error** (auth `42501`, "supera el saldo", violación de constraint, etc.) **NO es un PASA**:
  es un fallo del smoke a investigar. Sólo `SMOKE_OK` cuenta como verde.

Por `psql` conviene envolverlo además en `BEGIN; \i archivo.sql ROLLBACK;` (el `RAISE`
final igual aborta la transacción; el `BEGIN/ROLLBACK` es cinturón y tiradores).

## Cobertura actual

| Archivo | RPC | Invariantes verificados |
|---|---|---|
| `smoke_registrar_cobranza_idempotencia.sql` | `registrar_cobranza_comprobante` | mismo `idempotency_key` → 1 movimiento + 1 imputación; key distinto → 2º movimiento; key `NULL` → sin dedup (2 movimientos) |
| `smoke_curso_registrar_pago_idempotencia.sql` | `curso_registrar_pago` | mismo `idempotency_key` → 1 movimiento + `idempotent_replay`; key distinto → 2º movimiento; key `NULL` → sin dedup (2 movimientos) |

## Para agregar un smoke a otra RPC de dinero

Las restantes con lógica de dinero (patrón a cubrir cuando se las toque): `pago_conciliar`,
`imputar_credito_a_comprobante`, `emitir_comprobante_manual`. Copiá un archivo existente,
cambiá los datos base que elige el `SELECT … INTO`, la llamada a la RPC y los invariantes
que verificás. Mantené el cierre con `RAISE 'SMOKE_OK …'` para garantizar el rollback.
