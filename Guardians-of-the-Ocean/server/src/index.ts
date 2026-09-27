import "dotenv/config";
import { loadEnv, productionWarnings } from "./env.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const env = loadEnv();
  for (const warning of productionWarnings(env)) console.warn(`[config] ${warning}`);

  const built = await buildApp(env);
  built.deps.payments.startSweeper();

  const server = built.app.listen(env.PORT, () => {
    console.log(
      `Harmony API listening on :${env.PORT} (store=${built.deps.store.kind}, stripe=${env.stripeEnabled ? "on" : "off"}, ` +
        `sms=${env.smsMode}, voice=${env.voiceMode}, mpesa=${env.mpesaMode}, airtel=${env.airtelMode}, pawapay=${env.pawapayMode}, simulator=${env.devTools ? "on" : "off"})`
    );
    if (!env.production) {
      console.log(`  Africa's Talking USSD callback: ${env.publicApiUrl}/api/at/${env.CALLBACK_TOKEN || "dev"}/ussd`);
    }
  });

  async function shutdown(): Promise<void> {
    server.close();
    await built.close();
  }

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
