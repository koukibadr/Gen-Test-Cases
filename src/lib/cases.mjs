// Validates the model's output and merges it with existing cases.
// Rules enforced in code, not left to the model:
//   - only issue/contract/existing expectations may block
//   - existing cases and their ids are never changed or dropped
//   - ids are TC-<issue>-NNN, unique, in file order
//   - the total stays within max-cases

const TYPES = ["happy", "negative", "edge", "regression"];
const PRIORITIES = ["P1", "P2", "P3"];
const LAYERS = ["ui", "api"];
const SOURCES = ["issue", "contract", "existing", "assumption"];
const BLOCKING_SOURCES = new Set(["issue", "contract", "existing"]);

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : str(v) ? [str(v)] : []);
const pick = (v, allowed, fallback) => (allowed.includes(str(v)) ? str(v) : fallback);

function normalizeCase(raw, warnings) {
  const c = {
    title: str(raw.title),
    type: pick(raw.type, TYPES, "edge"),
    criterion: str(raw.criterion) || "none",
    priority: pick(raw.priority, PRIORITIES, "P2"),
    layer: pick(raw.layer, LAYERS, "ui"),
    expected_source: pick(raw.expected_source, SOURCES, "assumption"),
    requires: strList(raw.requires),
    preconditions: strList(raw.preconditions),
    steps: strList(raw.steps),
    data: Array.isArray(raw.data) ? raw.data.filter((d) => d && typeof d === "object") : [],
    expected: strList(raw.expected),
  };
  c.blocking = BLOCKING_SOURCES.has(c.expected_source) && c.type !== "regression";
  if (!c.title || c.steps.length === 0 || c.expected.length === 0) {
    warnings.push(`Dropped a case without a title, steps or expected results: "${c.title || "untitled"}"`);
    return null;
  }
  return c;
}

const ORDER = ["title", "type", "criterion", "priority", "layer", "blocking", "expected_source", "requires", "preconditions", "steps", "data", "expected"];
const withId = (id, c) => Object.fromEntries([["id", id], ...ORDER.map((k) => [k, c[k]])]);

export function buildCases({ issueNumber, model: modelOut, existing, maxCases }) {
  const warnings = [];
  const prefix = `TC-${issueNumber}-`;

  const keep = (existing?.cases || []).filter((c) => c && c.id);
  const usedIds = new Set(keep.map((c) => c.id));
  const seenTitles = new Set(keep.map((c) => str(c.title).toLowerCase()));
  let next = keep.reduce((max, c) => {
    const n = Number(String(c.id).slice(prefix.length));
    return String(c.id).startsWith(prefix) && Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);

  const added = [];
  for (const raw of Array.isArray(modelOut.cases) ? modelOut.cases : []) {
    if (keep.length + added.length >= maxCases) {
      warnings.push(`Reached max-cases (${maxCases}); remaining cases were dropped.`);
      break;
    }
    const c = normalizeCase(raw || {}, warnings);
    if (!c) continue;
    const key = c.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    let id;
    do { id = `${prefix}${String(++next).padStart(3, "0")}`; } while (usedIds.has(id));
    usedIds.add(id);
    added.push(withId(id, c));
  }

  const criteria = (Array.isArray(modelOut.criteria) && modelOut.criteria.length ? modelOut.criteria : existing?.criteria || [])
    .map((a, i) => ({ id: str(a.id) || `AC-${i + 1}`, text: str(a.text), derived: Boolean(a.derived) }))
    .filter((a) => a.text);

  const cases = [...keep, ...added];
  const known = new Set(criteria.map((a) => a.id));
  for (const c of added) {
    if (c.criterion !== "none" && !known.has(c.criterion)) warnings.push(`${c.id} points to unknown criterion ${c.criterion}.`);
  }

  const uncovered = (Array.isArray(modelOut.uncovered) ? modelOut.uncovered : [])
    .map((u) => ({ criterion: str(u.criterion), reason: str(u.reason) }))
    .filter((u) => u.reason);
  const covered = new Set(cases.map((c) => c.criterion));
  for (const a of criteria) {
    if (!covered.has(a.id) && !uncovered.some((u) => u.criterion === a.id)) {
      uncovered.push({ criterion: a.id, reason: "No test case covers this criterion." });
    }
  }

  const result = modelOut.result === "needs_clarification" || uncovered.length ? "needs_clarification" : "ok";

  return {
    doc: {
      issue: Number(issueNumber),
      stack: str(modelOut.stack) || existing?.stack || "",
      criteria,
      cases,
      uncovered,
      open_questions: strList(modelOut.open_questions),
    },
    added: added.length,
    kept: keep.length,
    result,
    warnings,
  };
}

export function counts(cases) {
  const by = (k, v) => cases.filter((c) => c[k] === v).length;
  return {
    total: cases.length,
    happy: by("type", "happy"),
    negative: by("type", "negative"),
    edge: by("type", "edge"),
    regression: by("type", "regression"),
    blocking: cases.filter((c) => c.blocking).length,
  };
}
