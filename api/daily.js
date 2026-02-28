// api/daily.js
import OpenAI from "openai";

export const config = { runtime: "nodejs" };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Deterministic rotation (no DB):
 * - Same UTC date => same topic/spin
 * - Different day => different topic/spin (reliable freshness)
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getUTCDateKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function pickByDate(list, dateKey, salt) {
  const idx = hashString(`${salt}:${dateKey}`) % list.length;
  return list[idx];
}

function getYesterdayUTCDateKey() {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - 1);
  return getUTCDateKey(dt);
}

/**
 * Topics (rotate daily)
 * Expand anytime.
 */
const TOPICS = [
  "Why paying off a card can drop your score",
  "Utilization: the 30% myth and what actually matters",
  "Statement date vs due date: the hidden score lever",
  "Authorized user: when it helps and when it hurts",
  "Hard vs soft inquiries: what lenders really see",
  "Disputes: why ‘dispute everything’ can backfire",
  "Collections: the difference between paid vs deleted",
  "Charge offs: what changes (and what doesn’t) after payment",
  "Credit mix: why opening the wrong account can hurt",
  "Old accounts: why closing a card can sting later",
  "Debt validation: what it is and what it isn’t",
  "Zombie debts: how they get resurrected",
  "Medical collections: the special rules most people miss",
  "Goodwill letters: how to get a late payment removed",
  "Late payments: why a single 30-day can hurt for years",
  "Utilization per card vs overall utilization",
  "Credit limit increases: when to ask, when not to",
  "Balance transfers: the ‘gotcha’ people don’t expect",
  "Personal loans: why they can help utilization but hurt DTI",
  "Credit builder loans: what they do and don’t do",
  "Secured cards: how to graduate faster",
  "Derogatories: what ‘date of first delinquency’ controls",
  "What ‘verified’ really means in a bureau dispute",
  "CFPB complaints: when they work best",
  "Identity verification: why bureaus stall and how to respond",
  "FCRA basics: the single sentence most people need to know",
  "Debt collectors: what they can’t legally say",
  "Reporting timelines: when updates actually hit your file",
  "Why scores differ (FICO vs Vantage) and why it matters",
  "Rent reporting: when it helps and when it’s noise",
];

const SPINS = [
  "Explain it like I’m 12, then give the real reason.",
  "Give the common advice, then the exception that surprises people.",
  "Call out the popular myth, then replace it with the correct move.",
  "Use a simple analogy, then give a 2-step action plan.",
  "Contrast what people think happens vs what the bureaus actually do.",
  "Focus on what changes in scoring vs what changes in reporting.",
  "Give a quick 2-item checklist someone can do today.",
  "Explain why the system reacts this way without sounding conspiratorial.",
];

/**
 * Guards
 */
function scrubLinks(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function ensureExactly3EmojisAtEnd(title) {
  if (typeof title !== "string") return title;

  // Remove any links just in case
  title = scrubLinks(title);

  const prefix = "Your Daily Credit-Flex Minute";
  if (!title.startsWith(prefix)) {
    // Force the prefix if model drifted
    title = `${prefix} ${title.replace(/^["']|["']$/g, "").trim()}`;
  }

  // Extract emojis (basic unicode emoji ranges; not perfect but works well)
  const emojiRegex =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;
  const emojis = title.match(emojiRegex) || [];

  // Remove all emojis from title body
  const withoutEmojis = title.replace(emojiRegex, "").replace(/\s{2,}/g, " ").trim();

  // Keep last 3 unique emojis
  const unique = [];
  for (const e of emojis) {
    if (!unique.includes(e)) unique.push(e);
  }
  const last3 = unique.slice(-3);

  // If not enough emojis, add safe defaults (varied but neutral)
  while (last3.length < 3) last3.unshift("📈");
  const finalEmojis = last3.slice(-3).join("");

  return `${withoutEmojis} ${finalEmojis}`.trim();
}

function buildPrompt({ dateKey, topic, spin, yesterdayTopic }) {
  const extra = process.env.CREDFLEX_INSTRUCTIONS || "";

  // IMPORTANT: single, consistent ruleset.
  // Also: host = calm authority, expert = enthusiastic Tony/Mel vibe.
  return `
You are creating ONE 60-second episode for a daily micro show designed to drive comments and waitlist signups.

SHOW NAME (must be exact):
Your Daily Credit-Flex Minute

DATE KEY:
${dateKey}

TODAY'S TOPIC:
${topic}

YESTERDAY'S TOPIC (avoid repeating the same angle/phrasing):
${yesterdayTopic}

VARIATION SPIN (follow this):
${spin}

CHARACTERS:
- HOST: calm authority, anonymous expert vibe, grounded and clear.
- EXPERT: emotional, enthusiastic, motivational (Tony/Mel Robbins energy). Urgent but not reckless.

STRUCTURE (must follow):
1) Hook (1 sentence) that stops scrolling.
2) Fast clarification of the misconception.
3) AHA MOMENT (explicit, labeled as Aha!) that most people don’t know.
4) 1–2 actionable steps (simple, concrete).
5) TRANSITION LINE (1 sentence) that empowers the viewer (clarity/control/confidence).
6) CTA (exact wording below).

FRAMING LIMITS:
- Use at most ONE strong line like: "The credit industry profits from confusion."
- Use at most ONE moderate line like: "The system isn't designed for you."
- No shaming, no fearmongering, no legal advice, no "hire me" vibe.

TITLE RULES (strict):
- title MUST start with exactly: "Your Daily Credit-Flex Minute"
- title MUST end with exactly 3 relevant emojis
- emojis must be relevant to the topic, varied day-to-day, and no repeating the same emoji twice

CTA RULES (strict):
- DO NOT include any link anywhere.
- CTA must be a statement, not a question.
- CTA must be EXACTLY:
"The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link."

OUTPUT (return ONLY valid JSON):
{
  "title": string,
  "hook": string,
  "script": string,
  "aha_moment": string,
  "cta": string,
  "topic": string
}

${extra}
`.trim();
}

export default async function handler(req, res) {
  // Allow cron GET and manual POST
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Content-Type", "application/json");
    return res
      .status(405)
      .send(JSON.stringify({ error: "Use GET or POST" }, null, 2));
  }

  try {
    const dateKey = getUTCDateKey();
    const yesterdayKey = getYesterdayUTCDateKey();

    const topic = pickByDate(TOPICS, dateKey, "topic");
    const spin = pickByDate(SPINS, dateKey, "spin");
    const yesterdayTopic = pickByDate(TOPICS, yesterdayKey, "topic");

    const prompt = buildPrompt({ dateKey, topic, spin, yesterdayTopic });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content:
            "Write punchy, human, high-converting short-form dialogue. No corporate tone.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        title: "Your Daily Credit-Flex Minute 📈💳🧠",
        hook: "",
        script: String(raw),
        aha_moment: "",
        cta:
          "The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.",
        topic,
      };
    }

    // Server-enforced truth:
    data.topic = topic;

    // Force exact CTA
    data.cta =
      "The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.";

    // Scrub links anywhere
    data.title = scrubLinks(data.title);
    data.hook = scrubLinks(data.hook);
    data.script = scrubLinks(data.script);
    data.aha_moment = scrubLinks(data.aha_moment);

    // Enforce title prefix + exactly 3 emojis at end
    data.title = ensureExactly3EmojisAtEnd(data.title);

    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    return res.status(500).send(
      JSON.stringify(
        { error: "Server error", message: err?.message || String(err) },
        null,
        2
      )
    );
  }
}
