// Creates the test-cases comment on the issue, or updates it on a re-run.
import { appendFileSync, readFileSync } from "node:fs";
import { upsertComment } from "./lib/github.mjs";

const issueNumber = (process.env.GTC_ISSUE_NUMBER || "").trim();
const token = (process.env.GTC_GITHUB_TOKEN || "").trim();
const file = (process.env.GTC_COMMENT_FILE || "").trim();

try {
  if (!token) throw new Error("No github-token available to post the comment.");
  const body = readFileSync(file, "utf8");
  const { url, created } = await upsertComment(token, issueNumber, body);
  console.log(`${created ? "Posted" : "Updated"} test cases on issue #${issueNumber}: ${url}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `comment-url=${url}\n`);
} catch (err) {
  const hint = /403|Resource not accessible/.test(err.message) ? " Give the job `issues: write` permission." : "";
  console.log(`::error::Could not post the test cases on the issue: ${err.message}${hint}`);
  process.exit(1);
}
