#!/usr/bin/env bash
# Regenera src/types/database.ts desde el schema remoto de Supabase.
# Correr SIEMPRE después de aplicar una migración, antes de pushear
# (sino Vercel rompe el build) — doc 05 §5, regla 6.
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$PROJECT_REF" ]; then
  echo "Falta SUPABASE_PROJECT_REF. Ejemplo:"
  echo "  SUPABASE_PROJECT_REF=xxxx bash scripts/generate-types.sh"
  exit 1
fi

npx --yes supabase gen types typescript \
  --project-id "$PROJECT_REF" \
  --schema public \
  > src/types/database.ts

echo "OK · src/types/database.ts regenerado"
