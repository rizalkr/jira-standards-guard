import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const IssuePanel = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('getSmokeStatus')
      .then(setStatus)
      .catch((err) => setError(err?.message || 'Failed to load smoke status'));
  }, []);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Jira Standards Guard">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!status) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" />
        <Text>Checking issue context...</Text>
      </Inline>
    );
  }

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={status.ok ? 'success' : 'removed'}>
          {status.ok ? 'UI KIT READY' : 'CHECK FAILED'}
        </Lozenge>
        <Text>{status.issueKey}</Text>
        <Lozenge appearance="default">{status.issueType}</Lozenge>
      </Inline>
      <Text>{status.summary}</Text>
      <Text>
        Labels: {status.labels.length > 0 ? status.labels.join(', ') : 'None'}
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <IssuePanel />
  </React.StrictMode>
);
