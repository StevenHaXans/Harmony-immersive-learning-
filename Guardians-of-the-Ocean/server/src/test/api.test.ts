import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Mpesa } from "../payments/mpesa.js";
import { Airtel } from "../payments/airtel.js";
import { aquaRoutes, fakeFetch, json, STUDENT, STUDENT_E, AIRTEL_STUDENT, testApp, testEnv } from "./helpers.js";

async function serve(built: Awaited<ReturnType<typeof testApp>>) {
  const server = built.app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, data, type: res.headers.get("content-type") ?? "" };
  };
  return { base, call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("web: config, join, ask, pay with the simulator, ledger, card-off", async () => {
  const built = await testApp();
  const api = await serve(built);
  try {
    const cfg = await api.call("GET", "/api/mobile/config");
    assert.equal(cfg.status, 200);
    assert.equal(cfg.data.modes.mpesa, "mock");
    assert.equal(cfg.data.available.card, false);
    assert.equal(cfg.data.simulator, true);

    const join = await api.call("POST", "/api/students/join", { phone: STUDENT, name: "Amina", school: "Likoni Primary" });
    assert.equal(join.status, 200);
    assert.equal(join.data.network, "safaricom");
    assert.match(built.deps.messenger.outbox(STUDENT_E, 5).at(-1)!.body, /^Welcome Amina to Harmony Health!/);

    const ask = await api.call("POST", "/api/agent/ask", { question: "What are the signs of cholera?" });
    assert.equal(ask.data.via, "aqua");

    const pay = await api.call("POST", "/api/pay/mobile", { phone: STUDENT, amount: 250 });
    assert.equal(pay.status, 201);
    assert.equal(pay.data.payment.status, "pending");
    assert.equal(pay.data.payment.providerLabel, "M-Pesa");
    assert.equal(pay.data.payment.phone, "0712 ***678");

    const phone = await api.call("GET", `/api/dev/phone/${STUDENT}`);
    assert.equal(phone.data.prompts.length, 1);
    const ok = await api.call("POST", `/api/dev/prompts/${encodeURIComponent(phone.data.prompts[0].ref)}`, { provider: "mpesa", action: "pin", pin: "4321" });
    assert.equal(ok.data.outcome.status, "paid");
    await built.drain();

    const status = await api.call("GET", `/api/pay/mobile/${pay.data.payment.id}`);
    assert.equal(status.data.payment.status, "paid");
    assert.match(status.data.payment.receipt, /^T[A-Z0-9]{9}$/);

    const ledger = await api.call("GET", "/api/ledger");
    assert.equal(ledger.data.mobile.gifts, 1);
    assert.deepEqual(ledger.data.mobile.byCurrency, [{ currency: "KES", amount: 250, count: 1, label: "KES 250" }]);
    assert.deepEqual(ledger.data.mobile.countries, ["KE"]);
    assert.equal(ledger.data.live, false);

    assert.equal((await api.call("POST", "/api/checkout", { email: "a@b.co" })).status, 503);
    assert.equal((await api.call("GET", "/health")).data.store, "memory");
  } finally {
    await api.close();
  }
});

test("web: wrong-network numbers, bad input and cancelled prompts", async () => {
  const built = await testApp();
  const api = await serve(built);
  try {
    const mismatch = await api.call("POST", "/api/pay/mobile", { phone: AIRTEL_STUDENT, amount: 100, provider: "mpesa" });
    assert.equal(mismatch.status, 400);
    assert.match(mismatch.data.error, /Airtel number/);
    assert.equal((await api.call("POST", "/api/pay/mobile", { phone: "12345", amount: 100 })).status, 400);
    assert.equal((await api.call("POST", "/api/pay/mobile", { phone: STUDENT, amount: 10.5 })).status, 400);

    const pay = await api.call("POST", "/api/pay/mobile", { phone: AIRTEL_STUDENT, amount: 100 });
    const ref = (await api.call("GET", `/api/dev/phone/${AIRTEL_STUDENT}`)).data.prompts[0].ref;
    await api.call("POST", `/api/dev/prompts/${encodeURIComponent(ref)}`, { provider: "airtel", action: "cancel" });
    await built.drain();
    const status = await api.call("GET", `/api/pay/mobile/${pay.data.payment.id}`);
    assert.equal(status.data.payment.status, "cancelled");
    assert.equal((await api.call("POST", `/api/dev/prompts/${encodeURIComponent(ref)}`, { provider: "airtel", action: "cancel" })).status, 404);
  } finally {
    await api.close();
  }
});

test("web: STK prompts to one number are rate limited", async () => {
  const built = await testApp();
  const api = await serve(built);
  try {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await api.call("POST", "/api/pay/mobile", { phone: "0722000001", amount: 50 })).status);
    assert.deepEqual(codes.slice(0, 4), [201, 201, 201, 201]);
    assert.equal(codes[4], 429);
  } finally {
    await api.close();
  }
});

test("Africa's Talking webhooks: form-encoded USSD and SMS, token enforced", async () => {
  const built = await testApp({ CALLBACK_TOKEN: "s3cret-token-0123456789" });
  const api = await serve(built);
  const form = (path: string, fields: Record<string, string>) =>
    fetch(api.base + path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
  try {
    const ussd = await form("/api/at/s3cret-token-0123456789/ussd", { sessionId: "ATX1", serviceCode: "*384*2026#", phoneNumber: "+254712345678", text: "" });
    assert.equal(ussd.status, 200);
    assert.match(ussd.headers.get("content-type")!, /text\/plain/);
    assert.match(await ussd.text(), /^CON Harmony Health\n1\. Today's health tip/);

    assert.equal((await form("/api/at/wrong/ussd", { phoneNumber: "+254712345678", text: "" })).status, 404);
    assert.equal((await form("/api/at/dev/ussd", { phoneNumber: "+254712345678", text: "" })).status, 404);

    const sms = await form("/api/at/s3cret-token-0123456789/sms", { from: "+254712345678", to: "22384", text: "HELP" });
    assert.equal(sms.status, 200);
    await built.drain();
    assert.match(built.deps.messenger.outbox(STUDENT_E, 5).at(-1)!.body, /^Harmony Health SMS: LESSON/);

    const voice = await form("/api/at/s3cret-token-0123456789/voice", { isActive: "1", direction: "Inbound", callerNumber: "+254712345678", sessionId: "v1" });
    assert.match(voice.headers.get("content-type")!, /xml/);
    assert.match(await voice.text(), /callbackUrl="http:\/\/127\.0\.0\.1:8787\/api\/at\/s3cret-token-0123456789\/voice\/menu"/);
  } finally {
    await api.close();
  }
});

test("M-Pesa (Daraja) end to end: STK push request shape, callback settles and texts a receipt", async () => {
  const env = testEnv({
    MPESA_CONSUMER_KEY: "ck", MPESA_CONSUMER_SECRET: "cs", MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "pk",
    CALLBACK_TOKEN: "cb-token-abcdefghijklmnop", PUBLIC_API_URL: "https://api.harmony.test",
  });
  const daraja = fakeFetch({
    ...aquaRoutes,
    "/oauth/v1/generate": () => json({ access_token: "tok", expires_in: "3599" }),
    "/mpesa/stkpush/v1/processrequest": () =>
      json({ MerchantRequestID: "m-1", CheckoutRequestID: "ws_CO_TEST_1", ResponseCode: "0", CustomerMessage: "Success. Request accepted for processing" }),
  });
  const mpesa = new Mpesa(env, "https://api.harmony.test/api/pay/mpesa/callback/cb-token-abcdefghijklmnop", daraja.impl);
  const built = await testApp(
    { MPESA_CONSUMER_KEY: "ck", MPESA_CONSUMER_SECRET: "cs", MPESA_SHORTCODE: "174379", MPESA_PASSKEY: "pk", CALLBACK_TOKEN: "cb-token-abcdefghijklmnop" },
    { providers: { mpesa }, fetchImpl: daraja.impl }
  );
  const api = await serve(built);
  try {
    const pay = await api.call("POST", "/api/pay/mobile", { phone: STUDENT, amount: 100 });
    assert.equal(pay.status, 201);
    assert.equal(pay.data.payment.mode, "sandbox");

    const stk = daraja.calls.find((c) => c.url.includes("processrequest"))!;
    const body = JSON.parse(String(stk.init!.body));
    assert.equal(body.TransactionType, "CustomerPayBillOnline");
    assert.equal(body.PartyA, "254712345678");
    assert.equal(body.PartyB, "174379");
    assert.equal(body.Amount, 100);
    assert.equal(body.CallBackURL, "https://api.harmony.test/api/pay/mpesa/callback/cb-token-abcdefghijklmnop");
    assert.equal(Buffer.from(body.Password, "base64").toString(), `174379pk${body.Timestamp}`);
    assert.equal((stk.init!.headers as Record<string, string>).Authorization, "Bearer tok");

    const callback = {
      Body: { stkCallback: {
        MerchantRequestID: "m-1", CheckoutRequestID: "ws_CO_TEST_1", ResultCode: 0, ResultDesc: "ok",
        CallbackMetadata: { Item: [{ Name: "Amount", Value: 100 }, { Name: "MpesaReceiptNumber", Value: "TJR8XY12AB" }] },
      } },
    };
    assert.equal((await api.call("POST", "/api/pay/mpesa/callback/nope", callback)).status, 404);
    const ack = await api.call("POST", "/api/pay/mpesa/callback/cb-token-abcdefghijklmnop", callback);
    assert.deepEqual(ack.data, { ResultCode: 0, ResultDesc: "Accepted" });
    // Daraja retries callbacks; the second one must not double-count or re-text.
    await api.call("POST", "/api/pay/mpesa/callback/cb-token-abcdefghijklmnop", callback);
    await built.drain();

    const status = await api.call("GET", `/api/pay/mobile/${pay.data.payment.id}`);
    assert.equal(status.data.payment.status, "paid");
    assert.equal(status.data.payment.receipt, "TJR8XY12AB");
    const receipts = built.deps.messenger.outbox(STUDENT_E, 10).filter((m) => m.body.startsWith("Asante"));
    assert.equal(receipts.length, 1);
    assert.match(receipts[0].body, /Ref TJR8XY12AB/);
  } finally {
    await api.close();
  }
});

test("Airtel end to end: push request shape and status polling settles the payment", async () => {
  const env = testEnv({ AIRTEL_CLIENT_ID: "id", AIRTEL_CLIENT_SECRET: "secret" });
  let status = "TIP";
  const airtelApi = fakeFetch({
    ...aquaRoutes,
    "/auth/oauth2/token": () => json({ access_token: "atok", expires_in: 180 }),
    "/merchant/v2/payments/": () => json({ data: { transaction: { id: "x", status: "Success." } }, status: { success: true, code: "200" } }),
    "/standard/v1/payments/": () => json({ data: { transaction: { status, airtel_money_id: "MP260927.1234.A12345", message: "done" } }, status: { success: true } }),
  });
  const airtel = new Airtel(env, airtelApi.impl);
  let now = Date.now();
  const built = await testApp({ AIRTEL_CLIENT_ID: "id", AIRTEL_CLIENT_SECRET: "secret" }, { providers: { airtel }, fetchImpl: airtelApi.impl });
  (built.deps.payments as any).now = () => now;
  const api = await serve(built);
  try {
    const pay = await api.call("POST", "/api/pay/mobile", { phone: AIRTEL_STUDENT, amount: 300 });
    assert.equal(pay.status, 201);
    const push = airtelApi.calls.find((c) => c.url.includes("/merchant/v2/payments/"))!;
    const body = JSON.parse(String(push.init!.body));
    assert.equal(body.subscriber.msisdn, "733123456");
    assert.equal(body.transaction.id, pay.data.payment.id);
    assert.equal((push.init!.headers as Record<string, string>)["X-Country"], "KE");

    now += 30_000;
    assert.equal((await api.call("GET", `/api/pay/mobile/${pay.data.payment.id}`)).data.payment.status, "pending");
    status = "TS";
    const done = await api.call("GET", `/api/pay/mobile/${pay.data.payment.id}`);
    assert.equal(done.data.payment.status, "paid");
    assert.equal(done.data.payment.receipt, "MP260927.1234.A12345");
  } finally {
    await api.close();
  }
});

test("admin: agent console requires the token when one is set", async () => {
  const built = await testApp({ ADMIN_TOKEN: "admin-token-0123456789" });
  const api = await serve(built);
  try {
    await api.call("POST", "/api/agent/callback", { phone: STUDENT, question: "Is the beach safe after the oil spill?", call: false });
    await built.drain();
    assert.equal((await api.call("GET", "/api/agent/tickets")).status, 401);
    const auth = { Authorization: "Bearer admin-token-0123456789" };
    const list = await api.call("GET", "/api/agent/tickets?status=handoff", undefined, auth);
    assert.equal(list.data.tickets.length, 1);
    const reply = await api.call("POST", `/api/agent/tickets/${list.data.tickets[0].id}/reply`, { message: "Stay out of the water until the county says it's clear." }, auth);
    assert.equal(reply.data.ticket.status, "answered");
    assert.match(built.deps.messenger.outbox(STUDENT_E, 10).at(-1)!.body, /^Harmony health guide: Stay out/);

    await api.call("POST", "/api/students/join", { phone: "0711000222" });
    const cast = await api.call("POST", "/api/admin/broadcast", {}, auth);
    assert.equal(cast.data.sent, 1);
  } finally {
    await api.close();
  }
});

test("DEV_TOOLS in production only survives while every channel is a mock", () => {
  assert.equal(testEnv({ NODE_ENV: "production", DEV_TOOLS: "1" }).devTools, true);
  assert.equal(testEnv({ NODE_ENV: "production", DEV_TOOLS: "1", AT_USERNAME: "harmony", AT_API_KEY: "k" }).devTools, false);
  assert.equal(
    testEnv({ NODE_ENV: "production", DEV_TOOLS: "1", MPESA_CONSUMER_KEY: "a", MPESA_CONSUMER_SECRET: "b", MPESA_SHORTCODE: "1", MPESA_PASSKEY: "p" }).devTools,
    false
  );
  assert.equal(testEnv({ DEV_TOOLS: "0" }).devTools, false);
  assert.equal(testEnv({}).devTools, true);
});

test("production without DEV_TOOLS hides the simulator and refuses mock payments", async () => {
  const built = await testApp({ NODE_ENV: "production" });
  const api = await serve(built);
  try {
    assert.equal((await api.call("GET", `/api/dev/phone/${STUDENT}`)).status, 404);
    const pay = await api.call("POST", "/api/pay/mobile", { phone: STUDENT, amount: 100 });
    assert.equal(pay.status, 503);
    assert.equal((await api.call("GET", "/api/agent/tickets")).status, 503);
    assert.equal((await api.call("POST", "/api/pay/mpesa/callback/dev", {})).status, 404);
  } finally {
    await api.close();
  }
});
