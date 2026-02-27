// api/daily.js
import OpenAI from "openai";

export const config = {
  runtime: "nodejs",
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Deterministic "random" so:
 * - The same date produces the same topic/title (no repeats day-to-day)
 * - No database needed
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getDateKey() {
  // Use UTC date so it’s consistent for cron
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Topic bank
 * Add more anytime. The engine rotates by date so content stays fresh.
 * Each topic implies an "aha" angle that everyday people usually miss.
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

const EMOJI_POOL = [
  // growth / score
  "📈", "📊", "📋", "🧮", "📑",
  // power / drive
  "💪", "🚀", "🔥", "⚡", "🧠",
  // money / finance
  "💳", "💵", "🏦", "💰",
  // clarity / insight
  "🤓", "👀", "💡", "🎯", "🧩",
  // rebuild / reset
  "🔄", "🏗️", "🧱", "🧭"
];

function pickDailyTopic(dateKey) {
  const idx = hashString(dateKey) % TOPICS.length;
  return TOPICS[idx];
}

function generateEmojiCombo(seedStr) {
  const rng = mulberry32(hashString(seedStr));
  const count = 2 + Math.floor(rng() * 3); // 2–4 emojis
  const pool = [...EMOJI_POOL];

  // Fisher-Yates shuffle using seeded rng
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count).join("");
}

function buildPrompt({ title, topic }) {
  const extraInstructions = process.env.CREDFLEX_INSTRUCTIONS || "";

  return `
You are writing a 60-second vertical video script for a daily micro show.

SHOW TITLE:
${title}

FORMAT:
- Two speakers in podcast style: HOST and EXPERT.
- HOST tone: emotional, enthusiastic, motivational (Tony/Mel Robbins energy).
- EXPERT tone: anonymous, calm authority, zero fluff, straight truth.
- Must include a clear "Aha!" moment that most everyday people don't know.
- Must be non-repetitive and feel like a fresh episode.

TOPIC FOR TODAY:
${topic}

CONTENT RULES:
- Strong but not reckless framing is allowed.
  Use at most ONE strong line like: "The credit industry profits from confusion."
  And ONE moderate line like: "The system isn't designed for you."
- No shaming. No fearmongering. No legal advice.
- Clear, practical explanation + 1–2 actionable steps someone can do today.
- Keep it under ~150 spoken words if possible (tight, punchy).

CTA RULES (IMPORTANT):
- DO NOT include any link in the script.
- CTA must be a statement, not a question.
- Use this CTA pattern near the end:
  "The free CredFlex app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link."

OUTPUT:
Return ONLY valid JSON with these keys:
{
  "title": string,
  "hook": string,
  "script": string,
  "aha_moment": string,
  "cta": string,
  "topic": string
}

${extraInstructions}
`.trim();
}

export default async function handler(req, res) {
  try {
    // Cron will usually GET this endpoint.
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ error: "Use GET or POST" });
    }

    const dateKey = getDateKey();
    const topic = pickDailyTopic(dateKey);
    const emojiCombo = generateEmojiCombo(`${dateKey}:${topic}`);
    const title = `Your Daily Credit-Flex Minute ${emojiCombo}`;

    const prompt = buildPrompt({ title, topic });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.9,
      messages: [
        { role: "system", content: "You write tight, high-converting short-form scripts." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const raw = completion?.choices?.[0]?.message?.content || "{}";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = {
        title,
        hook: "",
        script: raw,
        aha_moment: "",
        cta: "The free CredFlex app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.",
        topic
      };
    }

    // Enforce title/topic so the engine stays consistent
    data.title = title;
    data.topic = topic;

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err?.message || String(err)
    });
  }
}
