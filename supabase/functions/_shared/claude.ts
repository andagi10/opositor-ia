// Cliente mínimo de la API de Anthropic con salida estructurada (tool use forzado) y reintentos.

const API_URL = (Deno.env.get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com") + "/v1/messages";

export type Bloque =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export interface Herramienta {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export class ErrorIA extends Error {
  constructor(msg: string, public reintentable = false) { super(msg); }
}

export async function llamarClaude<T>(opts: {
  sistema: string;
  contenido: Bloque[];
  herramienta: Herramienta;
  maxTokens?: number;
  temperatura?: number;
}): Promise<T> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new ErrorIA("Falta el secreto ANTHROPIC_API_KEY en Supabase.");
  const modelo = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5";

  const cuerpo = {
    model: modelo,
    max_tokens: opts.maxTokens ?? 8000,
    temperature: opts.temperatura ?? 0.3,
    system: opts.sistema,
    tools: [opts.herramienta],
    tool_choice: { type: "tool", name: opts.herramienta.name },
    messages: [{ role: "user", content: opts.contenido }],
  };

  let ultimoError = "";
  const t0 = Date.now();
  for (let intento = 0; intento < 3; intento++) {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(cuerpo),
      });
    } catch (e) {
      ultimoError = `Error de red: ${e}`;
      await esperar(2000 * (intento + 1));
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      console.log(`[ia] ${modelo} · ${opts.herramienta.name} · ${Date.now() - t0} ms · ${data.usage?.output_tokens ?? "?"} tokens de salida`);
      const bloque = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
      if (!bloque) throw new ErrorIA("La IA no devolvió datos estructurados.", true);
      if (data.stop_reason === "max_tokens") {
        throw new ErrorIA("La respuesta de la IA se cortó por longitud. Reintenta con menos preguntas por fragmento.", true);
      }
      return bloque.input as T;
    }

    const texto = await res.text();
    ultimoError = `API ${res.status}: ${texto.slice(0, 300)}`;
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const espera = Number(res.headers.get("retry-after")) * 1000 || 4000 * (intento + 1);
      await esperar(Math.min(espera, 20000));
      continue;
    }
    // 4xx no reintentables (clave inválida, petición mal formada...)
    throw new ErrorIA(ultimoError, false);
  }
  throw new ErrorIA(ultimoError || "La IA no respondió.", true);
}

function esperar(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
