const URL_REGEX = /https?:\/\/[^\s)>"']+/gi;
const BLOCK_BOUNDARY_TYPES = new Set([
  'paragraph',
  'listItem',
  'heading',
  'blockquote',
  'codeBlock',
  'hardBreak',
]);

/**
 * Extracts plain text and referenced URLs from a Jira description (string or ADF document).
 */
export function extractAdfContent(description) {
  if (!description) {
    return { text: '', urls: [] };
  }

  const urls = new Set();

  if (typeof description === 'string') {
    for (const match of description.match(URL_REGEX) || []) {
      urls.add(match);
    }
    return { text: description.trim(), urls: [...urls] };
  }

  const chunks = [];

  function walk(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (mark?.type === 'link' && mark.attrs?.href) {
          urls.add(mark.attrs.href);
        }
      }
    }

    if ((node.type === 'inlineCard' || node.type === 'blockCard') && node.attrs?.url) {
      urls.add(node.attrs.url);
      chunks.push(node.attrs.url);
    }

    if (node.type === 'text' && typeof node.text === 'string') {
      chunks.push(node.text);
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
      }
    }

    if (BLOCK_BOUNDARY_TYPES.has(node.type)) {
      chunks.push('\n');
    }
  }

  walk(description);

  const cleanedText = chunks
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  for (const match of cleanedText.match(URL_REGEX) || []) {
    urls.add(match);
  }

  return { text: cleanedText, urls: [...urls] };
}

/**
 * Extracts a numeric Confluence page ID from either a raw ID or a Confluence page URL.
 */
export function extractConfluencePageId(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  const pagesMatch = raw.match(/\/pages\/(\d+)/i);
  if (pagesMatch) {
    return pagesMatch[1];
  }
  const queryMatch = raw.match(/[?&]pageId=(\d+)/i);
  if (queryMatch) {
    return queryMatch[1];
  }
  return null;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function buildConfigForCheck(checkType, rawValue) {
  const value = String(rawValue || '').trim();
  switch (checkType) {
    case 'description_min_length':
      return { minLength: Math.max(1, Number.parseInt(value, 10) || 40) };
    case 'description_contains_any':
      return {
        keywords: value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
    case 'field_present':
      return { field: value.toLowerCase() || 'assignee' };
    case 'label_present':
      return {
        labels: value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      };
    case 'has_link_or_url':
    default:
      return {};
  }
}

const VALID_CHECK_TYPES = new Set([
  'description_min_length',
  'description_contains_any',
  'field_present',
  'has_link_or_url',
  'label_present',
]);

const STOP_WORDS = new Set([
  'must',
  'should',
  'include',
  'every',
  'issue',
  'with',
  'have',
  'before',
  'done',
  'this',
  'that',
  'from',
  'into',
  'standard',
]);

function inferNaturalRuleCheck(text) {
  const lower = text.toLowerCase();

  if (/\brepro|reproduction|steps to reproduce\b/.test(lower)) {
    return {
      issueTypes: ['Bug'],
      checkType: 'description_contains_any',
      config: { keywords: ['steps to reproduce', 'repro', 'reproduction'] },
    };
  }
  if (/\bacceptance criteria|definition of done|dod\b/.test(lower)) {
    return {
      issueTypes: ['Story', 'Task'],
      checkType: 'description_contains_any',
      config: { keywords: ['acceptance criteria', 'definition of done', 'dod'] },
    };
  }
  if (/\bassignee|owner\b/.test(lower)) {
    return {
      issueTypes: ['*'],
      checkType: 'field_present',
      config: { field: 'assignee' },
    };
  }
  if (/\bpriority|severity\b/.test(lower)) {
    return {
      issueTypes: ['*'],
      checkType: 'field_present',
      config: { field: 'priority' },
    };
  }
  if (/\b(link|doc|test|pr|pull request|url)\b/.test(lower)) {
    return {
      issueTypes: ['*'],
      checkType: 'has_link_or_url',
      config: {},
    };
  }
  if (/\blabel\b/.test(lower)) {
    return {
      issueTypes: ['*'],
      checkType: 'field_present',
      config: { field: 'labels' },
    };
  }

  const colonIdx = text.indexOf(':');
  const titlePart = (colonIdx > 0 ? text.slice(0, colonIdx) : text).trim();
  const titleWords = titlePart
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
  const fallbackKeywords =
    titleWords.length > 0 ? [titlePart.toLowerCase(), ...titleWords.slice(0, 3)] : [lower.slice(0, 32)];

  return {
    issueTypes: ['*'],
    checkType: 'description_contains_any',
    config: { keywords: [...new Set(fallbackKeywords)] },
  };
}

/**
 * Parses Confluence storage XHTML into deterministic standards rules.
 * Supports both structured RULE: lines and natural [STD-...] / Standard N: bullets.
 */
export function parseConfluenceStandardsHtml(storageHtml, pageTitle = 'Confluence Standards', pageUrl = '') {
  if (!storageHtml || typeof storageHtml !== 'string') {
    return [];
  }

  const candidates = [];
  const blockRegex = /<(li|p|h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRegex.exec(storageHtml)) !== null) {
    const plain = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) {
      candidates.push(plain);
    }
  }

  const rules = [];
  const seenIds = new Set();
  let confIndex = 1;

  for (const line of candidates) {
    if (line.toUpperCase().startsWith('RULE:')) {
      const parts = line
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      const parsed = {};
      for (const part of parts) {
        const sep = part.indexOf(':');
        if (sep === -1) continue;
        const key = part.slice(0, sep).trim().toUpperCase();
        const val = part.slice(sep + 1).trim();
        parsed[key] = val;
      }

      const title = parsed.RULE;
      const checkType = VALID_CHECK_TYPES.has(parsed.CHECK) ? parsed.CHECK : 'description_contains_any';
      if (!title) continue;

      const id = `CONF-${confIndex}`;
      confIndex += 1;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const issueTypes = (parsed.TYPE || '*')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const severity = parsed.SEVERITY?.toLowerCase() === 'warning' ? 'warning' : 'blocking';

      rules.push({
        id,
        code: id,
        title,
        description: line,
        issueTypes: issueTypes.length > 0 ? issueTypes : ['*'],
        checkType,
        config: buildConfigForCheck(checkType, parsed.VALUE || ''),
        severity,
        citation: `${pageTitle} (Confluence)`,
        citationUrl: pageUrl || '',
        enabled: true,
        source: 'confluence',
      });
      continue;
    }

    const bracketMatch = line.match(/^\[(STD-[A-Z0-9-]+)\]\s*(.+)$/i);
    const stdNumberMatch = line.match(/^Standard\s+\d+\s*[:\-]\s*(.+)$/i);
    if (!bracketMatch && !stdNumberMatch) {
      continue;
    }

    const explicitCode = bracketMatch ? bracketMatch[1].toUpperCase() : null;
    const bodyText = (bracketMatch ? bracketMatch[2] : stdNumberMatch[1]).trim();
    if (!bodyText) continue;

    const id = explicitCode || `CONF-${confIndex}`;
    if (!explicitCode) {
      confIndex += 1;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const colonPos = bodyText.indexOf(':');
    const title = colonPos > 0 && colonPos <= 60 ? bodyText.slice(0, colonPos).trim() : bodyText.slice(0, 60);
    const inferred = inferNaturalRuleCheck(bodyText);

    rules.push({
      id,
      code: id,
      title,
      description: bodyText,
      issueTypes: inferred.issueTypes,
      checkType: inferred.checkType,
      config: inferred.config,
      severity: 'blocking',
      citation: `${pageTitle} (Confluence)`,
      citationUrl: pageUrl || '',
      enabled: true,
      source: 'confluence',
    });
  }

  return rules;
}

/**
 * Checks whether an active precedent exception matches a failing rule and Jira issue context.
 */
export function matchesPrecedent(exception, ruleId, issueContext) {
  if (!exception || exception.active !== true || exception.scope !== 'precedent') {
    return false;
  }
  if (exception.ruleId !== ruleId) {
    return false;
  }

  const patternType = exception.pattern?.issueType;
  if (
    patternType &&
    patternType !== '*' &&
    patternType.toLowerCase() !== String(issueContext.issueType || '').toLowerCase()
  ) {
    return false;
  }

  const requiredLabel = exception.pattern?.requiredLabel;
  if (requiredLabel) {
    const target = requiredLabel.toLowerCase();
    const issueLabels = Array.isArray(issueContext.labels) ? issueContext.labels : [];
    if (!issueLabels.some((label) => String(label).toLowerCase() === target)) {
      return false;
    }
  }

  return true;
}

/**
 * Deterministically evaluates a single standard rule against extracted issue context.
 */
export function evaluateRule(rule, issueContext) {
  const config = rule.config || {};

  switch (rule.checkType) {
    case 'description_min_length': {
      const minLength = Math.max(1, Number(config.minLength) || 40);
      const actual = issueContext.descriptionLength || 0;
      const passed = actual >= minLength;
      return {
        passed,
        detail: passed
          ? `Description has ${actual} characters (minimum required: ${minLength}).`
          : `Description has ${actual} characters (minimum required: ${minLength}).`,
      };
    }

    case 'description_contains_any': {
      const keywords = Array.isArray(config.keywords) ? config.keywords : [];
      const textLower = String(issueContext.descriptionText || '').toLowerCase();
      const matched = keywords.find((kw) => kw && textLower.includes(String(kw).toLowerCase()));
      const passed = Boolean(matched);
      return {
        passed,
        detail: passed
          ? `Matched required keyword '${matched}' in description.`
          : `Description must include one of: ${keywords.join(', ')}.`,
      };
    }

    case 'field_present': {
      const field = String(config.field || '').toLowerCase();
      if (field === 'assignee') {
        const passed = Boolean(issueContext.assigneeAccountId || issueContext.assigneeName);
        return {
          passed,
          detail: passed
            ? `Assigned to ${issueContext.assigneeName || issueContext.assigneeAccountId}.`
            : 'Issue has no assignee.',
        };
      }
      if (field === 'priority') {
        const passed = Boolean(issueContext.priority);
        return {
          passed,
          detail: passed
            ? `Priority is set to ${issueContext.priority}.`
            : 'Issue priority is not set.',
        };
      }
      if (field === 'labels') {
        const passed = issueContext.labels.length > 0;
        return {
          passed,
          detail: passed
            ? `Labels present: ${issueContext.labels.join(', ')}.`
            : 'Issue has no labels.',
        };
      }
      if (field === 'description') {
        const passed = issueContext.descriptionLength > 0;
        return {
          passed,
          detail: passed ? 'Description is populated.' : 'Description is empty.',
        };
      }
      return {
        passed: false,
        detail: `Unsupported required field '${field}'.`,
      };
    }

    case 'has_link_or_url': {
      const totalLinks =
        issueContext.issueLinksCount + issueContext.remoteLinksCount + issueContext.urls.length;
      const passed = totalLinks > 0;
      return {
        passed,
        detail: passed
          ? `Found ${issueContext.issueLinksCount} Jira link(s), ${issueContext.remoteLinksCount} remote link(s), and ${issueContext.urls.length} description URL(s).`
          : 'No linked Jira issue, Confluence/remote link, or reference URL found.',
      };
    }

    case 'label_present': {
      const required = Array.isArray(config.labels) ? config.labels : [];
      const lowerLabels = issueContext.labels.map((l) => l.toLowerCase());
      const matched = required.find((label) => lowerLabels.includes(String(label).toLowerCase()));
      const passed = Boolean(matched);
      return {
        passed,
        detail: passed
          ? `Found required label '${matched}'.`
          : `Missing one of required labels: ${required.join(', ')}.`,
      };
    }

    default:
      return {
        passed: false,
        detail: `Unknown check type '${rule.checkType}'.`,
      };
  }
}

function buildIssueContext(issue, remoteLinks) {
  const fields = issue?.fields || {};
  const { text, urls } = extractAdfContent(fields.description);
  const issueLinks = Array.isArray(fields.issuelinks) ? fields.issuelinks : [];
  const safeRemoteLinks = Array.isArray(remoteLinks) ? remoteLinks : [];
  const labels = Array.isArray(fields.labels) ? fields.labels : [];

  return {
    key: issue?.key || 'UNKNOWN',
    summary: fields.summary || '',
    issueType: fields.issuetype?.name || 'Unknown',
    statusName: fields.status?.name || 'Unknown',
    priority: fields.priority?.name || '',
    assigneeAccountId: fields.assignee?.accountId || '',
    assigneeName: fields.assignee?.displayName || '',
    labels,
    descriptionText: text,
    descriptionLength: text.length,
    urls,
    issueLinksCount: issueLinks.length,
    remoteLinksCount: safeRemoteLinks.length,
  };
}

function ruleAppliesToIssueType(rule, issueType) {
  const types = Array.isArray(rule.issueTypes) && rule.issueTypes.length > 0 ? rule.issueTypes : ['*'];
  const normalized = String(issueType || '').toLowerCase();
  return types.some((t) => t === '*' || String(t).toLowerCase() === normalized);
}

/**
 * Evaluates a Jira issue against enabled standards and active exceptions/precedents.
 */
export function evaluateIssue({ issue, remoteLinks = [], standards = [], exceptions = [] }) {
  const issueContext = buildIssueContext(issue, remoteLinks);
  const applicableRules = standards.filter(
    (rule) => rule.enabled !== false && ruleAppliesToIssueType(rule, issueContext.issueType)
  );

  const summary = {
    total: applicableRules.length,
    passed: 0,
    failed: 0,
    warnings: 0,
    exemptedDirect: 0,
    exemptedPrecedent: 0,
  };

  const results = [];
  const matchedPrecedentIds = [];

  for (const rule of applicableRules) {
    const check = evaluateRule(rule, issueContext);

    if (check.passed) {
      summary.passed += 1;
      results.push({
        ruleId: rule.id,
        code: rule.code || rule.id,
        title: rule.title,
        severity: rule.severity || 'blocking',
        citation: rule.citation || '',
        citationUrl: rule.citationUrl || '',
        status: 'PASSED',
        detail: check.detail,
        exception: null,
      });
      continue;
    }

    const directException = exceptions.find(
      (exc) => exc.active === true && exc.ruleId === rule.id && exc.issueKey === issueContext.key
    );

    if (directException) {
      summary.exemptedDirect += 1;
      results.push({
        ruleId: rule.id,
        code: rule.code || rule.id,
        title: rule.title,
        severity: rule.severity || 'blocking',
        citation: rule.citation || '',
        citationUrl: rule.citationUrl || '',
        status: 'EXEMPTED_DIRECT',
        detail: check.detail,
        exception: directException,
      });
      continue;
    }

    const precedent = exceptions.find((exc) => matchesPrecedent(exc, rule.id, issueContext));
    if (precedent) {
      summary.exemptedPrecedent += 1;
      matchedPrecedentIds.push(precedent.id);
      results.push({
        ruleId: rule.id,
        code: rule.code || rule.id,
        title: rule.title,
        severity: rule.severity || 'blocking',
        citation: rule.citation || '',
        citationUrl: rule.citationUrl || '',
        status: 'EXEMPTED_PRECEDENT',
        detail: check.detail,
        exception: precedent,
      });
      continue;
    }

    const isWarning = rule.severity === 'warning';
    if (isWarning) {
      summary.warnings += 1;
    } else {
      summary.failed += 1;
    }

    results.push({
      ruleId: rule.id,
      code: rule.code || rule.id,
      title: rule.title,
      severity: rule.severity || 'blocking',
      citation: rule.citation || '',
      citationUrl: rule.citationUrl || '',
      status: isWarning ? 'WARNING' : 'FAILED',
      detail: check.detail,
      exception: null,
    });
  }

  let verdict = 'READY';
  if (summary.failed > 0) {
    verdict = 'BLOCKED';
  } else if (summary.exemptedPrecedent > 0) {
    verdict = 'EXEMPTED_PRECEDENT';
  } else if (summary.exemptedDirect > 0) {
    verdict = 'EXEMPTED';
  }

  return {
    verdict,
    evaluatedAt: new Date().toISOString(),
    issueContext,
    summary,
    results,
    matchedPrecedentIds,
  };
}
