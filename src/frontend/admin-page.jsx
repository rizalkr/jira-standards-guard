import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  ErrorMessage,
  Heading,
  HelperMessage,
  Inline,
  Label,
  Link,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  Textfield,
  Toggle,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const panelBoxStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
});

const CHECK_TYPE_OPTIONS = [
  { label: 'Description Minimum Length', value: 'description_min_length' },
  { label: 'Description Contains Keywords', value: 'description_contains_any' },
  { label: 'Required Field Present (assignee/priority/labels)', value: 'field_present' },
  { label: 'Linked Issue, Remote Link, or Reference URL', value: 'has_link_or_url' },
  { label: 'Required Label Present', value: 'label_present' },
];

const SEVERITY_OPTIONS = [
  { label: 'Blocking', value: 'blocking' },
  { label: 'Warning', value: 'warning' },
];

const CHECK_VALUE_HELPERS = {
  description_min_length: 'Enter minimum character count (e.g. 40).',
  description_contains_any: 'Comma-separated keywords (e.g. security review, threat model).',
  field_present: 'Enter one of: assignee, priority, labels, description.',
  has_link_or_url:
    'No value required; checks Jira links, Teamwork Graph connected pages, remote links, and URLs in description.',
  label_present: 'Comma-separated label names (e.g. reviewed, qa-verified).',
};

const AUDIT_EVENT_APPEARANCES = {
  PRECEDENT_APPLIED: 'inprogress',
  EXCEPTION_APPROVED: 'moved',
  PRECEDENT_REVOKED: 'removed',
  CONFLUENCE_SYNCED: 'success',
};

function buildCheckConfig(checkType, rawValue) {
  const val = String(rawValue || '').trim();
  switch (checkType) {
    case 'description_min_length':
      return { minLength: Math.max(1, Number.parseInt(val, 10) || 40) };
    case 'description_contains_any':
      return {
        keywords: val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case 'field_present':
      return { field: val.toLowerCase() || 'assignee' };
    case 'label_present':
      return {
        labels: val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    case 'has_link_or_url':
    default:
      return {};
  }
}

function formatConfigToCheckValue(checkType, config) {
  const safe = config || {};
  switch (checkType) {
    case 'description_min_length':
      return String(safe.minLength || 40);
    case 'description_contains_any':
      return Array.isArray(safe.keywords) ? safe.keywords.join(', ') : '';
    case 'field_present':
      return String(safe.field || 'assignee');
    case 'label_present':
      return Array.isArray(safe.labels) ? safe.labels.join(', ') : '';
    case 'has_link_or_url':
    default:
      return '';
  }
}

const AdminPage = () => {
  const [data, setData] = useState({
    standards: [],
    exceptions: [],
    confluenceSync: null,
    auditLog: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const [confluenceInput, setConfluenceInput] = useState('');
  const [syncingConfluence, setSyncingConfluence] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleCode, setRuleCode] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleCitation, setRuleCitation] = useState('');
  const [ruleCitationUrl, setRuleCitationUrl] = useState('');
  const [ruleIssueTypes, setRuleIssueTypes] = useState('*');
  const [ruleProjectKeys, setRuleProjectKeys] = useState('*');
  const [ruleCheckType, setRuleCheckType] = useState(CHECK_TYPE_OPTIONS[1]);
  const [ruleCheckValue, setRuleCheckValue] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState(SEVERITY_OPTIONS[0]);
  const [modalError, setModalError] = useState('');
  const [savingRule, setSavingRule] = useState(false);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('getAdminData');
      if (!res?.ok) {
        setError(res?.error || 'Failed to load governance data.');
      } else {
        setData({
          standards: res.standards || [],
          exceptions: res.exceptions || [],
          confluenceSync: res.confluenceSync || null,
          auditLog: res.auditLog || [],
        });
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error loading governance console.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const openAddModal = () => {
    setEditingRuleId(null);
    setRuleCode('');
    setRuleTitle('');
    setRuleDescription('');
    setRuleCitation('');
    setRuleCitationUrl('');
    setRuleIssueTypes('*');
    setRuleProjectKeys('*');
    setRuleCheckType(CHECK_TYPE_OPTIONS[1]);
    setRuleCheckValue('');
    setRuleSeverity(SEVERITY_OPTIONS[0]);
    setModalError('');
    setShowAddModal(true);
  };

  const openEditModal = (rule) => {
    const matchedCheck =
      CHECK_TYPE_OPTIONS.find((opt) => opt.value === rule.checkType) || CHECK_TYPE_OPTIONS[1];
    const matchedSeverity =
      SEVERITY_OPTIONS.find((opt) => opt.value === rule.severity) || SEVERITY_OPTIONS[0];

    setEditingRuleId(rule.id);
    setRuleCode(rule.code || rule.id);
    setRuleTitle(rule.title || '');
    setRuleDescription(rule.description || '');
    setRuleCitation(rule.citation || '');
    setRuleCitationUrl(rule.citationUrl || '');
    setRuleIssueTypes(Array.isArray(rule.issueTypes) && rule.issueTypes.length > 0 ? rule.issueTypes.join(', ') : '*');
    setRuleProjectKeys(
      Array.isArray(rule.projectKeys) && rule.projectKeys.length > 0 ? rule.projectKeys.join(', ') : '*'
    );
    setRuleCheckType(matchedCheck);
    setRuleCheckValue(formatConfigToCheckValue(rule.checkType, rule.config));
    setRuleSeverity(matchedSeverity);
    setModalError('');
    setShowAddModal(true);
  };

  const closeModal = () => {
    if (savingRule) return;
    setShowAddModal(false);
    setEditingRuleId(null);
    setModalError('');
  };

  const handleToggleRule = async (ruleId, nextEnabled) => {
    setBusyKey(ruleId);
    setError(null);
    try {
      const res = await invoke('toggleStandard', { ruleId, enabled: nextEnabled });
      if (!res?.ok) {
        setError(res?.error || 'Failed to update standard.');
      } else {
        setData((prev) => ({
          ...prev,
          standards: res.standards,
          auditLog: res.auditLog || prev.auditLog,
        }));
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error updating standard.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    setBusyKey(`del-${ruleId}`);
    setError(null);
    try {
      const res = await invoke('deleteStandard', { ruleId });
      if (!res?.ok) {
        setError(res?.error || 'Failed to remove standard.');
      } else {
        setData((prev) => ({
          ...prev,
          standards: res.standards,
          auditLog: res.auditLog || prev.auditLog,
        }));
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error removing standard.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleResetDefaults = async () => {
    setBusyKey('reset');
    setError(null);
    setFeedback(null);
    try {
      const res = await invoke('resetStandards');
      if (!res?.ok) {
        setError(res?.error || 'Failed to reset built-in defaults.');
      } else {
        setData((prev) => ({
          ...prev,
          standards: res.standards,
          auditLog: res.auditLog || prev.auditLog,
        }));
        setFeedback('Built-in default standards have been restored.');
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error resetting standards.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveCustomRule = async () => {
    const code = ruleCode.trim().toUpperCase();
    const title = ruleTitle.trim();
    if (!code || !title) {
      setModalError('Standard code and title are required.');
      return;
    }

    const checkType = ruleCheckType?.value || 'description_contains_any';
    if (checkType !== 'has_link_or_url' && !ruleCheckValue.trim()) {
      setModalError('Check value is required for the selected check type.');
      return;
    }

    setSavingRule(true);
    setModalError('');
    try {
      const issueTypes = ruleIssueTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const projectKeys = ruleProjectKeys
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);

      const res = await invoke('saveStandard', {
        id: editingRuleId || undefined,
        code,
        title,
        description: ruleDescription.trim() || title,
        citation: ruleCitation.trim() || 'Team Governance Policy',
        citationUrl: ruleCitationUrl.trim(),
        issueTypes: issueTypes.length > 0 ? issueTypes : ['*'],
        projectKeys: projectKeys.length > 0 ? projectKeys : ['*'],
        checkType,
        config: buildCheckConfig(checkType, ruleCheckValue),
        severity: ruleSeverity?.value || 'blocking',
      });

      if (!res?.ok) {
        setModalError(res?.error || 'Failed to save standard.');
      } else {
        setData((prev) => ({
          ...prev,
          standards: res.standards,
          auditLog: res.auditLog || prev.auditLog,
        }));
        setShowAddModal(false);
        setEditingRuleId(null);
        setFeedback(
          editingRuleId ? `Updated standard ${code}.` : `Saved custom standard ${code}.`
        );
      }
    } catch (err) {
      setModalError(err?.message || 'Unexpected error saving standard.');
    } finally {
      setSavingRule(false);
    }
  };

  const handleSyncConfluence = async () => {
    if (!confluenceInput.trim()) {
      setError('Enter a Confluence page URL or numeric Page ID.');
      return;
    }

    setSyncingConfluence(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await invoke('syncConfluencePage', { pageInput: confluenceInput.trim() });
      if (!res?.ok) {
        setError(res?.error || 'Failed to sync standards from Confluence.');
      } else {
        setData((prev) => ({
          ...prev,
          standards: res.standards,
          confluenceSync: res.confluenceSync,
          auditLog: res.auditLog || prev.auditLog,
        }));
        setFeedback(`Synced ${res.syncedCount} standard(s) from "${res.pageTitle}".`);
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error syncing Confluence page.');
    } finally {
      setSyncingConfluence(false);
    }
  };

  const handleRevokeException = async (exceptionId) => {
    setBusyKey(exceptionId);
    setError(null);
    try {
      const res = await invoke('revokeException', { exceptionId });
      if (!res?.ok) {
        setError(res?.error || 'Failed to revoke precedent.');
      } else {
        setData((prev) => ({
          ...prev,
          exceptions: res.exceptions || prev.exceptions,
          auditLog: res.auditLog || prev.auditLog,
        }));
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error revoking precedent.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && data.standards.length === 0) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="medium" />
        <Text>Loading Jira Standards Guard governance console...</Text>
      </Inline>
    );
  }

  const activeStandardsCount = data.standards.filter((r) => r.enabled !== false).length;
  const activePrecedentsCount = data.exceptions.filter(
    (e) => e.active && e.scope === 'precedent'
  ).length;
  const confluenceRulesCount = data.standards.filter((r) => r.source === 'confluence').length;

  const standardsHead = {
    cells: [
      { key: 'code', content: 'Code' },
      { key: 'title', content: 'Standard & Citation' },
      { key: 'types', content: 'Issue Types' },
      { key: 'projects', content: 'Projects' },
      { key: 'check', content: 'Check' },
      { key: 'severity', content: 'Severity' },
      { key: 'source', content: 'Source' },
      { key: 'enabled', content: 'Active' },
      { key: 'actions', content: 'Actions' },
    ],
  };

  const standardsRows = data.standards.map((rule) => ({
    key: rule.id,
    cells: [
      { key: 'code', content: <Text weight="bold">{rule.code || rule.id}</Text> },
      {
        key: 'title',
        content: (
          <Stack space="space.025">
            <Text weight="bold">{rule.title}</Text>
            <Text size="small" color="color.text.subtle">
              {rule.citation}
            </Text>
          </Stack>
        ),
      },
      { key: 'types', content: <Text>{(rule.issueTypes || ['*']).join(', ')}</Text> },
      {
        key: 'projects',
        content: (
          <Text>
            {!rule.projectKeys || rule.projectKeys.includes('*')
              ? 'All (*)'
              : rule.projectKeys.join(', ')}
          </Text>
        ),
      },
      { key: 'check', content: <Text size="small">{rule.checkType}</Text> },
      {
        key: 'severity',
        content: (
          <Lozenge appearance={rule.severity === 'warning' ? 'moved' : 'removed'}>
            {rule.severity === 'warning' ? 'WARNING' : 'BLOCKING'}
          </Lozenge>
        ),
      },
      {
        key: 'source',
        content: (
          <Lozenge appearance={rule.source === 'confluence' ? 'inprogress' : 'default'}>
            {(rule.source || 'builtin').toUpperCase()}
          </Lozenge>
        ),
      },
      {
        key: 'enabled',
        content: (
          <Toggle
            label={`Toggle ${rule.code}`}
            isChecked={rule.enabled !== false}
            isDisabled={busyKey === rule.id}
            onChange={(e) => handleToggleRule(rule.id, Boolean(e?.target?.checked))}
          />
        ),
      },
      {
        key: 'actions',
        content: (
          <Inline space="space.050">
            <Button appearance="subtle" onClick={() => openEditModal(rule)}>
              Edit
            </Button>
            {rule.source !== 'builtin' && (
              <LoadingButton
                appearance="subtle"
                isLoading={busyKey === `del-${rule.id}`}
                onClick={() => handleDeleteRule(rule.id)}
              >
                Delete
              </LoadingButton>
            )}
          </Inline>
        ),
      },
    ],
  }));

  const exceptionsHead = {
    cells: [
      { key: 'rule', content: 'Rule' },
      { key: 'scope', content: 'Scope & Pattern' },
      { key: 'sourceIssue', content: 'Source Issue' },
      { key: 'approver', content: 'Approver & Reason' },
      { key: 'matched', content: 'Applied Issues' },
      { key: 'status', content: 'Status' },
      { key: 'action', content: 'Action' },
    ],
  };

  const exceptionsRows = data.exceptions.map((exc) => ({
    key: exc.id,
    cells: [
      { key: 'rule', content: <Text weight="bold">{exc.ruleCode || exc.ruleId}</Text> },
      {
        key: 'scope',
        content: (
          <Stack space="space.025">
            <Lozenge appearance={exc.scope === 'precedent' ? 'inprogress' : 'default'}>
              {exc.scope === 'precedent' ? 'REUSABLE PRECEDENT' : 'ISSUE ONLY'}
            </Lozenge>
            {exc.scope === 'precedent' && exc.pattern && (
              <Text size="small" color="color.text.subtle">
                Type: {exc.pattern.issueType}
                {exc.pattern.requiredLabel ? ` | Label: ${exc.pattern.requiredLabel}` : ''}
              </Text>
            )}
          </Stack>
        ),
      },
      { key: 'sourceIssue', content: <Text>{exc.issueKey}</Text> },
      {
        key: 'approver',
        content: (
          <Stack space="space.025">
            <Text weight="bold">{exc.approverDisplayName}</Text>
            <Text size="small">{exc.reason}</Text>
          </Stack>
        ),
      },
      {
        key: 'matched',
        content: (
          <Text size="small">
            {Array.isArray(exc.appliedToIssues) && exc.appliedToIssues.length > 0
              ? exc.appliedToIssues.join(', ')
              : exc.issueKey}
          </Text>
        ),
      },
      {
        key: 'status',
        content: (
          <Lozenge appearance={exc.active ? 'success' : 'default'}>
            {exc.active ? 'ACTIVE' : 'REVOKED'}
          </Lozenge>
        ),
      },
      {
        key: 'action',
        content: exc.active ? (
          <LoadingButton
            appearance="subtle"
            isLoading={busyKey === exc.id}
            onClick={() => handleRevokeException(exc.id)}
          >
            Revoke
          </LoadingButton>
        ) : (
          <Text size="small" color="color.text.subtle">
            Revoked
          </Text>
        ),
      },
    ],
  }));

  const auditHead = {
    cells: [
      { key: 'time', content: 'Timestamp' },
      { key: 'event', content: 'Event' },
      { key: 'actor', content: 'Actor' },
      { key: 'issue', content: 'Issue / Target' },
      { key: 'rule', content: 'Rule' },
      { key: 'detail', content: 'Detail' },
    ],
  };

  const auditRows = data.auditLog.slice(0, 15).map((entry) => ({
    key: entry.id,
    cells: [
      { key: 'time', content: <Text size="small">{entry.timestamp?.slice(0, 19).replace('T', ' ')}</Text> },
      {
        key: 'event',
        content: (
          <Lozenge appearance={AUDIT_EVENT_APPEARANCES[entry.type] || 'default'}>
            {entry.type}
          </Lozenge>
        ),
      },
      { key: 'actor', content: <Text size="small">{entry.actor}</Text> },
      { key: 'issue', content: <Text size="small">{entry.issueKey || '—'}</Text> },
      { key: 'rule', content: <Text size="small">{entry.ruleCode || '—'}</Text> },
      { key: 'detail', content: <Text size="small">{entry.detail}</Text> },
    ],
  }));

  return (
    <Stack space="space.200">
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          <Heading as="h2">Jira Standards Guard — Governance Console</Heading>
          <Text size="small" color="color.text.subtle">
            Active Standards: {activeStandardsCount} | Active Precedents: {activePrecedentsCount} |
            Confluence Synced Rules: {confluenceRulesCount}
          </Text>
        </Stack>
        <LoadingButton appearance="subtle" isLoading={loading} onClick={loadAdminData}>
          Refresh
        </LoadingButton>
      </Inline>

      {error && (
        <SectionMessage appearance="error" title="Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {feedback && (
        <SectionMessage appearance="confirmation" title="Updated">
          <Text>{feedback}</Text>
        </SectionMessage>
      )}

      <Tabs id="governance-tabs">
        <TabList>
          <Tab>Standards Ruleset</Tab>
          <Tab>Confluence Sync</Tab>
          <Tab>Exceptions & Precedents</Tab>
        </TabList>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <Stack space="space.150">
              <Inline space="space.100">
                <Button appearance="primary" onClick={openAddModal}>
                  Add Custom Standard
                </Button>
                <LoadingButton
                  appearance="subtle"
                  isLoading={busyKey === 'reset'}
                  onClick={handleResetDefaults}
                >
                  Reset Built-in Defaults
                </LoadingButton>
              </Inline>

              <DynamicTable
                head={standardsHead}
                rows={standardsRows}
                emptyView={<EmptyState header="No standards configured" />}
              />
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <Stack space="space.200">
              {data.confluenceSync && (
                <SectionMessage appearance="information" title="Active Confluence Sync">
                  <Text>
                    Last synced from{' '}
                    {data.confluenceSync.pageUrl ? (
                      <Link href={data.confluenceSync.pageUrl} openNewTab>
                        {data.confluenceSync.pageTitle}
                      </Link>
                    ) : (
                      data.confluenceSync.pageTitle
                    )}{' '}
                    ({data.confluenceSync.ruleCount} rules) by {data.confluenceSync.syncedBy} at{' '}
                    {data.confluenceSync.syncedAt?.slice(0, 19).replace('T', ' ')}.
                  </Text>
                </SectionMessage>
              )}

              <Box backgroundColor="elevation.surface.sunken" padding="space.200" xcss={panelBoxStyle}>
                <Stack space="space.150">
                  <Label labelFor="confluence-page-input">Confluence Page URL or Page ID</Label>
                  <Textfield
                    id="confluence-page-input"
                    placeholder="https://your-site.atlassian.net/wiki/spaces/ENG/pages/123456/Engineering+Standards"
                    value={confluenceInput}
                    onChange={(e) => setConfluenceInput(e?.target?.value || '')}
                  />
                  <HelperMessage>
                    Syncing extracts deterministic rules from your Confluence Standards page and
                    links issue citations back to that page.
                  </HelperMessage>
                  <Inline>
                    <LoadingButton
                      appearance="primary"
                      isLoading={syncingConfluence}
                      onClick={handleSyncConfluence}
                    >
                      Sync Standards from Confluence
                    </LoadingButton>
                  </Inline>
                </Stack>
              </Box>

              <Box backgroundColor="elevation.surface.sunken" padding="space.200" xcss={panelBoxStyle}>
                <Stack space="space.100">
                  <Heading as="h4">Supported Confluence Page Formats</Heading>
                  <Text size="small">
                    Structured rule bullet: RULE: Security Review Required | TYPE: Story, Task |
                    CHECK: description_contains_any | VALUE: security review, threat model |
                    SEVERITY: blocking (optional: | PROJECT: KAN, PAY)
                  </Text>
                  <Text size="small">
                    Natural rule bullet: [STD-C1] Rollback Plan: Include rollback steps in the
                    issue description.
                  </Text>
                </Stack>
              </Box>
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel>
          <Box paddingBlockStart="space.200">
            <Stack space="space.200">
              <Heading as="h3">Approved Exceptions & Reusable Precedents</Heading>
              <DynamicTable
                head={exceptionsHead}
                rows={exceptionsRows}
                rowsPerPage={10}
                emptyView={
                  <EmptyState
                    header="No exceptions or precedents recorded yet"
                    description="Approve an exception from any Jira issue panel to create a direct exemption or reusable precedent."
                  />
                }
              />

              <Heading as="h3">Recent Governance Audit Log</Heading>
              <DynamicTable
                head={auditHead}
                rows={auditRows}
                rowsPerPage={10}
                emptyView={<EmptyState header="No governance events logged yet" />}
              />
            </Stack>
          </Box>
        </TabPanel>
      </Tabs>

      <ModalTransition>
        {showAddModal && (
          <Modal onClose={closeModal} width="medium">
            <ModalHeader>
              <ModalTitle>
                {editingRuleId ? `Edit Standard — ${ruleCode}` : 'Add Custom Standard'}
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.150">
                <Stack space="space.050">
                  <Label labelFor="rule-code">Standard Code</Label>
                  <Textfield
                    id="rule-code"
                    placeholder="e.g. STD-7"
                    isDisabled={Boolean(editingRuleId)}
                    value={ruleCode}
                    onChange={(e) => setRuleCode(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-title">Title</Label>
                  <Textfield
                    id="rule-title"
                    placeholder="e.g. Security Review Checklist"
                    value={ruleTitle}
                    onChange={(e) => setRuleTitle(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-description">Description</Label>
                  <TextArea
                    id="rule-description"
                    placeholder="Explain what the developer must provide..."
                    value={ruleDescription}
                    onChange={(e) => setRuleDescription(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-citation">Standard Citation</Label>
                  <Textfield
                    id="rule-citation"
                    placeholder="e.g. Security Policy Section 4.2"
                    value={ruleCitation}
                    onChange={(e) => setRuleCitation(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-citation-url">Citation URL (optional)</Label>
                  <Textfield
                    id="rule-citation-url"
                    placeholder="https://your-site.atlassian.net/wiki/..."
                    value={ruleCitationUrl}
                    onChange={(e) => setRuleCitationUrl(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-types">Applies to Issue Types</Label>
                  <Textfield
                    id="rule-types"
                    placeholder="*, Bug, Story, Task"
                    value={ruleIssueTypes}
                    onChange={(e) => setRuleIssueTypes(e?.target?.value || '')}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-project-keys">Project Keys (comma-separated or *)</Label>
                  <Textfield
                    id="rule-project-keys"
                    placeholder="*, KAN, PAY"
                    value={ruleProjectKeys}
                    onChange={(e) => setRuleProjectKeys(e?.target?.value || '')}
                  />
                  <HelperMessage>
                    Use * for all projects, or specify Jira project keys such as KAN, PAY.
                  </HelperMessage>
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-check-type">Deterministic Check Type</Label>
                  <Select
                    inputId="rule-check-type"
                    options={CHECK_TYPE_OPTIONS}
                    value={ruleCheckType}
                    onChange={(opt) => setRuleCheckType(opt)}
                  />
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-check-value">Check Value</Label>
                  <Textfield
                    id="rule-check-value"
                    placeholder="Enter expected value"
                    isDisabled={ruleCheckType?.value === 'has_link_or_url'}
                    value={ruleCheckValue}
                    onChange={(e) => setRuleCheckValue(e?.target?.value || '')}
                  />
                  <HelperMessage>
                    {CHECK_VALUE_HELPERS[ruleCheckType?.value] || ''}
                  </HelperMessage>
                </Stack>

                <Stack space="space.050">
                  <Label labelFor="rule-severity">Severity</Label>
                  <Select
                    inputId="rule-severity"
                    options={SEVERITY_OPTIONS}
                    value={ruleSeverity}
                    onChange={(opt) => setRuleSeverity(opt)}
                  />
                </Stack>

                {modalError && <ErrorMessage>{modalError}</ErrorMessage>}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={closeModal} isDisabled={savingRule}>
                Cancel
              </Button>
              <LoadingButton
                appearance="primary"
                isLoading={savingRule}
                onClick={handleSaveCustomRule}
              >
                Save Standard
              </LoadingButton>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <AdminPage />
  </React.StrictMode>
);
