#!/usr/bin/env python3
"""One-shot helper: extracts the supabase types JSON payload to database.ts.
Created by 0035_solicitudes_wizard migration cycle and deleted afterwards."""
import json, sys, pathlib
src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
arr = json.loads(src.read_text())
payload = json.loads(arr[0]["text"])
dst.write_text(payload["types"])
print(f"OK -> {dst} ({len(payload['types'])} chars)")
