// Collects a bounded slice of the repository for the model: file list, manifests,
// README, agent notes, and the files whose paths best match the issue's words.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const MANIFESTS = [
  "package.json", "pubspec.yaml", "build.gradle", "build.gradle.kts", "settings.gradle.kts",
  "Podfile", "Package.swift", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml",
  "composer.json", "Gemfile", "pom.xml", "next.config.ts", "next.config.js", "app.json",
];
const NOTES = ["AGENTS.md", "CLAUDE.md", "README.md", "readme.md"];
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|\.dart_tool|Pods|vendor|coverage|\.git)\//;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|pdf|zip|gz|jar|so|dylib|ttf|otf|woff2?|mp[34]|mov|lock|map|min\.js)$/i;
const SKIP_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pubspec\.lock|Podfile\.lock)$/;
const STOP = new Set(("the and for with that this from when have should will user users page screen able into " +
  "after before then than they them their there what which while also must can not are was were been being " +
  "add adds added make makes show shows display new feature issue bug fix please using use").split(" "));

function listFiles() {
  try {
    return execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readCapped(path, cap) {
  try {
    if (!existsSync(path) || statSync(path).size > 2_000_000) return null;
    const text = readFileSync(path, "utf8");
    return text.length > cap ? `${text.slice(0, cap)}\n… (truncated)` : text;
  } catch {
    return null;
  }
}

export function keywords(...texts) {
  const words = texts.join(" ").toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || [];
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}

export function collectContext({ title, body, maxChars }) {
  const files = listFiles();
  if (files.length === 0) {
    return { text: "(No repository files found. Was the repository checked out before this action?)", fileCount: 0, included: [] };
  }

  const candidates = files.filter((f) => !SKIP_DIR.test(`${f}`) && !SKIP_EXT.test(f) && !SKIP_FILE.test(f));
  const parts = [];
  const included = [];
  let used = 0;
  const add = (label, content) => {
    if (!content) return false;
    const block = `### ${label}\n\`\`\`\n${content}\n\`\`\`\n`;
    if (used + block.length > maxChars) return false;
    parts.push(block);
    used += block.length;
    return true;
  };

  const tree = candidates.slice(0, 600).join("\n") + (candidates.length > 600 ? `\n… and ${candidates.length - 600} more files` : "");
  add("File list", tree);

  for (const name of [...NOTES, ...MANIFESTS]) {
    const path = files.find((f) => f === name);
    if (path && add(path, readCapped(path, 6000))) included.push(path);
  }

  const words = keywords(title, body);
  const scored = candidates
    .filter((f) => !included.includes(f))
    .map((f) => {
      const p = f.toLowerCase();
      return { f, score: words.reduce((s, w) => s + (p.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
    .slice(0, 10);

  for (const { f } of scored) {
    if (add(f, readCapped(f, 8000))) included.push(f);
  }

  return { text: parts.join("\n"), fileCount: files.length, included };
}
