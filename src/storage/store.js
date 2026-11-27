import kvs from '@forge/kvs';
import { DEFAULT_STANDARDS } from '../engine/defaults.js';

const KEYS = {
  STANDARDS: 'standards:v1',
  EXCEPTIONS: 'exceptions:v1',
  CONFLUENCE_SYNC: 'confluenceSync:v1',
  AUDIT_LOG: 'auditLog:v1',
};

const MAX_AUDIT_ENTRIES = 100;

function cloneDefaults() {
  return DEFAULT_STANDARDS.map((rule) => ({
    ...rule,
    issueTypes: [...rule.issueTypes],
    projectKeys: [...(rule.projectKeys || ['*'])],
    config: { ...rule.config },
  }));
}

export async function getStandards() {
  const existing = await kvs.get(KEYS.STANDARDS);
  if (Array.isArray(existing) && existing.length > 0) {
    return existing;
  }
  const seeded = cloneDefaults();
  await kvs.set(KEYS.STANDARDS, seeded);
  return seeded;
}

export async function saveStandards(standards) {
  await kvs.set(KEYS.STANDARDS, standards);
  return standards;
}

export async function resetStandards() {
  const existing = await getStandards();
  const confluenceRules = existing.filter((r) => r.source === 'confluence');
  const defaults = [...cloneDefaults(), ...confluenceRules];
  await kvs.set(KEYS.STANDARDS, defaults);
  return defaults;
}

export async function getExceptions() {
  const existing = await kvs.get(KEYS.EXCEPTIONS);
  return Array.isArray(existing) ? existing : [];
}

export async function saveExceptions(exceptions) {
  await kvs.set(KEYS.EXCEPTIONS, exceptions);
  return exceptions;
}

function createAuditEntry({
  type,
  actor,
  issueKey = '',
  ruleCode = '',
  detail = '',
  timestamp = new Date().toISOString(),
}) {
  return {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp,
    type,
    actor: actor || 'Unknown User',
    issueKey,
    ruleCode,
    detail,
  };
}

/**
 * Pure state transition that marks first-time precedent applications and emits deduplicated audit entries.
 */
export function applyPrecedentUsage({
  exceptions = [],
  auditLog = [],
  precedentIds = [],
  issueKey = '',
  nowIso = new Date().toISOString(),
}) {
  if (!Array.isArray(precedentIds) || precedentIds.length === 0 || !issueKey) {
    return {
      modified: false,
      exceptions,
      auditLog,
      newlyAppliedIds: [],
    };
  }

  let modified = false;
  const newlyAppliedIds = [];
  const newAuditEntries = [];

  const updatedExceptions = exceptions.map((exc) => {
    if (!precedentIds.includes(exc.id)) {
      return exc;
    }
    const currentApplied = Array.isArray(exc.appliedToIssues) ? exc.appliedToIssues : [];
    if (currentApplied.includes(issueKey)) {
      return exc;
    }
    modified = true;
    newlyAppliedIds.push(exc.id);
    newAuditEntries.push(
      createAuditEntry({
        timestamp: nowIso,
        type: 'PRECEDENT_APPLIED',
        actor: 'Jira Standards Guard (Auto-Precedent)',
        issueKey,
        ruleCode: exc.ruleCode || exc.ruleId,
        detail: `Auto-applied precedent from ${exc.issueKey} (approved by ${exc.approverDisplayName}): ${exc.reason}`,
      })
    );
    return {
      ...exc,
      appliedToIssues: [...currentApplied, issueKey],
    };
  });

  if (!modified) {
    return {
      modified: false,
      exceptions,
      auditLog,
      newlyAppliedIds: [],
    };
  }

  const nextAuditLog = [...newAuditEntries, ...auditLog].slice(0, MAX_AUDIT_ENTRIES);
  return {
    modified: true,
    exceptions: updatedExceptions,
    auditLog: nextAuditLog,
    newlyAppliedIds,
  };
}

export async function recordPrecedentUsage(precedentIds, issueKey) {
  if (!Array.isArray(precedentIds) || precedentIds.length === 0 || !issueKey) {
    return;
  }
  const [exceptions, auditLog] = await Promise.all([getExceptions(), getAuditLog()]);
  const transition = applyPrecedentUsage({
    exceptions,
    auditLog,
    precedentIds,
    issueKey,
  });

  if (transition.modified) {
    await Promise.all([
      saveExceptions(transition.exceptions),
      kvs.set(KEYS.AUDIT_LOG, transition.auditLog),
    ]);
  }
}

export async function getConfluenceSync() {
  const existing = await kvs.get(KEYS.CONFLUENCE_SYNC);
  return existing || null;
}

export async function saveConfluenceSync(meta) {
  await kvs.set(KEYS.CONFLUENCE_SYNC, meta);
  return meta;
}

export async function getAuditLog() {
  const existing = await kvs.get(KEYS.AUDIT_LOG);
  return Array.isArray(existing) ? existing : [];
}

export async function appendAuditLogs(entries) {
  const validEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const current = await getAuditLog();
  if (validEntries.length === 0) {
    return current;
  }
  const created = validEntries.map((entry) => createAuditEntry(entry));
  const next = [...created, ...current].slice(0, MAX_AUDIT_ENTRIES);
  await kvs.set(KEYS.AUDIT_LOG, next);
  return next;
}

export async function appendAuditLog(entry) {
  return appendAuditLogs([entry]);
}
