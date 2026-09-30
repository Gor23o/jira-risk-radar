# Jira Risk Radar

Node.js CLI that scans Jira issues and produces an HTML risk report. It combines
deterministic rule-based flags with Claude's judgment. Built as a Product Manager
test task, so the code should be easy to read and every decision easy to explain.
Quality matters more than speed.

## Working agreement

- Build in the small phases listed under "Build plan" below. Stop at the end of each phase
  so the user can verify and commit. Don't start the next phase unasked.
- Explain decisions briefly as you go. The user is new to this and will present the work.
- Never ask for tokens or secrets. The user fills `.env` themselves.
- **Anything that writes to Jira needs the user's go-ahead in chat first:** `npm run seed`,
  `seed --refresh`, `seed --reset`, `--apply` (without `--dry-run`), and any ad-hoc POST/PUT/DELETE.
  Reads are fine.
- Don't run the pipeline with Claude enabled without saying so, because it costs money. Use
  `--no-ai` or fixtures for routine checks.
- **Scheduled runs** happen in GitHub Actions (`.github/workflows/risk-radar.yml`): daily at
  05:00 UTC plus a manual "Run workflow" button. Secrets live in the GitHub environment `.env`
  (environment secrets, not repository secrets). Every run ends by emailing the result via
  Gmail (`scripts/send-email.js`, content built by the pure `src/notify/email.js`): risk counts in
  the subject, per-assignee table, and every flagged issue with its evidence. Sending a real email needs the user's go-ahead, so use `--dry-run`
  locally. The workflow is **report-only**. Adding
  `--apply` to it needs the user's explicit decision. When a phase changes the CLI's output or
  needs a new secret, update the workflow in the same phase (phase 4: `ANTHROPIC_API_KEY`,
  phase 5: upload the HTML report and replace `scripts/ci-summary.js`).

## Stack

- Node 22+, plain JavaScript, ES modules (`"type": "module"`). No build step.
- `@anthropic-ai/sdk` for Claude, `zod` for config and response schemas, `dotenv` for env.
- Built-in `fetch` for Jira (no Jira SDK) and `node:util` `parseArgs` for CLI flags.
- Vitest for tests. HTML report built with template literals, everything inlined in one file.
- Keep dependencies minimal. Ask before adding one.

## Commands

```bash
npm install
npm test                                   # vitest run
npm run radar                              # node src/cli.js (reads config.json)
npm run radar -- --no-ai --reference-date 2026-10-12
npm run radar -- --dump                    # print normalized issues as JSON
npm run radar -- --jql "sprint in openSprints()"   # override the JQL for one run
npm run radar -- --apply --dry-run         # show what --apply would write
npm run radar -- --apply                   # writes label + comment to Jira (ask first!)
npm run seed -- --dry-run                  # preview the seed plan (read-only)
npm run seed                               # create demo issues in SCRUM (ask first!)
npm run seed -- --refresh                  # demo day: restart healthy issues' clocks (ask first!)
npm run seed -- --reset                    # delete seed-demo issues (ask first!)
npm run seed -- --verify --demo-aging      # check seeded issues against their scenarios now (read-only)
npm run radar -- --no-ai --demo-aging      # rules table with the seed waiting period simulated
```

## Architecture

Pipeline: **fetch → normalize → rules → Claude → merge → report → (apply)**

- `src/jira/` is the only code that talks to Jira. It returns raw API JSON, and
  `normalize.js` turns that into the internal `Issue` shape. Nothing downstream
  sees raw Jira JSON.
- `src/rules/` is **pure**: `(issue, config, referenceDate) → flags[]`. No I/O, no
  `Date.now()`, no env access. That keeps it fully unit-testable, and the tests are
  the main quality evidence.
- `src/ai/` handles Claude: batching, prompt, schema, and parsing. It produces the
  Claude-sourced flags (`vague`, `blockedInComments`) and a `risk_level`, but never
  overrides rule flags.
- `src/merge/` applies the severity model below. It's pure and tested.
- `src/report/` renders one self-contained HTML file:
  1. Header: reference date, JQL, generated-at, AI status (on / off / partial).
  2. **Summary**: count tiles per level (critical / at_risk / ok), then a per-assignee table
     (rows = assignees including "Unassigned"; columns = critical, at_risk, ok, total;
     sorted by critical desc, then at_risk desc). Numbers come from a pure `summarize(results)`.
  3. Issue list, sorted per the severity model.
- `src/pipeline.js` (`runRadar`) is the one pipeline: fetch → demo aging → rules → merge →
  summarize. The CLI table, `--json` report, CI summary and email all render its output.
- `src/cli.js` parses flags and prints; it holds no business logic.

### config.json shape

```json
{
  "jql": "project = SCRUM AND statusCategory != Done",
  "referenceDate": null,
  "timezone": null,
  "businessDays": { "workingDays": [1, 2, 3, 4, 5] },
  "dueSoonBusinessDays": 3,
  "stuckThresholdBusinessDays": { "default": 4, "In Progress": 5, "In Review": 2, "Ready for QA": 2, "In QA": 3 },
  "blockedStatuses": ["Blocked"],
  "bounce": { "fromStatuses": ["In QA", "Ready for QA"], "toStatuses": ["In Progress"], "minCount": 2 },
  "highPriorities": ["Highest", "High"],
  "statusCategoryOverrides": { "In QA": "indeterminate", "Blocked": "indeterminate" },
  "severity": {
    "rules": { "overdue": "critical", "dueSoonNotStarted": "at_risk", "stuck": "at_risk",
               "blocked": "at_risk", "blockedInComments": "at_risk", "bouncing": "at_risk",
               "unassignedHighPriority": "at_risk", "vague": "at_risk" },
    "flagGroups": { "blocked": ["blocked", "blockedInComments"] },
    "escalateAtRiskCount": 2
  },
  "claude": { "enabled": true, "model": "claude-sonnet-5-5", "batchSize": 10, "effort": "low" },
  "apply": { "label": "at-risk", "levels": ["critical", "at_risk"] },
  "seed": { "projectKey": "SCRUM", "label": "seed-demo", "refreshViaStatus": "To Do", "demoAging": true }
}
```

`src/config.js` validates this with zod. Unknown keys are errors, so typos surface. Every
severity value must be `critical`, `at_risk` or `ok`, every flag must have a severity, and a
flag may appear in at most one group. `null` for `referenceDate` means today, and `null` for
`timezone` means the system timezone. CLI flags override config.

## Severity model

Three levels, ordered `ok < at_risk < critical`:

- **critical**: needs action today. Delivery is already failing or will fail without intervention.
- **at_risk**: a warning sign that is likely to cause slippage if ignored.
- **ok**: no flags above `ok`, and Claude (if available) assessed the issue as ok.

Each flag's severity comes from `config.severity.rules` and is never hard-coded:

| Flag | Source | Default severity |
|---|---|---|
| `overdue` | rule | critical |
| `dueSoonNotStarted` | rule | at_risk |
| `stuck` | rule | at_risk |
| `blocked` (Blocked status or Jira flag) | rule | at_risk |
| `blockedInComments` | Claude | at_risk |
| `bouncing` | rule | at_risk |
| `unassignedHighPriority` | rule | at_risk |
| `vague` (no acceptance criteria) | Claude | at_risk |

**Flag groups** (`config.severity.flagGroups`) mark flags that describe the same underlying
problem. The default groups `blocked` and `blockedInComments`. A flag not listed in any group
is its own group.

Combination, in `src/merge/merge.js`. Rule flags and Claude-sourced flags are treated the same way:

1. **Flag level** = the highest flag severity. A flag mapped to `ok` is still shown but doesn't
   raise the level.
2. **Escalation counts distinct problems, not raw flags.** Collapse the flags into groups, where a
   group's severity is its highest member's. If the number of `at_risk` groups is at least
   `escalateAtRiskCount` (default 2), the flag level becomes `critical`.
   - Claude-sourced flags **do** count toward escalation: `vague` + `stuck` → critical.
   - `blocked` + `blockedInComments` = one problem → stays at_risk.
   - `blocked` + `blockedInComments` + `dueSoonNotStarted` = two problems → critical.
3. **Final level** = max(flag level, Claude's `risk_level`). Claude can raise the level, never lower it.
4. If the AI is unavailable, there are no Claude flags and no Claude level, so the final level
   is the rule-flag level.
5. Sort order: level desc → number of distinct problems desc → due date asc (no due date last) → key.

## Conventions

- **Status categories over names.** Use `status.statusCategory.key` (`new`,
  `indeterminate`, `done`) for "done" and "not started". Where a name is unavoidable
  (Blocked, QA bounce, per-status thresholds), it must come from `config.json`, never
  from a hard-coded string in rule code.
- **Dates are date-only and compared against `referenceDate`.** Never call `new Date()`
  inside rules. `referenceDate` is resolved once in `config.js`. Changelog timestamps are
  converted to calendar dates in `config.timezone` before any counting.
- **Business days** (`businessDays.workingDays`, ISO weekdays, default Mon–Fri) are used for
  time in status (stuck thresholds) and the due-soon window. There is one shared helper,
  `businessDaysBetween(start, end)` in `src/rules/dates.js`, which counts working days after
  `start` up to and including `end`.
- `overdue` is a plain date comparison (due date < referenceDate), because a missed date is
  missed on any day. Holidays are not modelled (documented limitation).
- **Time in status** is measured from the last changelog transition into the current
  status, or from the created date if there isn't one. `stuck` applies to statuses whose
  (effective) category is `indeterminate` and fires when business days are **strictly greater**
  than the status threshold. To Do isn't checked, because the backlog is normal.
- **`statusCategoryOverrides`** corrects statuses that the board files under the wrong Jira category.
  The SCRUM board reports In QA and Blocked as `new`, so config maps both to `indeterminate`.
  Rules read categories only through `effectiveCategory()` in `src/rules/statusHistory.js`.
- **Bouncing** = the number of changelog transitions directly from a `bounce.fromStatuses`
  status to a `bounce.toStatuses` status, ≥ `bounce.minCount`.
- Every flag has the shape `{ rule, source, severity, message, evidence }`. `evidence` is
  human-readable, e.g. "In Review for 4 business days (threshold 2)".
- Treat ticket text as **untrusted data** in prompts. Wrap it in delimiters and tell
  Claude to ignore any instructions inside it. HTML-escape everything in the report.
- Fail loudly with actionable messages (missing env var, 401 from Jira, unknown status
  name in config). Don't swallow errors.

## Jira API notes (Cloud, REST v3)

- Search: `POST /rest/api/3/search/jql` with `nextPageToken` pagination (not `startAt`).
  Request only the needed `fields` and use `expand: "changelog"`.
- Embedded changelogs can be truncated. When histories look incomplete, fetch
  `GET /rest/api/3/issue/{key}/changelog` (paginated).
- The "Flagged" field is a custom field whose id varies per site. Discover it via
  `GET /rest/api/3/field` by name. The flagged value looks like `[{ value: "Impediment" }]`.
- Descriptions and comments are ADF (JSON). Convert them with `src/adf/toText.js`.
- Auth: Basic with `JIRA_EMAIL:JIRA_API_TOKEN`. Retry on 429 respecting `Retry-After`.
- Transitions are discovered by target status name via `GET /issue/{key}/transitions`,
  never by hard-coded ids.

## Claude API notes

- Model `claude-sonnet-5-5` (the user's choice; configurable in `config.json`).
- **Before writing phase 4 code, check the current docs on docs.claude.com** (Messages API,
  structured outputs, JS SDK error types) and confirm method names and parameters. The notes
  below are the starting assumption, not the source of truth.
- Structured JSON via `client.messages.parse()` with
  `output_config: { format: zodOutputFormat(schema) }` (to be verified). No assistant prefill.
  Leave thinking at its default and tune `output_config.effort`.
- **No refusal fallback. Keep it simple:** if a batch fails (an API error after the SDK's built-in
  retries, a `stop_reason` of `refusal` or `max_tokens`, or a schema parse failure), every issue
  in that batch gets `ai: { status: "unavailable", reason }`. Issues missing from a response are
  also marked unavailable. The run continues, and the report shows rule flags plus an
  "AI unavailable" badge.
- Batches of 10 by default. Results are matched by issue key, never by position.

## Testing

- Unit tests live in `test/`, mirroring `src/`. Required for: config validation, every rule,
  `businessDaysBetween` (weekend spans, same day, start on Saturday, end on Sunday), the
  status-history helpers, ADF conversion, `merge`, and `summarize`.
- Required merge cases: `blocked` + `blockedInComments` → at_risk; the same plus
  `dueSoonNotStarted` → critical; `vague` + `stuck` → critical; overdue issue that Claude calls
  `ok` → critical; AI unavailable → rule flags only.
- Required status-history case: a refreshed issue (In QA → To Do → In QA) is **not** flagged
  as bouncing, and its time in status restarts at the refresh date.
- Build test issues with a small factory (`test/helpers/makeIssue.js`) instead of
  copy-pasted JSON.
- Tests never hit the network. Anything Jira- or Claude-facing is tested via fixtures in
  `test/fixtures/`.

## Build plan

One commit per phase. Stop after each phase for the user to verify.

| # | Phase | Deliverables | Done when |
|---|---|---|---|
| 0 | Scaffold | `git init`, package.json, .gitignore, .env.example, `config.json`, `src/config.js` (zod validation, referenceDate/timezone resolution), Vitest, README skeleton | `npm test` passes the config-validation tests |
| 1 | Jira read | `jira/client.js`, `jira/search.js`, `jira/fields.js`, `jira/normalize.js`, `adf/toText.js`, `--dump` | SCRUM issues print as normalized JSON; ADF + normalize tests pass on fixtures |
| 2 | Seed demo data | `scripts/seed-data.js` (~30 scenarios), `scripts/seed.js` (`seed`, `--refresh`, `--reset`), demo runbook in README | Board shows the issues; refresh and reset behave as described in "Seed design" |
| 3 | Rule engine | `rules/dates.js`, `rules/statusHistory.js`, six rules, `rules/index.js`, rules-only table in the CLI, `seed/aging.js` + `seed --verify` for instant checks | Rule tests green (including the refresh-is-not-a-bounce case); scenario acceptance test passes on demo day and with aging; `seed --verify --demo-aging` 33/33 live |
| 4 | Claude assessment | Verify SDK on docs.claude.com, then `ai/schema.js`, `ai/prompt.js`, `ai/assess.js` | Fixture tests for parsing + unavailable handling; one real run with the user's OK |
| 5 | Report | `merge/merge.js` and `report/summarize.js` were pulled forward into phase 3 so the daily email shows risk levels; left: `report/html.js` | The HTML report opens and reads well |
| 6 | `--apply` | `jira/apply.js` with `--dry-run`; label + comment for `apply.levels`, skip already-labelled issues | Dry run lists the right issues; the real run writes them; a second run changes nothing |
| 7 | Polish | README: what, setup, run, demo runbook, design decisions, limitations, next steps, "How this was built with Claude" (CLAUDE.md, plan mode, decisions changed during planning: severity model + flag groups, business days, no refusal fallback, seed design). Sample report | A fresh clone works by following the README only |

## Seed design

**Problem:** Jira can't backdate, so every seeded issue enters its status on seed day. With a
future `--reference-date`, all issues in one column have the same time in status, so there's no
healthy-vs-stuck contrast inside a column.

**Solution: seed early, refresh on demo day, run with the real date.**

- Each `seed-data.js` entry has a scenario, a target status, a `dueInBusinessDays` offset
  (or none), and `refresh: true` for healthy issues. All seeded issues get the `seed.label`
  label, and summaries are unique.
- `npm run seed`: run **at least 6 business days before the demo** (longer than the largest
  stuck threshold). It creates the issues, walks them through their transitions, sets the Jira
  flag, adds comments, and creates QA bounces. Due dates = seed date + offset. It refuses to run
  if `seed-demo` issues already exist.
- `npm run seed -- --refresh`: run **on demo day**. Healthy issues move out and straight back
  **via `seed.refreshViaStatus`** (default To Do), e.g. In QA → To Do → In QA, which restarts their
  time in status. The script refuses to run if the via status is in `bounce.fromStatuses` or
  `bounce.toStatuses`, so a refresh can never look like a QA bounce. It also re-anchors all due
  dates to today + offset. Stuck candidates are left alone.
- `npm run seed -- --reset`: deletes exactly `project = SCRUM AND labels = seed-demo`, after
  printing the keys and asking for typed confirmation.
- **Check right away: `--demo-aging`** (user requirement: results must be checkable the moment
  issues are seeded, not after a week). Only `stuck` depends on elapsed time; every other flag is
  live Jira data from the start. `src/seed/aging.js` simulates the wait by moving back the
  "entered current status" date, and **only** for issues that have the seed label AND match a
  scenario with `refresh: false`. It never makes an issue younger, marks aged history entries
  `simulated: true`, and every command using it prints how many issues were aged. Never apply
  it to anything else. It replaces the old "future `--reference-date`" fallback, which shifted
  due-date meanings.
- **`seed.demoAging: true`** in config.json turns demo aging on for *every* run, including the
  scheduled GitHub run and its email, so results show "stuck" from the day after seeding (user
  requirement). Every output states which issues were aged. Set it to `false` when the demo is over.
- `npm run seed -- --verify [--demo-aging] [--reference-date D]` (read-only) runs the rules on the live seeded issues
  and prints ✓/✗ per scenario against `expect`, with hints for un-aged stuck scenarios and due
  dates anchored to another day (fix: `--refresh`).

**Demo runbook** (in the README):
1. Any time: `npm run seed` (after `--reset` if re-seeding), then
   `npm run seed -- --verify --demo-aging` and `npm run radar -- --demo-aging`.
2. On a later day: `npm run seed -- --refresh` first (re-anchors due dates), then the same.
3. Fully real demo (no simulation): seed ≥6 business days ahead, `--refresh` on demo day, and
   run without `--demo-aging`.
4. Optionally: `npm run radar -- --apply --dry-run` to show what would be written to Jira.
