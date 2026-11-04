// Orquestación del píxel de Meta — DGG-242.
// Monta dentro del Router (y de AuthProvider). Decide CUÁNDO cargar/disparar:
//   - sólo con VITE_META_PIXEL_ID configurada,
//   - sólo con consentimiento 'granted',
//   - sólo para visitantes ANÓNIMOS (sin sesión),
//   - sólo en rutas públicas de marketing (allowlist).
// Dispara PageView en cada cambio de ruta pública. Captura UTM first-touch en
// toda ruta (dato first-party para los formularios, independiente del píxel).

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getConsent, onConsentChange, type ConsentValue } from '@/lib/metaConsent';
import { metaPixelConfigured, initMetaPixel, trackPageView } from '@/lib/metaPixel';
import { captureUtmFirstTouch } from '@/lib/utmTracking';
import { isTrackablePath } from '@/lib/publicRoutes';

export function MetaPixel() {
  const location = useLocation();
  const { session } = useAuth();
  const [consent, setConsent] = useState<ConsentValue | null>(() => getConsent());

  // Reaccionar cuando el visitante acepta/rechaza en el aviso de cookies.
  useEffect(() => onConsentChange(setConsent), []);

  // First-touch UTM en toda ruta (first-party; no depende del píxel ni consent).
  useEffect(() => {
    captureUtmFirstTouch(location.search);
  }, [location.search]);

  // PageView en cada ruta pública (con consentimiento y anónimo). Init idempotente.
  useEffect(() => {
    const anon = !session;
    if (!metaPixelConfigured() || consent !== 'granted' || !anon) return;
    if (!isTrackablePath(location.pathname)) return;
    initMetaPixel();
    trackPageView();
  }, [location.pathname, consent, session]);

  return null;
}
