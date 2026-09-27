import { loadEnv, type Env } from "../env.js";
import { buildApp, type AppOverrides, type BuiltApp } from "../app.js";

export function testEnv(extra: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    AQUA_ASK_URL: "http://aqua.test",
    MOCK_CONFIRM_MS: "0",
    AGENT_PHONES: "0799000111",
    ...extra,
  } as NodeJS.ProcessEnv);
}

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** Routes fetch by URL substring; records every call. Unmatched URLs fail loudly. */
export function fakeFetch(routes: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: FetchCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    for (const [needle, handler] of Object.entries(routes)) {
      if (url.includes(needle)) return handler(url, init);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Aqua Ask stub: answers anything mentioning cholera, returns an off-topic answer for river water, knows nothing else. */
export const aquaRoutes = {
  "aqua.test/api/search": async (_url: string, init?: RequestInit) => {
    const { query } = JSON.parse(String(init?.body ?? "{}")) as { query: string };
    if (/cholera/i.test(query)) {
      return json({
        answer: "**Cholera** causes sudden watery diarrhoea and spreads through dirty water [1]. Early rehydration saves lives. See https://example.org",
        sources: [{ publication_title: "Cholera response review", section: "Results", source_origin: "x" }],
      });
    }
    if (/river water/i.test(query)) {
      // Real retrieval does this: a confident answer to a neighbouring question.
      return json({
        answer:
          "Earth observation and remote sensing are combined with in situ techniques to assess urban stream health. Satellite sensors map water-surface patterns. " +
          "[Source: From Space to Stream] Ustun A (2023) Burden of disease attributable to unsafe drinking water. WHO (2017) Guidelines for drinking-water quality.",
        sources: [{ publication_title: "Aquatic ecosystem indices" }],
      });
    }
    return json({ answer: "I do not have sufficient information in my knowledge base to answer this.", sources: [] });
  },
};

export async function testApp(extraEnv: Record<string, string> = {}, overrides: AppOverrides = {}): Promise<BuiltApp & { env: Env }> {
  const env = testEnv(extraEnv);
  const fetchImpl = overrides.fetchImpl ?? fakeFetch(aquaRoutes).impl;
  const built = await buildApp(env, { fetchImpl, ...overrides });
  return { ...built, env };
}

export const STUDENT = "0712345678"; // Safaricom
export const STUDENT_E = "254712345678";
export const AIRTEL_STUDENT = "0733123456";
export const AIRTEL_E = "254733123456";
export const TELKOM_STUDENT = "0771234567";
