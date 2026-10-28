# Gen Test Cases

Generate user acceptance test cases for a GitHub issue with the AI model of your choice, and post them on the issue.

For every acceptance criterion in the issue, the action designs **happy**, **negative** and **edge** cases (plus a few **regression** cases when shared code is affected), grounded in your repository's real pages, screens and APIs. It posts them as one comment on the issue: a readable summary for people and the full YAML for machines. Optionally, it also commits the cases file to your repository.

```
Issue opened → read issue + repository → model designs cases → comment on the issue (+ optional commit)
```

## Quick start

```yaml
# .github/workflows/test-cases.yml
name: Test cases
on:
  issues:
    types: [opened]

jobs:
  test-cases:
    runs-on: ubuntu-latest
    permissions:
      contents: read      # use write if commit: true
      issues: write       # to post the comment
    steps:
      - uses: actions/checkout@v6        # the model reads your code for real names
      - uses: koukibadr/gen-test-cases@v0
        with:
          provider: anthropic
          model: claude-sonnet-4-6
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Providers

Any provider with an OpenAI-compatible chat API works. Pick a preset with `provider`, or point `base-url` at any compatible endpoint.

| `provider` | Example `model` | Key secret |
|---|---|---|
| `anthropic` (or `claude`) | `claude-sonnet-4-6` | Claude API key |
| `openai` | `gpt-5` | OpenAI key |
| `xai` (or `grok`) | `grok-4` | xAI key |
| `gemini` | `gemini-2.5-pro` | Google AI Studio key |
| `openrouter` | `anthropic/claude-sonnet-4.6`, free models ending in `:free` | OpenRouter key |
| `groq`, `mistral`, `deepseek` | provider's model name | provider key |
| `custom` + `base-url` | e.g. Ollama: `base-url: http://localhost:11434/v1` | any value |

Model names change often; use the name your provider lists today.

## Inputs

| Input | Default | Description |
|---|---|---|
| `provider` | `anthropic` | Provider preset (see above). |
| `model` | required | Model name. |
| `api-key` | required | Provider API key, from a secret. |
| `base-url` | | OpenAI-compatible base URL; overrides the preset. |
| `issue-number`, `issue-title`, `issue-body` | the triggering issue | Set these to run on events other than `issues`. |
| `commit` | `false` | Also commit the cases file. Needs `contents: write`. |
| `commit-branch` | checked-out branch | Where to push the commit. |
| `output-dir` | `e2e/cases` | Folder of the cases file (`issue-<n>.yaml`). |
| `max-cases` | `25` | Maximum cases per issue. |
| `max-tokens` | `8000` | Maximum tokens the model may generate. |
| `context-chars` | `60000` | How much repository content is sent to the model. |
| `github-token` | `github.token` | Token for the comment (and the push). |

## Outputs

| Output | Description |
|---|---|
| `result` | `ok`, or `needs_clarification` when a criterion could not be tested as written. |
| `total` | Number of cases. |
| `blocking` | Number of blocking cases. |
| `cases-file` | Path of the YAML file in the workspace. |
| `comment-url` | Link to the issue comment. |

## What a case looks like

```yaml
- id: TC-42-001
  title: Search returns recipes that match the keyword
  type: happy                 # happy | negative | edge | regression
  criterion: AC-1
  priority: P1                # P1 | P2 | P3
  layer: ui                   # ui | api
  blocking: true
  expected_source: issue      # issue | contract | existing | assumption
  requires: [seed-data]
  preconditions: ["A recipe named 'Chicken curry' exists"]
  steps: ["Open /recipes", "Type 'chicken' in Search", "Press Enter"]
  data: [{ keyword: chicken }, { keyword: CHICKEN }]
  expected: ["Only recipes whose name contains 'chicken' are listed"]
```

**Blocking** is decided by where the expected result comes from, and is enforced by the action, not left to the model: only results stated in the issue, an attached contract, or the project's existing behavior can block. Results the model had to assume never block; they become open questions on the issue.

## Re-running

Re-run the workflow (or call the action again) on the same issue: existing cases and their ids are kept, only missing cases are added, and the same comment is updated. Edits made to the comment stay in its history.

## Security

- The model only receives text and returns JSON. It cannot run commands or change files; the action writes the one cases file itself.
- The issue text is passed as data, never as instructions.
- Repository content up to `context-chars` is sent to your model provider. Exclude secrets from your repository as usual.

## Limits (v0)

- The model sees a bounded slice of the repository (file list, manifests, README and the files whose paths match the issue), not the whole codebase.
- GitHub comments are capped at 65,536 characters. Large results drop the step details, then the YAML, from the comment; the full file is always attached to the workflow run as an artifact.
- No test code is generated; the cases are designed for a person or a runner to execute.

## License

MIT
