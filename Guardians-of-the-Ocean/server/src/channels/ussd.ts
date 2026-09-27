import { LESSONS, lessonAt, quizText } from "../agent/lessons.js";
import type { Deps } from "../deps.js";
import { money } from "../lib/countries.js";
import { countryOf, networkOf, normalizePhone } from "../lib/phone.js";
import { SMS_MAX, USSD_MAX, toGsm7 } from "../lib/text.js";
import type { MobilePayment, Student } from "../store/types.js";

/**
 * USSD menu (Africa's Talking format: reply "CON ..." to continue, "END ..." to close).
 * The gateway sends the whole input history as `text`, e.g. "5*2*1". The menu is a pure walk of
 * that history, so any step can be replayed; side effects only run on END screens.
 * "0" goes back one level, "00" goes home.
 */

export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  text: string;
  /** MCC+MNC of the caller's network, sent by the gateway. */
  networkCode?: string;
}

/** "KES 100 + UGX 5,000": gifts in different currencies are listed, never added up. */
export function givenLabel(payments: MobilePayment[]): string {
  const sums = new Map<string, number>();
  for (const p of payments) if (p.status === "paid") sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount);
  if (!sums.size) return "none yet";
  return [...sums].map(([cur, amt]) => money(amt, cur)).join(" + ");
}

const ROOT =
  "Harmony: learn the ocean\n1. Today's lesson\n2. Quiz\n3. Ask a question\n4. Talk to a guide\n5. Support the coast\n6. My progress\n7. Daily SMS lessons";

function con(body: string): string {
  return "CON " + clip(body);
}

function end(body: string): string {
  return "END " + clip(body);
}

function clip(body: string): string {
  const text = toGsm7(body);
  return text.length <= USSD_MAX - 4 ? text : text.slice(0, USSD_MAX - 4);
}

/** Applies back ("0") and home ("00") to the raw input history. */
export function navPath(text: string): string[] {
  const path: string[] = [];
  for (const raw of (text || "").split("*")) {
    const input = raw.trim();
    if (input === "") continue;
    if (input === "00") path.length = 0;
    else if (input === "0") path.pop();
    else path.push(input);
  }
  return path;
}

// Where each session's lesson counter started, so replayed steps show the same lesson.
const sessionBase = new Map<string, { base: number; at: number }>();

function lessonBase(sessionId: string, student: Student): number {
  const now = Date.now();
  for (const [key, v] of sessionBase) if (now - v.at > 10 * 60_000) sessionBase.delete(key);
  const hit = sessionBase.get(sessionId);
  if (hit) return hit.base;
  sessionBase.set(sessionId, { base: student.lessonIndex, at: now });
  return student.lessonIndex;
}

export async function handleUssd(deps: Deps, req: UssdRequest): Promise<string> {
  const phone = normalizePhone(req.phoneNumber);
  if (!phone) return end("Sorry, Harmony doesn't support numbers from this country yet.");
  const student = await deps.store.upsertStudent(phone);
  const path = navPath(req.text);
  const [menu, a, b, c] = path;

  if (!menu) return con(ROOT);

  switch (menu) {
    case "1": {
      // Each "1" after the lesson screen moves to the next lesson.
      const base = lessonBase(req.sessionId, student);
      const rest = path.slice(1);
      const smsIt = rest[rest.length - 1] === "2";
      const nexts = rest.filter((x) => x === "1").length;
      if (rest.some((x) => x !== "1" && x !== "2") || rest.slice(0, -1).includes("2")) return con("Invalid choice.\n" + ROOT);
      const index = base + nexts;
      const lesson = lessonAt(index);
      const seen = Math.max(student.lessonIndex, index + 1);
      if (seen !== student.lessonIndex) await deps.store.upsertStudent(phone, { lessonIndex: seen });
      if (smsIt) {
        deps.background(() => deps.messenger.sendSms(phone, lesson.sms));
        return end(`Sent! "${lesson.title}" is on its way by SMS.`);
      }
      return con(`${lesson.ussd}\n1. Next lesson\n2. SMS it to me\n0. Back`);
    }

    case "2": {
      const index = Math.max(student.lessonIndex - 1, 0);
      const lesson = lessonAt(index);
      if (!a) return con(quizText(lesson, "ussd"));
      const pick = Number(a) - 1;
      if (![0, 1, 2].includes(pick)) return con("Pick 1, 2 or 3.\n" + quizText(lesson, "ussd"));
      if (pick === lesson.quiz.answer) {
        const updated = await deps.store.upsertStudent(phone, { points: student.points + 10 });
        return end(`Correct! +10 points. You have ${updated.points} points.\n${lesson.quiz.why}`);
      }
      return end(`Not quite. Answer: ${lesson.quiz.options[lesson.quiz.answer]}.\n${lesson.quiz.why}`);
    }

    case "3": {
      if (!a) return con("Type your question.\nThe answer comes by SMS.");
      const question = path.slice(1).join(" ");
      deps.background(async () => {
        const answer = await deps.agent.answer(question, SMS_MAX - 12);
        await deps.messenger.sendSms(phone, `Harmony: ${answer.text}`);
        await deps.desk.logAnswered(phone, "ussd", question, answer.text);
      });
      return end("Thanks! Your answer is on its way by SMS.");
    }

    case "4": {
      if (!a) return con("Talk to a guide\n1. Call me back (free)\n2. Ask by SMS\n0. Back");
      if (a === "1") {
        deps.background(() => deps.desk.requestHuman(phone, "ussd", "Asked for a call back", { call: true }));
        return end("A guide will call you shortly. Your ticket number is coming by SMS.");
      }
      if (a === "2") {
        if (!b) return con("Type your question for the guide:");
        const question = path.slice(2).join(" ");
        deps.background(() => deps.desk.requestHuman(phone, "ussd", question, { call: false }));
        return end("Sent to a guide. They will reply by SMS.");
      }
      return con("Invalid choice.\nTalk to a guide\n1. Call me back (free)\n2. Ask by SMS\n0. Back");
    }

    case "5": {
      const country = countryOf(phone)!;
      const wallets = country.wallets;
      if (!wallets.length) return end(`Mobile money support isn't available in ${country.name} yet.`);
      const network = networkOf(phone, req.networkCode);
      let wallet = network !== "unknown" ? wallets.find((w) => w.network === network) ?? null : wallets.length === 1 ? wallets[0] : null;
      if (network !== "unknown" && !wallet) return end(`Mobile money support works with ${wallets.map((w) => w.label).join(" or ")}.`);

      let rest = path.slice(1);
      if (!wallet) {
        // The network can't be told from this number: let the student pick their wallet first.
        const walletMenu = `Pay with:\n${wallets.map((w, i) => `${i + 1}. ${w.label}`).join("\n")}\n0. Back`;
        if (!rest[0]) return con(walletMenu);
        wallet = wallets[Number(rest[0]) - 1] ?? null;
        if (!wallet) return con("Invalid choice.\n" + walletMenu);
        rest = rest.slice(1);
      }
      const [pick, typed, confirm] = rest;
      const cur = country.currency;
      const presets = country.amounts.slice(0, 3);
      const pickMenu = `Support coast restoration\n${presets.map((v, i) => `${i + 1}. ${money(v, cur)}`).join("\n")}\n4. Other amount\n0. Back`;
      if (!pick) return con(pickMenu);

      let amount: number;
      let confirmAt: string | undefined;
      if (pick === "4") {
        if (!typed) return con(`Enter amount in ${cur} (${country.min} - ${country.max}):`);
        amount = Number(typed);
        confirmAt = confirm;
        if (!Number.isInteger(amount) || amount < country.min || amount > country.max) {
          return end(`Amount must be between ${money(country.min, cur)} and ${money(country.max, cur)}. Please dial again.`);
        }
      } else {
        const idx = Number(pick) - 1;
        if (!presets[idx]) return con("Invalid choice.\n" + pickMenu);
        amount = presets[idx];
        confirmAt = typed;
      }

      const label = wallet.label;
      if (!confirmAt) return con(`Pay ${money(amount, cur)} with ${label} from this line?\n1. Confirm\n0. Back`);
      if (confirmAt !== "1") return end("Cancelled. Nothing was charged.");
      if (!deps.payments.available(country.code, wallet.id)) return end(`${label} is not available yet. Please try later.`);

      const chosen = wallet.id;
      deps.background(async () => {
        try {
          await deps.payments.start({ phone, amount, wallet: chosen, mccmnc: req.networkCode, channel: "ussd" });
        } catch (err) {
          await deps.messenger.sendSms(phone, `Harmony: ${(err as Error).message}`);
        }
      });
      return end(`You'll get a ${label} PIN prompt in a few seconds for ${money(amount, cur)}. Thank you!`);
    }

    case "6": {
      const payments = await deps.store.paymentsForPhone(phone, 50);
      return end(
        `Your Harmony progress\nLessons: ${Math.min(student.lessonIndex, LESSONS.length)} of ${LESSONS.length}\nQuiz points: ${student.points}\nSupport given: ${givenLabel(payments)}\nDaily SMS: ${student.optedIn ? "on" : "off"}`
      );
    }

    case "7": {
      if (student.optedIn) {
        return end(`You already get daily lessons. Text STOP to ${deps.env.SMS_SHORTCODE} to pause them.`);
      }
      await deps.store.upsertStudent(phone, { optedIn: true });
      deps.background(() =>
        deps.messenger.sendSms(phone, `Welcome to Harmony! One short ocean lesson a day by SMS. Text LESSON any time, ASK <question>, or STOP to quit. Free to receive.`)
      );
      return end(`You're in! One short lesson a day by SMS. Text STOP to ${deps.env.SMS_SHORTCODE} to quit.`);
    }

    default:
      return con("Invalid choice.\n" + ROOT);
  }
}
