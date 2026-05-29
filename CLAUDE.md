# CLAUDE.md — Plataforma Gestión Global

> **Si arrancás una sesión nueva, leé en este orden:**
>   1. `PROJECT_STATUS.md` (raíz) — snapshot vivo de dónde quedó el proyecto,
>      qué se hizo, qué falta, qué se pateó. **OBLIGATORIO antes de cualquier
>      cambio**. Se actualiza después de cada chunk verificado (DGG-09).
>   2. Este archivo (`CLAUDE.md`) — contrato y 13 reglas no negociables.
>   3. `BACKLOG.md` (raíz) — plan maestro + rondas + backlog de mejoras.
>   4. `knowledge-base/DECISIONES.md` — decisiones DGG-##.
>   5. `knowledge-base/ERRORES.md` — bugs E## con causa raíz y fix.
>   6. (Si lo requiere el problema) `knowledge-base/00_LEEME_PRIMERO` → `05_*`
>      el contrato extendido capitalizado de MANAXER.
>
> Citar los IDs (E##, D##/DGG-##, P-XX-NN, regla N) al justificar decisiones.

## 1. Qué es

Ecosistema digital único de **Gestión Global** (servicios a administradores de
consorcios) bajo el dominio **gestionglobal.ar**. Tres accesos: panel de socios
gerentes, portal de administradores clientes, formularios públicos sin login.

## 2. Las 13 reglas no negociables

1. **Persistencia en BD siempre.** Toda mutación de negocio pasa por Supabase
   (INSERT/UPDATE/DELETE o RPC). `setState` sin persistir = bug.
2. **RLS activa en toda tabla.** `ENABLE ROW LEVEL SECURITY` no es opcional.
   `USING (true)` requiere comentario que lo justifique.
3. **Sin secretos en el front.** Service role keys, tokens, credenciales → edge
   functions. El front sólo conoce la anon key.
4. **Nada de `supabase.from()` en componentes.** Todo query vive en
   `src/services/api/`. Si lo ves en un componente, refactor antes de seguir.
5. **Operaciones multi-tabla → RPC.** 2+ tablas → `plpgsql` con
   `SECURITY DEFINER` y `SET search_path = public, pg_temp`.
6. **Migraciones versionadas con GRANTs explícitos.** Todo cambio de
   schema en `supabase/migrations/`. DDL a mano sin migración = deuda
   inmediata. **A partir de mig 0130 (post 30/10/2026 Supabase cambia
   default)**: toda `CREATE TABLE public.*` requiere `GRANT … TO
   authenticated` explícito en la misma migración. Patrón estándar:
   ```sql
   CREATE TABLE public.X (...);
   ALTER TABLE public.X ENABLE ROW LEVEL SECURITY;
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.X TO authenticated;
   -- (anon sólo si el flujo público lo necesita)
   CREATE POLICY ...
   ```
7. **Edge functions versionadas.** Toda edge function en prod existe como
   archivo en el repo. Drift → bajar y commitear.
8. **Español para dominio, inglés para tecnología.** Inglés en schema/BD/APIs,
   español en copy UI. **Excepción E43**: tablas pre-existentes con naming
   híbrido. Antes de RPC sobre tabla existente:
   `SELECT column_name FROM information_schema.columns WHERE table_name='...'`.
9. **Un error, un aprendizaje.** Todo bug >30 min se documenta en
   `knowledge-base/ERRORES.md` con ID `E##`.
10. **ARCH-REVIEW antes de cada deploy.** No se mergea sin informe limpio.
11. **EXPLAIN ANALYZE antes de exponer RPC al frontend.** >200ms con datos
    reales → optimizar. Toda FK debe tener su índice (Postgres NO los crea).
12. **Tenancy guard en RPCs SECURITY DEFINER.** Single-tenant: el eje no es
    `empresa` sino `administracion`. Toda RPC alcanzable por rol
    `administrador` que reciba `p_administracion_id` llama
    `public.assert_administracion_access(p_administracion_id)` al inicio. Los
    gerentes bypassan. (Adaptación de regla 12 / E45 / E49.)
13. **Ninguna ventana nativa del browser.** `window.confirm/alert/prompt`
    prohibidos. Usar `useConfirm()` / `usePrompt()` / `useAlert()`
    (`src/components/common/DialogProvider.tsx`). Toasts (`sonner`) sólo para
    feedback fugaz.

## 3. Decisiones de arranque (2026-05-19)

- **Single-tenant**: NO multiempresa. Sin tabla `empresas` / `empresa_id`.
  Configuración global en fila singleton `config_global` (datos fiscales,
  certs ARCA, email, branding, `proximo_dni_ficticio`).
- **Modelo de clientes**: `administraciones` (el cliente, administrador de
  consorcios) → `consorcios` (≈ edificios MANAXER, siempre vinculados a una
  administración). Un comprobante puede no tener consorcio (servicio personal
  del administrador) → `consorcio_id` NULL permitido.
- **ARCA desde el día 1** con vinculación asistida self-service
  (CSR → cert → test) + comprobantes simples (tipo X). ARCA es plugin
  (P-ARCA-04): el core factura sin ARCA.
- **Sin datos iniciales**: alta manual. Schema preparado para importar
  históricos de Excel después (campo `origen`).
- **Email**: Resend transaccional + `reply_to` a casillas Google Workspace
  del dominio. Throttle global 5 min hard (E42/D05). Cola + cron + Realtime.

## 4. Stack

React 18 + TS strict + Vite 6 + Tailwind + lucide + sonner · Supabase
(Postgres 15 + Auth + Storage + Edge/Deno) · pg_cron + pg_net · Resend ·
ARCA SOAP nativo (node-forge) · Web Push VAPID · NIC.ar → Cloudflare →
Vercel → GitHub → Supabase → Google Workspace.

## 5. Flujo de trabajo

Ciclo de cierre: `npm run build` limpio (incluye `tsc --noEmit` — D13) →
migraciones aplicadas → edge fns deployadas → commit del *por qué* → push a
`origin/main` (Vercel auto-deploya; "no pushear sin pedir" NO aplica acá) →
**browser test en vivo (URL Vercel) de cada cambio: apariencia + funcionalidad,
desktop + mobile 360px, casos borde** (método obligatorio 2026-05-21) →
`ERRORES.md`/`DECISIONES.md`/`PROJECT_STATUS.md` actualizados desde el día 1 (D10).
Operaciones destructivas: flujo de 8 pasos (doc 05 §5). Regenerar types tras
toda migración (`bash scripts/generate-types.sh`).
