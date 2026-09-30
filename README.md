# Jira Risk Radar

A command-line tool that scans Jira issues, flags the ones at risk of slipping, and writes
a sorted HTML report. Deterministic rules catch the measurable problems (overdue, stuck,
blocked, bouncing back from QA, unassigned high-priority work). Claude adds judgment on
top: blocker language hidden in comments, and vague tickets with no acceptance criteria.

> Status: work in progress. Built in phases; see `CLAUDE.md` → "Build plan".

## Setup

Requires Node.js 22.12 or newer.

```bash
npm install
cp .env.example .env   # then fill in your Jira and Anthropic credentials
npm test
```

> **Folder names with `:` break `npm test`.** npm adds `node_modules/.bin` to `PATH`, and `:`
> is the `PATH` separator. If your checkout folder contains a colon, rename it.

## How to run

```bash
npm run radar                                  # evaluate as of today
npm run radar -- --reference-date 2026-10-12   # evaluate "as of" another date
npm run radar -- --no-ai                       # rules only, no Claude call
npm run radar -- --jql "sprint in openSprints()"   # different JQL for one run
npm run radar -- --dump > issues.json          # the normalized issues as JSON
```

Everything adjustable (JQL, thresholds, severities, model) lives in `config.json`.

## Scheduled runs (GitHub Actions)

`.github/workflows/risk-radar.yml` runs the radar **every day at 09:00 Yerevan time** (05:00 UTC),
and on demand from **Actions → Risk Radar → Run workflow**, where you can optionally override the
JQL or reference date. Each run shows a summary on the run page and keeps its output as a
downloadable artifact for 14 days. Scheduled runs are report-only; they never write to Jira.

One-time setup: in the GitHub repo, go to **Settings → Secrets and variables → Actions → New
repository secret** and add `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` (same values as `.env`).

To change the schedule, edit the `cron` line: `"0 5 * * 1-5"` = weekdays only,
`"0 5 * * 1,4"` = Monday and Thursday. Times are UTC. GitHub pauses scheduled workflows
in repos with no commits for 60 days.

## Demo runbook

_Phase 2._

## Design decisions

_Phase 7._

## Limitations

_Phase 7._

## Next steps

_Phase 7._

## How this was built with Claude

_Phase 7._
