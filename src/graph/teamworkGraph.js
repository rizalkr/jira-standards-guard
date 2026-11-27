import api from '@forge/api';
import { extractConfluencePageId } from '../engine/evaluator.js';

const ISSUE_CONTEXT_QUERY = `
  query StandardsGuard_GetIssueContext($id: ID!) {
    jiraWorkItem(id: $id) {
      id
      key
      summary
      status {
        name
      }
      issueType {
        name
      }
      assignee {
        name
      }
    }
  }
`;

const LINKED_PAGES_QUERY = `
  query StandardsGuard_GetLinkedPages($id: ID!, $first: Int) {
    jiraWorkItemLinkedConfluencePages(id: $id, first: $first) {
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

const CONFLUENCE_PAGE_QUERY = `
  query StandardsGuard_GetConfluencePage($id: ID!) {
    confluencePage(id: $id) {
      id
      title
    }
  }
`;

const MAX_HYDRATED_ITEMS = 5;
const MAX_GRAPH_ROWS = 20;

/**
 * Builds an Atlassian Resource Identifier (ARI) for a Jira issue.
 */
export function buildIssueAri(cloudId, issueId) {
  const cleanCloudId = String(cloudId || '').trim();
  const cleanIssueId = String(issueId || '').trim();
  if (!cleanCloudId || !cleanIssueId) {
    return '';
  }
  return `ari:cloud:jira:${cleanCloudId}:issue/${cleanIssueId}`;
}

/**
 * Builds an Atlassian Resource Identifier (ARI) for a Confluence page.
 */
export function buildConfluencePageAri(cloudId, pageId) {
  const cleanCloudId = String(cloudId || '').trim();
  const cleanPageId = String(pageId || '').trim();
  if (!cleanCloudId || !cleanPageId) {
    return '';
  }
  return `ari:cloud:confluence:${cleanCloudId}:page/${cleanPageId}`;
}

function extractPageIdFromAri(ari) {
  const match = String(ari || '').match(/\/page\/(\d+)$/);
  return match ? match[1] : '';
}

async function executeTwgQuery(requester, query, variables, operationName) {
  try {
    const response = await requester(query, variables, operationName);
    if (!response) {
      return { ok: false, data: null, error: 'Empty Teamwork Graph response.' };
    }
    if (!response.ok) {
      return {
        ok: false,
        data: null,
        error: `Teamwork Graph HTTP ${response.status || 'error'}.`,
      };
    }

    const body = await response.json();
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const firstError = errors[0]?.message || '';
    return {
      ok: errors.length === 0 && Boolean(body?.data),
      data: body?.data || null,
      error: firstError,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err?.message || 'Teamwork Graph request failed.',
    };
  }
}

function collectConfluenceCandidates(remoteLinks, descriptionUrls) {
  const byPageId = new Map();

  for (const link of Array.isArray(remoteLinks) ? remoteLinks : []) {
    const url = String(link?.object?.url || '').trim();
    const pageId = extractConfluencePageId(url);
    if (!pageId) continue;
    if (!byPageId.has(pageId)) {
      byPageId.set(pageId, {
        pageId,
        url,
        title: String(link?.object?.title || '').trim(),
      });
    }
  }

  for (const rawUrl of Array.isArray(descriptionUrls) ? descriptionUrls : []) {
    const url = String(rawUrl || '').trim();
    const pageId = extractConfluencePageId(url);
    if (!pageId) continue;
    if (!byPageId.has(pageId)) {
      byPageId.set(pageId, {
        pageId,
        url,
        title: '',
      });
    }
  }

  return [...byPageId.values()].slice(0, MAX_HYDRATED_ITEMS);
}

function collectLinkedIssues(issueLinks) {
  const byKey = new Map();

  for (const link of Array.isArray(issueLinks) ? issueLinks : []) {
    const target = link?.outwardIssue || link?.inwardIssue;
    const relationship = link?.outwardIssue
      ? link?.type?.outward || link?.type?.name || 'relates to'
      : link?.type?.inward || link?.type?.name || 'related from';
    const key = String(target?.key || '').trim();
    const id = String(target?.id || '').trim();
    const dedupeKey = key || id;
    if (!dedupeKey || byKey.has(dedupeKey)) continue;

    byKey.set(dedupeKey, {
      id,
      key,
      summary: String(target?.fields?.summary || '').trim(),
      status: String(target?.fields?.status?.name || '').trim(),
      relationship,
    });
  }

  return [...byKey.values()].slice(0, MAX_HYDRATED_ITEMS);
}

/**
 * Fetches Teamwork Graph context (issue node, connected Confluence pages, related Jira issues)
 * for a Jira issue via curated GraphQL queries with graceful fallback.
 */
export async function fetchIssueTeamworkGraphContext({
  cloudId,
  issueId,
  issueKey = '',
  remoteLinks = [],
  descriptionUrls = [],
  issueLinks = [],
  requester,
}) {
  const invokeGraph =
    typeof requester === 'function'
      ? requester
      : (query, variables, operationName) =>
          api.asUser().requestTeamworkGraph(query, variables, operationName);

  const issueAri = buildIssueAri(cloudId, issueId);
  if (!issueAri) {
    return {
      status: 'unavailable',
      source: 'teamwork-graph',
      issueAri: '',
      issueNode: null,
      linkedPages: [],
      relatedIssues: [],
      errorDetail: 'Missing Jira cloudId or issueId for Teamwork Graph ARI.',
    };
  }

  const [issueRes, pagesRes] = await Promise.all([
    executeTwgQuery(
      invokeGraph,
      ISSUE_CONTEXT_QUERY,
      { id: issueAri },
      'StandardsGuard_GetIssueContext'
    ),
    executeTwgQuery(
      invokeGraph,
      LINKED_PAGES_QUERY,
      { id: issueAri, first: MAX_GRAPH_ROWS },
      'StandardsGuard_GetLinkedPages'
    ),
  ]);

  const issueNode = issueRes.data?.jiraWorkItem || null;
  const pageCandidates = collectConfluenceCandidates(remoteLinks, descriptionUrls);
  const candidateByPageId = new Map(pageCandidates.map((c) => [c.pageId, c]));

  const pageMap = new Map();
  const seenPageIds = new Set();

  const rawEdges = pagesRes.data?.jiraWorkItemLinkedConfluencePages?.edges;
  for (const edge of Array.isArray(rawEdges) ? rawEdges : []) {
    const node = edge?.node;
    if (!node?.id && !node?.title) continue;
    const pageId = extractPageIdFromAri(node.id);
    if (pageId) seenPageIds.add(pageId);
    const matchingCandidate = pageId ? candidateByPageId.get(pageId) : null;
    const dedupeKey = node.id || matchingCandidate?.url || node.title;
    if (!dedupeKey || pageMap.has(dedupeKey)) continue;

    pageMap.set(dedupeKey, {
      id: node.id || '',
      pageId,
      title: node.title || matchingCandidate?.title || 'Confluence Page',
      url: matchingCandidate?.url || '',
      source: 'teamwork-graph',
    });
  }

  const missingCandidates = pageCandidates.filter((c) => !seenPageIds.has(c.pageId));
  let hydratedPageOk = false;
  if (missingCandidates.length > 0) {
    const pageResults = await Promise.allSettled(
      missingCandidates.map(async (candidate) => {
        const pageAri = buildConfluencePageAri(cloudId, candidate.pageId);
        if (!pageAri) return null;
        const res = await executeTwgQuery(
          invokeGraph,
          CONFLUENCE_PAGE_QUERY,
          { id: pageAri },
          'StandardsGuard_GetConfluencePage'
        );
        return { candidate, pageAri, res };
      })
    );

    for (const settled of pageResults) {
      if (settled.status !== 'fulfilled' || !settled.value) continue;
      const { candidate, pageAri, res } = settled.value;
      if (res.ok) hydratedPageOk = true;
      const node = res.data?.confluencePage;
      if (!node) continue;

      const id = node.id || pageAri;
      const dedupeKey = id || candidate.url;
      if (!pageMap.has(dedupeKey)) {
        pageMap.set(dedupeKey, {
          id,
          pageId: candidate.pageId,
          title: node.title || candidate.title || `Confluence Page ${candidate.pageId}`,
          url: candidate.url || '',
          source: 'teamwork-graph',
        });
      }
    }
  }

  const linkedIssueCandidates = collectLinkedIssues(issueLinks);
  const relatedIssueMap = new Map();
  let hydratedIssueOk = false;

  if (linkedIssueCandidates.length > 0) {
    const issueResults = await Promise.allSettled(
      linkedIssueCandidates.map(async (candidate) => {
        const targetAri = buildIssueAri(cloudId, candidate.id);
        if (!targetAri) {
          return { candidate, targetAri: '', res: null };
        }
        const res = await executeTwgQuery(
          invokeGraph,
          ISSUE_CONTEXT_QUERY,
          { id: targetAri },
          'StandardsGuard_GetIssueContext'
        );
        return { candidate, targetAri, res };
      })
    );

    for (const settled of issueResults) {
      if (settled.status !== 'fulfilled' || !settled.value) continue;
      const { candidate, targetAri, res } = settled.value;
      if (res?.ok) hydratedIssueOk = true;
      const node = res?.data?.jiraWorkItem || null;
      const key = node?.key || candidate.key;
      const dedupeKey = key || node?.id || targetAri || candidate.id;
      if (!dedupeKey || relatedIssueMap.has(dedupeKey)) continue;

      relatedIssueMap.set(dedupeKey, {
        id: node?.id || targetAri || candidate.id,
        key,
        summary: node?.summary || candidate.summary,
        status: node?.status?.name || candidate.status,
        relationship: candidate.relationship,
        hydratedByGraph: Boolean(node),
      });
    }
  }

  const anyQueryOk = Boolean(issueNode) || issueRes.ok || pagesRes.ok || hydratedPageOk || hydratedIssueOk;
  const errorMessages = [issueRes.error, pagesRes.error].filter(Boolean);
  const errorDetail = [...new Set(errorMessages)].join(' | ');

  if (!anyQueryOk && errorDetail) {
    console.warn(`Teamwork Graph lookup failed for ${issueKey || issueAri}: ${errorDetail}`);
  }

  return {
    status: anyQueryOk ? 'ok' : 'error',
    source: 'teamwork-graph',
    issueAri,
    issueNode,
    linkedPages: [...pageMap.values()],
    relatedIssues: [...relatedIssueMap.values()],
    errorDetail: anyQueryOk ? '' : errorDetail || 'Teamwork Graph context unavailable.',
  };
}
