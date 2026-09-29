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
```

Everything adjustable (JQL, thresholds, severities, model) lives in `config.json`.

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
