import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// DGG-46 (TRAMIX) · sonda de egress NEUTRALIZADA tras confirmar (2026-06-04)
// que el runtime de Edge llega a tramix:8080 (status 200, JSESSIONID, 238ms).
// Sin fetch externo. La reemplaza `tramix-consulta` (producción) con auth +
// sesión + parser + throttle. verify_jwt = true.
Deno.serve(() =>
  new Response(JSON.stringify({ note: "egress verificado · reemplazar por tramix-consulta (Fase 1)" }), {
    headers: { "Content-Type": "application/json" },
  })
);
