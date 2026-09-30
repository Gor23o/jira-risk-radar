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

One-time setup: the workflow reads its secrets from a GitHub **environment** named `.env`. In the
repo, go to **Settings → Environments → New environment**, name it `.env`, and under
**Environment secrets** add `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` and `ANTHROPIC_API_KEY`
(same values as your local `.env` file). Use *secrets*, not *variables*: variables are stored
in plain text. Keep "Deployment branches" on *No restriction* and add no required reviewers,
otherwise scheduled runs will wait for approval. Each run appears as a "deployment" to `.env`
on the repo page; that's expected.

### Email results

Every run, scheduled or manual, successful or failed, ends with an email: the results table
on success, and on failure which step broke plus a link to the log. It's sent through Gmail.

1. Turn on 2-Step Verification for the Google account that will send the email.
2. Create an app password at https://myaccount.google.com/apppasswords (16 characters).
   Your normal Google password will not work.
3. Add three more **secrets** to the `.env` environment:
   - `GMAIL_USER`: the sending Gmail address
   - `GMAIL_APP_PASSWORD`: the app password
   - `EMAIL_TO`: recipients, comma-separated (kept as a secret so addresses stay out of this public repo)

**Choosing recipients per run:** the Run workflow form has a **"Send email to"** field. Type one or
more addresses (comma-separated) and that run emails them *instead of* `EMAIL_TO`. Leave it
empty to use `EMAIL_TO`. Scheduled runs always use `EMAIL_TO`. Because this repo is public,
typed addresses are masked as `***` in the run logs. A mistyped address fails the email step
with a clear message rather than being skipped silently.

If these secrets are missing, the run still passes and shows a yellow "Email not sent" warning.
Preview an email locally without sending: `node scripts/send-email.js --issues issues.json --dry-run`.
If `npm ci` itself fails, no email can be sent; GitHub's own failure notification covers that case.

To change the schedule, edit the `cron` line: `"0 5 * * 1-5"` = weekdays only,
`"0 5 * * 1,4"` = Monday and Thursday. Times are UTC. GitHub pauses scheduled workflows
in repos with no commits for 60 days.

## Demo runbook

The demo backlog is 33 issues for a fictional "Checkout v2" project, defined in
[`scripts/seed-data.js`](scripts/seed-data.js). Each one covers a risk scenario and says what the
radar should find. All seeded issues carry the `seed-demo` label; nothing else is ever touched.

**Why two steps?** Jira can't backdate, so every seeded issue enters its status on seed day.
Seeding early and then "refreshing" the healthy issues on demo day gives a real contrast: stuck
issues have sat for a week while healthy ones restarted their clock today.

1. **At least 6 business days before the demo** (the longest stuck threshold + 1):
   ```bash
   npm run seed -- --dry-run   # preview; writes nothing
   npm run seed                # create the issues
   ```
   It prints the earliest demo day and a fallback date.
2. **On demo day:**
   ```bash
   npm run seed -- --refresh   # healthy issues re-enter their status; due dates re-anchor to today
   npm run radar
   ```
3. **Optional:** `npm run radar -- --apply --dry-run` to show what would be written back to Jira.
4. **Start over:** `npm run seed -- --reset` lists the `seed-demo` issues and deletes them after you type `yes`.

**Short notice** (seeded the same day as the demo): skip the refresh and run
`npm run radar -- --reference-date <fallback date printed by seed>`. Waiting statuses and In QA
look stuck, In Progress doesn't. The contrast is between columns rather than within one.

The refresh moves healthy issues out and back **via To Do** (`seed.refreshViaStatus`). A route
through In Progress would look like a QA bounce, so config validation rejects bounce statuses there.

## Design decisions

_Phase 7._

## Limitations

_Phase 7._

## Next steps

_Phase 7._

## How this was built with Claude

_Phase 7._
