// Emails the result of a Risk Radar run via Gmail. Used by the GitHub Actions
// workflow after every run, successful or not.
//
// Usage:
//   node scripts/send-email.js --status success --issues out/issues.json --run-url <url>
//   node scripts/send-email.js --status failure --failed-step "Run Risk Radar" --run-url <url>
//   add --dry-run to print the email instead of sending it
//
// Needs GMAIL_USER, GMAIL_APP_PASSWORD and EMAIL_TO (comma-separated) in the environment.
// EMAIL_TO_OVERRIDE, set from the "Send email to" field of a manual run, replaces EMAIL_TO.

import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import nodemailer from 'nodemailer';
import { loadConfig } from '../src/config.js';
import { buildEmail, parseRecipients } from '../src/notify/email.js';

const { values: args } = parseArgs({
  options: {
    status: { type: 'string', default: 'success' },
    issues: { type: 'string' },
    'run-url': { type: 'string', default: '' },
    'failed-step': { type: 'string' },
    jql: { type: 'string' },
    'reference-date': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

dotenv.config({ quiet: true });
// Same JQL and date the run used, so the email describes what was actually searched.
const config = await loadConfig('config.json', {
  overrides: { jql: args.jql || undefined, referenceDate: args['reference-date'] || undefined, noAi: true },
});

/** Results only count on a successful run; a failed run can leave a half-written file behind. */
function readIssues(path) {
  if (args.status !== 'success' || !path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const issues = readIssues(args.issues);
const email = buildEmail({
  status: args.status,
  issues,
  date: config.referenceDate,
  jql: config.jql,
  runUrl: args['run-url'],
  failedStep: args['failed-step'],
});

if (args['dry-run']) {
  console.log(`Subject: ${email.subject}\n\n${email.text}`);
  process.exit(0);
}

const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const override = process.env.EMAIL_TO_OVERRIDE?.trim();
const EMAIL_TO = override || process.env.EMAIL_TO;
const missing = Object.entries({ GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_TO })
  .filter(([, value]) => !value?.trim())
  .map(([name]) => name);
if (missing.length) {
  // Email is optional: a missing setup shouldn't turn a good radar run red.
  // "::warning::" shows up as a yellow annotation on the GitHub run page.
  console.log(`::warning::Email not sent: missing ${missing.join(', ')}. See README → Email results.`);
  process.exit(0);
}

const { valid: recipients, invalid } = parseRecipients(EMAIL_TO);
if (invalid.length || recipients.length === 0) {
  // Someone typed these on purpose, so a typo should be loud, not silently skipped.
  const source = override ? 'the "Send email to" field' : 'EMAIL_TO';
  console.error(`Email not sent: ${source} has ${invalid.length} invalid address(es) and ${recipients.length} valid one(s). Use comma-separated addresses like a@x.com, b@y.com.`);
  process.exit(1);
}
const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER.trim(), pass: GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
});

try {
  await transport.sendMail({ from: `Risk Radar <${GMAIL_USER.trim()}>`, to: recipients, ...email });
  console.log(`Email sent to ${recipients.length} recipient(s): ${email.subject}`);
} catch (err) {
  const hint =
    err.code === 'EAUTH'
      ? ' Gmail rejected the login: GMAIL_APP_PASSWORD must be a 16-character app password, not your Google password.'
      : '';
  console.error(`Email failed: ${err.message}.${hint}`);
  process.exit(1);
}
