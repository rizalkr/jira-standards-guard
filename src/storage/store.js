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

export async function recordPrecedentUsage(precedentIds, issueKey) {
  if (!Array.isArray(precedentIds) || precedentIds.length === 0 || !issueKey) {
    return;
  }
  const exceptions = await getExceptions();
  let modified = false;

  const updated = exceptions.map((exc) => {
    if (!precedentIds.includes(exc.id)) {
      return exc;
    }
    const currentApplied = Array.isArray(exc.appliedToIssues) ? exc.appliedToIssues : [];
    if (currentApplied.includes(issueKey)) {
      return exc;
    }
    modified = true;
    return {
      ...exc,
      appliedToIssues: [...currentApplied, issueKey],
    };
  });

  if (modified) {
    await saveExceptions(updated);
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

export async function appendAuditLog({ type, actor, issueKey = '', ruleCode = '', detail = '' }) {
  const current = await getAuditLog();
  const entry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    actor: actor || 'Unknown User',
    issueKey,
    ruleCode,
    detail,
  };
  const next = [entry, ...current].slice(0, MAX_AUDIT_ENTRIES);
  await kvs.set(KEYS.AUDIT_LOG, next);
  return next;
}
