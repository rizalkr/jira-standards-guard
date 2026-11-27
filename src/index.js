import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { CHECK_TYPE_LABELS } from './engine/defaults.js';
import {
  evaluateIssue,
  extractAdfContent,
  extractConfluencePageId,
  parseConfluenceStandardsHtml,
  ruleAppliesToIssueType,
  ruleAppliesToProject,
} from './engine/evaluator.js';
import { fetchIssueTeamworkGraphContext } from './graph/teamworkGraph.js';
import {
  appendAuditLog,
  appendAuditLogs,
  getAuditLog,
  getConfluenceSync,
  getExceptions,
  getStandards,
  recordPrecedentUsage,
  resetStandards,
  saveConfluenceSync,
  saveExceptions,
  saveStandards,
} from './storage/store.js';

const resolver = new Resolver();

function normalizeProjectKeys(raw) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || '*')
        .split(',')
        .map((item) => item.trim());
  const cleaned = [...new Set(list.map((p) => String(p || '').trim().toUpperCase()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : ['*'];
}

async function fetchJiraIssue(issueKey) {
  const issueRes = await api
    .asUser()
    .requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,issuetype,status,priority,assignee,labels,issuelinks,project`
    );

  if (!issueRes.ok) {
    throw new Error(`Jira issue API returned status ${issueRes.status} for ${issueKey}.`);
  }

  const issue = await issueRes.json();

  let remoteLinks = [];
  try {
    const remoteRes = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`);
    if (remoteRes.ok) {
      const parsed = await remoteRes.json();
      if (Array.isArray(parsed)) {
        remoteLinks = parsed;
      }
    }
  } catch {
    remoteLinks = [];
  }

  return { issue, remoteLinks };
}

async function fetchCurrentUser(fallbackAccountId) {
  try {
    const res = await api.asUser().requestJira(route`/rest/api/3/myself`);
    if (res.ok) {
      const me = await res.json();
      return {
        accountId: me.accountId || fallbackAccountId || 'unknown',
        displayName: me.displayName || me.emailAddress || fallbackAccountId || 'Jira User',
      };
    }
  } catch {
    // Fallback cleanly if profile lookup is restricted.
  }

  return {
    accountId: fallbackAccountId || 'unknown',
    displayName: fallbackAccountId || 'Jira User',
  };
}

async function evaluateIssueByKey(issueKey, cloudId = '') {
  const [{ issue, remoteLinks }, standards, exceptions] = await Promise.all([
    fetchJiraIssue(issueKey),
    getStandards(),
    getExceptions(),
  ]);

  const descriptionUrls = extractAdfContent(issue.fields?.description).urls;
  const teamworkGraph = await fetchIssueTeamworkGraphContext({
    cloudId,
    issueId: issue.id,
    issueKey: issue.key || issueKey,
    remoteLinks,
    descriptionUrls,
    issueLinks: issue.fields?.issuelinks,
  });

  const evaluation = evaluateIssue({
    issue,
    remoteLinks,
    teamworkGraph,
    standards,
    exceptions,
  });
  await recordPrecedentUsage(evaluation.matchedPrecedentIds, evaluation.issueContext.key || issueKey);
  return evaluation;
}

resolver.define('evaluateCurrentIssue', async (req) => {
  const issueKey = req.context?.extension?.issue?.key;
  if (!issueKey) {
    return { ok: false, error: 'No Jira issue context found.' };
  }

  try {
    const evaluation = await evaluateIssueByKey(issueKey, req.context?.cloudId);
    return { ok: true, evaluation };
  } catch (err) {
    return { ok: false, error: err?.message || 'Failed to evaluate issue standards.' };
  }
});

resolver.define('approveException', async (req) => {
  const issueKey = req.context?.extension?.issue?.key;
  const { ruleId, ruleIds, reason, scope, patternIssueType, requiredLabel } = req.payload || {};

  if (!issueKey) {
    return { ok: false, error: 'No Jira issue context found.' };
  }

  const requestedIds = Array.isArray(ruleIds) && ruleIds.length > 0 ? ruleIds : ruleId ? [ruleId] : [];
  const targetRuleIds = [...new Set(requestedIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (targetRuleIds.length === 0) {
    return { ok: false, error: 'At least one standard rule ID is required.' };
  }

  const trimmedReason = String(reason || '').trim();
  if (trimmedReason.length < 5 || trimmedReason.length > 500) {
    return { ok: false, error: 'Exception reason must be between 5 and 500 characters.' };
  }

  const normalizedScope = scope === 'precedent' ? 'precedent' : 'issue';
  const standards = await getStandards();
  const targetRules = [];
  for (const targetId of targetRuleIds) {
    const rule = standards.find((r) => r.id === targetId);
    if (!rule) {
      return { ok: false, error: `Standard '${targetId}' was not found.` };
    }
    targetRules.push(rule);
  }

  const [{ issue }, user, existingExceptions] = await Promise.all([
    fetchJiraIssue(issueKey),
    fetchCurrentUser(req.context?.accountId),
    getExceptions(),
  ]);

  const issueType = issue.fields?.issuetype?.name || 'Unknown';
  const cleanLabel = String(requiredLabel || '').trim();
  const now = new Date().toISOString();
  const batchTs = Date.now();
  const resolvedPatternType = String(patternIssueType || issueType).trim() || '*';

  const newExceptions = targetRules.map((rule, idx) => ({
    id: `exc-${batchTs}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    ruleId: rule.id,
    ruleCode: rule.code || rule.id,
    ruleTitle: rule.title,
    issueKey,
    issueType,
    reason: trimmedReason,
    approverAccountId: user.accountId,
    approverDisplayName: user.displayName,
    approvedAt: now,
    scope: normalizedScope,
    pattern:
      normalizedScope === 'precedent'
        ? {
            issueType: resolvedPatternType,
            requiredLabel: cleanLabel,
          }
        : null,
    active: true,
    revokedAt: null,
    revokedBy: null,
    appliedToIssues: [issueKey],
  }));

  const auditEntries = targetRules.map((rule) => ({
    type: 'EXCEPTION_APPROVED',
    actor: user.displayName,
    issueKey,
    ruleCode: rule.code || rule.id,
    timestamp: now,
    detail:
      normalizedScope === 'precedent'
        ? `Reusable precedent (${resolvedPatternType}${cleanLabel ? ` + label:${cleanLabel}` : ''}): ${trimmedReason}`
        : `Issue-only exception: ${trimmedReason}`,
  }));

  await saveExceptions([...newExceptions, ...existingExceptions]);
  await appendAuditLogs(auditEntries);

  const evaluation = await evaluateIssueByKey(issueKey, req.context?.cloudId);
  return {
    ok: true,
    evaluation,
    exceptions: newExceptions,
    exception: newExceptions[0],
  };
});

resolver.define('revokeException', async (req) => {
  const { exceptionId } = req.payload || {};
  if (!exceptionId) {
    return { ok: false, error: 'Exception ID is required.' };
  }

  const [exceptions, user] = await Promise.all([
    getExceptions(),
    fetchCurrentUser(req.context?.accountId),
  ]);

  const target = exceptions.find((e) => e.id === exceptionId);
  if (!target) {
    return { ok: false, error: 'Exception record not found.' };
  }

  const now = new Date().toISOString();
  const updated = exceptions.map((exc) =>
    exc.id === exceptionId
      ? { ...exc, active: false, revokedAt: now, revokedBy: user.displayName }
      : exc
  );

  await saveExceptions(updated);
  const auditLog = await appendAuditLog({
    type: 'PRECEDENT_REVOKED',
    actor: user.displayName,
    issueKey: target.issueKey,
    ruleCode: target.ruleCode || target.ruleId,
    detail: `Revoked ${target.scope === 'precedent' ? 'precedent' : 'exception'} originally approved for ${target.issueKey}.`,
  });

  const currentIssueKey = req.context?.extension?.issue?.key;
  const evaluation = currentIssueKey
    ? await evaluateIssueByKey(currentIssueKey, req.context?.cloudId)
    : null;

  return { ok: true, exceptions: updated, auditLog, evaluation };
});

resolver.define('getAdminData', async () => {
  const [standards, exceptions, confluenceSync, auditLog] = await Promise.all([
    getStandards(),
    getExceptions(),
    getConfluenceSync(),
    getAuditLog(),
  ]);
  return { ok: true, standards, exceptions, confluenceSync, auditLog };
});

resolver.define('toggleStandard', async (req) => {
  const { ruleId, enabled } = req.payload || {};
  const [standards, user] = await Promise.all([
    getStandards(),
    fetchCurrentUser(req.context?.accountId),
  ]);

  const target = standards.find((r) => r.id === ruleId);
  if (!target) {
    return { ok: false, error: `Standard '${ruleId}' not found.` };
  }

  const updated = standards.map((r) =>
    r.id === ruleId ? { ...r, enabled: Boolean(enabled) } : r
  );
  await saveStandards(updated);
  const auditLog = await appendAuditLog({
    type: 'RULE_UPDATED',
    actor: user.displayName,
    ruleCode: target.code || target.id,
    detail: `${Boolean(enabled) ? 'Enabled' : 'Disabled'} standard '${target.title}'.`,
  });

  return { ok: true, standards: updated, auditLog };
});

resolver.define('saveStandard', async (req) => {
  const payload = req.payload || {};
  const code = String(payload.code || '').trim().toUpperCase();
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  const citation = String(payload.citation || '').trim();
  const citationUrl = String(payload.citationUrl || '').trim();
  const checkType = String(payload.checkType || '').trim();
  const severity = payload.severity === 'warning' ? 'warning' : 'blocking';
  const issueTypes = Array.isArray(payload.issueTypes)
    ? payload.issueTypes.map((t) => String(t).trim()).filter(Boolean)
    : ['*'];
  const projectKeys = normalizeProjectKeys(payload.projectKeys);

  if (!code || !title) {
    return { ok: false, error: 'Standard code and title are required.' };
  }
  if (!CHECK_TYPE_LABELS[checkType]) {
    return { ok: false, error: `Unsupported check type '${checkType}'.` };
  }
  if (issueTypes.length === 0) {
    return { ok: false, error: 'At least one issue type (or *) is required.' };
  }

  const [standards, user] = await Promise.all([
    getStandards(),
    fetchCurrentUser(req.context?.accountId),
  ]);

  const isEditing = Boolean(payload.id);
  let existingIndex = -1;

  if (isEditing) {
    existingIndex = standards.findIndex((r) => r.id === payload.id);
    if (existingIndex < 0) {
      return { ok: false, error: `Standard '${payload.id}' was not found.` };
    }
  } else if (standards.some((r) => r.id === code || String(r.code || '').toUpperCase() === code)) {
    return {
      ok: false,
      error: `Standard code '${code}' already exists. Edit the existing rule or choose a new code.`,
    };
  }

  const existingRule = existingIndex >= 0 ? standards[existingIndex] : null;
  const nextRule = {
    id: existingRule ? existingRule.id : code,
    code: existingRule ? existingRule.code || code : code,
    title,
    description: description || title,
    issueTypes,
    projectKeys,
    checkType,
    config: payload.config && typeof payload.config === 'object' ? payload.config : {},
    severity,
    citation: citation || 'Team Governance Policy',
    citationUrl,
    enabled: existingRule ? existingRule.enabled : true,
    source: existingRule ? existingRule.source : 'custom',
  };

  const updated =
    existingIndex >= 0
      ? standards.map((r, idx) => (idx === existingIndex ? nextRule : r))
      : [...standards, nextRule];

  await saveStandards(updated);
  const auditLog = await appendAuditLog({
    type: 'RULE_UPDATED',
    actor: user.displayName,
    ruleCode: nextRule.code,
    detail: existingRule
      ? `Updated ${nextRule.source} standard '${title}'.`
      : `Created custom standard '${title}'.`,
  });

  return { ok: true, standards: updated, auditLog };
});

resolver.define('deleteStandard', async (req) => {
  const { ruleId } = req.payload || {};
  const [standards, user] = await Promise.all([
    getStandards(),
    fetchCurrentUser(req.context?.accountId),
  ]);

  const target = standards.find((r) => r.id === ruleId);
  if (!target) {
    return { ok: false, error: 'Standard not found.' };
  }
  if (target.source === 'builtin') {
    return { ok: false, error: 'Built-in standards can be disabled instead of deleted.' };
  }

  const updated = standards.filter((r) => r.id !== ruleId);
  await saveStandards(updated);
  const auditLog = await appendAuditLog({
    type: 'RULE_UPDATED',
    actor: user.displayName,
    ruleCode: target.code || target.id,
    detail: `Removed ${target.source} standard '${target.title}'.`,
  });

  return { ok: true, standards: updated, auditLog };
});

resolver.define('resetStandards', async (req) => {
  const user = await fetchCurrentUser(req.context?.accountId);
  const standards = await resetStandards();
  const auditLog = await appendAuditLog({
    type: 'RULE_UPDATED',
    actor: user.displayName,
    ruleCode: 'DEFAULTS',
    detail: 'Reset built-in default standards ruleset.',
  });
  return { ok: true, standards, auditLog };
});

resolver.define('syncConfluencePage', async (req) => {
  const pageInput = req.payload?.pageInput;
  const pageId = extractConfluencePageId(pageInput);
  if (!pageId) {
    return {
      ok: false,
      error: 'Enter a valid numeric Confluence Page ID or full Confluence page URL.',
    };
  }

  let res;
  try {
    res = await api
      .asUser()
      .requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to reach Confluence API: ${err?.message || 'Unknown error'}. Ensure the app is installed on Confluence for this site.`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Confluence API returned status ${res.status}. Verify the page ID exists, you have read access, and the app is installed on Confluence.`,
    };
  }

  const page = await res.json();
  const pageTitle = page.title || `Confluence Page ${pageId}`;
  const baseUrl = page._links?.base || '';
  const webUi = page._links?.webui || '';
  const pageUrl = baseUrl && webUi ? `${baseUrl}${webUi}` : '';
  const storageHtml = page.body?.storage?.value || '';

  const parsedRules = parseConfluenceStandardsHtml(storageHtml, pageTitle, pageUrl);
  if (parsedRules.length === 0) {
    return {
      ok: false,
      error: `No parseable standard rules found on "${pageTitle}". Use lines starting with "RULE:" or "[STD-...]".`,
    };
  }

  const [existingStandards, user] = await Promise.all([
    getStandards(),
    fetchCurrentUser(req.context?.accountId),
  ]);

  const preserved = existingStandards.filter((r) => r.source !== 'confluence');
  const existingCodes = new Set(preserved.map((r) => r.id));
  const uniqueConfluenceRules = parsedRules.map((rule) =>
    existingCodes.has(rule.id) ? { ...rule, id: `CONF-${rule.id}`, code: `CONF-${rule.code}` } : rule
  );

  const nextStandards = [...preserved, ...uniqueConfluenceRules];
  const syncMeta = {
    pageId,
    pageTitle,
    pageUrl,
    syncedAt: new Date().toISOString(),
    syncedBy: user.displayName,
    ruleCount: uniqueConfluenceRules.length,
  };

  await saveStandards(nextStandards);
  await saveConfluenceSync(syncMeta);
  const auditLog = await appendAuditLog({
    type: 'CONFLUENCE_SYNCED',
    actor: user.displayName,
    ruleCode: `PAGE-${pageId}`,
    detail: `Synced ${uniqueConfluenceRules.length} standard(s) from Confluence page '${pageTitle}'.`,
  });

  return {
    ok: true,
    syncedCount: uniqueConfluenceRules.length,
    pageTitle,
    pageUrl,
    standards: nextStandards,
    confluenceSync: syncMeta,
    auditLog,
  };
});

export const handler = resolver.getDefinitions();

function getActionInput(payload, key) {
  if (payload && payload[key] !== undefined && payload[key] !== null) {
    return payload[key];
  }
  return payload?.inputs?.[key];
}

function getActionCloudId(payload, context) {
  return String(context?.cloudId || payload?.context?.cloudId || '').trim();
}

export const checkIssueStandardsAction = async (payload, context) => {
  const issueKey = String(getActionInput(payload, 'issueKey') || '').trim().toUpperCase();
  if (!issueKey) {
    return { ok: false, error: 'issueKey is required (e.g. KAN-2).' };
  }

  try {
    const evaluation = await evaluateIssueByKey(issueKey, getActionCloudId(payload, context));
    return {
      ok: true,
      issueKey: evaluation.issueContext.key,
      projectKey: evaluation.issueContext.projectKey,
      issueType: evaluation.issueContext.issueType,
      verdict: evaluation.verdict,
      summary: evaluation.summary,
      teamworkGraph: evaluation.teamworkGraph,
      results: evaluation.results.map((r) => ({
        ruleId: r.ruleId,
        code: r.code,
        title: r.title,
        severity: r.severity,
        status: r.status,
        detail: r.detail,
        citation: r.citation,
        citationUrl: r.citationUrl,
        exceptionSourceIssue: r.exception?.issueKey || null,
        exceptionApprover: r.exception?.approverDisplayName || null,
        exceptionReason: r.exception?.reason || null,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      issueKey,
      error: err?.message || 'Failed to evaluate issue standards.',
    };
  }
};

export const listStandardsAction = async (payload) => {
  const projectKey = String(getActionInput(payload, 'projectKey') || '').trim().toUpperCase();
  const issueType = String(getActionInput(payload, 'issueType') || '').trim();

  const [standards, confluenceSync] = await Promise.all([getStandards(), getConfluenceSync()]);
  const filtered = standards.filter((rule) => {
    if (rule.enabled === false) return false;
    if (projectKey && !ruleAppliesToProject(rule, projectKey)) return false;
    if (issueType && !ruleAppliesToIssueType(rule, issueType)) return false;
    return true;
  });

  return {
    ok: true,
    count: filtered.length,
    confluenceSync,
    standards: filtered.map((rule) => ({
      id: rule.id,
      code: rule.code || rule.id,
      title: rule.title,
      description: rule.description,
      issueTypes: rule.issueTypes || ['*'],
      projectKeys: rule.projectKeys || ['*'],
      checkType: rule.checkType,
      severity: rule.severity,
      citation: rule.citation,
      citationUrl: rule.citationUrl || '',
      source: rule.source,
    })),
  };
};

export const listPrecedentsAction = async (payload) => {
  const rawActiveOnly = getActionInput(payload, 'activeOnly');
  const activeOnly =
    rawActiveOnly === undefined || rawActiveOnly === null
      ? true
      : typeof rawActiveOnly === 'string'
        ? rawActiveOnly.toLowerCase() !== 'false'
        : Boolean(rawActiveOnly);

  const exceptions = await getExceptions();
  const precedents = exceptions.filter((exc) => {
    if (exc.scope !== 'precedent') return false;
    return activeOnly ? exc.active === true : true;
  });

  return {
    ok: true,
    count: precedents.length,
    precedents: precedents.map((exc) => ({
      id: exc.id,
      ruleCode: exc.ruleCode || exc.ruleId,
      ruleTitle: exc.ruleTitle,
      sourceIssueKey: exc.issueKey,
      pattern: exc.pattern,
      reason: exc.reason,
      approver: exc.approverDisplayName,
      approvedAt: exc.approvedAt,
      active: exc.active,
      appliedToIssues: exc.appliedToIssues || [exc.issueKey],
    })),
  };
};

export const getIssueGraphContextAction = async (payload, context) => {
  const issueKey = String(getActionInput(payload, 'issueKey') || '').trim().toUpperCase();
  if (!issueKey) {
    return { ok: false, error: 'issueKey is required (e.g. KAN-3).' };
  }

  try {
    const { issue, remoteLinks } = await fetchJiraIssue(issueKey);
    const descriptionUrls = extractAdfContent(issue.fields?.description).urls;
    const teamworkGraph = await fetchIssueTeamworkGraphContext({
      cloudId: getActionCloudId(payload, context),
      issueId: issue.id,
      issueKey: issue.key || issueKey,
      remoteLinks,
      descriptionUrls,
      issueLinks: issue.fields?.issuelinks,
    });

    return {
      ok: true,
      issueKey: issue.key || issueKey,
      projectKey: String(issue.fields?.project?.key || '').trim().toUpperCase(),
      teamworkGraph,
    };
  } catch (err) {
    return {
      ok: false,
      issueKey,
      error: err?.message || 'Failed to retrieve Teamwork Graph context.',
    };
  }
};
