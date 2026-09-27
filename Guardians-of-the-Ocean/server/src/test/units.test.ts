import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPhone, networkOf, normalizePhone, prettyPhone } from "../lib/phone.js";
import { fitTo, forSms, isGsm7, plainText, toGsm7 } from "../lib/text.js";
import { RateLimiter } from "../lib/rate.js";
import { darajaPassword, darajaTimestamp, parseStkCallback } from "../payments/mpesa.js";
import { parseAirtelCallback } from "../payments/airtel.js";
import { isAllowedRecordingUrl } from "../agent/transcribe.js";
import { LESSONS, matchLesson, quizText } from "../agent/lessons.js";
import { Agent, isRelevant } from "../agent/agent.js";
import { aquaRoutes, fakeFetch, json, testEnv } from "./helpers.js";
import { AfricasTalking } from "../comms/africastalking.js";
import { ClickMobile, WithSmsFallback } from "../comms/clickmobile.js";
import { MemoryStore } from "../store/memory.js";
import { USSD_MAX } from "../lib/text.js";

test("normalizes Kenyan numbers in every common format", () => {
  for (const raw of ["0712345678", "+254712345678", "254712345678", "712345678", "0712 345 678", "00254712345678", "(0712)-345-678"]) {
    assert.equal(normalizePhone(raw), "254712345678", raw);
  }
  assert.equal(normalizePhone("0110123456"), "254110123456");
  for (const bad of ["", "12345", "0612345678", "+999712345678", "07123456789", null, undefined]) {
    assert.equal(normalizePhone(bad), "", String(bad));
  }
});

test("detects the network from the prefix", () => {
  assert.equal(networkOf("0712345678"), "safaricom");
  assert.equal(networkOf("0746000000"), "safaricom");
  assert.equal(networkOf("0110000000"), "safaricom");
  assert.equal(networkOf("0733123456"), "airtel");
  assert.equal(networkOf("0756000000"), "airtel");
  assert.equal(networkOf("0100000000"), "airtel");
  assert.equal(networkOf("0771234567"), "telkom");
  assert.equal(networkOf("garbage"), "unknown");
});

test("formats and masks phones", () => {
  assert.equal(prettyPhone("254712345678"), "0712 345 678");
  assert.equal(maskPhone("254712345678"), "0712 ***678");
});

test("toGsm7 removes emoji and smart punctuation", () => {
  const out = toGsm7("Karibu 🌊 “Harmony” — it’s…  great");
  assert.equal(out, "Karibu \"Harmony\" - it's... great");
  assert.ok(isGsm7(out));
});

test("plainText strips markdown, citations and links", () => {
  assert.equal(plainText("**Bold** claim [1] and [2, 3]. See [the paper](http://x.y) https://a.b/c"), "Bold claim and. See the paper");
  assert.equal(plainText("An *important* point, `code`"), "An important point, code");
});

test("USSD codes survive SMS shaping", () => {
  assert.equal(forSms("Dial *384*2026# or text HELP to 22384."), "Dial *384*2026# or text HELP to 22384.");
});

test("fitTo cuts on a sentence or word boundary", () => {
  const text = "Mangroves slow waves. Their roots trap mud and protect the shore from storms every year.";
  assert.equal(fitTo(text, 30), "Mangroves slow waves.");
  assert.equal(fitTo(text, 40), "Mangroves slow waves. Their roots...");
  const words = fitTo("alpha beta gamma delta epsilon", 20);
  assert.ok(words.length <= 20 && words.endsWith("...") && !words.includes("epsi"));
  assert.ok(forSms("x ".repeat(400)).length <= 459);
});

test("rate limiter blocks after the limit and resets after the window", () => {
  let now = 0;
  const lim = new RateLimiter(2, 1000, () => now);
  assert.ok(lim.take("a"));
  assert.ok(lim.take("a"));
  assert.ok(!lim.take("a"));
  assert.ok(lim.take("b"));
  now = 1001;
  assert.ok(lim.take("a"));
});

test("Daraja timestamp is East Africa Time and password is base64(shortcode+passkey+timestamp)", () => {
  assert.equal(darajaTimestamp(new Date("2026-09-27T21:30:05Z")), "20260928003005");
  assert.equal(darajaPassword("174379", "key", "20260101000000"), Buffer.from("174379key20260101000000").toString("base64"));
});

test("parses M-Pesa STK callbacks", () => {
  const ok = parseStkCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: "m1",
        CheckoutRequestID: "ws_CO_1",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 100 },
            { Name: "MpesaReceiptNumber", Value: "TJ7ABC123X" },
            { Name: "PhoneNumber", Value: 254712345678 },
          ],
        },
      },
    },
  });
  assert.deepEqual(ok?.outcome, { status: "paid", receipt: "TJ7ABC123X" });
  assert.equal(ok?.amount, 100);

  const cancelled = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "ws_CO_2", ResultCode: 1032, ResultDesc: "Request cancelled by user" } } });
  assert.equal(cancelled?.outcome.status, "cancelled");
  assert.equal(parseStkCallback({ hello: 1 }), null);
});

test("parses Airtel callbacks", () => {
  const ok = parseAirtelCallback({ transaction: { id: "pay_1", message: "Paid", status_code: "TS", airtel_money_id: "MP123" } });
  assert.deepEqual(ok?.outcome, { status: "paid", receipt: "MP123" });
  const failed = parseAirtelCallback({ transaction: { id: "pay_2", message: "Transaction declined by user", status_code: "TF" } });
  assert.equal(failed?.outcome.status, "cancelled");
  assert.equal(parseAirtelCallback({}), null);
});

test("only Africa's Talking recordings are fetched for transcription", () => {
  assert.ok(isAllowedRecordingUrl("https://voice.africastalking.com/recordings/abc.mp3"));
  assert.ok(!isAllowedRecordingUrl("http://voice.africastalking.com/r.mp3"));
  assert.ok(!isAllowedRecordingUrl("https://evil.example/africastalking.com.mp3"));
  assert.ok(!isAllowedRecordingUrl("https://169.254.169.254/latest"));
});

test("lessons fit their channels and use GSM-7 only", () => {
  for (const l of LESSONS) {
    assert.ok(l.ussd.length <= 130, `${l.id} ussd is ${l.ussd.length}`);
    assert.ok(l.sms.length <= 306, `${l.id} sms is ${l.sms.length}`);
    assert.ok(isGsm7(l.ussd) && isGsm7(l.sms) && isGsm7(l.voice), l.id);
    assert.ok(quizText(l, "ussd").length <= USSD_MAX - 4, `${l.id} quiz`);
    assert.ok(isGsm7(quizText(l, "sms")));
  }
  assert.equal(matchLesson("how do I make river water safe to drink?")?.id, "safe-water");
  assert.equal(matchLesson("how can I prevent malaria?")?.id, "malaria");
  assert.equal(matchLesson("my child has cholera symptoms")?.id, "cholera");
  assert.equal(matchLesson("what is the capital of France"), null);
});

test("off-topic research answers fall back to the vetted lesson", async () => {
  assert.ok(isRelevant("What is OneAquaHealth?", "OneAquaHealth is a Horizon Europe project"));
  assert.ok(isRelevant("How do mangroves stop erosion?", "Mangrove roots reduce erosion"));
  assert.ok(!isRelevant("Is it safe to drink river water?", "Satellite sensors map water-surface patterns."));
  const agent = new Agent(testEnv(), fakeFetch(aquaRoutes).impl);
  const reply = await agent.answer("Is it safe to drink river water?", 440);
  assert.equal(reply.via, "lessons");
  assert.match(reply.text, /^Safe water: water that looks clear/);
  assert.equal((await agent.answer("What are the signs of cholera?", 440)).via, "aqua");
});

test("possible emergencies lead with 'go to a health facility now'", async () => {
  const agent = new Agent(testEnv(), fakeFetch(aquaRoutes).impl);
  const r = await agent.answer("my baby is having fits and is not breathing well", 440);
  assert.match(r.text, /^This may be an emergency: go to the nearest health facility now/);
  assert.ok(r.text.length <= 440);
  // "drink" must not pull in the safe-water lesson: emergencies get the danger signs.
  const fits = await agent.answer("My brother has fits and cannot drink", 440);
  assert.match(fits.text, /Danger signs: go to a health facility now/);
  assert.doesNotMatch(fits.text, /Safe water/);
});

test("a failed Africa's Talking SMS is retried through Click Mobile", async () => {
  const env = testEnv({ AT_USERNAME: "sandbox", AT_API_KEY: "k", CLICKMOBILE_SMS_URL: "http://click.test/sms", CLICKMOBILE_API_KEY: "ck" });
  const { impl, calls } = fakeFetch({
    "africastalking.com": () => json({ SMSMessageData: { Recipients: [{ status: "InvalidSenderId" }] } }),
    "click.test/sms": () => json({ messageId: "cm_1" }),
  });
  const store = new MemoryStore();
  const messenger = new WithSmsFallback(new AfricasTalking(env, store, impl), new ClickMobile(env, store, impl));
  assert.deepEqual(await messenger.sendSms("0712345678", "Harmony: test"), { ok: true, id: "cm_1" });
  const click = calls.find((c) => c.url.includes("click.test"))!;
  assert.equal((click.init?.headers as Record<string, string>).Authorization, "Bearer ck");
  assert.deepEqual(JSON.parse(String(click.init?.body)), { to: "+254712345678", message: "Harmony: test" });
});
