import type Anthropic from '@anthropic-ai/sdk';

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_visits',
    description: 'List site visits filtered by worker, site, date range, or status. Returns a JSON array of visit summaries. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        workerId: { type: 'string', description: 'Worker UUID' },
        siteId: { type: 'string', description: 'Site UUID' },
        from: { type: 'string', description: 'Start date ISO YYYY-MM-DD' },
        to: { type: 'string', description: 'End date ISO YYYY-MM-DD' },
        status: { type: 'string', enum: ['SCHEDULED','NOTIFIED','CHECKED_IN','IN_PROGRESS','SUBMITTED','VERIFIED','COMPLETED_VERIFIED','COMPLETED_PARTIAL_APPROVED','COMPLETED_FLAGGED_WAIVED','FLAGGED','CANCELLED','UNCOVERED'] },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_worker_history',
    description: "Get a worker's activity (assignments, visits, lifecycle events) for the last N days. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        workerId: { type: 'string' },
        days: { type: 'number', minimum: 1, maximum: 90 },
      },
      required: ['workerId', 'days'],
    },
  },
  {
    name: 'get_site_history',
    description: "Get a site's activity for the last N days. Read-only.",
    input_schema: {
      type: 'object',
      properties: {
        siteId: { type: 'string' },
        days: { type: 'number', minimum: 1, maximum: 90 },
      },
      required: ['siteId', 'days'],
    },
  },
  {
    name: 'summarize_patterns',
    description: 'Summarise trends (by worker, site, or company) over a date range. Returns aggregate numbers + callouts. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['COMPANY', 'SITE', 'WORKER'] },
        from: { type: 'string' },
        to: { type: 'string' },
        targetId: { type: 'string', description: 'Site UUID or Worker UUID when scope != COMPANY' },
      },
      required: ['scope', 'from', 'to'],
    },
  },
  {
    name: 'export_as_excel',
    description: 'Generate an Excel file for a date range and return a one-time download URL. Does not write any business data.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string' },
        end: { type: 'string' },
        mode: { type: 'string', enum: ['day', 'week'] },
        includeAdvanced: { type: 'boolean' },
      },
      required: ['start', 'end', 'mode'],
    },
  },
  {
    name: 'compose_client_message',
    description: "Draft a client-facing message (subject + body) about a site. Returns the draft ONLY — the admin must click Send manually. No emails are sent by this tool.",
    input_schema: {
      type: 'object',
      properties: {
        siteId: { type: 'string' },
        context: { type: 'string', description: "What happened — admin's free text" },
      },
      required: ['siteId', 'context'],
    },
  },
  {
    name: 'explain_visit',
    description: 'Return a plain-English narrative of what happened during one specific visit. Uses event log + photos + GPS. Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        visitId: { type: 'string' },
      },
      required: ['visitId'],
    },
  },
];
