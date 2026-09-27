import { z } from "zod";

const text = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim());

function isOn(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(raw ?? "").trim().toLowerCase());
}

const envSchema = z.object({
  NODE_ENV: text,
  PORT: z.coerce.number().int().positive().default(8787),

  // Postgres. Without it the mobile features run on an in-memory store (dev / demo only).
  DATABASE_URL: text,

  // Stripe card checkout. Card routes answer 503 until the keys and a database are set.
  STRIPE_SECRET_KEY: text,
  STRIPE_WEBHOOK_SECRET: text,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: text,
  FRONTEND_ORIGIN: z.string().min(1).default("http://127.0.0.1:8765,http://localhost:8765"),
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:8765"),
  CHECKOUT_USER_SECRET: z.string().optional().default(""),
  CHECKOUT_AMOUNT_CENTS: z.coerce.number().int().min(50).max(1_000_000).default(2500),
  CHECKOUT_CURRENCY: z.string().min(3).max(3).default("usd"),

  // Public origin of this API, used to build provider callback URLs. Render sets RENDER_EXTERNAL_URL.
  PUBLIC_API_URL: text,
  RENDER_EXTERNAL_URL: text,
  // Secret path segment on payment callbacks (M-Pesa does not sign its callbacks).
  CALLBACK_TOKEN: text,
  // Bearer token for the agent console and broadcasts.
  ADMIN_TOKEN: text,
  // Simulator + outbox endpoints. Defaults to on outside production.
  DEV_TOOLS: z.string().optional(),

  // Africa's Talking: SMS, USSD, voice. Username "sandbox" targets the sandbox.
  AT_USERNAME: text,
  AT_API_KEY: text,
  AT_SMS_FROM: text,
  AT_VOICE_NUMBER: text,
  USSD_CODE: z.string().optional().default("*384*2026#"),
  SMS_SHORTCODE: z.string().optional().default("22384"),

  // Safaricom Daraja (M-Pesa Express / STK push).
  MPESA_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  MPESA_CONSUMER_KEY: text,
  MPESA_CONSUMER_SECRET: text,
  MPESA_SHORTCODE: text,
  MPESA_PASSKEY: text,
  MPESA_TYPE: z.enum(["paybill", "till"]).default("paybill"),
  MPESA_PARTY_B: text,
  MPESA_ACCOUNT_REF: z.string().optional().default("HARMONY"),

  // pawaPay: pan-African mobile money (20 countries) through one API. The fallback rail for
  // every wallet without a direct integration, and for Kenyan M-Pesa when Daraja is not set.
  PAWAPAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PAWAPAY_API_TOKEN: text,

  // Country used for numbers typed without a country code (ISO 3166 alpha-2).
  DEFAULT_COUNTRY: z.string().optional().default("KE"),

  // Airtel Africa Open API (Airtel Money collection / USSD push).
  AIRTEL_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  AIRTEL_CLIENT_ID: text,
  AIRTEL_CLIENT_SECRET: text,
  AIRTEL_COUNTRY: z.string().optional().default("KE"),
  AIRTEL_CURRENCY: z.string().optional().default("KES"),

  // The learning agent.
  AQUA_ASK_URL: z.string().optional().default("https://aqua-ask.onrender.com"),
  GOOGLE_API_KEY: text,
  GOOGLE_CHAT_MODEL: z.string().optional().default("gemini-2.5-flash-lite"),
  AGENT_PHONES: text,

  // Community goal on the support meter, counted in gifts because gifts arrive in many currencies.
  MOBILE_GOAL_GIFTS: z.coerce.number().int().min(1).default(500),
  // Mock payments confirm themselves after this many ms (0 = wait for the simulator).
  MOCK_CONFIRM_MS: z.coerce.number().int().min(0).default(8000),
});

type RawEnv = z.infer<typeof envSchema>;

export type Mode = "live" | "sandbox" | "mock";

export type Env = RawEnv & {
  production: boolean;
  devTools: boolean;
  publicApiUrl: string;
  agentPhones: string[];
  stripeEnabled: boolean;
  dbEnabled: boolean;
  smsMode: Mode;
  voiceMode: Mode;
  mpesaMode: Mode;
  airtelMode: Mode;
  pawapayMode: Mode;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment: ${JSON.stringify(details)}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";
  const publicApiUrl = (e.PUBLIC_API_URL || e.RENDER_EXTERNAL_URL || `http://127.0.0.1:${e.PORT}`).replace(/\/$/, "");

  const atReady = !!(e.AT_USERNAME && e.AT_API_KEY);
  const atMode: Mode = !atReady ? "mock" : e.AT_USERNAME === "sandbox" ? "sandbox" : "live";
  const smsMode = atMode;
  const voiceMode: Mode = atReady && e.AT_VOICE_NUMBER ? atMode : "mock";
  const mpesaReady = !!(e.MPESA_CONSUMER_KEY && e.MPESA_CONSUMER_SECRET && e.MPESA_SHORTCODE && e.MPESA_PASSKEY);
  const mpesaMode: Mode = !mpesaReady ? "mock" : e.MPESA_ENV === "production" ? "live" : "sandbox";
  const airtelReady = !!(e.AIRTEL_CLIENT_ID && e.AIRTEL_CLIENT_SECRET);
  const airtelMode: Mode = !airtelReady ? "mock" : e.AIRTEL_ENV === "production" ? "live" : "sandbox";
  const pawapayMode: Mode = !e.PAWAPAY_API_TOKEN ? "mock" : e.PAWAPAY_ENV === "production" ? "live" : "sandbox";

  // The simulator can play any phone number. That is harmless while every channel is a mock,
  // but with real gateways it would let anyone send SMS and PIN prompts to strangers, so a
  // production server only keeps it while nothing real is connected.
  const allMock = [smsMode, voiceMode, mpesaMode, airtelMode, pawapayMode].every((m) => m === "mock");
  const wanted = e.DEV_TOOLS == null || e.DEV_TOOLS.trim() === "" ? !production : isOn(e.DEV_TOOLS);
  const devTools = wanted && (!production || allMock);

  return {
    ...e,
    production,
    devTools,
    publicApiUrl,
    agentPhones: e.AGENT_PHONES.split(",").map((s) => s.trim()).filter(Boolean),
    stripeEnabled: !!(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET && e.DATABASE_URL),
    dbEnabled: !!e.DATABASE_URL,
    smsMode,
    voiceMode,
    mpesaMode,
    airtelMode,
    pawapayMode,
  };
}

/**
 * Mock providers (fake STK prompts, SMS outbox) are only allowed when the simulator is on.
 * In production that means DEV_TOOLS=1 was set on purpose, e.g. for a demo deploy.
 */
export function mockAllowed(env: Env): boolean {
  return env.devTools;
}

/** Misconfigurations worth shouting about at boot. The server still starts so card checkout keeps working. */
export function productionWarnings(env: Env): string[] {
  if (!env.production) return [];
  const warnings: string[] = [];
  if (!env.dbEnabled) warnings.push("DATABASE_URL is not set: mobile payments and students live in memory and vanish on restart");
  if (env.CALLBACK_TOKEN.length < 16) warnings.push("CALLBACK_TOKEN (16+ chars) is not set: M-Pesa and Airtel callbacks are refused");
  if (env.ADMIN_TOKEN.length < 16) warnings.push("ADMIN_TOKEN (16+ chars) is not set: the agent console and broadcasts are locked");
  if (env.devTools) warnings.push("DEV_TOOLS is on in production: the simulator and practice payments are public (it switches off once real gateways are set)");
  if (!env.devTools && isOn(env.DEV_TOOLS)) warnings.push("DEV_TOOLS was ignored because real SMS or payment gateways are connected");
  return warnings;
}
