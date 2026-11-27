# Privacy Policy — Jira Standards Guard

**Effective Date:** November 27, 2026

## 1. Overview & Runs on Atlassian Architecture

Jira Standards Guard is built 100% on the Atlassian Forge platform (`nodejs24.x` runtime and `@forge/kvs` storage). The app has no external servers, external databases, analytics trackers, or third-party egress endpoints. All data processing and persistence remain entirely within Atlassian Cloud.

## 2. Data Accessed (Read-Only via `api.asUser()`)

Jira Standards Guard reads Atlassian data strictly within the invoking user's existing Atlassian Cloud permissions (`api.asUser()`) using the Forge scopes declared in `manifest.yml`:

- `read:jira-work` — Jira issue fields (issue key, summary, issue type, project key, status, assignee, priority, labels, Atlassian Document Format descriptions, issue links, and remote links) for deterministic standards evaluation.
- `read:jira-user` — Current user account ID and display name for recording human-approved exception attribution.
- `read:page:confluence` — Content and metadata of the Confluence page explicitly chosen by an administrator in the Confluence Sync configuration.
- `storage:app` — Tenant-scoped Atlassian Forge Key-Value Store (`@forge/kvs`) persistence.
- `read:graph:issue:jira`, `read:graph:page:confluence`, `read:graph:user:atlassian` — Atlassian Teamwork Graph queries (`/graphql/twg`) to retrieve connected `JiraWorkItem` nodes, linked `ConfluencePage` nodes, and issue hierarchy context.

## 3. Data Stored in Forge KVS (`@forge/kvs`)

Stored data is isolated per Atlassian Cloud site installation in Forge KVS across the following keys:

- `standards:v1`: Engineering standard rule definitions (built-in defaults, custom rules, and Confluence-synced rules).
- `confluenceSync:v1`: Synced Confluence page ID, page title, page URL, and sync timestamp.
- `exceptions:v1`: Human-approved exception and reusable precedent records, including issue key, rule ID/code, justification reason, approver account ID and display name, reusable matching pattern (`issueType`, `requiredLabel`), applied issue keys, and active/revoked status.
- `auditLog:v1`: Recent governance audit events (capped at the 100 most recent entries), storing timestamp, event type, actor display name, issue key, rule code, and summary detail.

## 4. How We Use Data

Accessed and stored data is used solely to provide app functionality:

- Deterministic evaluation of Jira issues against configured engineering standards.
- Synchronization of team standards from an administrator-selected Confluence page.
- Enrichment of issue compliance checks with Atlassian Teamwork Graph context.
- Human-gated exception approval, reusable precedent matching, and governance audit logging.
- Read-only governance lookups invoked by authorized users through Atlassian MCP (`rovo:mcp`) or the Rovo agent (`rovo:agent`).

## 5. Data Sharing & Third Parties

We do not sell, rent, disclose, or transmit customer data to external third parties. All computation and storage stay inside Atlassian Cloud infrastructure.

## 6. Data Retention, Control & Deletion

Site administrators can edit or delete custom/synced rules and revoke any exception or precedent at any time from the Jira Standards Guard Admin Console. Uninstalling the app from an Atlassian Cloud site immediately revokes app access and clears Forge app storage in accordance with Atlassian Forge's data lifecycle.

## 7. Changes to This Policy

Updates to this Privacy Policy will be published directly in this document with an updated effective date.

## 8. Contact

- **Developer:** Rizal Kurnia
- **Email:** `rizalkurnia.me@gmail.com`
- **Support & Privacy Requests:** `https://github.com/rizalkr/jira-standards-guard/issues`
