import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STANDARDS } from '../src/engine/defaults.js';
import {
  evaluateIssue,
  extractAdfContent,
  extractConfluencePageId,
  parseConfluenceStandardsHtml,
  ruleAppliesToProject,
} from '../src/engine/evaluator.js';
import {
  buildConfluencePageAri,
  buildIssueAri,
  fetchIssueTeamworkGraphContext,
} from '../src/graph/teamworkGraph.js';
import { applyPrecedentUsage } from '../src/storage/store.js';

function makeAdfDoc(text, extraNodes = []) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
      ...extraNodes,
    ],
  };
}

test('extractAdfContent extracts text, link mark href, inlineCard URL, and handles null/string', () => {
  assert.deepEqual(extractAdfContent(null), { text: '', urls: [] });
  assert.deepEqual(extractAdfContent('Plain text with https://example.com/spec'), {
    text: 'Plain text with https://example.com/spec',
    urls: ['https://example.com/spec'],
  });

  const adf = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See design doc ' },
          {
            type: 'text',
            text: 'here',
            marks: [{ type: 'link', attrs: { href: 'https://confluence.example.com/pages/101' } }],
          },
        ],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'inlineCard',
            attrs: { url: 'https://github.com/org/repo/pull/42' },
          },
        ],
      },
    ],
  };

  const extracted = extractAdfContent(adf);
  assert.match(extracted.text, /See design doc/);
  assert.ok(extracted.urls.includes('https://confluence.example.com/pages/101'));
  assert.ok(extracted.urls.includes('https://github.com/org/repo/pull/42'));
});

test('incomplete Bug issue is BLOCKED with expected missing standards', () => {
  const issue = {
    key: 'SG-1',
    fields: {
      summary: 'Checkout button unresponsive',
      description: makeAdfDoc('Short note.'),
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: null,
      labels: [],
      issuelinks: [],
    },
  };

  const evaluation = evaluateIssue({
    issue,
    remoteLinks: [],
    standards: DEFAULT_STANDARDS,
    exceptions: [],
  });

  assert.equal(evaluation.verdict, 'BLOCKED');
  const failedCodes = evaluation.results
    .filter((r) => r.status === 'FAILED')
    .map((r) => r.code)
    .sort();
  assert.deepEqual(failedCodes, ['STD-1', 'STD-2', 'STD-4', 'STD-6']);
});

test('fully compliant Bug evaluates to READY with zero failures', () => {
  const issue = {
    key: 'SG-10',
    fields: {
      summary: 'Checkout fails on expired coupon',
      description: makeAdfDoc(
        'Steps to reproduce: 1. Open cart 2. Apply expired coupon. Expected: clear error. Actual: 500 error. Spec: https://rizalkurnia-me.atlassian.net/wiki/spaces/RK/pages/12345'
      ),
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: { accountId: 'acc-1', displayName: 'Rizal Kurnia' },
      labels: ['checkout'],
      issuelinks: [],
    },
  };

  const evaluation = evaluateIssue({
    issue,
    remoteLinks: [],
    standards: DEFAULT_STANDARDS,
    exceptions: [],
  });

  assert.equal(evaluation.verdict, 'READY');
  assert.equal(evaluation.summary.failed, 0);
  assert.equal(evaluation.summary.warnings, 0);
});

test('direct issue exception exempts target issue only', () => {
  const makeBug = (key) => ({
    key,
    fields: {
      summary: 'Hotfix release',
      description: makeAdfDoc(
        'Steps to reproduce: deploy hotfix immediately to mitigate outage. Expected: service restored. Actual: timeout.'
      ),
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress' },
      priority: { name: 'Highest' },
      assignee: { accountId: 'acc-1', displayName: 'Rizal Kurnia' },
      labels: ['hotfix'],
      issuelinks: [],
    },
  });

  const exceptions = [
    {
      id: 'exc-1',
      ruleId: 'STD-6',
      issueKey: 'SG-1',
      scope: 'issue',
      active: true,
      reason: 'Emergency outage mitigation',
      approverDisplayName: 'Rizal Kurnia',
    },
  ];

  const evalSg1 = evaluateIssue({
    issue: makeBug('SG-1'),
    standards: DEFAULT_STANDARDS,
    exceptions,
  });
  const evalSg2 = evaluateIssue({
    issue: makeBug('SG-2'),
    standards: DEFAULT_STANDARDS,
    exceptions,
  });

  assert.equal(evalSg1.verdict, 'EXEMPTED');
  assert.equal(evalSg1.summary.exemptedDirect, 1);
  assert.equal(evalSg2.verdict, 'BLOCKED');
  assert.equal(evalSg2.summary.failed, 1);
});

test('reusable precedent exempts matching issues and ignores non-matching or revoked ones', () => {
  const makeBug = (key, labels) => ({
    key,
    fields: {
      summary: 'Hotfix release',
      description: makeAdfDoc(
        'Steps to reproduce: deploy hotfix immediately to restore checkout API. Expected: 200 OK. Actual: 503.'
      ),
      issuetype: { name: 'Bug' },
      status: { name: 'In Progress' },
      priority: { name: 'Highest' },
      assignee: { accountId: 'acc-1', displayName: 'Rizal Kurnia' },
      labels,
      issuelinks: [],
    },
  });

  const activePrecedent = {
    id: 'prec-1',
    ruleId: 'STD-6',
    issueKey: 'SG-1',
    scope: 'precedent',
    pattern: { issueType: 'Bug', requiredLabel: 'hotfix' },
    active: true,
    reason: 'Production hotfixes ship before postmortem links are created.',
    approverDisplayName: 'Rizal Kurnia',
  };

  const evalMatching = evaluateIssue({
    issue: makeBug('SG-2', ['hotfix', 'api']),
    standards: DEFAULT_STANDARDS,
    exceptions: [activePrecedent],
  });
  assert.equal(evalMatching.verdict, 'EXEMPTED_PRECEDENT');
  assert.deepEqual(evalMatching.matchedPrecedentIds, ['prec-1']);
  const std6 = evalMatching.results.find((r) => r.ruleId === 'STD-6');
  assert.equal(std6.status, 'EXEMPTED_PRECEDENT');
  assert.equal(std6.exception.issueKey, 'SG-1');

  const evalNonMatching = evaluateIssue({
    issue: makeBug('SG-3', ['backend']),
    standards: DEFAULT_STANDARDS,
    exceptions: [activePrecedent],
  });
  assert.equal(evalNonMatching.verdict, 'BLOCKED');

  const evalRevoked = evaluateIssue({
    issue: makeBug('SG-2', ['hotfix']),
    standards: DEFAULT_STANDARDS,
    exceptions: [{ ...activePrecedent, active: false }],
  });
  assert.equal(evalRevoked.verdict, 'BLOCKED');
});

test('warning-only rule failure keeps overall verdict READY', () => {
  const issue = {
    key: 'SG-20',
    fields: {
      summary: 'Improve error message copy',
      description: makeAdfDoc(
        'Acceptance criteria: display clear validation copy when coupon code expires. Spec: https://example.com/spec'
      ),
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      priority: null,
      assignee: { accountId: 'acc-1', displayName: 'Rizal Kurnia' },
      labels: [],
      issuelinks: [],
    },
  };

  const evaluation = evaluateIssue({
    issue,
    standards: DEFAULT_STANDARDS,
    exceptions: [],
  });

  assert.equal(evaluation.verdict, 'READY');
  assert.equal(evaluation.summary.warnings, 1);
  assert.equal(evaluation.summary.failed, 0);
});

test('Confluence page ID extraction and standards HTML parsing work for structured and natural formats', () => {
  assert.equal(extractConfluencePageId('983041'), '983041');
  assert.equal(
    extractConfluencePageId('https://rizalkurnia-me.atlassian.net/wiki/spaces/RK/pages/983041/Engineering+Standards'),
    '983041'
  );
  assert.equal(extractConfluencePageId('https://example.com/viewpage.action?pageId=55123'), '55123');
  assert.equal(extractConfluencePageId('not-a-page'), null);

  const html = `
    <ul>
      <li>RULE: Security Review Required | TYPE: Story, Task | CHECK: description_contains_any | VALUE: security review, threat model | SEVERITY: blocking</li>
      <li>[STD-C1] Rollback Plan: Include rollback steps in the issue description.</li>
    </ul>
  `;

  const parsed = parseConfluenceStandardsHtml(
    html,
    'Engineering Standards',
    'https://rizalkurnia-me.atlassian.net/wiki/spaces/RK/pages/983041'
  );

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].source, 'confluence');
  assert.equal(parsed[0].title, 'Security Review Required');
  assert.deepEqual(parsed[0].issueTypes, ['Story', 'Task']);
  assert.deepEqual(parsed[0].config.keywords, ['security review', 'threat model']);
  assert.equal(parsed[1].code, 'STD-C1');
  assert.equal(parsed[1].title, 'Rollback Plan');
  assert.equal(parsed[1].citation, 'Engineering Standards (Confluence)');
});

test('projectKeys scoping filters rules by project and supports Confluence PROJECT directive', () => {
  assert.equal(ruleAppliesToProject({ id: 'LEGACY' }, 'KAN'), true);
  assert.equal(ruleAppliesToProject({ projectKeys: ['*'] }, 'KAN'), true);
  assert.equal(ruleAppliesToProject({ projectKeys: ['KAN', 'PAY'] }, 'pay'), true);
  assert.equal(ruleAppliesToProject({ projectKeys: ['KAN'] }, 'OPS'), false);

  const html = `
    <ul>
      <li>RULE: Payments Audit | TYPE: Story | PROJECT: PAY, FIN | CHECK: label_present | VALUE: audited | SEVERITY: blocking</li>
    </ul>
  `;
  const [rule] = parseConfluenceStandardsHtml(html, 'Payments Standards');
  assert.deepEqual(rule.projectKeys, ['PAY', 'FIN']);

  const opsIssue = {
    key: 'OPS-7',
    fields: {
      project: { key: 'OPS' },
      summary: 'Rotate DNS keys',
      description: makeAdfDoc('Rotate edge DNS keys cleanly.'),
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      labels: [],
      issuelinks: [],
    },
  };
  const opsEval = evaluateIssue({ issue: opsIssue, standards: [rule], exceptions: [] });
  assert.equal(opsEval.summary.total, 0);
  assert.equal(opsEval.verdict, 'READY');

  const payIssue = {
    ...opsIssue,
    key: 'PAY-12',
    fields: { ...opsIssue.fields, project: { key: 'PAY' } },
  };
  const payEval = evaluateIssue({ issue: payIssue, standards: [rule], exceptions: [] });
  assert.equal(payEval.summary.total, 1);
  assert.equal(payEval.verdict, 'BLOCKED');
});

test('fetchIssueTeamworkGraphContext handles ARI validation, objects/hierarchy/linked-pages parsing, partial fallback, and HTTP errors', async () => {
  assert.equal(buildIssueAri('cloud-1', '10001'), 'ari:cloud:jira:cloud-1:issue/10001');
  assert.equal(buildConfluencePageAri('cloud-1', '983041'), 'ari:cloud:confluence:cloud-1:page/983041');

  const missingCloud = await fetchIssueTeamworkGraphContext({ cloudId: '', issueId: '10001' });
  assert.equal(missingCloud.status, 'unavailable');
  assert.deepEqual(missingCloud.linkedPages, []);

  const issueAri = 'ari:cloud:jira:cloud-1:issue/10002';
  const pageAri = 'ari:cloud:confluence:cloud-1:page/983041';
  const linkedIssueAri = 'ari:cloud:jira:cloud-1:issue/10001';

  // Partial fallback: StandardsGuard_GetIssueHierarchy errors, objects(ids) hydrates issue/page/linked issue.
  const partialCtx = await fetchIssueTeamworkGraphContext({
    cloudId: 'cloud-1',
    issueId: '10002',
    issueKey: 'KAN-3',
    descriptionUrls: ['https://rizalkurnia-me.atlassian.net/wiki/spaces/SD/pages/983041/Engineering+Standards'],
    issueLinks: [
      {
        type: { outward: 'blocks' },
        outwardIssue: {
          id: '10001',
          key: 'KAN-2',
          fields: { summary: 'Fallback summary', status: { name: 'To Do' } },
        },
      },
    ],
    requester: async (_q, variables, op) => ({
      ok: true,
      json: async () => {
        if (op === 'StandardsGuard_GetObjects') {
          assert.deepEqual(variables.ids, [issueAri, pageAri, linkedIssueAri]);
          return {
            data: {
              objects: [
                {
                  id: issueAri,
                  data: {
                    __typename: 'JiraWorkItem',
                    id: issueAri,
                    key: 'KAN-3',
                    summary: 'Webhook retries',
                    status: { name: 'In Progress' },
                  },
                },
                {
                  id: pageAri,
                  data: {
                    __typename: 'ConfluencePage',
                    id: pageAri,
                    pageId: '983041',
                    title: 'Engineering Standards',
                    webUrl: 'https://rizalkurnia-me.atlassian.net/wiki/spaces/SD/pages/983041',
                  },
                },
                {
                  id: linkedIssueAri,
                  data: {
                    __typename: 'JiraWorkItem',
                    id: linkedIssueAri,
                    key: 'KAN-2',
                    summary: 'Checkout timeout',
                    status: { name: 'Blocked' },
                  },
                },
              ],
            },
          };
        }
        if (op === 'StandardsGuard_GetIssueHierarchy') {
          return { errors: [{ message: 'Hierarchy unavailable' }] };
        }
        if (op === 'StandardsGuard_GetLinkedConfluencePages') {
          return { data: { confluencePageLinkedConfluencePages: { edges: [] } } };
        }
        return { data: {} };
      },
    }),
  });

  assert.equal(partialCtx.status, 'ok');
  assert.equal(partialCtx.issueNode?.key, 'KAN-3');
  assert.equal(partialCtx.linkedPages.length, 1);
  assert.equal(partialCtx.linkedPages[0].title, 'Engineering Standards');
  assert.equal(partialCtx.relatedIssues.length, 1);
  assert.equal(partialCtx.relatedIssues[0].key, 'KAN-2');
  assert.equal(partialCtx.relatedIssues[0].hydratedByGraph, true);

  // Hierarchy + secondary Confluence linked pages discovery and deduplication.
  const graphRichCtx = await fetchIssueTeamworkGraphContext({
    cloudId: 'cloud-1',
    issueId: '10002',
    issueKey: 'KAN-3',
    descriptionUrls: ['https://rizalkurnia-me.atlassian.net/wiki/spaces/SD/pages/983041/Engineering+Standards'],
    requester: async (_q, variables, op) => ({
      ok: true,
      json: async () => {
        if (op === 'StandardsGuard_GetObjects') {
          return {
            data: {
              objects: [
                {
                  id: issueAri,
                  data: {
                    __typename: 'JiraWorkItem',
                    id: issueAri,
                    key: 'KAN-3',
                    summary: 'Webhook retries',
                    status: { name: 'In Progress' },
                  },
                },
                {
                  id: pageAri,
                  data: {
                    __typename: 'ConfluencePage',
                    id: pageAri,
                    pageId: '983041',
                    title: 'Engineering Standards',
                    webUrl: 'https://rizalkurnia-me.atlassian.net/wiki/spaces/SD/pages/983041',
                  },
                },
              ],
            },
          };
        }
        if (op === 'StandardsGuard_GetIssueHierarchy') {
          return {
            data: {
              jiraWorkItemHierarchy: {
                edges: [
                  {
                    node: {
                      __typename: 'JiraWorkItem',
                      id: issueAri,
                      key: 'KAN-3',
                      summary: 'Webhook retries',
                    },
                  },
                  {
                    node: {
                      __typename: 'JiraWorkItem',
                      id: 'ari:cloud:jira:cloud-1:issue/10009',
                      key: 'KAN-9',
                      summary: 'Epic parent reliability work',
                      status: { name: 'In Progress' },
                    },
                  },
                ],
              },
            },
          };
        }
        if (op === 'StandardsGuard_GetLinkedConfluencePages') {
          assert.equal(variables.id, pageAri);
          return {
            data: {
              confluencePageLinkedConfluencePages: {
                edges: [
                  {
                    node: {
                      __typename: 'ConfluencePage',
                      id: pageAri,
                      pageId: '983041',
                      title: 'Engineering Standards',
                    },
                  },
                  {
                    node: {
                      __typename: 'ConfluencePage',
                      id: 'ari:cloud:confluence:cloud-1:page/983042',
                      pageId: '983042',
                      title: 'Runbook Checklist',
                      webUrl: 'https://rizalkurnia-me.atlassian.net/wiki/spaces/SD/pages/983042',
                    },
                  },
                ],
              },
            },
          };
        }
        return { data: {} };
      },
    }),
  });

  assert.equal(graphRichCtx.status, 'ok');
  assert.deepEqual(
    graphRichCtx.linkedPages.map((p) => p.pageId),
    ['983041', '983042']
  );
  assert.deepEqual(
    graphRichCtx.relatedIssues.map((i) => i.key),
    ['KAN-9']
  );

  // HTTP error returns degraded error status without throwing.
  const httpErrCtx = await fetchIssueTeamworkGraphContext({
    cloudId: 'cloud-1',
    issueId: '10002',
    requester: async () => ({ ok: false, status: 503 }),
  });
  assert.equal(httpErrCtx.status, 'error');
  assert.match(httpErrCtx.errorDetail, /503/);
});

test('has_link_or_url passes when Teamwork Graph provides connected Confluence pages', () => {
  const std6 = DEFAULT_STANDARDS.find((r) => r.id === 'STD-6');
  const issue = {
    key: 'KAN-99',
    fields: {
      project: { key: 'KAN' },
      summary: 'Harden webhook queue',
      description: makeAdfDoc('No inline URLs in the Jira description body yet.'),
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      labels: [],
      issuelinks: [],
    },
  };

  const withoutGraph = evaluateIssue({
    issue,
    remoteLinks: [],
    teamworkGraph: { status: 'ok', linkedPages: [], relatedIssues: [] },
    standards: [std6],
    exceptions: [],
  });
  assert.equal(withoutGraph.verdict, 'BLOCKED');

  const withGraph = evaluateIssue({
    issue,
    remoteLinks: [],
    teamworkGraph: {
      status: 'ok',
      linkedPages: [{ id: 'ari:cloud:confluence:c1:page/123', title: 'Architecture Spec', url: '' }],
      relatedIssues: [],
    },
    standards: [std6],
    exceptions: [],
  });
  assert.equal(withGraph.verdict, 'READY');
  assert.match(withGraph.results[0].detail, /Teamwork Graph connection/);
});

test('applyPrecedentUsage logs PRECEDENT_APPLIED once per issue and deduplicates re-checks', () => {
  const initialExceptions = [
    {
      id: 'prec-1',
      ruleId: 'STD-2',
      ruleCode: 'STD-2',
      issueKey: 'KAN-4',
      scope: 'precedent',
      approverDisplayName: 'Rizal Kurnia',
      reason: 'Typo bug fix does not require full repro script',
      active: true,
      appliedToIssues: ['KAN-4'],
    },
  ];

  const firstRun = applyPrecedentUsage({
    exceptions: initialExceptions,
    auditLog: [],
    precedentIds: ['prec-1'],
    issueKey: 'KAN-5',
    nowIso: '2026-11-27T10:00:00.000Z',
  });

  assert.equal(firstRun.modified, true);
  assert.deepEqual(firstRun.newlyAppliedIds, ['prec-1']);
  assert.deepEqual(firstRun.exceptions[0].appliedToIssues, ['KAN-4', 'KAN-5']);
  assert.equal(firstRun.auditLog.length, 1);
  assert.equal(firstRun.auditLog[0].type, 'PRECEDENT_APPLIED');
  assert.equal(firstRun.auditLog[0].issueKey, 'KAN-5');
  assert.equal(firstRun.auditLog[0].ruleCode, 'STD-2');
  assert.match(firstRun.auditLog[0].detail, /KAN-4/);

  const secondRun = applyPrecedentUsage({
    exceptions: firstRun.exceptions,
    auditLog: firstRun.auditLog,
    precedentIds: ['prec-1'],
    issueKey: 'KAN-5',
    nowIso: '2026-11-27T10:05:00.000Z',
  });

  assert.equal(secondRun.modified, false);
  assert.deepEqual(secondRun.newlyAppliedIds, []);
  assert.equal(secondRun.auditLog.length, 1);
});
