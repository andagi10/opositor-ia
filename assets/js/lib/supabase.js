import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configurado = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON');

export const sb = createClient(
  configurado ? SUPABASE_URL : 'https://example.supabase.co',
  configurado ? SUPABASE_ANON_KEY : 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

/** Lanza el error de Supabase si existe y devuelve los datos. */
export function ok({ data, error }) {
  if (error) throw error;
  return data;
}

/** Llama a la Edge Function de IA con el token del usuario. */
export async function llamarIA(cuerpo) {
  const { data, error } = await sb.functions.invoke('ia', { body: cuerpo });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
