// api/daily.js
import OpenAI from "openai";

export const config = {
  runtime: "nodejs",
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Deterministic "random" so:
 * - Same date -> same topic choice (no DB needed)
 * - Rotates topics day-to-day
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * We use UTC date so Vercel cron is consistent.
 * If you want Knoxville-local mornings, adjust the cron in vercel.json.
 */
function getDateKeyUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Topic bank
 * Add more whenever you want. The selector rotates by day.
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

/**
 * Adds some variety even if you only have 30 topics:
 * - Same index rotation
 * - Plus a "spin" angle that changes by day
 */
const SPINS = [
  "Explain it like I’m 12, then give the real reason.",
  "Give a simple rule of thumb, then the exception that surprises people.",
  "Call out the common advice that’s wrong, then replace it with the right move.",
  "Use a short analogy, then the exact step-by-step action.",
  "Focus on what changes in the scoring model vs what changes in reporting.",
  "Contrast what people think happens vs what the bureaus actually do.",
  "Give a quick 'do this today' checklist with 2 items max.",
  "Frame it as 'why the system reacts this way' without sounding conspiratorial.",
];

function pickFromListByDate(list, dateKey, salt) {
  const idx = hashString(`${salt}:${dateKey}`) % list.length;
  return list[idx];
}

function pickTopicByDate(dateKey) {
  const idx = hashString(`topic:${dateKey}`) % TOPICS.length;
  return TOPICS[idx];
}

function buildPrompt({ dateKey, topic, spin, yesterdayHint }) {
  const extraInstructions = process.env.CREDFLEX_INSTRUCTIONS || "";

  return `
You are writing a single 60-second episode for a daily micro show.

SHOW ID:
date_key: ${dateKey}

SHOW NAME:
"Your Daily Credit-Flex Minute"

FORMAT:
- Two speakers in podcast style: HOST and EXPERT.
- HOST tone: emotional, calm authority, no fluff, direct truth.
- EXPERT tone: anonymous, enthusiastic, motivational (Tony/Mel Robbins energy).
- Must include a clear Aha! moment that everyday people usually don't know.

TOPIC FOR TODAY:
${topic}

SPIN FOR VARIETY (follow it):
${spin}

NON-REPETITION RULES (IMPORTANT):
- Must feel like a fresh episode with a fresh angle.
- Avoid generic filler intros like "today we’re talking about..." unless it’s genuinely punchy and unique.
- Do not reuse exact phrasing from yesterday (assume yesterday was roughly about: ${yesterdayHint}).

FRAMING RULES:
- Use at most ONE strong line like: "The credit industry profits from confusion."
- And ONE moderate line like: "The system isn't designed for you."
- No shaming. No fearmongering. No legal advice. No “hire me” vibes.
- Clear, practical explanation + 1–2 actionable steps someone can do today.
- Keep it tight: ~140–170 spoken words.

TITLE RULES (IMPORTANT):
- The "title" must start exactly with: "Your Daily Credit-Flex Minute"
- Then append 3 relevant emojis at the end.
- Emojis must be relevant to the topic and must feel varied day-to-day.
- Do not repeat the same emoji twice.

TRANSITION RULE (IMPORTANT):
- Immediately before the CTA, include one short, empowering sentence that reinforces clarity, control, or confidence.
- It should feel like an earned emotional shift, not a sales bridge.
- Example tone (do not copy exactly):
  "Now you understand the system instead of fearing it."
  "When you know this, you move differently."
  "Clarity changes how you play the game."

CTA RULES (IMPORTANT):
- DO NOT include any link in the script, hook, or CTA.
- CTA must be a statement, not a question.
- Use this exact CTA pattern near the end:
  "The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link."
- Never mention a link unless the viewer comments FIX (so: no link text, no URL).

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
  // Basic method handling
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Content-Type", "application/json");
    return res.status(405).send(JSON.stringify({ error: "Use GET or POST" }, null, 2));
    }

  try {
    const dateKey = getDateKeyUTC();
    const topic = pickTopicByDate(dateKey);
    const spin = pickFromListByDate(SPINS, dateKey, "spin");

    // Give the model a hint to avoid repeating yesterday’s angle (not perfect but helpful).
    // If you want this stronger, we can compute yesterday’s topic + spin and pass it in.
    const yesterdayHint = pickTopicByDate(
      (() => {
        const dt = new Date();
        dt.setUTCDate(dt.getUTCDate() - 1);
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const d = String(dt.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      })()
    );

    const prompt = buildPrompt({ dateKey, topic, spin, yesterdayHint });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.9,
      messages: [
        {
          role: "system",
          content:
            "You write tight, high-converting short-form scripts that sound human, punchy, and practical.",
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
        title: "Your Daily Credit-Flex Minute 💳",
        hook: "",
        script: raw,
        aha_moment: "",
        cta: "The free CredFlex app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.",
        topic,
      };
    }

    // Enforce topic stays consistent (title is model-controlled, per your request)
    data.topic = topic;

    // Enforce CTA pattern and no link leakage
    const forcedCTA =
      "The free CredFlex app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.";
    data.cta = forcedCTA;

    // If model accidentally inserts a link anywhere, hard-sanitize (simple guardrail)
    const scrubLinks = (s) =>
      typeof s === "string"
        ? s.replace(/https?:\/\/\S+/gi, "").replace(/\bwww\.\S+/gi, "")
        : s;

    data.hook = scrubLinks(data.hook);
    data.script = scrubLinks(data.script);
    data.aha_moment = scrubLinks(data.aha_moment);
    data.title = scrubLinks(data.title);

    // Return pretty JSON (helps when you open in browser)
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify(data, null, 2));
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    return res.status(500).send(
      JSON.stringify(
        {
          error: "Server error",
          message: err?.message || String(err),
        },
        null,
        2
      )
    );
  }
}
