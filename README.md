# Jira Standards Guard

**Codify engineering standards once, enforce them deterministically in Jira, enrich context with Atlassian Teamwork Graph, and manage exceptions through human-gated reusable precedents.**

Built on **Atlassian Forge** (`nodejs24.x`, UI Kit `render: native`, `@forge/kvs`, Runs on Atlassian eligible) for **Atlassian Codegeist 2026 — Apps for Software Teams**.

---

## Why Jira Standards Guard?

Engineering teams document Definition of Done and bug-triage standards in Confluence, yet Jira issues routinely move forward with missing reproduction steps, no acceptance criteria, no owner, or no linked spec. Pure LLM checks can hallucinate pass/fail decisions, while rigid Jira workflow validators block legitimate exceptions (such as documentation-only fixes or emergency hotfixes) without learning from past approvals.

**Jira Standards Guard** solves this with an Atlassian-native governance loop:

1. **Deterministic Core Verification:** Every rule check is pure, deterministic, and reproducible — no LLM guesswork on compliance verdicts.
2. **Confluence Policy Sync:** Teams maintain standards in Confluence (`RULE:` or `[STD-...]` bullets) and sync them into Jira with clickable policy citations.
3. **Teamwork Graph Context Enrichment:** Uses `api.asUser().requestTeamworkGraph(...)` against `/graphql/twg` to hydrate the issue node, connected Confluence pages, and issue hierarchy, counting graph connections toward link requirements.
4. **Human-Gated Exception Precedents:** Reviewers approve blocking exceptions with an explicit reason and optional reusable pattern (`issueType` + `requiredLabel`) with a built-in blast-radius UX guardrail. Matching follow-up issues automatically evaluate as `EXEMPTED (PRECEDENT)` with full audit attribution back to the source issue.
5. **Atlassian MCP & Rovo Agent Ready:** Exposes 4 shared read-only governance actions via `rovo:mcp` and `rovo:agent` (`app.rovo.tag: stdguard`).

---

## Key Features

### 1. Deterministic Standards Engine (`STD-1`–`STD-6` + Custom & Synced Rules)
- **Built-in Default Rules (`projectKeys: ['*']`):**
  - `STD-1` — Clear Problem Description (`description_min_length`, min 40 chars, all issue types, blocking)
  - `STD-2` — Bug Reproduction Steps (`description_contains_any`, Bug, blocking)
  - `STD-3` — Acceptance Criteria Required (`description_contains_any`, Story/Task, blocking)
  - `STD-4` — Owner Assigned (`field_present: assignee`, all issue types, blocking)
  - `STD-5` — Priority Triaged (`field_present: priority`, Bug/Story, warning)
  - `STD-6` — Reference Doc, Test, or Linked Work (`has_link_or_url`, Bug/Story, blocking)
- **5 Check Types:** `description_min_length`, `description_contains_any`, `field_present`, `has_link_or_url`, and `label_present`.
- **Project Scoping (`projectKeys`):** Scope any rule to all projects (`*`) or specific Jira project keys (e.g. `KAN, PAY`), both in the Admin Console and via Confluence `PROJECT:` directives.
- **Edit Any Standard:** Enable/disable, edit built-in/custom/synced standards, or delete custom/synced rules from the Admin Console.

### 2. Confluence Engineering Standards Sync
- Imports rules directly from any accessible Confluence page via `/wiki/api/v2/pages/{id}?body-format=storage` (accepts numeric Page ID or full Confluence URL).
- Parses both structured `RULE:` directives (with optional `PROJECT:`) and natural `[STD-...]` / `Standard N:` bullet lists.
- Displays clickable **Open Confluence Standard** citations on every synced rule card in the Jira Issue Panel.

### 3. Atlassian Teamwork Graph Integration
- Queries Atlassian Teamwork Graph (`/graphql/twg`) via `api.asUser().requestTeamworkGraph(...)` using verified curated/object queries:
  - `objects(ids: [ID!]!)` (`StandardsGuard_GetObjects`) hydrating `JiraWorkItem` and `ConfluencePage` ARIs in a single batch (`ObjectResult.data` union)
  - `jiraWorkItemHierarchy(id: $id, kinds: [PARENT, CHILD, BLOCKS, BLOCKED_BY, LINKED], first: $first)` (`StandardsGuard_GetIssueHierarchy`)
  - `confluencePageLinkedConfluencePages(id: $id, first: $first)` (`StandardsGuard_GetLinkedConfluencePages`)
- Displays a **Teamwork Graph Context** card in the Issue Panel (`CONNECTED`, `UNAVAILABLE`, or `DEGRADED`), showing the hydrated `Graph Node`, connected Confluence pages, and related Jira issues.
- Counts Teamwork Graph connections toward `has_link_or_url` standards (`STD-6` / `CONF-3`) alongside Jira issue links, remote links, and description URLs.

### 4. Human-Gated Exception Precedents & Blast-Radius Guardrail
- **Single & Batch Approvals:** Approve one failing rule or use **Approve All Blocking (N)** to create independent, individually revocable exception records in Forge KVS (`@forge/kvs`).
- **Blast-Radius UX Guardrail:** **Save as reusable precedent** defaults to unchecked when an issue has no labels or during batch approvals; if checked with a blank `Required label`, a **Broad precedent scope** warning alerts the reviewer before creating a type-wide precedent.
- **Deduplicated Audit Trail:** Logs `EXCEPTION_APPROVED`, `PRECEDENT_APPLIED` (once per auto-exempted issue, zero duplicates on re-check), `PRECEDENT_REVOKED`, `RULE_UPDATED`, and `CONFLUENCE_SYNCED` (capped at 100 latest entries).

### 5. Atlassian MCP (`rovo:mcp`) & Rovo Agent (`rovo:agent`)
- Shared `action` modules wired to both `standards-guard-mcp` (`rovo:mcp`) and `standards-guard-agent` (`Standards Guard`, `app.rovo.tag: stdguard`):
  - `check-issue-standards` — Evaluate an issue key deterministically (`issueKey`)
  - `list-standards` — List enabled standards with optional `projectKey` / `issueType` filters
  - `list-precedents` — Inspect active or revoked human-approved precedents (`activeOnly`)
  - `get-issue-graph-context` — Retrieve Teamwork Graph context for an issue (`issueKey`)

---

## Project Structure

```text
jira-standards-guard/
├── manifest.yml                 # Forge modules, scopes, nodejs24.x runtime, Rovo/MCP config
├── package.json                 # Dependencies and node:test script
├── .nvmrc                       # Node.js 24 pin
├── src/
│   ├── index.js                 # Backend resolvers, Confluence sync, and 4 MCP/Rovo action handlers
│   ├── engine/
│   │   ├── defaults.js          # Built-in STD-1..STD-6 definitions & check labels
│   │   └── evaluator.js         # Pure deterministic ADF/rule evaluator & Confluence HTML parser
│   ├── graph/
│   │   └── teamworkGraph.js     # Curated Teamwork Graph client (/graphql/twg) with graceful fallback
│   ├── storage/
│   │   └── store.js             # Forge KVS persistence (standards, exceptions, sync metadata, audit log)
│   └── frontend/
│       ├── issue-panel.jsx      # Native UI Kit Jira Issue Panel (verdict, approvals, TWG card)
│       └── admin-page.jsx       # Native UI Kit Jira Admin Console (3 tabs + audit log)
└── tests/
    └── evaluator.test.js        # Unit tests using node:test
```

---

## Judge Setup & 5-Minute Evaluation Guide

### 1. Install via Forge Installation Link (ShareLink)
- **Installation Link:** `[INSERT PRODUCTION SHARELINK FROM DEVELOPER CONSOLE]`
- Install the app onto **both Jira and Confluence** on your evaluation Atlassian Cloud site so issue evaluation and Confluence policy sync work end-to-end.

### 2. Optional: Create & Sync an Engineering Standards Confluence Page
Create a Confluence page (e.g., **Engineering Standards**) containing rules like:

```text
* RULE: Security Review Notes | TYPE: Story, Task | CHECK: description_contains_any | VALUE: security, threat model | SEVERITY: blocking
* RULE: Release Ticket Linked | TYPE: Bug | PROJECT: KAN | CHECK: has_link_or_url | VALUE: | SEVERITY: blocking
* [STD-DOC] Design Doc Reference: Include a linked spec or Confluence URL for Story work.
```

Then open **Jira Settings -> Apps -> Jira Standards Guard** (Admin Console), go to the **Confluence Sync** tab, paste the page URL or numeric Page ID, and click **Sync from Confluence**.

### 3. Walkthrough in Jira (5 Minutes)
1. **Blocked Issue (`BLOCKED`):** Create an incomplete Bug (short description, no assignee, no links). Open the **Jira Standards Guard** panel on the right — it displays `BLOCKED` with per-rule citations and **Approve All Blocking (N)**.
2. **Compliant Issue + Teamwork Graph (`READY FOR DONE` + `CONNECTED`):** Create or open a Bug with reproduction steps (>= 40 chars), an assignee, and a Confluence page URL in the description. Click **Re-check** — the **Teamwork Graph Context** card shows `CONNECTED`, `Graph Node: <KEY>`, and the linked Confluence page, which also satisfies `has_link_or_url`.
3. **Human-Gated Precedent Approval:** On a labeled Bug (e.g., label `docs-only`) that fails reproduction/link checks, click **Approve Exception**, enter a reason, keep **Save as reusable precedent** checked with `Required label: docs-only`, and submit.
4. **Automatic Precedent Reuse (`EXEMPTED (PRECEDENT)`):** Create a second Bug with label `docs-only` and >= 40-char description. Open Jira Standards Guard — it automatically evaluates as `EXEMPTED (PRECEDENT)` citing the first issue, and records `PRECEDENT_APPLIED` once in the Admin Console **Recent Governance Audit Log**.
5. **Inspect Admin Console:** Review **Standards Ruleset** (toggle/edit/create rules, `Projects` column), **Confluence Sync**, and **Exceptions & Precedents** (active precedents, applied issue history, instant **Revoke**).
6. **Enable MCP Tools / Rovo Agent:** In `admin.atlassian.com` -> **Apps -> Connected apps -> Jira Standards Guard -> Tools**, click **Enable tools** to expose the 4 `rovo:mcp` tools to MCP-compatible clients (`https://mcp.atlassian.com/v2/mcp`) or invoke **Standards Guard** (`@stdguard`) in Rovo Chat on sites with Rovo enabled.

---

## Forge Manifest Summary

- **UI Kit Modules (`render: native`):** `jira:issuePanel`, `jira:adminPage`
- **AI & Graph Modules:** `rovo:mcp`, `rovo:agent`, `action` (`check-issue-standards`, `list-standards`, `list-precedents`, `get-issue-graph-context`)
- **Scopes:** `read:jira-work`, `read:jira-user`, `read:page:confluence`, `storage:app`, `read:graph:issue:jira`, `read:graph:page:confluence`, `read:graph:user:atlassian`
- **Runtime:** `nodejs24.x`, `256 MB`, `arm64` (Runs on Atlassian eligible)

---

## Local Development

### Prerequisites
- **Node.js 24** (`.nvmrc` pins `24`)
- **Atlassian Forge CLI** (`@forge/cli`) authenticated with your Atlassian developer account

### Commands

```bash
nvm use
npm install
npm test
forge lint
forge deploy -e development
forge install -e development
```
