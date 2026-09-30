// The demo backlog: a team building "Checkout v2" for an online store.
// Each scenario is one Jira issue, plus what Risk Radar should say about it on demo day.
//
// Timeline (see CLAUDE.md → "Seed design"):
//   seed day   `npm run seed`: create issues and walk them through the workflow
//   ≥6 business days later
//   demo day   `npm run seed -- --refresh`: healthy issues (refresh: true) re-enter their
//              status so their clock restarts; due dates are re-anchored to today
//
// Fields:
//   summary              unique; used to find the issue again on refresh
//   type                 Jira issue type (this project has Task and Story)
//   priority             Jira priority name
//   assignee             'me' (the token's account) | 'teammate' (another assignable user) | null
//   path                 statuses to walk through, in order, from To Do
//   dueInBusinessDays    due date relative to seed day / demo day; null = no due date
//   flagged              set Jira's Flagged (impediment) marker
//   description          plain text; blank lines separate paragraphs
//   acceptanceCriteria   rendered as a bulleted "Acceptance criteria" section
//   comments             added in order after the transitions
//   refresh              true = healthy clock: restart time-in-status on demo day
//   expect               rule flags the radar should raise on demo day
//   expectAi             flags Claude should raise on demo day (phase 4 judgment, not guaranteed)

// Forward path through the workflow.
const FLOW = ['In Progress', 'In Review', 'Ready for QA', 'In QA', 'Done'];

/** Walk forward from To Do up to and including `status`. */
export const forwardTo = (status) => (status === 'To Do' ? [] : FLOW.slice(0, FLOW.indexOf(status) + 1));

/** Reach QA, get sent back to In Progress; `times` round trips, ending In Progress. */
const bounces = (times) =>
  Array.from({ length: times }, () => ['In Progress', 'In Review', 'Ready for QA', 'In QA']).flat().concat('In Progress');

export const scenarios = [
  // ── Healthy: nothing should be flagged ────────────────────────────────────
  {
    summary: 'Add saved addresses to checkout',
    type: 'Story', priority: 'Medium', assignee: 'me', path: forwardTo('To Do'), dueInBusinessDays: 8,
    description: 'Returning customers should be able to pick one of their saved addresses instead of typing it again.',
    acceptanceCriteria: ['Up to 5 saved addresses are listed on the shipping step', 'Choosing one fills every address field', 'A new address can still be typed manually'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Update checkout copy for new shipping tiers',
    type: 'Task', priority: 'Low', assignee: 'teammate', path: forwardTo('To Do'), dueInBusinessDays: null,
    description: 'Marketing renamed the shipping tiers. Update the labels and helper text on the shipping step.',
    acceptanceCriteria: ['"Standard", "Express" and "Next day" labels match the marketing doc', 'Helper text shows the delivery window for each tier'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Apple Pay button on payment step',
    type: 'Story', priority: 'High', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: 7,
    description: 'Offer Apple Pay as a one-tap payment option on supported devices.',
    acceptanceCriteria: ['Button only appears on devices that support Apple Pay', 'Successful payment lands on the order confirmation page', 'Cancelled payment returns to the payment step with the cart intact'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Migrate cart service to new pricing API',
    type: 'Task', priority: 'Medium', assignee: 'teammate', path: forwardTo('In Progress'), dueInBusinessDays: 6,
    description: 'The pricing team is retiring the v1 endpoint at the end of the quarter.',
    acceptanceCriteria: ['Cart totals come from the v2 pricing API', 'Totals match v1 for the 50 sample carts in the test suite'],
    comments: ['Half of the endpoints are switched over; the rest go in tomorrow.'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Checkout analytics events',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: 9,
    description: 'Track each checkout step so product can see where customers drop off.',
    acceptanceCriteria: ['An event fires when each step is viewed and completed', 'Events carry the cart value and step name'],
    comments: ['Deployed to staging, looks good so far.'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Order summary sidebar redesign',
    type: 'Story', priority: 'Medium', assignee: 'me', path: forwardTo('In Review'), dueInBusinessDays: 5,
    description: 'Make the order summary sticky and show savings from promo codes.',
    acceptanceCriteria: ['Sidebar stays visible while scrolling on desktop', 'Promo savings appear as a separate line'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Promo code validation messages',
    type: 'Story', priority: 'Medium', assignee: 'teammate', path: forwardTo('Ready for QA'), dueInBusinessDays: 6,
    description: 'Tell customers why a promo code was rejected instead of a generic error.',
    acceptanceCriteria: ['Expired, not-yet-valid and minimum-spend errors each have their own message', 'Messages are announced to screen readers'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Tax calculation for EU countries',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In QA'), dueInBusinessDays: 4,
    description: 'Charge VAT at the destination country rate for EU orders.',
    acceptanceCriteria: ['VAT rate is taken from the destination country', 'Invoice shows the VAT amount and rate'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Guest checkout',
    type: 'Story', priority: 'Medium', assignee: 'me', path: forwardTo('Done'), dueInBusinessDays: null,
    description: 'Let customers buy without creating an account.',
    acceptanceCriteria: ['Checkout works end to end without logging in', 'Guests are offered an account after the order'],
    refresh: true, expect: [], expectAi: [],
  },
  {
    summary: 'Remove legacy PayPal SDK',
    type: 'Task', priority: 'Low', assignee: 'teammate', path: forwardTo('Done'), dueInBusinessDays: null,
    description: 'The old SDK is replaced by the hosted PayPal button.',
    acceptanceCriteria: ['No imports of the legacy SDK remain', 'Bundle size drops by at least 40 KB'],
    refresh: true, expect: [], expectAi: [],
  },

  // ── Overdue: due date has passed and the work isn't done ──────────────────
  {
    summary: 'Shipping rate calculator',
    type: 'Story', priority: 'High', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: -2,
    description: 'Show live shipping rates from the carrier before payment.',
    acceptanceCriteria: ['Rates load in under 2 seconds', 'A fallback flat rate is shown if the carrier API is down'],
    refresh: true, expect: ['overdue'], expectAi: [],
  },
  {
    summary: 'Refactor payment error handling',
    type: 'Task', priority: 'Medium', assignee: 'teammate', path: forwardTo('In Review'), dueInBusinessDays: -1,
    description: 'Payment errors are handled in four different places. Consolidate them into one module.',
    acceptanceCriteria: ['All payment errors go through one handler', 'Customer-facing messages are unchanged'],
    refresh: false, expect: ['overdue', 'stuck'], expectAi: [],
  },
  {
    summary: 'Accessibility audit of checkout forms',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('To Do'), dueInBusinessDays: -3,
    description: 'Audit every checkout form against WCAG 2.2 AA before the legal deadline.',
    acceptanceCriteria: ['Audit report lists every issue with severity', 'Critical issues have follow-up tickets'],
    refresh: true, expect: ['overdue'], expectAi: [],
  },

  // ── Due soon, not started ─────────────────────────────────────────────────
  {
    summary: 'Delivery date picker',
    type: 'Story', priority: 'Medium', assignee: 'me', path: forwardTo('To Do'), dueInBusinessDays: 1,
    description: 'Let customers choose a delivery date for Express orders.',
    acceptanceCriteria: ['Only dates the carrier supports can be picked', 'Chosen date appears on the confirmation email'],
    refresh: true, expect: ['dueSoonNotStarted'], expectAi: [],
  },
  {
    summary: 'Fraud check before payment capture',
    type: 'Story', priority: 'High', assignee: null, path: forwardTo('To Do'), dueInBusinessDays: 2,
    description: 'Run the fraud score before capturing payment and hold risky orders for review.',
    acceptanceCriteria: ['Orders scoring above 80 are held', 'Held orders appear in the support queue'],
    // Two distinct problems: due soon AND nobody owns it, so it escalates to critical.
    refresh: true, expect: ['dueSoonNotStarted', 'unassignedHighPriority'], expectAi: [],
  },
  {
    summary: 'Localize checkout emails',
    type: 'Task', priority: 'Low', assignee: 'teammate', path: forwardTo('To Do'), dueInBusinessDays: 3,
    description: 'Send order emails in the language the customer shopped in.',
    acceptanceCriteria: ['Emails exist in English, German and French', 'Language follows the storefront locale'],
    // Exactly on the edge of the 3-business-day window.
    refresh: true, expect: ['dueSoonNotStarted'], expectAi: [],
  },

  // ── Stuck: sitting in one status longer than its threshold ────────────────
  {
    summary: 'Split payment between two cards',
    type: 'Story', priority: 'Medium', assignee: 'teammate', path: forwardTo('In Progress'), dueInBusinessDays: 10,
    description: 'Allow paying part of the order with one card and the rest with another.',
    acceptanceCriteria: ['Customer can enter an amount for the first card', 'Remainder is charged to the second card'],
    refresh: false, expect: ['stuck'], expectAi: [],
  },
  {
    summary: 'Rate-limit the coupon endpoint',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In Review'), dueInBusinessDays: 8,
    description: 'Bots are brute-forcing coupon codes. Limit attempts per session.',
    acceptanceCriteria: ['More than 10 attempts per minute returns 429', 'Legitimate customers are not affected in load tests'],
    refresh: false, expect: ['stuck'], expectAi: [],
  },
  {
    summary: 'Gift wrapping option',
    type: 'Story', priority: 'Medium', assignee: 'teammate', path: forwardTo('Ready for QA'), dueInBusinessDays: 9,
    description: 'Offer gift wrapping for a small fee, with an optional message.',
    acceptanceCriteria: ['Gift wrap adds the fee to the order total', 'Gift message is printed on the packing slip'],
    refresh: false, expect: ['stuck'], expectAi: [],
  },
  {
    summary: 'Currency rounding fix',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In QA'), dueInBusinessDays: 7,
    description: 'Totals in JPY show two decimal places. Round per currency rules.',
    acceptanceCriteria: ['Zero-decimal currencies show no decimals', 'Totals still match the payment provider to the cent'],
    refresh: false, expect: ['stuck'], expectAi: [],
  },

  // ── Blocked: by status, by Jira flag, or only in the comments ─────────────
  {
    summary: 'Integrate new address-verification provider',
    type: 'Task', priority: 'Medium', assignee: 'me', path: ['In Progress', 'Blocked'], dueInBusinessDays: 6,
    description: 'Replace the current address lookup with the new provider chosen by procurement.',
    acceptanceCriteria: ['Address suggestions come from the new provider', 'Old provider is switched off'],
    refresh: true, expect: ['blocked'], expectAi: [],
  },
  {
    summary: 'Terms and conditions checkbox',
    type: 'Story', priority: 'High', assignee: 'teammate', path: forwardTo('In Progress'), dueInBusinessDays: 7, flagged: true,
    description: 'Customers must accept the updated terms before paying.',
    acceptanceCriteria: ['Payment button is disabled until the box is ticked', 'Acceptance is stored with the order'],
    comments: ['Flagged: waiting for legal to approve the final terms text.'],
    // The comment repeats the flag; flag groups count this as one problem, not two.
    refresh: true, expect: ['blocked'], expectAi: ['blockedInComments'],
  },
  {
    summary: 'Webhook for payment status updates',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: 8,
    description: 'Listen for the provider’s payment status webhook instead of polling.',
    acceptanceCriteria: ['Order status updates within 5 seconds of the webhook', 'Duplicate webhooks are ignored'],
    comments: ["Can't continue until the payments team gives us sandbox API keys. Asked twice, no reply yet."],
    // Only the comment reveals the blocker: nothing in the fields says so.
    refresh: true, expect: [], expectAi: ['blockedInComments'],
  },
  {
    summary: 'Mobile checkout layout',
    type: 'Story', priority: 'Medium', assignee: 'teammate', path: forwardTo('In Review'), dueInBusinessDays: 6,
    description: 'Single-column checkout on screens narrower than 600px.',
    acceptanceCriteria: ['No horizontal scrolling at 360px width', 'Tap targets are at least 44px'],
    comments: ['Code review done, looks fine.', 'Holding the merge: blocked until design signs off on the final spacing.'],
    refresh: true, expect: [], expectAi: ['blockedInComments'],
  },
  {
    summary: 'Sync orders to warehouse system',
    type: 'Task', priority: 'Medium', assignee: 'me', path: ['In Progress', 'Blocked'], dueInBusinessDays: 8,
    description: 'Push new orders to the warehouse system within a minute of payment.',
    acceptanceCriteria: ['Orders appear in the warehouse system within 60 seconds', 'Failed pushes are retried'],
    comments: ['Blocked by the warehouse vendor outage, no ETA from them.'],
    // Blocked status + blocking comment = one problem → stays at_risk.
    refresh: true, expect: ['blocked'], expectAi: ['blockedInComments'],
  },

  // ── Bouncing: sent back from QA to In Progress repeatedly ─────────────────
  {
    summary: 'Saved cards list',
    type: 'Story', priority: 'High', assignee: 'me', path: bounces(2), dueInBusinessDays: 5,
    description: 'Show saved cards on the payment step with the last four digits and expiry.',
    acceptanceCriteria: ['Expired cards are shown but cannot be selected', 'Cards can be removed from the list'],
    comments: ['QA: expired cards can still be selected.', 'QA: removing a card does not refresh the list.'],
    refresh: true, expect: ['bouncing'], expectAi: [],
  },
  {
    summary: 'Shipping address autocomplete',
    type: 'Task', priority: 'Medium', assignee: 'teammate', path: [...bounces(3), 'In Review', 'Ready for QA', 'In QA'], dueInBusinessDays: 6,
    description: 'Autocomplete street addresses as the customer types.',
    acceptanceCriteria: ['Suggestions appear after 3 characters', 'Selecting a suggestion fills city and postcode'],
    refresh: true, expect: ['bouncing'], expectAi: [],
  },
  {
    summary: 'Order confirmation page',
    type: 'Task', priority: 'Medium', assignee: 'me', path: bounces(1), dueInBusinessDays: 6,
    description: 'Show order number, delivery estimate and next steps after payment.',
    acceptanceCriteria: ['Order number matches the confirmation email', 'Page works when refreshed'],
    // One round trip is normal; the rule needs two.
    refresh: true, expect: [], expectAi: [],
  },

  // ── Vague: no acceptance criteria, unclear goal ───────────────────────────
  {
    summary: 'Improve checkout',
    type: 'Story', priority: 'Medium', assignee: 'teammate', path: forwardTo('To Do'), dueInBusinessDays: 8,
    description: 'Make the checkout better.',
    refresh: true, expect: [], expectAi: ['vague'],
  },
  {
    summary: 'Fix login issues',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: 6,
    description: 'Users are complaining. Fix it.',
    refresh: true, expect: [], expectAi: ['vague'],
  },

  // ── Unassigned high priority ──────────────────────────────────────────────
  {
    summary: 'PCI compliance fixes for card form',
    type: 'Task', priority: 'Highest', assignee: null, path: forwardTo('To Do'), dueInBusinessDays: null,
    description: 'The latest PCI scan found two issues in the card form.',
    acceptanceCriteria: ['Card fields are served from the provider iframe', 'Rescan passes with no findings'],
    refresh: true, expect: ['unassignedHighPriority'], expectAi: [],
  },
  {
    summary: 'Retry failed payments automatically',
    type: 'Story', priority: 'High', assignee: null, path: forwardTo('In Progress'), dueInBusinessDays: 10,
    description: 'Retry soft-declined payments once before showing an error.',
    acceptanceCriteria: ['Soft declines are retried once after 3 seconds', 'Hard declines are never retried'],
    comments: ['Started by the previous owner, who moved to another team.'],
    refresh: true, expect: ['unassignedHighPriority'], expectAi: [],
  },

  // ── Combination: a rule flag plus a Claude flag escalates ─────────────────
  {
    summary: 'Speed up checkout',
    type: 'Task', priority: 'Medium', assignee: 'me', path: forwardTo('In Progress'), dueInBusinessDays: 10,
    description: 'Performance stuff.',
    // stuck (rule) + vague (Claude) = two problems → critical.
    refresh: false, expect: ['stuck'], expectAi: ['vague'],
  },
];
