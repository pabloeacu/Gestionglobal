import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// El proyecto Supabase aún no existe (desarrollo local). Hasta que se configure
// .env, exponemos isConfigured para que la UI muestre un estado claro en vez
// de romper. NUNCA va la service-role key acá (regla 3 / AP-13).
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-placeholder',
  { auth: { persistSession: true, autoRefreshToken: true } },
);
