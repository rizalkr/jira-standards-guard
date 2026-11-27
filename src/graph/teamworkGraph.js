import api from '@forge/api';
import { extractConfluencePageId } from '../engine/evaluator.js';

const OBJECTS_HYDRATION_QUERY = `
  query StandardsGuard_GetObjects($ids: [ID!]!) {
    objects(ids: $ids) {
      id
      data {
        __typename
        ... on JiraWorkItem {
          id
          key
          summary
          webUrl
          status {
            name
          }
          issueType {
            name
          }
        }
        ... on ConfluencePage {
          id
          pageId
          title
          webUrl
        }
      }
    }
  }
`;

const ISSUE_HIERARCHY_QUERY = `
  query StandardsGuard_GetIssueHierarchy($id: ID!, $first: Int) {
    jiraWorkItemHierarchy(
      id: $id
      kinds: [PARENT, CHILD, BLOCKS, BLOCKED_BY, LINKED]
      first: $first
    ) {
      edges {
        node {
          __typename
          ... on JiraWorkItem {
            id
            key
            summary
            webUrl
            status {
              name
            }
          }
        }
      }
    }
  }
`;

const CONFLUENCE_LINKED_PAGES_QUERY = `
  query StandardsGuard_GetLinkedConfluencePages($id: ID!, $first: Int) {
    confluencePageLinkedConfluencePages(id: $id, first: $first) {
      edges {
        node {
          __typename
          ... on ConfluencePage {
            id
            pageId
            title
            webUrl
          }
        }
      }
    }
  }
`;

const MAX_HYDRATED_ITEMS = 5;
const MAX_GRAPH_ROWS = 20;
const MAX_OBJECTS_BATCH = 25;
const MAX_LINKED_PAGE_SEEDS = 2;

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

function isJiraWorkItemData(data) {
  return data?.__typename === 'JiraWorkItem' || Boolean(data?.key || data?.issueType);
}

function isConfluencePageData(data) {
  return data?.__typename === 'ConfluencePage' || Boolean(data?.title || data?.pageId);
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

  const pageCandidates = collectConfluenceCandidates(remoteLinks, descriptionUrls).map(
    (candidate) => ({
      ...candidate,
      pageAri: buildConfluencePageAri(cloudId, candidate.pageId),
    })
  );
  const candidateByPageId = new Map(pageCandidates.map((c) => [c.pageId, c]));

  const linkedIssueCandidates = collectLinkedIssues(issueLinks).map((candidate) => ({
    ...candidate,
    targetAri: buildIssueAri(cloudId, candidate.id),
  }));
  const candidateByIssueAri = new Map(
    linkedIssueCandidates.filter((c) => c.targetAri).map((c) => [c.targetAri, c])
  );
  const candidateByIssueKey = new Map(
    linkedIssueCandidates.filter((c) => c.key).map((c) => [c.key, c])
  );

  const batchIds = [
    ...new Set(
      [
        issueAri,
        ...pageCandidates.map((c) => c.pageAri),
        ...linkedIssueCandidates.map((c) => c.targetAri),
      ].filter(Boolean)
    ),
  ].slice(0, MAX_OBJECTS_BATCH);

  const [objectsRes, hierarchyRes] = await Promise.all([
    executeTwgQuery(
      invokeGraph,
      OBJECTS_HYDRATION_QUERY,
      { ids: batchIds },
      'StandardsGuard_GetObjects'
    ),
    executeTwgQuery(
      invokeGraph,
      ISSUE_HIERARCHY_QUERY,
      { id: issueAri, first: MAX_GRAPH_ROWS },
      'StandardsGuard_GetIssueHierarchy'
    ),
  ]);

  let issueNode = null;
  const pageMap = new Map();
  const relatedIssueMap = new Map();

  for (const entry of Array.isArray(objectsRes.data?.objects) ? objectsRes.data.objects : []) {
    const data = entry?.data;
    if (!data) continue;

    if (isJiraWorkItemData(data)) {
      const nodeId = data.id || entry.id || '';
      const nodeKey = String(data.key || '').trim();
      const isCurrentIssue =
        entry.id === issueAri || nodeId === issueAri || (Boolean(issueKey) && nodeKey === issueKey);

      if (isCurrentIssue) {
        issueNode = data;
        continue;
      }

      const matchingCandidate =
        candidateByIssueAri.get(entry.id) ||
        candidateByIssueAri.get(nodeId) ||
        (nodeKey ? candidateByIssueKey.get(nodeKey) : null);
      const dedupeKey = nodeKey || nodeId || entry.id;
      if (!dedupeKey || relatedIssueMap.has(dedupeKey)) continue;

      relatedIssueMap.set(dedupeKey, {
        id: nodeId || matchingCandidate?.id || '',
        key: nodeKey || matchingCandidate?.key || '',
        summary: data.summary || matchingCandidate?.summary || '',
        status: data.status?.name || matchingCandidate?.status || '',
        relationship: matchingCandidate?.relationship || 'related',
        url: data.webUrl || '',
        hydratedByGraph: true,
      });
      continue;
    }

    if (isConfluencePageData(data)) {
      const nodeId = data.id || entry.id || '';
      const pageId = String(data.pageId || extractPageIdFromAri(nodeId) || '').trim();
      const matchingCandidate = pageId ? candidateByPageId.get(pageId) : null;
      const dedupeKey = pageId || nodeId || matchingCandidate?.url;
      if (!dedupeKey || pageMap.has(dedupeKey)) continue;

      pageMap.set(dedupeKey, {
        id: nodeId,
        pageId,
        title:
          data.title ||
          matchingCandidate?.title ||
          (pageId ? `Confluence Page ${pageId}` : 'Confluence Page'),
        url: data.webUrl || matchingCandidate?.url || '',
        source: 'teamwork-graph',
      });
    }
  }

  const hierarchyEdges = hierarchyRes.data?.jiraWorkItemHierarchy?.edges;
  for (const edge of Array.isArray(hierarchyEdges) ? hierarchyEdges : []) {
    const node = edge?.node;
    if (!node || (!node.id && !node.key)) continue;
    const nodeKey = String(node.key || '').trim();
    const isCurrentIssue = node.id === issueAri || (Boolean(issueKey) && nodeKey === issueKey);
    if (isCurrentIssue) continue;

    const dedupeKey = nodeKey || node.id;
    if (!dedupeKey || relatedIssueMap.has(dedupeKey)) continue;

    relatedIssueMap.set(dedupeKey, {
      id: node.id || '',
      key: nodeKey,
      summary: node.summary || '',
      status: node.status?.name || '',
      relationship: 'hierarchy',
      url: node.webUrl || '',
      hydratedByGraph: true,
    });
  }

  for (const candidate of linkedIssueCandidates) {
    const dedupeKey = candidate.key || candidate.targetAri || candidate.id;
    if (!dedupeKey || relatedIssueMap.has(dedupeKey)) continue;

    relatedIssueMap.set(dedupeKey, {
      id: candidate.targetAri || candidate.id,
      key: candidate.key,
      summary: candidate.summary,
      status: candidate.status,
      relationship: candidate.relationship,
      url: '',
      hydratedByGraph: false,
    });
  }

  let linkedPagesOk = false;
  const seedPageAris = pageCandidates
    .map((c) => c.pageAri)
    .filter(Boolean)
    .slice(0, MAX_LINKED_PAGE_SEEDS);

  if (seedPageAris.length > 0) {
    const linkedPageResults = await Promise.allSettled(
      seedPageAris.map((pageAri) =>
        executeTwgQuery(
          invokeGraph,
          CONFLUENCE_LINKED_PAGES_QUERY,
          { id: pageAri, first: MAX_GRAPH_ROWS },
          'StandardsGuard_GetLinkedConfluencePages'
        )
      )
    );

    for (const settled of linkedPageResults) {
      if (settled.status !== 'fulfilled' || !settled.value) continue;
      const res = settled.value;
      if (res.ok) linkedPagesOk = true;
      const edges = res.data?.confluencePageLinkedConfluencePages?.edges;
      for (const edge of Array.isArray(edges) ? edges : []) {
        const node = edge?.node;
        if (!node || (!node.id && !node.title && !node.pageId)) continue;
        const pageId = String(node.pageId || extractPageIdFromAri(node.id) || '').trim();
        const dedupeKey = pageId || node.id || node.webUrl || node.title;
        if (!dedupeKey || pageMap.has(dedupeKey)) continue;

        pageMap.set(dedupeKey, {
          id: node.id || '',
          pageId,
          title: node.title || (pageId ? `Confluence Page ${pageId}` : 'Confluence Page'),
          url: node.webUrl || '',
          source: 'teamwork-graph-linked',
        });
      }
    }
  }

  const anyQueryOk = Boolean(issueNode) || objectsRes.ok || hierarchyRes.ok || linkedPagesOk;
  const errorMessages = [objectsRes.error, hierarchyRes.error].filter(Boolean);
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
