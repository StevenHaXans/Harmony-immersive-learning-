import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { COUNTRIES, countryByCode, money, walletFromWord } from "../lib/countries.js";
import { countryOf, maskPhone, networkOf, normalizePhone, prettyPhone } from "../lib/phone.js";
import { handleUssd } from "../channels/ussd.js";
import { handleSms } from "../channels/sms.js";
import { customerMessage, outcomeForDeposit, PawaPay } from "../payments/pawapay.js";
import { isGsm7, USSD_MAX } from "../lib/text.js";
import { aquaRoutes, fakeFetch, json, testApp, testEnv } from "./helpers.js";

const UG_MTN = "+256772123456";
const GH_MTN = "+233241234567";
const BJ = "+2290197123456";
const CI_ORANGE = "+2250701234567";
const ZM_AIRTEL = "+260971234567";

test("every country is internally consistent", () => {
  for (const c of COUNTRIES) {
    assert.ok(c.wallets.length > 0, `${c.code} has wallets`);
    assert.ok(c.amounts.every((a) => a >= c.min && a <= c.max), `${c.code} presets within limits`);
    for (const w of c.wallets) {
      assert.ok(w.pawapay || w.direct, `${c.code}/${w.id} has a rail`);
      if (w.pawapay) assert.ok(w.pawapay.endsWith(c.iso3), `${w.pawapay} belongs to ${c.iso3}`);
    }
  }
  assert.equal(new Set(COUNTRIES.map((c) => c.dial)).size, COUNTRIES.length, "dial codes are unique");
});

test("numbers from across Africa normalise and resolve to country and network", () => {
  assert.equal(normalizePhone("+256 772 123 456"), "256772123456");
  assert.equal(normalizePhone("0772123456", "UG"), "256772123456");
  assert.equal(normalizePhone("0701234567", "CI"), "2250701234567");
  assert.equal(normalizePhone("0241234567", "GH"), "233241234567");
  assert.equal(normalizePhone("0803 123 4567", "NG"), "2348031234567");
  assert.equal(normalizePhone("256772123456"), "256772123456", "international without plus");
  assert.equal(normalizePhone("+999123456789"), "");
  assert.equal(countryOf(UG_MTN)?.code, "UG");
  assert.equal(networkOf(UG_MTN), "mtn");
  assert.equal(networkOf(GH_MTN), "mtn");
  assert.equal(networkOf(CI_ORANGE), "orange");
  assert.equal(networkOf(ZM_AIRTEL), "airtel");
  assert.equal(networkOf("+2348031234567"), "mtn");
  assert.equal(networkOf(BJ), "unknown");
  assert.equal(networkOf("+256712345678", "64101"), "airtel", "USSD networkCode wins over prefix");
  assert.equal(prettyPhone(UG_MTN), "+256 772 123 456");
  assert.equal(maskPhone(UG_MTN), "+256 772 ***456");
  assert.equal(prettyPhone("254712345678"), "0712 345 678", "home country stays local");
});

test("money labels and wallet words", () => {
  assert.equal(money(5000, "UGX"), "UGX 5,000");
  const gh = countryByCode("GH")!;
  assert.equal(walletFromWord(gh, "mtn")?.pawapay, "MTN_MOMO_GHA");
  assert.equal(walletFromWord(gh, "Telecel")?.pawapay, "VODAFONE_GHA");
  assert.equal(walletFromWord(countryByCode("KE")!, "MPESA")?.id, "mpesa");
  assert.equal(walletFromWord(gh, "orange"), null);
});

test("pawaPay: deposit request shape, rejection handling, status mapping", async () => {
  const env = testEnv({ PAWAPAY_API_TOKEN: "pp-token" });
  const api = fakeFetch({
    "/v2/deposits": (url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        if (body.payer.accountDetails.phoneNumber === "256700000000") {
          return json({ depositId: body.depositId, status: "REJECTED", failureReason: { failureCode: "PROVIDER_TEMPORARILY_UNAVAILABLE", failureMessage: "down" } });
        }
        return json({ depositId: body.depositId, status: "ACCEPTED", created: "2026-09-27T12:00:00Z" });
      }
      return json({ status: "FOUND", data: { status: "COMPLETED", providerTransactionId: "MP-777" } });
    },
  });
  const pp = new PawaPay(env, api.impl);
  assert.equal(pp.mode, "sandbox");
  const pushed = await pp.push({ paymentId: "pay_1", phone: "256772123456", amount: 5000, currency: "UGX", walletCode: "MTN_MOMO_UGA", reference: "HARMONY", description: "Harmony coast" });
  assert.match(pushed.providerRef, /^[0-9a-f-]{36}$/);
  const sent = JSON.parse(String(api.calls[0].init!.body));
  assert.equal(api.calls[0].url, "https://api.sandbox.pawapay.io/v2/deposits");
  assert.deepEqual(sent.payer, { type: "MMO", accountDetails: { phoneNumber: "256772123456", provider: "MTN_MOMO_UGA" } });
  assert.equal(sent.amount, "5000");
  assert.equal(sent.currency, "UGX");
  assert.equal(sent.clientReferenceId, "pay_1");
  assert.equal(sent.customerMessage, "Harmony coast");
  assert.equal((api.calls[0].init!.headers as Record<string, string>).Authorization, "Bearer pp-token");

  await assert.rejects(
    pp.push({ paymentId: "pay_2", phone: "256700000000", amount: 5000, currency: "UGX", walletCode: "AIRTEL_OAPI_UGA", reference: "H", description: "Harmony coast" }),
    /PROVIDER_TEMPORARILY_UNAVAILABLE/
  );
  assert.deepEqual(await pp.query(pushed.providerRef), { status: "paid", receipt: "MP-777" });

  assert.equal(outcomeForDeposit({ status: "FAILED", failureReason: { failureCode: "PAYMENT_NOT_APPROVED" } }).status, "cancelled");
  assert.equal(outcomeForDeposit({ status: "PROCESSING" }).status, "pending");
  assert.equal(customerMessage("Harmony: coast & reef!"), "Harmony coast reef");
  assert.equal(customerMessage("!!"), "Harmony");
});

test("USSD in Uganda: MTN line pays in UGX through the pan-African rail", async () => {
  const built = await testApp();
  const sid = "ug-1";
  const menu = await handleUssd(built.deps, { sessionId: sid, phoneNumber: UG_MTN, text: "5", networkCode: "64110" });
  assert.match(menu, /UGX 1,000[\s\S]*UGX 5,000/);
  assert.match(await handleUssd(built.deps, { sessionId: sid, phoneNumber: UG_MTN, text: "5*3", networkCode: "64110" }), /Pay UGX 5,000 with MTN MoMo/);
  assert.match(await handleUssd(built.deps, { sessionId: sid, phoneNumber: UG_MTN, text: "5*3*1", networkCode: "64110" }), /MTN MoMo PIN prompt/);
  await built.drain();
  const [p] = await built.deps.store.paymentsForPhone("256772123456", 1);
  assert.equal(p.provider, "pawapay");
  assert.equal(p.wallet, "mtn");
  assert.equal(p.currency, "UGX");
  assert.equal(p.country, "UG");
  const prompt = built.deps.mocks.pawapay!.openPrompts("256772123456")[0];
  built.deps.mocks.pawapay!.respond(prompt.ref, "pin", "2468");
  await new Promise((r) => setTimeout(r, 10));
  await built.drain();
  const sms = built.deps.messenger.outbox("256772123456", 10).map((m) => m.body).at(-1)!;
  assert.match(sms, /^Asante! UGX 5,000 received via MTN MoMo\. Ref MP/);
});

test("USSD in Benin: network unknown, so the student picks a wallet first", async () => {
  const built = await testApp();
  const sid = "bj-1";
  const pick = await handleUssd(built.deps, { sessionId: sid, phoneNumber: BJ, text: "5" });
  assert.match(pick, /^CON Pay with:\n1\. MTN MoMo\n2\. Moov Money/);
  assert.match(await handleUssd(built.deps, { sessionId: sid, phoneNumber: BJ, text: "5*2" }), /XOF 500/);
  assert.match(await handleUssd(built.deps, { sessionId: sid, phoneNumber: BJ, text: "5*2*2" }), /Pay XOF 1,000 with Moov Money/);
  assert.match(await handleUssd(built.deps, { sessionId: sid, phoneNumber: BJ, text: "5*2*2*1" }), /Moov Money PIN prompt/);
  await built.drain();
  assert.equal((await built.deps.store.paymentsForPhone("2290197123456", 1))[0].wallet, "moov");
  for (const text of ["5", "5*1", "5*1*4", "5*1*1", "6"]) {
    const r = await handleUssd(built.deps, { sessionId: "bj-2", phoneNumber: BJ, text });
    assert.ok(r.length <= USSD_MAX && isGsm7(r), `${text}: ${r}`);
  }
});

test("SMS PAY in Ghana and Côte d'Ivoire, with and without a wallet word", async () => {
  const built = await testApp();
  assert.match((await handleSms(built.deps, GH_MTN, "PAY 20"))!, /MTN MoMo PIN to give GHS 20/);
  assert.match((await handleSms(built.deps, GH_MTN, "PAY 20 TELECEL"))!, /That looks like a MTN number/);
  assert.match((await handleSms(built.deps, CI_ORANGE, "PAY 2000"))!, /Orange Money PIN to give XOF 2,000/);
  assert.match((await handleSms(built.deps, BJ, "PAY 1000"))!, /which wallet\? Reply PAY 1000 MTN or PAY 1000 MOOV/);
  assert.match((await handleSms(built.deps, BJ, "PAY 1000 MOOV"))!, /Moov Money PIN to give XOF 1,000/);
  assert.match((await handleSms(built.deps, BJ, "PAY 1000 WAVE"))!, /pick MTN or MOOV/);
});

test("web: country catalogue, Zambian Airtel payment, ledger per currency, pawaPay callback verified", async () => {
  // Live-ish pawaPay (sandbox token) with a faked API; the callback body alone must not settle anything.
  let depositStatus = "PROCESSING";
  const api = fakeFetch({
    ...aquaRoutes,
    "/v2/deposits": (_url, init) =>
      init?.method === "POST"
        ? json({ depositId: JSON.parse(String(init.body)).depositId, status: "ACCEPTED" })
        : json({ status: "FOUND", data: { status: depositStatus, providerTransactionId: "ZM-1" } }),
  });
  const built = await testApp({ PAWAPAY_API_TOKEN: "t", CALLBACK_TOKEN: "cb-0123456789abcdef" }, { fetchImpl: api.impl });
  const server = built.app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json() }));
  try {
    const cfg = await (await fetch(base + "/api/mobile/config")).json();
    assert.equal(cfg.countries.length, COUNTRIES.length);
    const zm = cfg.countries.find((c: { code: string }) => c.code === "ZM");
    assert.deepEqual(zm.wallets.map((w: { id: string }) => w.id), ["mtn", "airtel", "zamtel"]);
    assert.ok(zm.wallets.every((w: { rail: string; available: boolean }) => w.rail === "pawapay" && w.available));
    const ke = cfg.countries.find((c: { code: string }) => c.code === "KE");
    assert.equal(ke.wallets.find((w: { id: string }) => w.id === "mpesa").rail, "pawapay", "Kenyan M-Pesa falls back to pawaPay without Daraja");

    const pay = await post("/api/pay/mobile", { phone: ZM_AIRTEL, amount: 50, wallet: "airtel" });
    assert.equal(pay.status, 201);
    assert.equal(pay.data.payment.amountLabel, "ZMW 50");
    assert.equal(pay.data.payment.providerLabel, "Airtel Money");
    const depositId = JSON.parse(String(api.calls.find((c) => c.url.endsWith("/v2/deposits"))!.init!.body)).depositId;

    // A forged "COMPLETED" callback while pawaPay still says PROCESSING changes nothing.
    await post("/api/pay/pawapay/callback/cb-0123456789abcdef", { depositId, status: "COMPLETED" });
    let status = await (await fetch(`${base}/api/pay/mobile/${pay.data.payment.id}`)).json();
    assert.equal(status.payment.status, "pending");

    depositStatus = "COMPLETED";
    const cb = await post("/api/pay/pawapay/callback/cb-0123456789abcdef", { depositId, status: "COMPLETED" });
    assert.equal(cb.data.handled, true);
    await built.drain();
    status = await (await fetch(`${base}/api/pay/mobile/${pay.data.payment.id}`)).json();
    assert.equal(status.payment.status, "paid");
    assert.equal(status.payment.receipt, "ZM-1");

    const ledger = await (await fetch(base + "/api/mobile/ledger")).json();
    assert.deepEqual(ledger.byCurrency, [{ currency: "ZMW", amount: 50, count: 1, label: "ZMW 50" }]);
    assert.deepEqual(ledger.countries, ["ZM"]);
    assert.equal((await post("/api/pay/pawapay/callback/wrong", { depositId })).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
