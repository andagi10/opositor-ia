(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { p.catch((e) => console.error('bg', e)); } };
await import('/home/claude/opositor-ia/supabase/functions/ia/index.ts');
