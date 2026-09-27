import type { Env } from "./env.js";
import type { Messenger } from "./comms/africastalking.js";
import type { Agent } from "./agent/agent.js";
import type { Desk } from "./agent/desk.js";
import type { Payments } from "./payments/service.js";
import type { MockMoney } from "./payments/mock.js";
import type { Store } from "./store/types.js";

/** Everything the mobile channels need, wired once in app.ts and swappable in tests. */
export interface Deps {
  env: Env;
  store: Store;
  messenger: Messenger;
  payments: Payments;
  agent: Agent;
  desk: Desk;
  /** Present for providers running in practice mode, so the simulator can answer their prompts. */
  mocks: Partial<Record<"mpesa" | "airtel" | "pawapay", MockMoney>>;
  /** Fire-and-forget work (SMS answers after a USSD session ends). Tests await it via drain(). */
  background(task: () => Promise<unknown>): void;
}
