#!/usr/bin/env node
/**
 * Seed a "try the app" demo into the local dev instance so a human can
 * click through it immediately — no hand-written one-off scripts.
 *
 * Mints an operator session cookie via the shared auth lib (same path as
 * `scripts/local-session.mjs` and the e2e suite), then drives the REAL
 * public API to create a group, a track, and two activities that exercise
 * the interactive Parts: a write-reflection + quiz activity, and an embed.
 * It never writes the DB directly — only auth seeding does that, and only
 * because OAuth has no headless mode.
 *
 * Library-backed Parts (read/listen/watch) need an R2 upload + a real file
 * and are intentionally left out — add those through the Library upload UI.
 *
 * Usage:
 *   pnpm seed-local                                  # seed for the default local operator
 *   pnpm seed-local --email me@example.com           # seed for / as a specific operator
 *   pnpm seed-local --email me@e.com --user-id u_x   # target an EXISTING user's id
 *   pnpm seed-local --base-url http://localhost:8787 # override the Worker origin
 *   pnpm seed-local --json                           # machine-readable output
 */
import process from "node:process";
import { BETTER_AUTH_SESSION_COOKIE, mintSessionCookie } from "./lib/auth-session.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const email = (args.email ?? "seed-operator@local.dev").trim().toLowerCase();
const name =
  args.name ??
  (email === "seed-operator@local.dev" ? "Local Operator" : (email.split("@")[0] ?? email));
const userIdSlug = email.replace(/[^a-z0-9]/g, "_").slice(0, 40);
const userId = args.userId ?? `u_local_${userIdSlug}`;
const baseUrl = (args.baseUrl ?? "http://localhost:8787").replace(/\/$/, "");

let cookie;
try {
  ({ cookie } = await mintSessionCookie({
    userId,
    email,
    name,
    asOperator: true,
    idPrefix: "s_seed_",
  }));
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

const api = `${baseUrl}/api/v1`;

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${BETTER_AUTH_SESSION_COOKIE}=${cookie}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    fail(
      `${method} ${path} → ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`,
    );
  }
  return json;
}

function activityBody(trackId, title, parts) {
  return {
    trackId,
    title,
    parts,
    flow: { prereqs: [], displayOrder: parts.map((p) => p.id) },
    audience: { kind: "everyone_enrolled" },
    completionRule: { kind: "manual_mark" },
    libraryRefs: [],
    prerequisiteActivityIds: [],
    suggestedNextActivityIds: [],
  };
}

const group = await call("POST", "/g", { name: "Demo — Tuesday Learners" });
const track = await call("POST", `/g/${group.id}/tracks`, {
  name: "Beginner Spanish (demo)",
  description: "Reflection, quiz, and an embed — for trying out the interactive Parts.",
});

const reflectQuiz = await call(
  "POST",
  `/tracks/${track.id}/activities`,
  activityBody(track.id, "Greetings — reflect & quiz", [
    {
      kind: "write_reflection",
      id: "p_reflect",
      prompt: "What's your favorite Spanish greeting, and when would you use it?",
      minWords: 10,
      placeholder: "Write a few sentences…",
    },
    {
      kind: "quiz",
      id: "p_quiz",
      questions: [
        {
          id: "q1",
          prompt: "Which greeting is most formal?",
          shape: {
            kind: "multiple_choice",
            options: ["Buenos días", "Qué onda", "Hola"],
            answerKeyIndex: 0,
          },
          explainAfterAnswer: "“Buenos días” is the formal daytime greeting.",
        },
        {
          id: "q2",
          prompt: "Type “yes” or “sí” to confirm you practiced aloud.",
          shape: {
            kind: "short_answer",
            correctAnswer: "sí",
            alsoAccept: ["si", "yes"],
            exactMatch: false,
          },
          explainAfterAnswer: "Either spelling counts.",
        },
      ],
    },
  ]),
);

const embed = await call(
  "POST",
  `/tracks/${track.id}/activities`,
  activityBody(track.id, "Watch — a short clip", [
    {
      kind: "embed",
      id: "p_embed",
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Intro video",
    },
  ]),
);

const spaOrigin = baseUrl.includes(":8787") ? "http://localhost:5173" : baseUrl;
const trackUrl = `${spaOrigin}/g/${group.id}/t/${track.id}`;

if (args.json) {
  process.stdout.write(
    `${JSON.stringify(
      {
        cookieName: BETTER_AUTH_SESSION_COOKIE,
        cookieValue: cookie,
        user: { id: userId, email },
        groupId: group.id,
        trackId: track.id,
        activities: { reflectQuiz: reflectQuiz.id, embed: embed.id },
        trackUrl,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

process.stdout.write(
  [
    `Seeded a demo for ${email} (${userId}).`,
    "",
    `  Group:  ${group.id}  "Demo — Tuesday Learners"`,
    `  Track:  ${track.id}  "Beginner Spanish (demo)"`,
    `  Activities: reflect+quiz (${reflectQuiz.id}), embed (${embed.id})`,
    "",
    "Open it in the browser:",
    `  ${trackUrl}`,
    "",
    "Sign in as this operator by pasting the cookie in the browser console, then reload:",
    `  document.cookie = "${BETTER_AUTH_SESSION_COOKIE}=${cookie}; path=/"`,
    "",
    "Library-backed Parts (read/listen/watch) need a file — add those via the Library upload UI.",
    "",
  ].join("\n"),
);

function parseArgs(argv) {
  const out = { json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--json") out.json = true;
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--user-id") out.userId = argv[++i];
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else fail(`Unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: pnpm seed-local [options]",
      "",
      "Seeds a group + track + a reflection/quiz activity + an embed activity into the",
      "local dev instance via the real API, and prints a cookie + URL to try them.",
      "",
      "Options:",
      "  --email <addr>      Operator to seed as (default seed-operator@local.dev)",
      "  --name <str>        Display name if the user is created",
      "  --user-id <id>      Target an existing user's id (e.g. a real OAuth account)",
      "  --base-url <url>    Worker origin (default http://localhost:8787)",
      "  --json              Emit a JSON blob instead of the human-readable summary",
      "  --help, -h          Show this help",
      "",
    ].join("\n"),
  );
}

function fail(msg) {
  process.stderr.write(`seed-local: ${msg}\n`);
  process.exit(1);
}
