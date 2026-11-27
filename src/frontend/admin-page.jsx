import React from 'react';
import ForgeReconciler, {
  Heading,
  SectionMessage,
  Stack,
  Text,
} from '@forge/react';

const AdminPage = () => {
  return (
    <Stack space="space.200">
      <Heading as="h2">Jira Standards Guard</Heading>
      <SectionMessage appearance="information" title="Week 0 Smoke Test Active">
        <Text>
          This Forge UI Kit (render: native) admin page is deployed on Node.js 24.
          Standards management and exception precedent audit controls will live here.
        </Text>
      </SectionMessage>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <AdminPage />
  </React.StrictMode>
);
