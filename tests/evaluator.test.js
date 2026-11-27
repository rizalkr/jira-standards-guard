import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STANDARDS } from '../src/engine/defaults.js';
import {
  evaluateIssue,
  extractAdfContent,
  extractConfluencePageId,
  parseConfluenceStandardsHtml,
} from '../src/engine/evaluator.js';

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
