import express, { type Express } from "express";
import cors from "cors";
import type Stripe from "stripe";
import { type Env, mockAllowed } from "./env.js";
import { requireCheckoutAuth } from "./auth.js";
import { errorHandler, HttpError } from "./http.js";
import { Agent } from "./agent/agent.js";
import { Desk } from "./agent/desk.js";
import { AfricasTalking, type Messenger } from "./comms/africastalking.js";
import { ClickMobile, WithSmsFallback } from "./comms/clickmobile.js";
import type { Deps } from "./deps.js";
import { Airtel } from "./payments/airtel.js";
import { MockMoney } from "./payments/mock.js";
import { Mpesa } from "./payments/mpesa.js";
import { PawaPay } from "./payments/pawapay.js";
import { setDefaultCountry } from "./lib/phone.js";
import { Payments } from "./payments/service.js";
import type { MobileMoney } from "./payments/types.js";
import { mobileLedger, mobileRouter } from "./routes/mobile.js";
import { createStore } from "./store/index.js";
import type { Provider, Store } from "./store/types.js";

export interface AppOverrides {
  store?: Store;
  messenger?: Messenger;
  agent?: Agent;
  fetchImpl?: typeof fetch;
  providers?: Partial<Record<Provider, MobileMoney>>;
}

export interface BuiltApp {
  app: Express;
  deps: Deps;
  /** Resolves when all fire-and-forget work (SMS replies, pushes) has finished. */
  drain(): Promise<void>;
  close(): Promise<void>;
}

export async function buildApp(env: Env, overrides: AppOverrides = {}): Promise<BuiltApp> {
  setDefaultCountry(env.DEFAULT_COUNTRY);
  const fetchImpl = overrides.fetchImpl ?? fetch;
  const store = overrides.store ?? (await createStore(env));
  const messenger = overrides.messenger ?? new WithSmsFallback(new AfricasTalking(env, store, fetchImpl), new ClickMobile(env, store, fetchImpl));

  const mocks: Deps["mocks"] = {};
  function rail(name: Provider): MobileMoney {
    const given = overrides.providers?.[name];
    if (given) return given;
    const mode = name === "mpesa" ? env.mpesaMode : name === "airtel" ? env.airtelMode : env.pawapayMode;
    if (mode === "mock") {
      const mock = new MockMoney(name, env.MOCK_CONFIRM_MS);
      mocks[name] = mock;
      return mock;
    }
    const token = env.CALLBACK_TOKEN || "dev";
    if (name === "mpesa") return new Mpesa(env, `${env.publicApiUrl}/api/pay/mpesa/callback/${token}`, fetchImpl);
    if (name === "airtel") return new Airtel(env, fetchImpl);
    return new PawaPay(env, fetchImpl);
  }
  const providers = { mpesa: rail("mpesa"), airtel: rail("airtel"), pawapay: rail("pawapay") };
  const payments = new Payments(env, store, messenger, providers);
  for (const mock of Object.values(mocks)) {
    mock!.onSettled = (provider, ref, outcome) => {
      void payments.onProviderOutcome(provider, ref, outcome);
    };
  }

  const pending = new Set<Promise<unknown>>();
  const background = (task: () => Promise<unknown>) => {
    const p = task()
      .catch((err) => console.warn("[background]", (err as Error).message))
      .finally(() => pending.delete(p));
    pending.add(p);
  };

  const agent = overrides.agent ?? new Agent(env, fetchImpl);
  const desk = new Desk(env, store, messenger);
  const deps: Deps = { env, store, messenger, payments, agent, desk, mocks, background };

  const app = express();
  app.set("trust proxy", 1);

  const allowed = env.FRONTEND_ORIGIN.split(",").map((s) => s.trim());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowed.includes(origin) || allowed.includes("*")) {
          cb(null, true);
          return;
        }
        cb(null, false);
      },
    })
  );

  // Stripe needs the raw body, so its webhook is registered before the JSON parser.
  let stripe: Stripe | null = null;
  if (env.stripeEnabled) {
    const [{ createStripe }, { createWebhookHandler }] = await Promise.all([import("./stripe.js"), import("./routes/webhook.js")]);
    stripe = createStripe(env);
    app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), createWebhookHandler(stripe, env));
  }

  app.use(express.json({ limit: "32kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      store: store.kind,
      stripe: env.stripeEnabled,
      sms: messenger.smsMode,
      smsFallback: env.CLICKMOBILE_SMS_URL && env.CLICKMOBILE_API_KEY ? "clickmobile" : "none",
      voice: messenger.voiceMode,
      mpesa: providers.mpesa.mode,
      airtel: providers.airtel.mode,
      pawapay: providers.pawapay.mode,
      mockPayments: mockAllowed(env) && Object.values(providers).some((p) => p.mode === "mock"),
    });
  });

  const ledger = () => mobileLedger(deps);
  if (stripe) {
    const [{ createCheckoutHandler }, { createBalanceHandler, createOrderStatusHandler }] = await Promise.all([
      import("./routes/checkout.js"),
      import("./routes/balance.js"),
    ]);
    app.post("/api/checkout", requireCheckoutAuth(env), createCheckoutHandler(stripe, env));
    const balance = createBalanceHandler(stripe, ledger);
    app.get("/api/balance", balance);
    app.get("/api/ledger", balance);
    app.get("/api/orders/status", createOrderStatusHandler());
  } else {
    const { createMobileOnlyLedgerHandler } = await import("./routes/balance.js");
    const balance = createMobileOnlyLedgerHandler(ledger);
    app.get("/api/balance", balance);
    app.get("/api/ledger", balance);
    app.post("/api/checkout", (_req, _res, next) => next(new HttpError(503, "Card payments are not set up on this server yet")));
    app.get("/api/orders/status", (_req, _res, next) => next(new HttpError(503, "Card payments are not set up on this server yet")));
  }

  app.use(mobileRouter(deps));
  app.use(errorHandler);

  return {
    app,
    deps,
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    async close() {
      payments.stopSweeper();
      await store.close();
    },
  };
}
