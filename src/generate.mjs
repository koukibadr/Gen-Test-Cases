// Generates the test cases for one issue and writes:
//   - <output-dir>/issue-<n>.yaml in the workspace
//   - the issue comment body in RUNNER_TEMP
// and sets the step outputs.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { chat, extractJson, resolveBaseUrl } from "./lib/model.mjs";
import { collectContext } from "./lib/context.mjs";
import { buildCases, counts } from "./lib/cases.mjs";
import { findComment, yamlFromComment } from "./lib/github.mjs";
import { renderComment } from "./lib/render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const env = (k, d = "") => (process.env[k] ?? d).trim();
const int = (k, d) => {
  const n = Number.parseInt(env(k), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const setOutput = (k, v) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  else console.log(`[output] ${k}=${v}`);
};
const fail = (msg) => {
  console.log(`::error::${msg}`);
  process.exit(1);
};

async function main() {
  const issueNumber = env("GTC_ISSUE_NUMBER");
  const title = env("GTC_ISSUE_TITLE");
  const body = process.env.GTC_ISSUE_BODY ?? "";
  const model = env("GTC_MODEL");
  const apiKey = env("GTC_API_KEY");
  const token = env("GTC_GITHUB_TOKEN");
  const maxCases = int("GTC_MAX_CASES", 25);
  const maxTokens = int("GTC_MAX_TOKENS", 8000);
  const contextChars = int("GTC_CONTEXT_CHARS", 60000);
  const outDir = env("GTC_OUTPUT_DIR", "e2e/cases").replace(/^\/+|\/+$/g, "") || ".";

  if (!/^\d+$/.test(issueNumber)) fail("No issue number. Run on an `issues` event or set the issue-number input.");
  if (!title) fail("The issue has no title. Set the issue-title input when not running on an `issues` event.");
  if (!model) fail("The model input is required.");
  if (!apiKey) fail("The api-key input is empty. Pass your provider key from a secret.");

  let baseUrl;
  try {
    baseUrl = resolveBaseUrl(env("GTC_PROVIDER", "anthropic"), env("GTC_BASE_URL"));
  } catch (e) {
    fail(e.message);
  }

  const casesFile = join(outDir, `issue-${issueNumber}.yaml`);

  // Existing cases: the committed file first, then the previous issue comment.
  let existing = null;
  let existingFrom = "";
  if (existsSync(casesFile)) {
    existing = yaml.load(readFileSync(casesFile, "utf8"));
    existingFrom = casesFile;
  } else if (token && process.env.GITHUB_REPOSITORY) {
    try {
      const prev = await findComment(token, issueNumber);
      const text = yamlFromComment(prev?.body);
      if (text) {
        existing = yaml.load(text);
        existingFrom = "the previous issue comment";
      }
    } catch (e) {
      console.log(`::warning::Could not read previous test cases from the issue: ${e.message}`);
    }
  }
  if (existing && !Array.isArray(existing.cases)) existing = null;
  if (existing) console.log(`Keeping ${existing.cases.length} existing cases from ${existingFrom}.`);

  const context = collectContext({ title, body, maxChars: contextChars });
  console.log(`Repository context: ${context.fileCount} files listed, ${context.included.length} files included.`);

  const system = readFileSync(join(here, "..", "prompts", "system.md"), "utf8").replaceAll("{{MAX_CASES}}", String(maxCases));
  const user = [
    `# Issue #${issueNumber}`,
    "<issue>",
    `Title: ${title}`,
    "",
    body || "(no description)",
    "</issue>",
    "",
    existing
      ? `# Existing cases (keep them; return only new cases)\n\`\`\`yaml\n${yaml.dump({ criteria: existing.criteria, cases: existing.cases }, { lineWidth: 120 })}\`\`\`\n`
      : "",
    "# Project context",
    context.text,
    "",
    "Design the test cases now. Reply with the JSON object only.",
  ].join("\n");

  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  console.log(`Calling ${model} at ${baseUrl} …`);

  let reply = await chat({ baseUrl, apiKey, model, messages, maxTokens });
  let parsed;
  try {
    parsed = extractJson(reply.content);
  } catch (err) {
    console.log(`::warning::Reply was not valid JSON (${err.message}); asking the model to fix it.`);
    if (reply.finishReason === "length") console.log("::warning::The reply hit max-tokens; consider raising the max-tokens input.");
    messages.push({ role: "assistant", content: reply.content });
    messages.push({ role: "user", content: `That reply was not a valid JSON object (${err.message}). Reply again with only the complete JSON object, no code fence.` });
    reply = await chat({ baseUrl, apiKey, model, messages, maxTokens });
    try {
      parsed = extractJson(reply.content);
    } catch (err2) {
      fail(`The model did not return valid JSON after a retry: ${err2.message}`);
    }
  }
  if (reply.usage) console.log(`Tokens: ${reply.usage.prompt_tokens ?? "?"} in, ${reply.usage.completion_tokens ?? "?"} out.`);

  const built = buildCases({ issueNumber, model: parsed, existing, maxCases });
  for (const w of built.warnings) console.log(`::warning::${w}`);
  if (built.doc.cases.length === 0) fail("The model produced no usable test cases.");

  const ordered = {
    issue: Number(issueNumber),
    title,
    generated_by: "gen-test-cases v0",
    model,
    generated_at: new Date().toISOString(),
    stack: built.doc.stack,
    criteria: built.doc.criteria,
    cases: built.doc.cases,
    uncovered: built.doc.uncovered,
    open_questions: built.doc.open_questions,
  };
  const yamlText = yaml.dump(ordered, { lineWidth: 120, noRefs: true });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(casesFile, yamlText);

  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  const runUrl = process.env.GITHUB_RUN_ID ? `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : "";
  const commentBody = renderComment({ doc: ordered, yamlText, result: built.result, model, runUrl, added: built.added, kept: built.kept });
  const tmp = process.env.RUNNER_TEMP || "/tmp";
  const commentFile = join(tmp, `gen-test-cases-${issueNumber}.md`);
  writeFileSync(commentFile, commentBody);

  const n = counts(ordered.cases);
  console.log(`Wrote ${casesFile}: ${n.total} cases (${n.happy} happy, ${n.negative} negative, ${n.edge} edge, ${n.regression} regression), ${n.blocking} blocking, result ${built.result}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, commentBody.replace(/<details>[\s\S]*?<\/details>/g, "") + "\n");
  }

  setOutput("cases-file", casesFile);
  setOutput("comment-file", commentFile);
  setOutput("total", n.total);
  setOutput("blocking", n.blocking);
  setOutput("result", built.result);
}

main().catch((err) => fail(err.message));
