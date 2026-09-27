import express, { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { LESSONS, lessonAt } from "../agent/lessons.js";
import { ticketCode } from "../agent/desk.js";
import { handleSms, helpText } from "../channels/sms.js";
import { handleUssd } from "../channels/ussd.js";
import { handleVoiceCall, handleVoiceMenu, handleVoicePay, handleVoiceQuestion, VoiceRequest } from "../channels/voice.js";
import type { Deps } from "../deps.js";
import { HttpError } from "../http.js";
import { COUNTRIES, money } from "../lib/countries.js";
import { countryOf, getDefaultCountry, maskPhone, networkOf, normalizePhone, prettyPhone } from "../lib/phone.js";
import { walletLabel } from "../payments/service.js";
import { RateLimiter } from "../lib/rate.js";
import { kes } from "../lib/text.js";
import type { AgentTicket, Provider, TicketStatus } from "../store/types.js";

type Handler = (req: Request, res: Response) => Promise<void>;

function wrap(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const phoneSchema = z.string().min(9).max(20);

export function mobileRouter(deps: Deps): Router {
  const { env, store, messenger, payments, agent, desk } = deps;
  const r = Router();
  const form = express.urlencoded({ extended: false, limit: "32kb" });

  // Anything that can make a stranger's phone buzz is capped per number and per IP.
  const phoneLimit = new RateLimiter(4, 10 * 60_000);
  const ipLimit = new RateLimiter(20, 10 * 60_000);
  const askLimit = new RateLimiter(30, 10 * 60_000);

  function guard(req: Request, phone: string | null): void {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!ipLimit.take(`ip:${ip}`) || (phone && !phoneLimit.take(`phone:${phone}`))) {
      throw new HttpError(429, "Too many requests for this number. Please wait a few minutes.");
    }
  }

  function requirePhone(raw: unknown): string {
    const phone = normalizePhone(raw);
    if (!phone) throw new HttpError(400, "Enter a valid mobile number, with the country code if it is not local (e.g. +256 772 123 456)");
    return phone;
  }

  function requireAdmin(req: Request): void {
    if (!env.ADMIN_TOKEN) {
      if (env.devTools) return;
      throw new HttpError(503, "The agent console is locked until ADMIN_TOKEN is set");
    }
    const header = req.headers.authorization || "";
    if (header !== `Bearer ${env.ADMIN_TOKEN}`) throw new HttpError(401, "Unauthorized");
  }

  // ── Public config for the web app ──

  r.get("/api/mobile/config", (_req, res) => {
    res.json({
      ussdCode: env.USSD_CODE,
      smsShortcode: env.SMS_SHORTCODE,
      voiceNumber: env.AT_VOICE_NUMBER || null,
      modes: {
        sms: messenger.smsMode,
        voice: messenger.voiceMode,
        mpesa: payments.providers.mpesa.mode,
        airtel: payments.providers.airtel.mode,
        pawapay: payments.providers.pawapay.mode,
        stripe: env.stripeEnabled,
      },
      available: { card: env.stripeEnabled },
      defaultCountry: getDefaultCountry().code,
      // Every supported country with its currency, networks (for number hints) and wallets.
      countries: payments.catalogue().map(({ country, wallets }) => ({
        code: country.code,
        name: country.name,
        flag: country.flag,
        dial: country.dial,
        nsn: country.nsn,
        trunk0: country.trunk0,
        mobileStarts: country.mobileStarts ?? null,
        currency: country.currency,
        amounts: country.amounts,
        min: country.min,
        max: country.max,
        networks: country.networks.map((n) => ({ id: n.id, name: n.name, prefixes: n.prefixes })),
        wallets: wallets.map((w) => ({ id: w.id, label: w.label, network: w.network, available: w.available, rail: w.rail })),
      })),
      amounts: { usd: [5, 10, 25, 50, 100] },
      goalGifts: env.MOBILE_GOAL_GIFTS,
      lessons: LESSONS.map((l) => ({ id: l.id, title: l.title, summary: l.ussd })),
      guides: desk.hasGuides,
      simulator: env.devTools,
      store: store.kind,
    });
  });

  r.get("/api/mobile/phone-info", (req, res) => {
    const phone = normalizePhone(req.query.phone);
    const network = phone ? networkOf(phone) : "unknown";
    const country = phone ? countryOf(phone) : null;
    const wallet = country?.wallets.find((w) => w.network === network) ?? null;
    res.json({ valid: !!phone, country: country?.code ?? null, network, wallet: wallet?.id ?? null });
  });

  // ── Students ──

  const joinBody = z.object({ phone: phoneSchema, name: z.string().max(40).optional(), school: z.string().max(60).optional() });

  r.post("/api/students/join", wrap(async (req, res) => {
    const body = joinBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Enter your phone number");
    const phone = requirePhone(body.data.phone);
    guard(req, phone);
    const name = body.data.name?.trim() || null;
    const existing = await store.getStudent(phone);
    const student = await store.upsertStudent(phone, {
      optedIn: true,
      name: name ?? existing?.name ?? null,
      school: body.data.school?.trim() || existing?.school || null,
    });
    const lesson = lessonAt(student.lessonIndex);
    await store.upsertStudent(phone, { lessonIndex: student.lessonIndex + 1 });
    await messenger.sendSms(
      phone,
      `Welcome${name ? " " + name : ""} to Harmony Health! ${lesson.sms.replace(/^Harmony lesson - /, "Tip 1 - ")} Text HELP to ${env.SMS_SHORTCODE} or dial ${env.USSD_CODE}.`
    );
    res.json({
      ok: true,
      phone: prettyPhone(phone),
      country: countryOf(phone)?.code ?? null,
      network: networkOf(phone),
      smsMode: messenger.smsMode,
      firstLesson: lesson.title,
    });
  }));

  // ── The agent (same brain as SMS / USSD / voice) ──

  const askBody = z.object({ question: z.string().min(2).max(500), phone: z.string().max(20).optional(), sms: z.boolean().optional() });

  r.post("/api/agent/ask", wrap(async (req, res) => {
    const body = askBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Type a question first");
    const ip = req.ip || "unknown";
    if (!askLimit.take(`ask:${ip}`)) throw new HttpError(429, "Slow down a little and try again in a minute.");
    const phone = body.data.phone ? requirePhone(body.data.phone) : null;
    if (body.data.sms && phone) guard(req, phone);
    const answer = await agent.answer(body.data.question, 700, { cite: false });
    let smsSent = false;
    if (body.data.sms && phone) {
      const forPhone = await agent.answer(body.data.question, 440);
      smsSent = (await messenger.sendSms(phone, `Harmony: ${forPhone.text}`)).ok;
      await desk.logAnswered(phone, "web", body.data.question, answer.text);
    }
    res.json({ ...answer, smsSent });
  }));

  const callbackBody = z.object({ phone: phoneSchema, question: z.string().max(300).optional(), call: z.boolean().optional() });

  r.post("/api/agent/callback", wrap(async (req, res) => {
    const body = callbackBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Enter your phone number");
    const phone = requirePhone(body.data.phone);
    guard(req, phone);
    const { ticket, calling } = await desk.requestHuman(phone, "web", body.data.question?.trim() || "Asked for a call back", {
      call: body.data.call !== false,
    });
    res.json({ ok: true, ticket: ticketCode(ticket), calling, guides: desk.hasGuides });
  }));

  // ── Mobile money ──

  const payBody = z.object({
    phone: phoneSchema,
    amount: z.coerce.number(),
    wallet: z.string().max(20).optional(),
    // Older clients sent the Kenyan wallet as `provider`.
    provider: z.enum(["mpesa", "airtel"]).optional(),
    purpose: z.string().max(40).optional(),
  });

  r.post("/api/pay/mobile", wrap(async (req, res) => {
    const body = payBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Enter a phone number and amount");
    const phone = requirePhone(body.data.phone);
    guard(req, phone);
    const { payment, message } = await payments.start({
      phone,
      amount: body.data.amount,
      wallet: body.data.wallet ?? body.data.provider,
      purpose: body.data.purpose,
      channel: "web",
    });
    res.status(201).json({ payment: payments.view(payment, message) });
  }));

  r.get("/api/pay/mobile/:id", wrap(async (req, res) => {
    const payment = await payments.refresh(String(req.params.id));
    if (!payment) throw new HttpError(404, "Payment not found");
    res.json({ payment: payments.view(payment) });
  }));

  function callbackAllowed(token: string): boolean {
    if (env.CALLBACK_TOKEN) return token === env.CALLBACK_TOKEN;
    return !env.production && token === "dev";
  }

  r.post("/api/pay/pawapay/callback/:token", wrap(async (req, res) => {
    if (!callbackAllowed(String(req.params.token))) throw new HttpError(404, "Not found");
    const handled = await payments.handlePawapayCallback(req.body);
    res.json({ ok: true, handled });
  }));

  r.post("/api/pay/mpesa/callback/:token", wrap(async (req, res) => {
    if (!callbackAllowed(String(req.params.token))) throw new HttpError(404, "Not found");
    const handled = await payments.handleMpesaCallback(req.body);
    // Daraja only needs an acknowledgement; anything else makes it retry.
    res.json({ ResultCode: 0, ResultDesc: handled ? "Accepted" : "Ignored" });
  }));

  r.post("/api/pay/airtel/callback/:token", wrap(async (req, res) => {
    if (!callbackAllowed(String(req.params.token))) throw new HttpError(404, "Not found");
    const handled = await payments.handleAirtelCallback(req.body);
    res.json({ ok: true, handled });
  }));

  r.get("/api/mobile/ledger", wrap(async (_req, res) => {
    res.json(await mobileLedger(deps));
  }));

  // ── Africa's Talking webhooks: /api/at/{CALLBACK_TOKEN}/... ──

  const at = Router({ mergeParams: true });
  at.use((req, _res, next) => {
    next(callbackAllowed(String(req.params.token)) ? undefined : new HttpError(404, "Not found"));
  });
  const atBase = () => `${env.publicApiUrl}/api/at/${env.CALLBACK_TOKEN || "dev"}`;

  at.post("/ussd", form, wrap(async (req, res) => {
    const reply = await handleUssd(deps, {
      sessionId: String(req.body.sessionId ?? ""),
      phoneNumber: String(req.body.phoneNumber ?? ""),
      text: String(req.body.text ?? ""),
      networkCode: req.body.networkCode ? String(req.body.networkCode) : undefined,
    });
    res.type("text/plain").send(reply);
  }));

  at.post("/sms", form, wrap(async (req, res) => {
    const from = String(req.body.from ?? "");
    const text = String(req.body.text ?? "");
    res.sendStatus(200); // acknowledge fast; the reply goes out as a new SMS
    deps.background(async () => {
      const reply = await handleSms(deps, from, text);
      if (reply) await messenger.sendSms(from, reply);
    });
  }));

  at.post("/delivery", form, wrap(async (req, res) => {
    const status = String(req.body.status ?? "");
    if (status && status !== "Success") console.warn(`[sms] delivery ${req.body.id}: ${status} (${req.body.failureReason ?? ""})`);
    res.sendStatus(200);
  }));

  const voiceSteps: Record<string, (d: Deps, base: string, v: VoiceRequest) => Promise<string>> = {
    "/voice": handleVoiceCall,
    "/voice/menu": handleVoiceMenu,
    "/voice/question": handleVoiceQuestion,
    "/voice/pay": handleVoicePay,
  };
  for (const [path, handler] of Object.entries(voiceSteps)) {
    at.post(path, form, wrap(async (req, res) => {
      const xml = await handler(deps, atBase(), req.body as VoiceRequest);
      if (!xml) {
        res.sendStatus(200);
        return;
      }
      res.type("application/xml").send(xml);
    }));
  }
  r.use("/api/at/:token", at);

  // ── Agent console + broadcasts (Bearer ADMIN_TOKEN) ──

  function ticketView(t: AgentTicket) {
    return {
      id: t.id,
      code: ticketCode(t),
      phone: prettyPhone(t.phone),
      channel: t.channel,
      question: t.question,
      answer: t.answer,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    };
  }

  r.get("/api/agent/tickets", wrap(async (req, res) => {
    requireAdmin(req);
    const status = String(req.query.status || "all") as TicketStatus | "all";
    const valid = ["all", "open", "answered", "handoff", "closed"].includes(status) ? status : "all";
    const tickets = await store.listTickets(valid, 100);
    res.json({ tickets: tickets.map(ticketView), guides: env.agentPhones.map(maskPhone) });
  }));

  const replyBody = z.object({ message: z.string().min(1).max(450) });

  r.post("/api/agent/tickets/:id/reply", wrap(async (req, res) => {
    requireAdmin(req);
    const body = replyBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Write a reply first");
    const ticket = await desk.reply(String(req.params.id), body.data.message, "console");
    if (!ticket) throw new HttpError(404, "Ticket not found");
    res.json({ ticket: ticketView(ticket) });
  }));

  r.post("/api/agent/tickets/:id/close", wrap(async (req, res) => {
    requireAdmin(req);
    const ticket = await store.updateTicket(String(req.params.id), { status: "closed" });
    if (!ticket) throw new HttpError(404, "Ticket not found");
    res.json({ ticket: ticketView(ticket) });
  }));

  const broadcastBody = z.object({ message: z.string().max(450).optional() });

  r.post("/api/admin/broadcast", wrap(async (req, res) => {
    requireAdmin(req);
    const body = broadcastBody.safeParse(req.body ?? {});
    if (!body.success) throw new HttpError(400, "Message is too long");
    const students = await store.listOptedIn(5000);
    let sent = 0;
    for (const s of students) {
      let text = body.data.message?.trim();
      if (!text) {
        const lesson = lessonAt(s.lessonIndex);
        await store.upsertStudent(s.phone, { lessonIndex: s.lessonIndex + 1 });
        text = `${lesson.sms} Reply QUIZ to test yourself or STOP to quit.`;
      }
      if ((await messenger.sendSms(s.phone, text)).ok) sent += 1;
    }
    res.json({ ok: true, students: students.length, sent });
  }));

  // ── Simulator (DEV_TOOLS) ──

  if (env.devTools) {
    const dev = Router();
    const devBase = () => `${env.publicApiUrl}/api/dev`;

    dev.post("/ussd", wrap(async (req, res) => {
      const reply = await handleUssd(deps, {
        sessionId: String(req.body.sessionId ?? "sim"),
        phoneNumber: String(req.body.phone ?? ""),
        text: String(req.body.text ?? ""),
      });
      res.type("text/plain").send(reply);
    }));

    dev.post("/sms", wrap(async (req, res) => {
      const phone = requirePhone(req.body.phone);
      const reply = await handleSms(deps, phone, String(req.body.text ?? ""));
      if (reply) await messenger.sendSms(phone, reply);
      res.json({ ok: true });
    }));

    for (const [path, handler] of Object.entries(voiceSteps)) {
      dev.post(path, wrap(async (req, res) => {
        const phone = requirePhone(req.body.phone);
        const outbound = String(req.body.clientRequestId ?? "").startsWith("agent:");
        const xml = await handler(deps, devBase(), {
          isActive: "1",
          sessionId: String(req.body.sessionId ?? "sim"),
          direction: outbound ? "Outbound" : "Inbound",
          callerNumber: outbound ? env.AT_VOICE_NUMBER : phone,
          destinationNumber: outbound ? phone : env.AT_VOICE_NUMBER,
          clientRequestId: req.body.clientRequestId,
          dtmfDigits: req.body.digits,
          transcript: req.body.transcript,
        });
        res.type("application/xml").send(xml);
      }));
    }

    dev.get("/phone/:phone", wrap(async (req, res) => {
      const phone = requirePhone(req.params.phone);
      const outbox = messenger.outbox(phone, 60);
      const open = (["mpesa", "airtel", "pawapay"] as Provider[]).flatMap((p) => (deps.mocks[p]?.openPrompts(phone) ?? []).map((x) => ({ ...x, provider: p })));
      const prompts = await Promise.all(
        open.map(async (x) => {
          const payment = await store.getPayment(x.paymentId);
          return { ...x, amountLabel: money(x.amount, x.currency), walletLabel: payment ? walletLabel(payment.country, payment.wallet) : "Mobile money" };
        })
      );
      res.json({ outbox, prompts, network: networkOf(phone), country: countryOf(phone)?.code ?? null });
    }));

    const promptBody = z.object({ provider: z.enum(["mpesa", "airtel", "pawapay"]), action: z.enum(["pin", "cancel"]), pin: z.string().max(8).optional() });

    dev.post("/prompts/:ref", wrap(async (req, res) => {
      const body = promptBody.safeParse(req.body);
      if (!body.success) throw new HttpError(400, "Bad prompt response");
      const mock = deps.mocks[body.data.provider];
      if (!mock) throw new HttpError(409, "That provider is live, not in practice mode");
      const outcome = mock.respond(String(req.params.ref), body.data.action, body.data.pin);
      if (!outcome) throw new HttpError(404, "Prompt already closed");
      res.json({ outcome });
    }));

    dev.get("/help", (_req, res) => {
      res.json({ sms: helpText(deps) });
    });

    r.use("/api/dev", dev);
  }

  return r;
}

export async function mobileLedger(deps: Deps) {
  const totals = await deps.store.paymentTotals();
  const byCurrency = Object.entries(totals.byCurrency)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([currency, v]) => ({ currency, amount: v.amount, count: v.count, label: money(v.amount, currency) }));
  return {
    gifts: totals.paidCount,
    pending: totals.pendingCount,
    countries: totals.countries,
    byCurrency,
    students: await deps.store.studentCount(),
  };
}
