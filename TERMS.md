# Terms of Service — Jira Standards Guard

**Effective Date:** November 27, 2026

## 1. Acceptance of Terms

By installing, accessing, or using **Jira Standards Guard** (the "App"), you agree to be bound by these Terms of Service ("Terms"). If you are installing or using the App on behalf of an organization, you represent that you have the authority to bind that organization to these Terms.

## 2. Service Description & Atlassian Forge Platform

Jira Standards Guard is a serverless Atlassian Forge application (`nodejs24.x`, Runs on Atlassian) that evaluates Jira issues against configured engineering standards, synchronizes policies from Confluence, enriches issue context via Atlassian Teamwork Graph, and tracks human-approved exception precedents.

Use of the App requires an active Atlassian Cloud site (Jira and, optionally, Confluence) and remains subject to Atlassian's applicable Cloud Terms of Service and Forge platform policies.

## 3. Customer Responsibilities & Governance Usage

Site administrators and authorized users are responsible for configuring standards, selecting Confluence policy pages to synchronize, and reviewing or revoking human-approved exceptions and reusable precedents.

The App executes deterministic checks based on rules configured by your team and surfaces read-only governance information via UI Kit panels, `rovo:mcp`, and `rovo:agent`. It is an operational governance aid and does not replace organizational security, compliance, or legal review.

## 4. Data & Privacy

All App computation and persistence occur within Atlassian Cloud using Forge Key-Value Store (`@forge/kvs`), scoped to your site installation. For complete details on what data is accessed and stored, see our [Privacy Policy](https://github.com/rizalkr/jira-standards-guard/blob/main/PRIVACY.md).

## 5. Intellectual Property & Open Source

The App source code is maintained in the public repository at `https://github.com/rizalkr/jira-standards-guard`. Atlassian, Jira, Confluence, Forge, Rovo, and Teamwork Graph are trademarks of Atlassian Pty Ltd.

## 6. Disclaimer of Warranties

The App is provided on an **"AS IS"** and **"AS AVAILABLE"** basis without warranties of any kind, whether express, implied, or statutory, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement.

## 7. Limitation of Liability

To the maximum extent permitted by applicable law, the developer shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or workflow availability arising out of or related to your use of the App.

## 8. Termination & Uninstallation

You may stop using the App at any time by uninstalling it from your Atlassian Cloud site administration settings. Uninstalling the App revokes its permissions and removes access to tenant-scoped Forge storage in accordance with Atlassian Forge's data lifecycle.

## 9. Changes to These Terms

We may update these Terms from time to time by publishing the revised version in this repository with an updated effective date.

## 10. Contact

- **Developer:** Rizal Kurnia
- **Email:** `rizalkurnia.me@gmail.com`
- **Support & Issues:** `https://github.com/rizalkr/jira-standards-guard/issues`
