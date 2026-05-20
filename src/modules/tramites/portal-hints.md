# Portal del administrador — Integración con Trámites

> Notas para el agent que esté implementando `src/modules/portal/` (Phase 2B).
> El módulo de trámites (Phase 2D) ya expone las APIs necesarias.

## Cómo consumir trámites desde el portal

Los siguientes endpoints están disponibles en `@/services/api/tramites` y
respetan la RLS: como administrador autenticado, solo ves los trámites donde
`administracion_id = private.current_administracion_id()`.

```ts
import {
  listMisTramites,
  getTramite,
  addComentario,
  subirAdjunto,
  urlFirmadaAdjunto,
  computeSla,
} from '@/services/api/tramites';
```

### Listar mis trámites
```ts
const res = await listMisTramites();
// res.data: TramiteListItem[]
```

### Detalle (con comentarios visibles para el cliente + adjuntos + eventos)
```ts
const res = await getTramite(id);
// La RLS filtra automáticamente los comentarios visible_para='staff'.
```

### Responder al trámite (administrador)
```ts
await addComentario(tramiteId, 'Adjunto la documentación solicitada', 'todos');
// Para administrador, RLS fuerza visible_para='todos' y autor_role='administrador'.
// El service ya lo resuelve transparentemente — pasar 'todos' es lo más limpio.
```

### Subir un adjunto desde el portal
```ts
await subirAdjunto(tramiteId, file);
// Path en storage: <tramite_id>/<timestamp>_<filename>
// La policy de storage.objects valida que el tramite pertenezca a la
// administracion del usuario.
```

### Previsualizar un adjunto (signed URL temporal)
```ts
const res = await urlFirmadaAdjunto(adjunto.storage_path, 600);  // 10 min
```

### SLA / días para vencer
```ts
const sla = computeSla(tramite);
// { diasRestantes, vencido, diasAbierto }
```

## Lo que NO puede hacer un administrador

- No puede crear trámites desde el front (regla de negocio: gerencia genera el
  expediente desde un submission o manualmente). Si querés permitirlo, lo
  agregamos como RPC `crear_tramite_propio` con guard de tenancy.
- No puede cambiar `estado`, `prioridad`, `asignado_a`, ni cualquier campo del
  trámite. La RLS solo le permite SELECT.
- No puede ver comentarios con `visible_para='staff'`.

## Hooks útiles

- Realtime: `useRealtimeRefresh(['tramites','tramite_comentarios','tramite_adjuntos'], onChange)`
- Para una vista tipo card con SLA chip, mirá
  `src/modules/tramites/pages/TramitesKanbanPage.tsx`.

## Push notifications (futuro)

Cuando se quiera notificar al administrador de un nuevo comentario "todos" o
"cliente", el trigger `tramite_on_comentario_insert` ya inserta un evento; un
edge function `notify-tramite-actualizado` con pg_cron + Web Push VAPID puede
disparar el aviso. Aún no implementado.
