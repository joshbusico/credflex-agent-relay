// api/daily.js
import OpenAI from "openai";

export const config = { runtime: "nodejs" };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Deterministic rotation: same UTC date => same topic/spin
 * No database required.
 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getDateKeyUTC() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getYesterdayDateKeyUTC() {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() - 1);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  "Give a rule of thumb, then the exception that surprises people.",
  "Call out common advice that’s wrong, then replace it with the right move.",
  "Use a short analogy, then the exact step-by-step action.",
  "Focus on reporting vs scoring: what changes where.",
  "Contrast what people think happens vs what bureaus actually do.",
  "Give a 2 item checklist someone can do today.",
  "Frame it as 'why the system reacts this way' without sounding conspiratorial.",
];

function pickByDate(list, dateKey, salt) {
  const idx = hashString(`${salt}:${dateKey}`) % list.length;
  return list[idx];
}

function scrubLinks(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Emoji detection (best-effort). Node supports this in modern runtimes.
function extractEmojis(str) {
  if (typeof str !== "string") return [];
  const matches = str.match(/\p{Extended_Pictographic}/gu);
  return matches ? matches : [];
}

function ensureThreeEmojisNoDup(title) {
  const base = "Your Daily Credit-Flex Minute";
  const t = typeof title === "string" ? title : base;

  // Strip existing emojis then re-add validated ones
  const emojis = extractEmojis(t);
  const unique = [];
  for (const e of emojis) {
    if (!unique.includes(e)) unique.push(e);
  }

  // If model fails, fallback (still looks good)
  while (unique.length < 3) {
    const fallback = ["📈", "💳", "🧠", "🎯", "⚡", "💪"];
    const next = fallback[(unique.length + hashString(t)) % fallback.length];
    if (!unique.includes(next)) unique.push(next);
    else unique.push("📈");
  }

  const finalEmojis = unique.slice(0, 3).join("");

  // Build cleaned title: start exactly with show name
  // Allow optional colon/topic text after it, but keep it tidy
  let cleaned = t;
  // Force prefix
  if (!cleaned.startsWith(base)) cleaned = `${base}: ${cleaned}`;
  // Remove any emojis from cleaned
  cleaned = cleaned.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s{2,}/g, " ").trim();

  // Ensure there is at least something after base (optional)
  // Then append emojis at end
  if (cleaned === base) cleaned = `${base}`;
  return `${cleaned} ${finalEmojis}`.trim();
}

function hasTwoVoices(script) {
  if (typeof script !== "string") return false;
  const hasHost = /(^|\n)\s*HOST\s*:/i.test(script);
  const hasExpert = /(^|\n)\s*EXPERT\s*:/i.test(script);
  return hasHost && hasExpert;
}

function buildPrompt({ dateKey, topic, spin, yesterdayTopic }) {
  const extra = process.env.CREDFLEX_INSTRUCTIONS || "";

  return `
You are writing a single 60-second episode for a daily micro show.

SHOW NAME (must match exactly at the start of title):
Your Daily Credit-Flex Minute

DATE KEY (for non-repetition):
${dateKey}

TODAY TOPIC:
${topic}

YESTERDAY TOPIC (avoid repeating phrasing/angle):
${yesterdayTopic}

SPIN (must follow for freshness):
${spin}

FORMAT (STRICT):
- The script MUST be a dialogue with exactly two speakers: HOST and EXPERT.
- Every spoken line MUST start with either "HOST:" or "EXPERT:".
- Alternate speakers frequently (no long monologues). Minimum 8 total lines.

TONE:
- HOST: calm authority, grounded, no fluff, “let’s get clear.”
- EXPERT: emotional + enthusiastic, motivational energy (Tony/Mel Robbins vibe), but still accurate.

HOOK:
- 1 punchy hook line (HOST) that stops the scroll.

AHA MOMENT:
- Include a clear "Aha!" that most everyday people don’t know.
- Make it concrete and specific.

FRAMING (ALLOWED, LIMITED):
- Include at most ONE strong line: "The credit industry profits from confusion."
- Include at most ONE moderate line: "The system isn't designed for you."
- No shaming. No fearmongering. No legal advice.

ACTION:
- Give 1–2 actionable steps someone can do today.

TRANSITION RULE (IMPORTANT):
- Immediately before CTA, include ONE short empowering sentence that signals confidence/clarity.
- Then go straight into the CTA. No wrap-up after CTA.

CTA (STRICT):
- DO NOT include any link or URL anywhere.
- CTA must be a statement, not a question.
- Use EXACTLY this CTA sentence (verbatim) as the final line of the script:
"The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link."

TITLE (STRICT):
- Provide a title that starts exactly with "Your Daily Credit-Flex Minute"
- Add a short descriptor after it (like ": Hard vs Soft Inquiries Demystified")
- Append exactly 3 relevant emojis at the end of the title.
- Emojis must be relevant, no duplicates.

OUTPUT (STRICT):
Return ONLY valid JSON with keys:
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

async function generateJson(prompt) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.9,
    messages: [
      { role: "system", content: "You write tight, human-sounding, high-converting short-form scripts." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const raw = completion?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(raw);
}

async function repairIfNeeded({ data, dateKey, topic }) {
  // Guardrails: scrub links
  data.title = scrubLinks(data.title);
  data.hook = scrubLinks(data.hook);
  data.script = scrubLinks(data.script);
  data.aha_moment = scrubLinks(data.aha_moment);
  data.cta = scrubLinks(data.cta);

  // Force topic
  data.topic = topic;

  // Force CTA exact + final line behavior (abrupt ending)
  const forcedCTA =
    "The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.";
  data.cta = forcedCTA;

  if (typeof data.script === "string") {
    // Remove any accidental CTA duplicates, then append as final line
    const lines = data.script.split("\n").map((l) => l.trim()).filter(Boolean);

    // Remove any line that contains the CTA idea (so we don't double)
    const filtered = lines.filter(
      (l) => !/Comment\s+FIX/i.test(l) && !/sign-up\s+link/i.test(l)
    );

    // Ensure the final line is the CTA, without adding after it
    filtered.push(`HOST: ${forcedCTA}`);
    data.script = filtered.join("\n");
  }

  // Force title prefix + exactly 3 emojis
  data.title = ensureThreeEmojisNoDup(data.title);

  // Validate voices
  const okVoices = hasTwoVoices(data.script);
  const okHook = typeof data.hook === "string" && data.hook.trim().length > 0;
  const okAha = typeof data.aha_moment === "string" && data.aha_moment.trim().length > 0;

  // If anything critical is missing, do ONE repair pass with strict instructions
  if (!okVoices || !okHook || !okAha) {
    const repairPrompt = `
Fix the following JSON to comply with ALL constraints.

Critical must-fix:
- script MUST contain HOST: and EXPERT: lines (exact labels), alternating frequently, minimum 8 lines.
- hook MUST be a single punchy HOST line.
- aha_moment MUST be one sentence, specific and surprising.
- The very last line of script must be exactly:
HOST: The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.
- No URLs anywhere.

Keep the topic the same:
${topic}

Return ONLY valid JSON with the same keys.

JSON TO FIX:
${JSON.stringify(data, null, 2)}
`.trim();

    const fixed = await generateJson(repairPrompt);

    // Re-apply final enforcement (no links, CTA, title emojis, topic)
    fixed.title = ensureThreeEmojisNoDup(scrubLinks(fixed.title));
    fixed.hook = scrubLinks(fixed.hook);
    fixed.script = scrubLinks(fixed.script);
    fixed.aha_moment = scrubLinks(fixed.aha_moment);
    fixed.topic = topic;
    fixed.cta =
      "The free CredFlex X app that addresses this is releasing soon. Comment FIX and I’ll reply with the sign-up link.";

    // Ensure CTA ends script
    if (typeof fixed.script === "string" && !/HOST:\s*The free CredFlex X app/i.test(fixed.script.split("\n").slice(-1)[0] || "")) {
      const cleanLines = fixed.script.split("\n").map((l) => l.trim()).filter(Boolean);
      cleanLines.push(`HOST: ${fixed.cta}`);
      fixed.script = cleanLines.join("\n");
    }

    return fixed;
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Content-Type", "application/json");
    return res.status(405).send(JSON.stringify({ error: "Use GET or POST" }, null, 2));
  }

  try {
    const dateKey = getDateKeyUTC();
    const topic = pickByDate(TOPICS, dateKey, "topic");
    const yesterdayTopic = pickByDate(TOPICS, getYesterdayDateKeyUTC(), "topic");
    const spin = pickByDate(SPINS, dateKey, "spin");

    const prompt = buildPrompt({ dateKey, topic, spin, yesterdayTopic });

    let data;
    try {
      data = await generateJson(prompt);
    } catch {
      data = {
        title: "Your Daily Credit-Flex Minute: Credit Clarity 📈💳🧠",
        hook: "HOST: Quick truth about credit—most people have this backwards.",
        script: "",
        aha_moment: "Aha! Credit changes often reflect reporting mechanics, not your worth.",
        cta: "",
        topic,
      };
    }

    data = await repairIfNeeded({ data, dateKey, topic });

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
