# Jira Standards Guard

Deterministic engineering standards verification, Confluence policy sync, and precedent-based governance for Jira, built on Atlassian Forge UI Kit (`render: native`) and `nodejs24.x` for Atlassian Codegeist 2026.

## Features

- **Deterministic Standards Engine (`STD-1`–`STD-6` + Custom Rules):**
  - `STD-1` — Clear Problem Description (`description_min_length`, min 40 chars, all issue types)
  - `STD-2` — Bug Reproduction Steps (`description_contains_any`, Bug)
  - `STD-3` — Acceptance Criteria Required (`description_contains_any`, Story/Task)
  - `STD-4` — Owner Assigned (`field_present: assignee`, all issue types)
  - `STD-5` — Priority Triaged (`field_present: priority`, warning, Bug/Story)
  - `STD-6` — Reference Doc, Test, or Linked Work (`has_link_or_url`, Bug/Story)
- **Confluence Engineering Standards Sync:** Imports structured or bullet-formatted standards directly from a Confluence page via `/wiki/api/v2/pages/{id}` with clickable source citations.
- **Human-Gated Exception Precedents:** Engineers or reviewers can approve exceptions with an explicit reason and optionally save them as reusable deterministic precedents in Forge KVS (`@forge/kvs`), so matching follow-up issues automatically pass as `EXEMPTED (PRECEDENT)` with citation back to the source issue.
- **Native Forge UI Kit Views:**
  - `jira:issuePanel` — Live verdict lozenge, rule-by-rule checklist with standard citations, exception approval modal, and precedent citation banner.
  - `jira:adminPage` — Governance Console with Standards Ruleset management, Confluence Sync configuration, and Exceptions & Precedents / Audit Log tables.
- **Rovo & MCP Integration Wiring:** `rovo:mcp`, `rovo:agent`, and shared `action` handlers wired in `manifest.yml` (`read:graph:*` scopes prepared for Teamwork Graph context enrichment).

## Project Structure

```text
jira-standards-guard/
├── manifest.yml                 # Forge modules, scopes, runtime, and Rovo metadata
├── package.json                 # Dependencies and Node test script
├── .nvmrc                       # Node.js 24 version pin
├── src/
│   ├── index.js                 # Backend resolvers, Confluence sync, and action handlers
│   ├── engine/
│   │   ├── defaults.js          # Built-in STD-1..STD-6 definitions
│   │   └── evaluator.js         # Pure deterministic ADF/rule evaluator & Confluence parser
│   ├── storage/
│   │   └── store.js             # Forge KVS persistence (standards, exceptions, precedents, audit log)
│   └── frontend/
│       ├── issue-panel.jsx      # Native UI Kit Jira Issue Panel
│       └── admin-page.jsx       # Native UI Kit Jira Admin Console
└── tests/
    └── evaluator.test.js        # Unit tests using node:test
```

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
