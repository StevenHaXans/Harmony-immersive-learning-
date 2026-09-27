import { test } from "node:test";
import assert from "node:assert/strict";
import { handleUssd, navPath } from "../channels/ussd.js";
import { handleSms } from "../channels/sms.js";
import { handleVoiceCall, handleVoiceMenu, handleVoicePay, handleVoiceQuestion } from "../channels/voice.js";
import { isGsm7, USSD_MAX } from "../lib/text.js";
import { AIRTEL_E, AIRTEL_STUDENT, STUDENT, STUDENT_E, TELKOM_STUDENT, testApp } from "./helpers.js";

const smsTo = (built: Awaited<ReturnType<typeof testApp>>, phone: string) =>
  built.deps.messenger.outbox(phone, 100).filter((m) => m.kind === "sms").map((m) => m.body);

test("navPath applies back and home", () => {
  assert.deepEqual(navPath(""), []);
  assert.deepEqual(navPath("5*2"), ["5", "2"]);
  assert.deepEqual(navPath("5*0*1"), ["1"]);
  assert.deepEqual(navPath("5*2*00*6"), ["6"]);
});

test("every reachable USSD screen fits one screen and is GSM-7", async () => {
  const built = await testApp();
  const paths = [
    "", "1", "1*1", "1*1*1", "1*2", "2", "2*1", "2*2", "2*9", "3", "3*why do corals bleach", "4", "4*1", "4*2", "4*2*help me",
    "4*9", "5", "5*1", "5*2*1", "5*3*0", "5*4", "5*4*75", "5*4*75*1", "5*4*5", "5*9", "6", "7", "7", "9", "0",
  ];
  for (const text of paths) {
    const reply = await handleUssd(built.deps, { sessionId: "s-len", phoneNumber: STUDENT_E, text });
    assert.match(reply, /^(CON|END) /, text);
    assert.ok(reply.length <= USSD_MAX, `"${text}" is ${reply.length} chars:\n${reply}`);
    assert.ok(isGsm7(reply), `"${text}" has non GSM-7 characters`);
  }
  await built.drain();
});

test("USSD lesson screens advance and remember progress", async () => {
  const built = await testApp();
  const first = await handleUssd(built.deps, { sessionId: "a", phoneNumber: STUDENT_E, text: "1" });
  const again = await handleUssd(built.deps, { sessionId: "a", phoneNumber: STUDENT_E, text: "1" });
  assert.equal(first, again, "replaying a step shows the same lesson");
  assert.match(first, /^CON Mangroves/);
  const next = await handleUssd(built.deps, { sessionId: "a", phoneNumber: STUDENT_E, text: "1*1" });
  assert.match(next, /^CON Coral reefs/);
  const student = await built.deps.store.getStudent(STUDENT_E);
  assert.equal(student?.lessonIndex, 2);

  const sms = await handleUssd(built.deps, { sessionId: "a", phoneNumber: STUDENT_E, text: "1*1*2" });
  assert.match(sms, /^END Sent! "Coral reefs"/);
  await built.drain();
  assert.match(smsTo(built, STUDENT_E).at(-1)!, /Coral reefs/);
});

test("USSD quiz awards points for the right answer", async () => {
  const built = await testApp();
  await handleUssd(built.deps, { sessionId: "q", phoneNumber: STUDENT_E, text: "1" }); // sees mangroves
  const q = await handleUssd(built.deps, { sessionId: "q", phoneNumber: STUDENT_E, text: "2" });
  assert.match(q, /mangroves protect/i);
  const right = await handleUssd(built.deps, { sessionId: "q", phoneNumber: STUDENT_E, text: "2*1" });
  assert.match(right, /^END Correct! \+10 points/);
  const wrong = await handleUssd(built.deps, { sessionId: "q", phoneNumber: STUDENT_E, text: "2*2" });
  assert.match(wrong, /^END Not quite/);
  assert.equal((await built.deps.store.getStudent(STUDENT_E))?.points, 10);
});

test("USSD question is answered by SMS through the agent", async () => {
  const built = await testApp();
  const reply = await handleUssd(built.deps, { sessionId: "ask", phoneNumber: STUDENT_E, text: "3*why do corals bleach" });
  assert.match(reply, /^END Thanks!/);
  await built.drain();
  const sms = smsTo(built, STUDENT_E).at(-1)!;
  assert.match(sms, /^Harmony: Corals bleach when water stays too warm/);
  assert.match(sms, /Src: Reef heat stress review/);
  assert.ok(!sms.includes("**") && !sms.includes("[1]") && !sms.includes("http"));
  const logged = await built.deps.store.listTickets("answered", 5);
  assert.equal(logged[0].question, "why do corals bleach");
});

test("USSD support flow sends an M-Pesa prompt and texts a receipt", async () => {
  const built = await testApp();
  assert.match(await handleUssd(built.deps, { sessionId: "p", phoneNumber: STUDENT_E, text: "5*2" }), /Pay KES 100 with M-Pesa/);
  const done = await handleUssd(built.deps, { sessionId: "p", phoneNumber: STUDENT_E, text: "5*2*1" });
  assert.match(done, /^END You'll get a M-Pesa PIN prompt/);
  await built.drain();

  const [payment] = await built.deps.store.paymentsForPhone(STUDENT_E, 1);
  assert.equal(payment.status, "pending");
  assert.equal(payment.amount, 100);
  assert.equal(payment.channel, "ussd");

  const prompt = built.deps.mocks.mpesa!.openPrompts(STUDENT_E)[0];
  built.deps.mocks.mpesa!.respond(prompt.ref, "pin", "1234");
  await new Promise((r) => setTimeout(r, 10));
  await built.drain();
  const settled = await built.deps.store.getPayment(payment.id);
  assert.equal(settled?.status, "paid");
  assert.match(smsTo(built, STUDENT_E).at(-1)!, /^Asante! KES 100 received via M-Pesa\. Ref T/);
});

test("USSD support picks Airtel Money for Airtel lines and refuses Telkom", async () => {
  const built = await testApp();
  assert.match(await handleUssd(built.deps, { sessionId: "p2", phoneNumber: AIRTEL_E, text: "5*1" }), /with Airtel Money/);
  assert.match(await handleUssd(built.deps, { sessionId: "p3", phoneNumber: TELKOM_STUDENT, text: "5" }), /^END Mobile money support works with M-Pesa or Airtel Money/);
  const tooSmall = await handleUssd(built.deps, { sessionId: "p4", phoneNumber: STUDENT_E, text: "5*4*5" });
  assert.match(tooSmall, /^END Amount must be between KES 10/);
});

test("USSD call-back request opens a ticket, alerts guides and rings the student", async () => {
  const built = await testApp();
  const reply = await handleUssd(built.deps, { sessionId: "g", phoneNumber: STUDENT_E, text: "4*1" });
  assert.match(reply, /^END A guide will call you shortly/);
  await built.drain();
  const [ticket] = await built.deps.store.listTickets("handoff", 5);
  assert.equal(ticket.phone, STUDENT_E);
  assert.match(smsTo(built, "254799000111").at(-1)!, /^Harmony help [A-Z0-9]{5}: 0712 345 678 via USSD/);
  const calls = built.deps.messenger.outbox(STUDENT_E, 10).filter((m) => m.kind === "call");
  assert.equal(calls[0].body, `agent:${ticket.id}`);
});

test("USSD daily-lesson opt-in", async () => {
  const built = await testApp();
  assert.match(await handleUssd(built.deps, { sessionId: "o", phoneNumber: STUDENT_E, text: "7" }), /^END You're in!/);
  assert.equal((await built.deps.store.getStudent(STUDENT_E))?.optedIn, true);
  assert.match(await handleUssd(built.deps, { sessionId: "o2", phoneNumber: STUDENT_E, text: "7" }), /already get daily lessons/);
  assert.match(await handleUssd(built.deps, { sessionId: "o3", phoneNumber: STUDENT_E, text: "6" }), /Daily SMS: on/);
});

test("SMS commands: JOIN, LESSON, QUIZ + answer, POINTS, STOP", async () => {
  const built = await testApp();
  const join = await handleSms(built.deps, STUDENT, "join Amina");
  assert.match(join!, /^Welcome Amina!.*First lesson - Mangroves/);
  const lesson = await handleSms(built.deps, STUDENT, "lesson");
  assert.match(lesson!, /Coral reefs/);
  const quiz = await handleSms(built.deps, STUDENT, "QUIZ");
  assert.match(quiz!, /What makes coral bleach\?.*Reply A, B or C/);
  assert.match((await handleSms(built.deps, STUDENT, "b"))!, /^Correct! \+10 points \(total 10\)/);
  assert.match((await handleSms(built.deps, STUDENT, "points"))!, /2\/8 lessons, 10 quiz points/);
  assert.match((await handleSms(built.deps, STUDENT, "STOP"))!, /won't get daily/);
  assert.equal((await built.deps.store.getStudent(STUDENT_E))?.optedIn, false);
});

test("SMS free text goes to the agent, with a lessons fallback and a human offer", async () => {
  const built = await testApp();
  assert.match((await handleSms(built.deps, STUDENT, "why do corals bleach?"))!, /^Harmony: Corals bleach/);
  assert.match((await handleSms(built.deps, STUDENT, "ASK is it safe to drink river water"))!, /^Harmony: Safe water: water that looks clear/);
  assert.match((await handleSms(built.deps, STUDENT, "who won the football"))!, /Reply AGENT/);
});

test("SMS PAY starts a mobile money prompt; bad amounts get guidance", async () => {
  const built = await testApp();
  assert.match((await handleSms(built.deps, AIRTEL_STUDENT, "PAY 200"))!, /enter your Airtel Money PIN to give KES 200/);
  assert.match((await handleSms(built.deps, STUDENT, "PAY"))!, /e\.g\. PAY 100/);
  assert.match((await handleSms(built.deps, STUDENT, "PAY 5"))!, /between KES 10/);
});

test("guides answer tickets by SMS with R <code>", async () => {
  const built = await testApp();
  assert.equal(await handleSms(built.deps, STUDENT, "AGENT my school well smells bad"), null);
  await built.drain();
  const [ticket] = await built.deps.store.listTickets("handoff", 1);
  const alert = smsTo(built, "254799000111").at(-1)!;
  const code = /help ([A-Z0-9]{5})/.exec(alert)![1];
  const ack = await handleSms(built.deps, "0799000111", `R ${code} Please boil it and tell your teacher, we will visit.`);
  assert.match(ack!, /^Harmony desk: sent to 0712 \*\*\*678/);
  assert.match(smsTo(built, STUDENT_E).at(-1)!, /^Harmony guide: Please boil it/);
  assert.equal((await built.deps.store.getTicket(ticket.id))?.status, "answered");
  assert.match((await handleSms(built.deps, "0799000111", "R ZZZZZ hi"))!, /no ticket ZZZZZ/);
});

test("voice IVR: menu, lesson, spoken question answered by SMS, pay, guide bridge", async () => {
  const built = await testApp();
  const base = "https://api.test/api/at/dev";
  const call = await handleVoiceCall(built.deps, base, { isActive: "1", direction: "Inbound", callerNumber: "+254712345678" });
  assert.match(call, /<GetDigits[^>]*callbackUrl="https:\/\/api\.test\/api\/at\/dev\/voice\/menu"/);
  assert.match(call, /Welcome to Harmony/);

  const lesson = await handleVoiceMenu(built.deps, base, { callerNumber: "+254712345678", dtmfDigits: "1" });
  assert.match(lesson, /<Say[^>]*>Today's lesson is about mangroves/);

  const rec = await handleVoiceMenu(built.deps, base, { callerNumber: "+254712345678", dtmfDigits: "2" });
  assert.match(rec, /<Record[^>]*callbackUrl="https:\/\/api\.test\/api\/at\/dev\/voice\/question"/);

  const q = await handleVoiceQuestion(built.deps, base, { callerNumber: "+254712345678", transcript: "Why do corals bleach?" });
  assert.match(q, /answer will arrive by SMS/);
  await built.drain();
  assert.match(smsTo(built, STUDENT_E).at(-1)!, /^Harmony: You asked: "Why do corals bleach\?"\. Corals bleach/);

  const pay = await handleVoicePay(built.deps, base, { callerNumber: "+254712345678", dtmfDigits: "150" });
  assert.match(pay, /enter your M-Pesa PIN/);
  await built.drain();
  assert.equal((await built.deps.store.paymentsForPhone(STUDENT_E, 1))[0].amount, 150);

  const bridge = await handleVoiceCall(built.deps, base, {
    isActive: "1", direction: "Outbound", destinationNumber: "+254712345678", clientRequestId: "agent:tkt_1",
  });
  assert.match(bridge, /<Dial phoneNumbers="0799000111" sequential="true"/);
  assert.equal(await handleVoiceCall(built.deps, base, { isActive: "0" }), "");
});

test("voice guide option falls back to SMS when no guides are configured", async () => {
  const built = await testApp({ AGENT_PHONES: "" });
  const xml = await handleVoiceMenu(built.deps, "https://x", { callerNumber: "+254712345678", dtmfDigits: "3" });
  assert.match(xml, /All guides are busy/);
  assert.doesNotMatch(xml, /<Dial/);
  await built.drain();
  assert.equal((await built.deps.store.listTickets("handoff", 5)).length, 1);
});
