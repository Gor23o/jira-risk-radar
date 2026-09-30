// The JSON shape Claude must return, enforced by structured outputs.
// Booleans + strings only (no nullable/optional fields) keep it simple for the model
// and within what structured outputs support.

import { z } from 'zod';

export const IssueAssessment = z.object({
  key: z.string().describe('The issue key exactly as given, e.g. SCRUM-12'),
  risk_level: z
    .enum(['critical', 'at_risk', 'ok'])
    .describe('Your overall judgment of delivery risk for this issue'),
  reason: z.string().describe('One or two plain-language sentences explaining the risk level'),
  suggested_action: z
    .string()
    .describe('One concrete next step for the project manager, or "None" when the issue is ok'),
  blocked_in_comments: z.object({
    blocked: z.boolean().describe('True if the description or comments say work cannot proceed because of something unresolved'),
    quote: z.string().describe('The short phrase that shows it, copied from the ticket; empty if not blocked'),
  }),
  vague: z.object({
    vague: z.boolean().describe('True if a developer could not tell when this ticket is done: no acceptance criteria or concrete goal'),
    why: z.string().describe('What is missing, in one sentence; empty if not vague'),
  }),
});

export const BatchAssessment = z.object({
  assessments: z.array(IssueAssessment).describe('Exactly one entry per issue in the input'),
});
