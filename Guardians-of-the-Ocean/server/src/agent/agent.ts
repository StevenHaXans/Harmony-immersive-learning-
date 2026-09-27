import type { Env } from "../env.js";
import { fitTo, plainText, toGsm7 } from "../lib/text.js";
import { EMERGENCY, matchLesson } from "./lessons.js";

/**
 * The learning agent every channel talks to. It asks Aqua Ask (RAG over the OneAquaHealth
 * publications) and shapes the answer for the channel. When Aqua Ask is unreachable or has
 * nothing, it falls back to the built-in lessons, then offers a human.
 */

const NO_ANSWER = "I do not have sufficient information";

export interface AgentAnswer {
  text: string;
  via: "aqua" | "lessons" | "none";
  source: string | null;
}

interface AquaSource {
  publication_title?: string | null;
  section?: string;
  source_origin?: string;
}

const STOPWORDS = new Set([
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how", "does", "doing", "done", "have", "has",
  "with", "about", "from", "that", "this", "these", "those", "there", "their", "they", "them", "your", "yours",
  "will", "would", "could", "should", "shall", "into", "onto", "than", "then", "also", "some", "many", "much",
  "very", "just", "only", "tell", "please", "explain", "mean", "means", "happen", "happens", "safe",
]);

function keyWords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)).map((w) => w.replace(/(ing|es|s)$/, "")))].filter((w) => w.length >= 3);
}

/** Aqua Ask appends "[Source: ...]" and raw reference lists after the answer; keep only the answer. */
export function answerOnly(text: string): string {
  return text.split(/\[Source:/i)[0].trim();
}

/** True when the answer mentions enough of the question's key words to be about the same thing. */
export function isRelevant(question: string, answer: string): boolean {
  const words = keyWords(question);
  if (!words.length) return true;
  const hay = answer.toLowerCase();
  const hits = words.filter((w) => hay.includes(w)).length;
  return hits >= Math.min(2, Math.ceil(words.length / 2));
}

export class Agent {
  constructor(private env: Env, private fetchImpl: typeof fetch = fetch) {}

  /** `cite` appends "Src: ..." to the text, for SMS where there is nowhere else to show it. */
  async answer(question: string, maxChars: number, opts: { cite?: boolean } = {}): Promise<AgentAnswer> {
    const q = question.trim().slice(0, 500);
    if (q.length < 2) {
      return { text: "Ask me about safe water, hygiene, cholera, malaria or when to see a health worker. Example: ASK signs of cholera", via: "none", source: null };
    }
    // Possible emergencies get the safety instruction first, whatever else the answer says.
    if (EMERGENCY.test(q)) {
      const lead = "This may be an emergency: go to the nearest health facility now or call your local emergency number. ";
      const rest = await this.answerInner(q, Math.max(60, maxChars - lead.length), opts);
      return { ...rest, text: fitTo(lead + rest.text, maxChars) };
    }
    return this.answerInner(q, maxChars, opts);
  }

  private async answerInner(q: string, maxChars: number, opts: { cite?: boolean }): Promise<AgentAnswer> {
    const cite = opts.cite !== false;

    const aqua = await this.askAqua(q);
    // Retrieval sometimes returns a confident answer to a different question; a student asking
    // whether water is safe to drink is better served by the vetted lesson than by that.
    const answerText = aqua ? answerOnly(aqua.text) : "";
    if (aqua && answerText && isRelevant(q, answerText)) {
      const source = aqua.source ? fitTo(toGsm7(aqua.source), cite ? 48 : 120) : null;
      const suffix = source && cite ? ` Src: ${source}` : "";
      let body = fitTo(toGsm7(plainText(answerText)), Math.max(60, maxChars - suffix.length - 1));
      if (suffix && !/[.!?]$/.test(body)) body += ".";
      return { text: body + suffix, via: "aqua", source };
    }

    const lesson = matchLesson(q);
    if (lesson) {
      const text = maxChars <= 200 ? lesson.ussd : lesson.sms.replace(/^Harmony lesson - /, "");
      return { text: fitTo(text, maxChars), via: "lessons", source: `Harmony lesson: ${lesson.title}` };
    }

    return {
      text: fitTo("I don't know that one yet. Reply AGENT and a Harmony health guide will get back to you.", maxChars),
      via: "none",
      source: null,
    };
  }

  private async askAqua(query: string): Promise<{ text: string; source: string | null } | null> {
    const base = this.env.AQUA_ASK_URL.replace(/\/$/, "");
    if (!base) return null;
    try {
      const res = await this.fetchImpl(`${base}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The query is embedded for retrieval, so it goes in bare; shortening happens here.
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { answer?: string; sources?: AquaSource[] };
      const text = String(body.answer ?? "").trim();
      if (!text || text.startsWith(NO_ANSWER)) return null;
      const top = body.sources?.[0];
      const source = top ? (top.publication_title || top.section || top.source_origin || null) : null;
      return { text, source };
    } catch {
      return null;
    }
  }
}
