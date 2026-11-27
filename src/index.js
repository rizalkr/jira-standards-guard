import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

resolver.define('getSmokeStatus', async (req) => {
  const issueKey = req.context?.extension?.issue?.key;
  if (!issueKey) {
    return {
      ok: false,
      issueKey: 'UNKNOWN',
      summary: 'No Jira issue context detected.',
      issueType: 'Unknown',
      labels: [],
    };
  }

  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,issuetype,labels`);

  if (!res.ok) {
    return {
      ok: false,
      issueKey,
      summary: `Jira API returned status ${res.status}`,
      issueType: 'Unknown',
      labels: [],
    };
  }

  const data = await res.json();
  return {
    ok: true,
    issueKey,
    summary: data.fields?.summary || '',
    issueType: data.fields?.issuetype?.name || 'Unknown',
    labels: data.fields?.labels || [],
  };
});

export const handler = resolver.getDefinitions();

export const pingAction = async (payload) => {
  const issueKey = payload?.issueKey || 'NONE';
  return {
    ok: true,
    issueKey,
    message: 'Jira Standards Guard action is reachable.',
  };
};
