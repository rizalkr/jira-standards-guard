import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Checkbox,
  ErrorMessage,
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
  Text,
  TextArea,
  Textfield,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const cardStyle = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
});

const VERDICT_META = {
  READY: { appearance: 'success', label: 'READY FOR DONE' },
  BLOCKED: { appearance: 'removed', label: 'BLOCKED' },
  EXEMPTED_PRECEDENT: { appearance: 'inprogress', label: 'EXEMPTED (PRECEDENT)' },
  EXEMPTED: { appearance: 'moved', label: 'EXEMPTED' },
};

const RULE_STATUS_META = {
  PASSED: { appearance: 'success', label: 'PASS' },
  FAILED: { appearance: 'removed', label: 'BLOCKED' },
  WARNING: { appearance: 'moved', label: 'WARNING' },
  EXEMPTED_DIRECT: { appearance: 'moved', label: 'EXEMPTED' },
  EXEMPTED_PRECEDENT: { appearance: 'inprogress', label: 'EXEMPTED (PRECEDENT)' },
};

const TWG_STATUS_META = {
  ok: { appearance: 'success', label: 'CONNECTED' },
  unavailable: { appearance: 'default', label: 'UNAVAILABLE' },
  error: { appearance: 'moved', label: 'DEGRADED' },
};

const IssuePanel = () => {
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);

  const [modalRules, setModalRules] = useState([]);
  const [reason, setReason] = useState('');
  const [saveAsPrecedent, setSaveAsPrecedent] = useState(true);
  const [patternIssueType, setPatternIssueType] = useState(null);
  const [requiredLabel, setRequiredLabel] = useState('');
  const [modalError, setModalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadEvaluation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke('evaluateCurrentIssue');
      if (!res?.ok) {
        setError(res?.error || 'Failed to evaluate issue standards.');
      } else {
        setEvaluation(res.evaluation);
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error evaluating issue standards.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvaluation();
  }, [loadEvaluation]);

  const openApprovalModal = (ruleList) => {
    const rules = Array.isArray(ruleList) ? ruleList : [ruleList];
    const issueType = evaluation?.issueContext?.issueType || 'Bug';
    const firstLabel = evaluation?.issueContext?.labels?.[0] || '';
    setModalRules(rules);
    setReason('');
    setSaveAsPrecedent(true);
    setPatternIssueType({ label: `${issueType} only`, value: issueType });
    setRequiredLabel(firstLabel);
    setModalError('');
  };

  const closeModal = () => {
    if (submitting) return;
    setModalRules([]);
    setModalError('');
  };

  const handleSubmitApproval = async () => {
    if (modalRules.length === 0) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setModalError('Please enter at least 5 characters explaining why this exception is approved.');
      return;
    }

    setSubmitting(true);
    setModalError('');
    try {
      const res = await invoke('approveException', {
        ruleIds: modalRules.map((r) => r.ruleId),
        reason: trimmed,
        scope: saveAsPrecedent ? 'precedent' : 'issue',
        patternIssueType: patternIssueType?.value || evaluation?.issueContext?.issueType || '*',
        requiredLabel: saveAsPrecedent ? requiredLabel.trim() : '',
      });

      if (!res?.ok) {
        setModalError(res?.error || 'Failed to approve exception.');
      } else {
        setEvaluation(res.evaluation);
        setModalRules([]);
      }
    } catch (err) {
      setModalError(err?.message || 'Unexpected error approving exception.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeException = async (exceptionId) => {
    setActionBusyId(exceptionId);
    setError(null);
    try {
      const res = await invoke('revokeException', { exceptionId });
      if (!res?.ok) {
        setError(res?.error || 'Failed to revoke exception.');
      } else if (res.evaluation) {
        setEvaluation(res.evaluation);
      } else {
        await loadEvaluation();
      }
    } catch (err) {
      setError(err?.message || 'Unexpected error revoking exception.');
    } finally {
      setActionBusyId(null);
    }
  };

  if (loading && !evaluation) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Evaluating issue against team standards...</Text>
      </Inline>
    );
  }

  if (error && !evaluation) {
    return (
      <SectionMessage appearance="error" title="Jira Standards Guard">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  const { verdict, issueContext, teamworkGraph, summary, results } = evaluation;
  const verdictMeta = VERDICT_META[verdict] || VERDICT_META.BLOCKED;
  const failingBlockingRules = results.filter((item) => item.status === 'FAILED');
  const graphPages = Array.isArray(teamworkGraph?.linkedPages) ? teamworkGraph.linkedPages : [];
  const graphIssues = Array.isArray(teamworkGraph?.relatedIssues) ? teamworkGraph.relatedIssues : [];
  const twgMeta = TWG_STATUS_META[teamworkGraph?.status] || TWG_STATUS_META.unavailable;

  const totalLinks =
    (issueContext.issueLinksCount || 0) +
    (issueContext.remoteLinksCount || 0) +
    (issueContext.urls?.length || 0) +
    (issueContext.graphLinkedPagesCount || 0) +
    (issueContext.graphRelatedIssuesCount || 0);
  const issueTypeOptions = [
    { label: `${issueContext.issueType} only`, value: issueContext.issueType },
    { label: 'All issue types (*)', value: '*' },
  ];

  return (
    <Stack space="space.150">
      <Inline spread="space-between" alignBlock="center">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={verdictMeta.appearance}>{verdictMeta.label}</Lozenge>
          <Text weight="bold">{issueContext.key}</Text>
          <Lozenge appearance="default">{issueContext.issueType}</Lozenge>
        </Inline>
        <Inline space="space.100" alignBlock="center">
          {failingBlockingRules.length > 1 && (
            <Button
              appearance="default"
              onClick={() => openApprovalModal(failingBlockingRules)}
            >
              Approve All Blocking ({failingBlockingRules.length})
            </Button>
          )}
          <LoadingButton
            appearance="subtle"
            isLoading={loading}
            onClick={loadEvaluation}
          >
            Re-check
          </LoadingButton>
        </Inline>
      </Inline>

      <Text size="small" color="color.text.subtle">
        {summary.passed} passed | {summary.failed} blocking | {summary.warnings} warnings |{' '}
        {summary.exemptedDirect + summary.exemptedPrecedent} exempted | {totalLinks} link(s)
        {' '}| Labels: {issueContext.labels?.length > 0 ? issueContext.labels.join(', ') : 'None'}
      </Text>

      {error && (
        <SectionMessage appearance="error" title="Action Error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {summary.exemptedPrecedent > 0 && (
        <SectionMessage appearance="information" title="Precedent Applied">
          <Text>
            One or more checks passed automatically because this issue matches a human-approved
            exception precedent stored in Jira Standards Guard.
          </Text>
        </SectionMessage>
      )}

      <Stack space="space.100">
        {results.map((item) => {
          const statusMeta = RULE_STATUS_META[item.status] || RULE_STATUS_META.FAILED;
          const isFailing = item.status === 'FAILED' || item.status === 'WARNING';
          const isExempted =
            item.status === 'EXEMPTED_DIRECT' || item.status === 'EXEMPTED_PRECEDENT';

          return (
            <Box
              key={item.ruleId}
              backgroundColor="elevation.surface.sunken"
              padding="space.150"
              xcss={cardStyle}
            >
              <Stack space="space.075">
                <Inline spread="space-between" alignBlock="center">
                  <Inline space="space.100" alignBlock="center">
                    <Lozenge appearance={statusMeta.appearance}>{statusMeta.label}</Lozenge>
                    <Text weight="bold">
                      {item.code}: {item.title}
                    </Text>
                  </Inline>
                  {isFailing && (
                    <Button
                      appearance="subtle"
                      onClick={() => openApprovalModal([item])}
                    >
                      Approve Exception
                    </Button>
                  )}
                  {isExempted && item.exception?.id && (
                    <LoadingButton
                      appearance="subtle"
                      isLoading={actionBusyId === item.exception.id}
                      onClick={() => handleRevokeException(item.exception.id)}
                    >
                      Revoke
                    </LoadingButton>
                  )}
                </Inline>

                <Text>{item.detail}</Text>

                {item.citation && (
                  <Text size="small" color="color.text.subtle">
                    Standard: {item.citation}
                    {item.citationUrl ? ' — ' : ''}
                    {item.citationUrl && (
                      <Link href={item.citationUrl} openNewTab>
                        Open Confluence Standard
                      </Link>
                    )}
                  </Text>
                )}

                {isExempted && item.exception && (
                  <Text size="small" color="color.text.subtle">
                    {item.status === 'EXEMPTED_PRECEDENT'
                      ? `Precedent cited from ${item.exception.issueKey}`
                      : 'Direct issue exception'}{' '}
                    | Approved by {item.exception.approverDisplayName}: &ldquo;
                    {item.exception.reason}&rdquo;
                  </Text>
                )}
              </Stack>
            </Box>
          );
        })}
      </Stack>

      <Box
        backgroundColor="elevation.surface.sunken"
        padding="space.150"
        xcss={cardStyle}
      >
        <Stack space="space.075">
          <Inline spread="space-between" alignBlock="center">
            <Text weight="bold">Teamwork Graph Context</Text>
            <Lozenge appearance={twgMeta.appearance}>{twgMeta.label}</Lozenge>
          </Inline>

          <Text size="small" color="color.text.subtle">
            Connected Confluence Pages: {graphPages.length} | Related Jira Issues:{' '}
            {graphIssues.length}
          </Text>

          {graphPages.map((page) => (
            <Text key={page.id || page.url || page.title} size="small">
              Page:{' '}
              {page.url ? (
                <Link href={page.url} openNewTab>
                  {page.title}
                </Link>
              ) : (
                page.title
              )}
            </Text>
          ))}

          {graphIssues.map((rel) => (
            <Text key={rel.key || rel.id} size="small">
              Issue: {rel.key}
              {rel.summary ? ` — ${rel.summary}` : ''}
              {rel.status ? ` (${rel.status})` : ''}
            </Text>
          ))}

          {graphPages.length === 0 && graphIssues.length === 0 && (
            <Text size="small" color="color.text.subtle">
              {teamworkGraph?.errorDetail ||
                'No connected Confluence pages or related Jira issues found in Teamwork Graph for this issue.'}
            </Text>
          )}
        </Stack>
      </Box>

      <ModalTransition>
        {modalRules.length > 0 && (
          <Modal onClose={closeModal} width="medium">
            <ModalHeader>
              <ModalTitle>
                {modalRules.length > 1
                  ? `Approve All Blocking (${modalRules.length} Standards)`
                  : `Approve Exception — ${modalRules[0].code}: ${modalRules[0].title}`}
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.150">
                {modalRules.length === 1 ? (
                  <Text size="small" color="color.text.subtle">
                    Missing requirement: {modalRules[0].detail}
                  </Text>
                ) : (
                  <Stack space="space.050">
                    <Text size="small" weight="bold">
                      Rules included in this batch approval:
                    </Text>
                    {modalRules.map((rule) => (
                      <Text key={rule.ruleId} size="small" color="color.text.subtle">
                        {rule.code}: {rule.title}
                      </Text>
                    ))}
                    <HelperMessage>
                      Each rule is saved as an independent exception entry and can be revoked
                      individually.
                    </HelperMessage>
                  </Stack>
                )}

                <Stack space="space.050">
                  <Label labelFor="exception-reason">Reason for exception</Label>
                  <TextArea
                    id="exception-reason"
                    placeholder="Explain why this work can proceed without fulfilling this standard (min 5 characters)..."
                    value={reason}
                    onChange={(e) => setReason(e?.target?.value || '')}
                  />
                  {modalError && <ErrorMessage>{modalError}</ErrorMessage>}
                </Stack>

                <Checkbox
                  label="Save as reusable precedent for future matching issues"
                  isChecked={saveAsPrecedent}
                  onChange={(e) => setSaveAsPrecedent(Boolean(e?.target?.checked))}
                />

                {saveAsPrecedent && (
                  <Stack space="space.100">
                    <Stack space="space.050">
                      <Label labelFor="precedent-issue-type">Applies to Issue Type</Label>
                      <Select
                        inputId="precedent-issue-type"
                        options={issueTypeOptions}
                        value={patternIssueType}
                        onChange={(option) => setPatternIssueType(option)}
                      />
                    </Stack>

                    <Stack space="space.050">
                      <Label labelFor="precedent-label">Required label (optional)</Label>
                      <Textfield
                        id="precedent-label"
                        placeholder="e.g. hotfix"
                        value={requiredLabel}
                        onChange={(e) => setRequiredLabel(e?.target?.value || '')}
                      />
                      <HelperMessage>
                        Leave blank to match all issues of the selected type. Current issue labels:{' '}
                        {issueContext.labels?.length > 0 ? issueContext.labels.join(', ') : 'None'}.
                      </HelperMessage>
                    </Stack>
                  </Stack>
                )}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={closeModal} isDisabled={submitting}>
                Cancel
              </Button>
              <LoadingButton
                appearance="primary"
                isLoading={submitting}
                onClick={handleSubmitApproval}
              >
                {modalRules.length > 1
                  ? `Approve ${modalRules.length} Exceptions`
                  : 'Approve Exception'}
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
    <IssuePanel />
  </React.StrictMode>
);
