// End-to-end check: drives a running Harmony server exactly the way Africa's Talking does
// (form-encoded USSD + SMS webhooks) across countries. Needs DEV_TOOLS on. Usage:
//   API=http://127.0.0.1:8787 node scripts/webhookcheck.mjs
const API = process.env.API || "http://127.0.0.1:8790";
const TOKEN = process.env.TOKEN || "dev";
const SERVICE = "*384*2026#";
const STUDENT = "+254722555010";   // Safaricom
const AIRTEL = "+254733555020";    // Airtel
const GUIDE = "0799000111";

let pass = 0, fail = 0;
const log = [];
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  log.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail.replace(/\n/g, "\n        ")}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function form(path, fields) {
  const res = await fetch(`${API}/api/at/${TOKEN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, type: res.headers.get("content-type") || "", body: await res.text() };
}

let session = 0;
async function ussd(phone, text, sid) {
  const r = await form("/ussd", { sessionId: sid, serviceCode: SERVICE, phoneNumber: phone, text });
  return r;
}

async function outbox(phone) {
  const r = await fetch(`${API}/api/dev/phone/${encodeURIComponent(phone)}`);
  return r.json();
}
async function waitForSms(phone, afterCount, match, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { outbox: items } = await outbox(phone);
    const sms = items.filter((m) => m.kind === "sms");
    const fresh = sms.slice(afterCount);
    const hit = fresh.find((m) => match.test(m.body));
    if (hit) return hit.body;
    await sleep(500);
  }
  return null;
}
async function smsCount(phone) {
  const { outbox: items } = await outbox(phone);
  return items.filter((m) => m.kind === "sms").length;
}
let smsId = 0;
async function inboundSms(from, text) {
  return form("/sms", { from, to: "22384", text, date: new Date().toISOString(), id: `ATXid_${++smsId}`, linkId: "" });
}

function screenOk(name, r, expectPrefix, mustInclude) {
  const okShape = r.status === 200 && r.type.startsWith("text/plain") && r.body.startsWith(expectPrefix) && r.body.length <= 182;
  const okText = !mustInclude || mustInclude.test(r.body);
  check(name, okShape && okText, `${r.body.length} chars | ${r.body}`);
}

// ─────────────── USSD ───────────────
const s1 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD open menu", await ussd(STUDENT, "", s1), "CON ", /1\. Today's lesson[\s\S]*7\. Daily SMS lessons/);
screenOk("USSD 1 -> today's lesson", await ussd(STUDENT, "1", s1), "CON ", /Mangroves/);
screenOk("USSD 1*1 -> next lesson", await ussd(STUDENT, "1*1", s1), "CON ", /Coral/);
let before = await smsCount(STUDENT);
screenOk("USSD 1*1*2 -> SMS it to me", await ussd(STUDENT, "1*1*2", s1), "END ", /Sent!/);
let got = await waitForSms(STUDENT, before, /Coral reefs/);
check("   ...lesson SMS delivered", !!got, got || "no SMS");

const s2 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 2 -> quiz question", await ussd(STUDENT, "2", s2), "CON ", /1\..*\n2\..*\n3\./);
screenOk("USSD 2*2 -> quiz answer (correct = coral bleaching)", await ussd(STUDENT, "2*2", s2), "END ", /Correct! \+10 points/);

const s3 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 3 -> ask prompt", await ussd(STUDENT, "3", s3), "CON ", /Type your question/);
before = await smsCount(STUDENT);
screenOk("USSD 3*<question> -> answer by SMS", await ussd(STUDENT, "3*What is OneAquaHealth", s3), "END ", /on its way by SMS/);
got = await waitForSms(STUDENT, before, /^Harmony: /, 40000);
check("   ...AI answer SMS delivered (live Aqua Ask)", !!got, got || "no SMS within 40s");

const s4 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 4 -> guide menu", await ussd(STUDENT, "4", s4), "CON ", /Call me back/);
screenOk("USSD 4*2 -> type question for guide", await ussd(STUDENT, "4*2", s4), "CON ", /question for the guide/);
const guideBefore = await smsCount(GUIDE);
before = await smsCount(STUDENT);
screenOk("USSD 4*2*<question> -> sent to guide", await ussd(STUDENT, "4*2*The river near our school is dirty", s4), "END ", /Sent to a guide/);
const alert = await waitForSms(GUIDE, guideBefore, /Harmony help [A-Z0-9]{5}/);
check("   ...guide received ticket alert SMS", !!alert, alert || "none");
got = await waitForSms(STUDENT, before, /ticket is [A-Z0-9]{5}/);
check("   ...student received ticket confirmation SMS", !!got, got || "none");

const s5 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 5 -> support amounts", await ussd(STUDENT, "5", s5), "CON ", /KES 50[\s\S]*Other amount/);
screenOk("USSD 5*2 -> confirm KES 100 with M-Pesa", await ussd(STUDENT, "5*2", s5), "CON ", /Pay KES 100 with M-Pesa/);
before = await smsCount(STUDENT);
screenOk("USSD 5*2*1 -> PIN prompt sent", await ussd(STUDENT, "5*2*1", s5), "END ", /PIN prompt/);
await sleep(700);
let { prompts } = await outbox(STUDENT);
check("   ...M-Pesa PIN prompt reached the phone", prompts.length === 1 && prompts[0].amount === 100, JSON.stringify(prompts));
if (prompts[0]) {
  await fetch(`${API}/api/dev/prompts/${encodeURIComponent(prompts[0].ref)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: prompts[0].provider, action: "pin", pin: "1234" }),
  });
  got = await waitForSms(STUDENT, before, /^Asante! KES 100 received via M-Pesa\. Ref /);
  check("   ...PIN entered -> receipt SMS delivered", !!got, got || "none");
}

const s6 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 5*4 -> other amount", await ussd(STUDENT, "5*4", s6), "CON ", /Enter amount/);
screenOk("USSD 5*4*75 -> confirm KES 75", await ussd(STUDENT, "5*4*75", s6), "CON ", /Pay KES 75/);
screenOk("USSD 5*4*75*0 -> back", await ussd(STUDENT, "5*4*75*0", s6), "CON ", /Enter amount/);
screenOk("USSD 5*4*5 -> amount too small", await ussd(STUDENT, "5*4*5", s6), "END ", /between KES 10/);

const s7 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD 5*0 -> back to main menu", await ussd(STUDENT, "5*0", s7), "CON ", /Today's lesson/);
screenOk("USSD 9 -> invalid choice re-shows menu", await ussd(STUDENT, "9", s7), "CON ", /Invalid choice/);
screenOk("USSD 7 -> daily SMS opt-in", await ussd(STUDENT, "7", s7), "END ", /You're in!/);
screenOk("USSD 6 -> progress", await ussd(STUDENT, "6", s7), "END ", /Quiz points: 10[\s\S]*Support given: KES 100[\s\S]*Daily SMS: on/);

const s8 = `ATUid_${Date.now()}_${++session}`;
screenOk("USSD Airtel line 5*1 -> Airtel Money", await ussd(AIRTEL, "5*1", s8), "CON ", /with Airtel Money/);
screenOk("USSD number from an unsupported country refused", await ussd("+447700900123", "", s8), "END ", /doesn.t support numbers from this country/);

// ─────────────── SMS ───────────────
const P = "+254722555030"; // fresh student for SMS
async function smsStep(name, text, match, from = P, ms = 30000) {
  const n = await smsCount(from);
  const r = await inboundSms(from, text);
  const reply = await waitForSms(from, n, match, ms);
  check(`SMS "${text}" -> ${name}`, r.status === 200 && !!reply, reply || `webhook ${r.status}, no reply`);
  return reply;
}
await smsStep("command list", "HELP", /^Harmony SMS: LESSON/);
await smsStep("joins + first lesson", "JOIN Amina", /^Welcome Amina!.*Mangroves/);
await smsStep("next lesson", "LESSON", /Coral reefs/);
await smsStep("quiz question", "QUIZ", /What makes coral bleach\?.*Reply A, B or C/);
await smsStep("quiz answer", "B", /^Correct! \+10 points/);
await smsStep("progress", "POINTS", /2\/8 lessons, 10 quiz points/);
await smsStep("Kiswahili lesson (SOMO)", "somo", /Plastic/);
await smsStep("AI answer", "ASK why do corals bleach?", /^Harmony: /, P, 40000);
await smsStep("free-text question", "Is it safe to drink river water?", /^Harmony: /, P, 40000);
const ticketMsg = await smsStep("human guide ticket", "AGENT our borehole water smells bad", /ticket is [A-Z0-9]{5}/);
const code = ticketMsg && /ticket is ([A-Z0-9]{5})/.exec(ticketMsg)[1];
if (code) {
  const n = await smsCount(P);
  await inboundSms(`+254${GUIDE.slice(1)}`, `R ${code} Please boil it for 1 minute. A health officer will visit on Monday.`);
  const relayed = await waitForSms(P, n, /^Harmony guide: Please boil it/);
  check(`SMS guide replies "R ${code} ..." -> relayed to student`, !!relayed, relayed || "none");
}
const payMsg = await smsStep("PAY starts M-Pesa prompt", "PAY 200", /enter your M-Pesa PIN to give KES 200/);
({ prompts } = await outbox(P));
if (prompts[0]) {
  const n = await smsCount(P);
  await fetch(`${API}/api/dev/prompts/${encodeURIComponent(prompts[0].ref)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "mpesa", action: "cancel" }),
  });
  const cancelled = await waitForSms(P, n, /did not go through \(Cancelled on the phone\)/);
  check("   ...student cancels on phone -> 'nothing charged' SMS", !!cancelled, cancelled || "none");
}
await smsStep("opt out", "STOP", /won't get daily/);

// ─────────────── Pan-African ───────────────
const UG = "+256772555040", BJ = "+2290197555050", GH = "+233241555060";
const u1 = `ATUid_${Date.now()}_ug`;
screenOk("USSD Uganda (MTN network code) -> UGX amounts", await form("/ussd", { sessionId: u1, serviceCode: SERVICE, phoneNumber: UG, networkCode: "64110", text: "5" }), "CON ", /UGX 1,000[\s\S]*UGX 5,000/);
const ugConfirm = await form("/ussd", { sessionId: u1, serviceCode: SERVICE, phoneNumber: UG, networkCode: "64110", text: "5*3" });
screenOk("USSD Uganda 5*3 -> MTN MoMo UGX 5,000", ugConfirm, "CON ", /Pay UGX 5,000 with MTN MoMo/);
let ugBefore = await smsCount(UG);
screenOk("USSD Uganda 5*3*1 -> prompt", await form("/ussd", { sessionId: u1, serviceCode: SERVICE, phoneNumber: UG, networkCode: "64110", text: "5*3*1" }), "END ", /MTN MoMo PIN prompt/);
await sleep(700);
let ugPrompts = (await outbox(UG)).prompts;
check("   ...MTN MoMo prompt reached the Ugandan phone (pawaPay rail)", ugPrompts.length === 1 && ugPrompts[0].provider === "pawapay" && ugPrompts[0].amountLabel === "UGX 5,000", JSON.stringify(ugPrompts));
if (ugPrompts[0]) {
  await fetch(`${API}/api/dev/prompts/${encodeURIComponent(ugPrompts[0].ref)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "pawapay", action: "pin", pin: "2468" }) });
  const r = await waitForSms(UG, ugBefore, /^Asante! UGX 5,000 received via MTN MoMo/);
  check("   ...receipt SMS in UGX", !!r, r || "none");
}
const b1 = `ATUid_${Date.now()}_bj`;
screenOk("USSD Benin -> asks which wallet", await ussd(BJ, "5", b1), "CON ", /Pay with:\n1\. MTN MoMo\n2\. Moov Money/);
screenOk("USSD Benin 5*2*2 -> Moov Money XOF 1,000", await ussd(BJ, "5*2*2", b1), "CON ", /Pay XOF 1,000 with Moov Money/);
await smsStep("Ghana PAY picks MTN MoMo in GHS", "PAY 20", /MTN MoMo PIN to give GHS 20/, GH);
await smsStep("Benin PAY asks for a wallet", "PAY 1000", /which wallet\? Reply PAY 1000 MTN or PAY 1000 MOOV/, BJ);
await smsStep("Benin PAY with wallet word", "PAY 1000 MOOV", /Moov Money PIN to give XOF 1,000/, BJ);

// Wrong token must be refused (spoofed webhook).
const spoof = await fetch(`${API}/api/at/wrong-token/ussd`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "phoneNumber=%2B254722555010&text=" });
check("Spoofed webhook with wrong token is refused", spoof.status === 404, `HTTP ${spoof.status}`);

console.log(log.join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
