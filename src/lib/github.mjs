// Minimal GitHub REST helpers for the issue comment.
export const MARKER = "<!-- gen-test-cases -->";

function api(token) {
  const base = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set.");
  return async (method, path, body) => {
    const res = await fetch(`${base}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
}

export async function findComment(token, issueNumber) {
  const call = api(token);
  for (let page = 1; page <= 20; page++) {
    const comments = await call("GET", `/issues/${issueNumber}/comments?per_page=100&page=${page}`);
    const hit = comments.find((c) => typeof c.body === "string" && c.body.includes(MARKER));
    if (hit) return hit;
    if (comments.length < 100) return null;
  }
  return null;
}

export async function upsertComment(token, issueNumber, body) {
  const call = api(token);
  const existing = await findComment(token, issueNumber);
  if (existing) {
    const updated = await call("PATCH", `/issues/comments/${existing.id}`, { body });
    return { url: updated.html_url, created: false };
  }
  const created = await call("POST", `/issues/${issueNumber}/comments`, { body });
  return { url: created.html_url, created: true };
}

// Pulls the YAML block out of a previous comment body.
export function yamlFromComment(body) {
  const m = body?.match(/```yaml\n([\s\S]*?)\n```/);
  return m ? m[1] : null;
}
