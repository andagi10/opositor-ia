// =====================================================================
// Configuración pública del proyecto Supabase.
// La "anon key" (o "publishable key") es pública por diseño: la seguridad
// la garantizan las políticas RLS de la base de datos.
// NUNCA pongas aquí la service_role key ni la clave de la API de IA.
// =====================================================================
export const SUPABASE_URL = 'https://hrqcowdfxbqltblyogce.supabase.co/rest/v1/';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhycWNvd2RmeGJxbHRibHlvZ2NlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MDM1NzMsImV4cCI6MjEwOTQ3OTU3M30.lizwILvkIsN97kZwHmhipkOPxEpaJtDnP6K6MBOVvNo';

// Zona horaria usada para agrupar estadísticas por día
export const ZONA_HORARIA = 'Europe/Madrid';
