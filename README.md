# Automated MFE E2E Report Aggregator

## Overview

The **Automated MFE E2E Report Aggregator** is a centralized GitHub Actions-based reporting solution that collects Cypress/Mochawesome test reports from multiple Micro Frontend (MFE) repositories and produces a single consolidated test report.

The solution automatically combines the latest available E2E test results from all configured MFE projects and generates:

- Consolidated Mochawesome JSON
- Consolidated Mochawesome HTML report
- Consolidated Excel report
- Consolidated PDF report
- Microsoft Teams notification
- A single downloadable GitHub Actions artifact containing the final reports and source reports

The system is designed to be triggered automatically when an MFE completes its E2E testing after a merge/push to the `master` branch.

---

# Table of Contents

1. [Purpose](#purpose)
2. [Key Features](#key-features)
3. [Architecture](#architecture)
4. [End-to-End Workflow](#end-to-end-workflow)
5. [Repository Structure](#repository-structure)
6. [Supported MFE Projects](#supported-mfe-projects)
7. [Trigger Mechanism](#trigger-mechanism)
8. [Triggering MFE vs Other MFEs](#triggering-mfe-vs-other-mfes)
9. [Source Report Architecture](#source-report-architecture)
10. [Consolidated JSON](#consolidated-json)
11. [HTML Report](#html-report)
12. [Excel Report](#excel-report)
13. [PDF Report](#pdf-report)
14. [Microsoft Teams Notification](#microsoft-teams-notification)
15. [GitHub Actions Workflow](#github-actions-workflow)
16. [Scripts](#scripts)
17. [Required Secrets](#required-secrets)
18. [Permissions](#permissions)
19. [MFE Repository Integration](#mfe-repository-integration)
20. [Artifact Naming Convention](#artifact-naming-convention)
21. [Adding a New MFE](#adding-a-new-mfe)
22. [Manual Testing](#manual-testing)
23. [Generated Output](#generated-output)
24. [Failure Handling](#failure-handling)
25. [Troubleshooting](#troubleshooting)
26. [Maintenance](#maintenance)
27. [Technology Stack](#technology-stack)
28. [Complete Process Summary](#complete-process-summary)

---

# Purpose

Each MFE repository maintains its own Cypress E2E test suite and generates its own Mochawesome report.

For example:

```text
Q4US/dashboard
Q4US/user-management
Q4US/ask-ai
Q4US/profile
Q4US/react-tree
Q4US/error-reports
Q4US/audit
```

Without a centralized solution, test results are distributed across multiple repositories.

The purpose of this project is to provide one centralized location where the latest E2E results from all MFEs can be:

1. Collected
2. Validated
3. Consolidated
4. Grouped by project
5. Converted into multiple reporting formats
6. Distributed to the QA/team through Microsoft Teams

---

# Key Features

## 1. Automatic consolidation

The aggregator can be triggered through GitHub `repository_dispatch`.

When an MFE finishes its E2E workflow after a merge/push to `master`, it can trigger this repository automatically.

## 2. Exact report from triggering MFE

The MFE that triggered the aggregation is handled differently from the other MFEs.

The aggregator receives:

- Repository
- Run ID
- Run number
- Branch
- Commit SHA

The exact Mochawesome artifact from that run is downloaded.

This prevents the aggregator from accidentally using an older or newer run from the triggering repository.

## 3. Latest available reports from other MFEs

For all other configured MFEs, the aggregator:

1. Finds recent successful `QA E2E Tests` runs on `master`.
2. Checks whether the run still has a valid Mochawesome artifact.
3. Searches up to the most recent 10 successful runs.
4. Selects the newest run with a non-expired Mochawesome artifact.
5. Downloads the report.

## 4. Project-grouped consolidation

Instead of mixing all test suites together, the consolidated Mochawesome JSON contains one result per MFE.

Example:

```text
Dashboard
 ├── Suite 1
 ├── Suite 2
 └── Suite 3

Ask AI
 ├── Suite 1
 ├── Suite 2
 └── Suite 3

User Management
 ├── Suite 1
 └── Suite 2
```

This keeps each MFE logically separated.

## 5. Asset preservation

The original report assets are retained, including:

- Screenshots
- Videos
- `index.json`

Asset paths are rewritten by the consolidation script so the consolidated HTML report can still locate the original screenshots and videos.

## 6. Multiple output formats

The aggregator generates:

```text
JSON
HTML
Excel
PDF
Teams notification
```

This allows both technical and management-oriented consumption of the results.

---

# Architecture

```text
                    MFE Repository
                         |
                 QA E2E Tests
                         |
                         v
              Mochawesome Artifact
                         |
                         v
                  repository_dispatch
                         |
                         v
        +--------------------------------+
        |  Automation Report Aggregator  |
        +--------------------------------+
                         |
          +--------------+--------------+
          |                             |
          v                             v
Triggering MFE                  Other MFEs
Exact Run ID                    Latest successful
Exact Artifact                  artifact with report
          |                             |
          +--------------+--------------+
                         |
                         v
              Source Reports
                         |
                         v
        consolidate-mochawesome.js
                         |
                         v
             consolidated.json
                         |
        +----------------+----------------+
        |                |                |
        v                v                v
      HTML             Excel             PDF
        |                |                |
        +----------------+----------------+
                         |
                         v
                Teams Adaptive Card
                         |
                         v
                 GitHub Artifact
```

---

# End-to-End Workflow

```text
1. MFE is merged/pushed to master
        |
        v
2. MFE QA E2E workflow executes
        |
        v
3. Cypress tests execute
        |
        v
4. Mochawesome report is generated
        |
        v
5. Mochawesome artifact is uploaded
        |
        v
6. MFE triggers automation-report-aggregator
        |
        v
7. Aggregator receives repository + run information
        |
        v
8. Exact report from triggering MFE is downloaded
        |
        v
9. Latest available successful reports from other MFEs
   are downloaded
        |
        v
10. Source reports are validated
        |
        v
11. Project-grouped consolidated.json is generated
        |
        +--------------------+
        |                    |
        v                    v
12. HTML              13. PDF
        |
        v
14. Excel
        |
        v
15. Teams Adaptive Card
        |
        v
16. Final reports uploaded as GitHub artifact
```

---

# Repository Structure

```text
automation-report-aggregator/
│
├── .github/
│   │
│   ├── scripts/
│   │   ├── consolidate-mochawesome.js
│   │   ├── generate-consolidated-excel.js
│   │   ├── generate-consolidated-pdf.js
│   │   ├── generate-teams-card.js
│   │   │
│   │   └── template/
│   │       └── consolidated-template.xlsm
│   │
│   └── workflows/
│       └── consolidate.yml
│
└── README.md
```

---

# Supported MFE Projects

The current workflow is configured with:

```yaml
ALL_MFE_REPOSITORIES: |
  Q4US/dashboard
  Q4US/user-management
  Q4US/ask-ai
  Q4US/profile
  Q4US/react-tree
  Q4US/error-reports
  Q4US/audit
```

These repositories are currently included in the consolidated report.

The repository names are also used as project identifiers when preparing source reports.

---

# Trigger Mechanism

The aggregator workflow supports two trigger mechanisms.

## Automatic trigger

The workflow listens for:

```yaml
on:
  repository_dispatch:
    types:
      - consolidate-report
```

An MFE sends a `repository_dispatch` event after its E2E report has been successfully generated.

## Manual trigger

The workflow also supports:

```yaml
workflow_dispatch:
```

This allows the workflow to be manually executed from:

```text
GitHub
  -> Actions
  -> Consolidate E2E Reports
  -> Run workflow
```

This is useful for testing and troubleshooting.

---

# Trigger Payload

The MFE sends:

```text
repository
run_id
run_number
branch
sha
```

Example:

```json
{
  "repository": "Q4US/dashboard",
  "run_id": "123456789",
  "run_number": "77",
  "branch": "master",
  "sha": "abcdef123456"
}
```

This information allows the aggregator to identify the exact E2E run that triggered the consolidation.

---

# Triggering MFE vs Other MFEs

This is one of the most important parts of the architecture.

## Triggering MFE

Suppose:

```text
Q4US/dashboard
```

is merged to `master`.

Dashboard triggers the aggregator.

The aggregator uses:

```text
repository = Q4US/dashboard
run_id = exact Dashboard E2E run
run_number = exact Dashboard run
```

Therefore:

```text
Dashboard
    |
    +--> exact triggering run
```

## Other MFEs

For the other repositories:

```text
Q4US/user-management
Q4US/ask-ai
Q4US/profile
Q4US/react-tree
Q4US/error-reports
Q4US/audit
```

the aggregator searches successful E2E runs on `master`.

It checks up to the latest 10 successful runs.

For every run it checks whether an available Mochawesome artifact exists.

It selects the newest run that has a valid:

```text
mochawesome-report-<run-number>
```

artifact.

This prevents failures when an artifact has expired.

---

# Source Report Architecture

All downloaded reports are organized under:

```text
consolidated-report/
└── source-reports/
    ├── dashboard/
    │   └── <timestamp>/
    │       ├── index.json
    │       ├── screenshots/
    │       └── videos/
    │
    ├── ask-ai/
    │   └── <timestamp>/
    │       ├── index.json
    │       ├── screenshots/
    │       └── videos/
    │
    ├── user-management/
    │   └── <timestamp>/
    │       ├── index.json
    │       ├── screenshots/
    │       └── videos/
    │
    └── ...
```

This structure is intentionally project-based.

Each MFE keeps its own report assets.

---

# Why Source Reports Are Preserved

The original report directories are retained because the consolidated HTML report may reference:

```text
screenshots
videos
```

The original assets therefore need to remain available alongside the consolidated report.

This also makes the final GitHub artifact useful for investigating individual test failures.

---

# Consolidated JSON

The main consolidated JSON is:

```text
consolidated-report/consolidated.json
```

It contains:

```text
stats
results
meta
```

The `results` array contains one result per MFE.

Example logical structure:

```json
{
  "stats": {
    "tests": 221,
    "passes": 218,
    "failures": 0,
    "pending": 3
  },
  "results": [
    {
      "title": "Dashboard",
      "suites": []
    },
    {
      "title": "Ask Ai",
      "suites": []
    },
    {
      "title": "User Management",
      "suites": []
    }
  ]
}
```

The actual suite and test data is retained from the source Mochawesome reports.

---

# Mochawesome Compatibility

The consolidation script normalizes Mochawesome structures before producing the final JSON.

This is important because `marge` expects specific fields.

For example, suites are normalized with fields such as:

```text
uuid
title
fullFile
file
beforeHooks
afterHooks
tests
suites
root
_timeout
passes
failures
pending
skipped
```

The script also ensures tests have UUIDs.

This prevents errors such as:

```text
Invalid value undefined supplied to /results/...
```

when generating the final HTML report.

---

# Asset Path Rewriting

The consolidation script rewrites paths for:

```text
screenshots
videos
video
videoPath
screenshot
```

For example, an asset can be transformed into a path similar to:

```text
source-reports/dashboard/<timestamp>/screenshots/...
```

This allows the generated consolidated HTML report to reference the original project assets.

---

# HTML Report

The HTML report is generated using:

```text
mochawesome-report-generator
```

The workflow executes:

```bash
npx marge \
  consolidated-report/consolidated.json \
  --reportDir consolidated-report/html \
  --reportFilename index.html
```

The resulting report is:

```text
consolidated-report/html/index.html
```

The HTML report provides a Mochawesome-style interactive report containing the consolidated E2E results.

Because the source screenshots and videos are retained, the report can also provide access to the associated evidence.

---

# Excel Report

The Excel report is generated by:

```text
.github/scripts/generate-consolidated-excel.js
```

using:

```text
.github/scripts/template/consolidated-template.xlsm
```

The Excel generator uses `xlsx-populate`.

---

# Excel Template

The template is:

```text
.github/scripts/template/consolidated-template.xlsm
```

The workbook contains the configured reporting sheets, including:

```text
Test_Execution_Summary
Configurations
```

The template is used as the base workbook so that formatting and report presentation remain consistent.

---

# Excel Configuration Mapping

The `Configurations` sheet is used to map the configured modules/suites to the test results.

The script reads the configuration structure from the template and writes the calculated:

```text
Passed
Failed
Not Executed
```

values into the appropriate cells.

This allows the existing Excel template layout to remain independent from the test execution logic.

---

# Excel Project Results

The Excel generation script processes project-level information from the consolidated JSON.

Project identification is dynamically obtained from the consolidated results.

Therefore the Excel generator does not need a separate hard-coded list of MFE names for normal project processing.

---

# Excel Suite Processing

The Excel generator recursively processes suites and child suites.

Wrapper/grouping suites are handled so that duplicate parent/child rows are avoided.

The final configuration output represents the meaningful test-bearing suites rather than simply duplicating every Mochawesome hierarchy level.

---

# Excel Output

The final Excel file is generated under:

```text
consolidated-report/final/
```

The workflow executes:

```bash
node .github/scripts/generate-consolidated-excel.js \
  consolidated-report/consolidated.json \
  .github/scripts/template/consolidated-template.xlsm \
  consolidated-report/final
```

---

# PDF Report

The PDF report is generated using:

```text
Puppeteer
```

and the script:

```text
.github/scripts/generate-consolidated-pdf.js
```

The script reads:

```text
consolidated-report/consolidated.json
```

and generates a formatted HTML document which is rendered to PDF using Chromium/Puppeteer.

---

# PDF Report Content

The PDF contains consolidated project-level results.

It includes information such as:

```text
Project
Module
Suite
Passed
Failed
Pending
Skipped
```

and detailed information for tests that are:

```text
Failed
Pending
Skipped
```

The report also extracts test case IDs when they follow the expected `TC_...` naming pattern.

---

# Test Case ID Extraction

The PDF generator attempts to extract test case IDs using the pattern:

```text
TC_...
```

For example:

```text
TC_DASHBOARD_001
```

The ID and description can then be displayed separately in the report.

If a test does not contain a recognizable test case ID, the full test title is retained as the description.

---

# Microsoft Teams Notification

The Teams notification is generated by:

```text
.github/scripts/generate-teams-card.js
```

The script creates a Microsoft Teams Adaptive Card payload.

The generated file is:

```text
teams-card.json
```

---

# Teams Notification Contents

The Teams card contains:

```text
Consolidated E2E Test Report

Projects
Total Tests
Passed
Failed
Not Executed
Pass Rate
```

It then provides a project-level table.

The project table contains:

```text
Project
Tests
Pass
Fail
N/E
Pass %
```

Example:

```text
Project              Tests   Pass   Fail   N/E   Pass %
---------------------------------------------------------
Ask Ai                  51     51      0     0    100.0%
Audit                   32     32      0     0    100.0%
Dashboard               28     28      0     0    100.0%
Error Reports           24     24      0     0    100.0%
Profile                 13     13      0     0    100.0%
React Tree              25     22      0     3     88.0%
User Management         48     48      0     0    100.0%
```

The project rows use Adaptive Card `ColumnSet` structures so that the values remain aligned.

---

# Teams Notification Link

The Teams card receives the GitHub Actions run URL through:

```text
REPORT_RUN_URL
```

The card contains a link to the GitHub Actions run.

From that run, users can access the final consolidated artifact.

---

# Overall Status

The Teams card does not display a separate:

```text
Overall Status: PASSED
Overall Status: PASSED WITH WARNINGS
```

Instead, the overall result is communicated through the numerical summary and per-project results.

---

# GitHub Actions Workflow

The main workflow is:

```text
.github/workflows/consolidate.yml
```

Workflow name:

```text
Consolidate E2E Reports
```

---

# Workflow Triggers

The workflow supports:

```yaml
on:
  repository_dispatch:
    types:
      - consolidate-report

  workflow_dispatch:
```

## `repository_dispatch`

Used for automatic execution from an MFE.

## `workflow_dispatch`

Used for manual execution/testing.

---

# Workflow Steps

The workflow performs the following major operations.

## 1. Checkout aggregator repository

```yaml
actions/checkout@v4
```

This downloads the reporting scripts and Excel template.

## 2. Display trigger information

The workflow logs:

```text
Trigger Repository
Trigger Run ID
Trigger Run Number
Trigger Branch
Trigger Commit
```

This is useful for debugging and traceability.

## 3. Setup Node

The workflow uses:

```text
Node.js 22
```

## 4. Initialize Node project

The workflow creates a temporary package configuration:

```bash
npm init -y
```

## 5. Install reporting dependencies

The workflow installs:

```text
puppeteer
xlsx-populate
mochawesome-merge
mochawesome-report-generator
```

These dependencies are required to generate the final reports.

---

# Directory Preparation

Before collecting reports, the workflow clears old working directories:

```bash
rm -rf reports
rm -rf consolidated-report
```

and creates:

```text
reports/
consolidated-report/source-reports/
```

This ensures that a previous workflow execution cannot contaminate the current report.

---

# Triggering Repository Download

The triggering MFE's exact artifact is downloaded using:

```text
run_id
run_number
repository
```

The artifact naming convention is:

```text
mochawesome-report-<run-number>
```

The downloaded files are initially placed under:

```text
reports/<mfe-name>/
```

and then copied to:

```text
consolidated-report/source-reports/<mfe-name>/
```

---

# Other MFE Report Selection

For other MFEs, the workflow executes:

```bash
gh run list
```

with:

```text
workflow = QA E2E Tests
branch = master
status = success
limit = 10
```

The workflow then checks each candidate run for an available Mochawesome artifact.

An artifact is considered usable when it is not expired and its name starts with:

```text
mochawesome-report-
```

---

# Why the Workflow Checks Multiple Runs

GitHub Actions artifacts can expire.

Therefore, simply selecting the latest successful run is not sufficient.

Example:

```text
Run 150
  SUCCESS
  Artifact expired

Run 149
  SUCCESS
  Artifact available

Run 148
  SUCCESS
  Artifact available
```

The aggregator selects:

```text
Run 149
```

rather than failing because Run 150's artifact is unavailable.

---

# Source Report Validation

Before creating the consolidated report, the workflow validates:

1. Expected number of projects
2. Downloaded project count
3. Presence of `index.json`
4. Source report structure

If a required project report is missing, the workflow stops rather than producing an incomplete consolidated report.

---

# Consolidated JSON Generation

The workflow executes:

```bash
node .github/scripts/consolidate-mochawesome.js
```

This produces:

```text
consolidated-report/consolidated.json
```

The script:

1. Discovers project directories
2. Finds `index.json`
3. Reads each Mochawesome report
4. Rewrites asset paths
5. Normalizes suites
6. Creates one Mochawesome result per project
7. Aggregates statistics
8. Writes the final JSON

---

# Consolidated JSON Verification

The workflow validates:

```text
Suites
Tests
Registered
Passed
Failed
Pending
Skipped
Pass %
Results
```

It also ensures that:

```text
results.length > 0
```

---

# Asset Validation

The workflow counts:

```text
Screenshots
Videos
```

under the project source directories.

This helps verify that evidence files were downloaded correctly.

---

# Final Report Generation

The workflow generates the three main report formats:

```text
HTML
PDF
Excel
```

in sequence.

---

# Final Report Structure

```text
consolidated-report/
│
├── source-reports/
│   │
│   ├── dashboard/
│   │   ├── <timestamp>/
│   │   │   ├── index.json
│   │   │   ├── screenshots/
│   │   │   └── videos/
│   │
│   ├── ask-ai/
│   ├── user-management/
│   ├── profile/
│   ├── react-tree/
│   ├── error-reports/
│   └── audit/
│
├── consolidated.json
│
├── html/
│   ├── index.html
│   └── assets/
│
└── final/
    ├── consolidated Excel report
    └── consolidated PDF report
```

Additionally:

```text
teams-card.json
```

is created at the repository workspace level.

---

# Final GitHub Artifact

The workflow uploads:

```text
consolidated-final-reports
```

The artifact contains:

```text
consolidated-report/
teams-card.json
```

Therefore a user can download one artifact and access:

- Consolidated JSON
- Source reports
- Screenshots
- Videos
- HTML report
- Excel report
- PDF report
- Teams card payload

---

# Required Secrets

The aggregator workflow requires the following GitHub secrets.

## `REPORT_READER_TOKEN`

Used to access reports/artifacts from the MFE repositories.

The token needs sufficient permission to:

- Read repositories as required
- Read workflow runs
- Read GitHub Actions artifacts

## `TEAMS_WEBHOOK_URL`

The Microsoft Teams incoming webhook URL used to send the generated Adaptive Card.

The workflow sends:

```text
teams-card.json
```

to this URL.

---

# MFE Repository Integration Secret

Each MFE that triggers the aggregator requires:

```text
AGGREGATOR_TOKEN
```

This token is used by the MFE workflow to call:

```text
/repos/Q4US/automation-report-aggregator/dispatches
```

---

# Permissions

The MFE E2E workflow requires sufficient GitHub permissions to:

- Execute the E2E workflow
- Upload Mochawesome artifacts
- Call the aggregator repository dispatch endpoint

The aggregator requires permissions to:

- Read MFE workflow runs
- Read MFE artifacts
- Generate and upload artifacts in the aggregator repository

---

# MFE Repository Integration

Each MFE's E2E workflow should upload its Mochawesome report using the standard naming convention:

```yaml
- name: Upload Mochawesome Report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: mochawesome-report-${{ github.run_number }}
    path: |
      e2e/cypress/reports
```

The artifact name is important because the aggregator expects:

```text
mochawesome-report-<run-number>
```

---

# Triggering the Aggregator from an MFE

After the MFE's final report is successfully created/uploaded, the MFE workflow should execute:

```yaml
- name: Trigger Consolidated Report
  if: >
    github.event_name == 'push' &&
    github.ref == 'refs/heads/master' &&
    steps.create-test-summary-report.conclusion == 'success'
  env:
    GH_TOKEN: ${{ secrets.AGGREGATOR_TOKEN }}
  run: |
    gh api \
      --method POST \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      /repos/Q4US/automation-report-aggregator/dispatches \
      -f event_type=consolidate-report \
      -f client_payload[repository]="${{ github.repository }}" \
      -f client_payload[run_id]="${{ github.run_id }}" \
      -f client_payload[run_number]="${{ github.run_number }}" \
      -f client_payload[branch]="${{ github.ref_name }}" \
      -f client_payload[sha]="${{ github.sha }}"
```

---

# When Consolidation Runs

The recommended production behavior is:

```text
MFE push/merge to master
        |
        v
QA E2E workflow
        |
        v
Test report successfully generated
        |
        v
Trigger aggregator
```

The consolidation workflow is therefore event-driven and does not require a scheduled Friday execution.

---

# Artifact Naming Convention

The MFE E2E workflow uses:

```text
mochawesome-report-${{ github.run_number }}
```

Examples:

```text
mochawesome-report-77
mochawesome-report-150
mochawesome-report-187
```

The aggregator uses the artifact name when downloading the triggering MFE report.

For other MFEs, the workflow discovers the artifact name through the GitHub Actions API.

---

# Adding a New MFE

When a new MFE is officially added to the system, the aggregator workflow currently requires the repository to be added to:

```yaml
ALL_MFE_REPOSITORIES
```

Example:

```yaml
ALL_MFE_REPOSITORIES: |
  Q4US/dashboard
  Q4US/user-management
  Q4US/ask-ai
  Q4US/profile
  Q4US/react-tree
  Q4US/error-reports
  Q4US/audit
  Q4US/new-mfe
```

The new MFE must also:

1. Generate a Mochawesome report.
2. Upload `mochawesome-report-<run-number>`.
3. Trigger the aggregator after its successful `master` execution.
4. Provide the required token/permissions.

---

# Dynamic Project Handling

The JavaScript reporting scripts are designed to process project directories dynamically.

For example, the consolidation script discovers directories under:

```text
consolidated-report/source-reports/
```

rather than requiring every project to be manually coded into the consolidation logic.

The workflow's repository list is currently the source of truth for which MFE repositories are collected.

---

# Important Difference: Workflow List vs Script Logic

There are two separate concepts.

## Workflow

The workflow decides:

```text
Which repositories should be downloaded?
```

This is controlled by:

```yaml
ALL_MFE_REPOSITORIES
```

## Consolidation script

The consolidation script decides:

```text
How should downloaded projects be consolidated?
```

The script discovers project directories dynamically.

Therefore, adding an MFE currently requires updating the workflow repository list, but does not require adding a new project-specific processing block to the consolidation JavaScript.

---

# Manual Testing

The aggregator can be manually tested through:

```text
GitHub
→ Actions
→ Consolidate E2E Reports
→ Run workflow
```

For the most accurate end-to-end validation, trigger the aggregator from an actual MFE workflow because the automatic flow provides the exact triggering run information.

---

# Recommended Production Test

To validate the complete production flow:

1. Merge one MFE to `master`.
2. Wait for its QA E2E workflow.
3. Confirm Mochawesome artifact upload.
4. Confirm the MFE triggers the aggregator.
5. Open the aggregator workflow.
6. Confirm the triggering repository and run ID.
7. Confirm the exact triggering artifact is downloaded.
8. Confirm reports from the other MFEs are found.
9. Confirm source reports are validated.
10. Confirm `consolidated.json` is generated.
11. Confirm HTML generation succeeds.
12. Confirm PDF generation succeeds.
13. Confirm Excel generation succeeds.
14. Confirm Teams card generation succeeds.
15. Confirm Teams notification is received.
16. Download `consolidated-final-reports`.
17. Verify all generated reports.

---

# Failure Handling

The workflow intentionally fails when required source reports cannot be obtained.

Examples include:

```text
No trigger repository
No trigger run ID
No trigger run number
No successful QA E2E run
No available Mochawesome artifact
No index.json
Missing project report
Missing consolidated.json
No consolidated results
Invalid report structure
```

This prevents the system from silently generating an incomplete consolidated report.

---

# Artifact Expiration Handling

Other MFE reports are not simply selected based on the latest successful run.

The aggregator checks artifact metadata:

```text
expired == false
```

If the latest run's artifact is expired, it checks the next successful run.

This makes the system more reliable when GitHub Actions artifacts have reached their retention period.

---

# Troubleshooting

## `No valid artifacts found to download`

Possible causes:

- Artifact has expired.
- Artifact name does not follow the expected naming convention.
- The selected run did not upload a Mochawesome artifact.
- The workflow is searching the wrong repository.
- Token does not have access to the artifact.

The aggregator mitigates this for other MFEs by checking up to the latest 10 successful runs.

---

## `No index.json found`

Check the MFE artifact structure.

The artifact should contain:

```text
index.json
```

somewhere under the downloaded report directory.

For example:

```text
mochawesome-report-77/
└── 2026-08-19T08-10-27-432Z/
    └── index.json
```

---

## HTML generation errors

If `marge` reports errors such as:

```text
Invalid value undefined supplied to /results/...
```

check the generated:

```text
consolidated-report/consolidated.json
```

The consolidation script normalizes fields such as:

```text
root
_timeout
passes
failures
pending
skipped
uuid
```

to satisfy Mochawesome/marge expectations.

---

## Teams notification not received

Check:

1. `TEAMS_WEBHOOK_URL`
2. Teams HTTP status
3. `teams-card.json`
4. Adaptive Card validation
5. GitHub Actions logs

A successful webhook request should return an HTTP status in the `2xx` range.

---

## Teams card too large

The Teams notification contains project-level results.

It does not embed screenshots, videos, or the entire consolidated JSON.

The detailed reports remain available in the GitHub artifact.

---

## Excel generation failure

Check:

```text
.github/scripts/template/consolidated-template.xlsm
```

Ensure the expected worksheets still exist:

```text
Test_Execution_Summary
Configurations
```

Do not arbitrarily rename the worksheets or remove required cells used by the script.

---

## Excel configuration results missing

The `Configurations` sheet is driven by the configuration mapping in the Excel template.

If the sheet layout changes, review:

```text
generate-consolidated-excel.js
```

especially the functions responsible for reading headers/configuration data and writing configuration results.

---

# Maintenance

## Updating MFE repositories

Update:

```yaml
ALL_MFE_REPOSITORIES
```

in:

```text
.github/workflows/consolidate.yml
```

## Updating Excel formatting

Modify:

```text
.github/scripts/template/consolidated-template.xlsm
```

rather than hard-coding formatting in JavaScript whenever possible.

## Updating Excel logic

Modify:

```text
.github/scripts/generate-consolidated-excel.js
```

## Updating PDF formatting

Modify:

```text
.github/scripts/generate-consolidated-pdf.js
```

## Updating Teams notification layout

Modify:

```text
.github/scripts/generate-teams-card.js
```

The Teams card uses Adaptive Cards.

## Updating consolidation logic

Modify:

```text
.github/scripts/consolidate-mochawesome.js
```

---

# Technology Stack

| Technology | Purpose |
|---|---|
| GitHub Actions | CI/CD and workflow orchestration |
| GitHub `repository_dispatch` | Event-based aggregator triggering |
| GitHub Actions Artifacts | Report storage and transfer |
| Node.js | Report-processing scripts |
| JavaScript | Consolidation/report generation |
| Mochawesome | Cypress test reporting |
| Mochawesome Report Generator (`marge`) | HTML report generation |
| Puppeteer | PDF generation |
| XlsxPopulate | Excel report generation |
| Excel XLSM template | Excel report formatting |
| Microsoft Teams Adaptive Cards | Team notification |
| GitHub CLI (`gh`) | Run and artifact retrieval |
| GitHub API | Artifact/run discovery |

---

# Main Scripts

## `consolidate-mochawesome.js`

Purpose:

```text
Source Mochawesome reports
        ↓
Project-grouped consolidated JSON
```

Responsibilities:

- Discover projects
- Locate `index.json`
- Normalize Mochawesome suites
- Generate UUIDs
- Rewrite asset paths
- Group suites by project
- Aggregate statistics
- Generate `consolidated.json`

## `generate-consolidated-excel.js`

Purpose:

```text
consolidated.json
        +
Excel template
        ↓
Consolidated Excel report
```

Responsibilities:

- Read consolidated JSON
- Read Excel template
- Calculate project statistics
- Process suite/configuration data
- Populate `Configurations`
- Populate `Test_Execution_Summary`
- Save final workbook

## `generate-consolidated-pdf.js`

Purpose:

```text
consolidated.json
        ↓
HTML document
        ↓
Puppeteer
        ↓
PDF
```

Responsibilities:

- Calculate project statistics
- Generate project/module/suite tables
- Extract failed/pending/skipped tests
- Extract test case IDs
- Format the report
- Render PDF using Puppeteer

## `generate-teams-card.js`

Purpose:

```text
consolidated.json
        ↓
Adaptive Card JSON
        ↓
Microsoft Teams
```

Responsibilities:

- Read project results
- Calculate overall statistics
- Create project result table
- Format pass/fail/not-executed values
- Create GitHub Actions run link
- Generate `teams-card.json`

---

# Complete File Responsibilities

```text
.github/
│
├── scripts/
│
│   ├── consolidate-mochawesome.js
│   │       ↓
│   │   Consolidates all MFE Mochawesome reports
│   │
│   ├── generate-consolidated-excel.js
│   │       ↓
│   │   Generates Excel report
│   │
│   ├── generate-consolidated-pdf.js
│   │       ↓
│   │   Generates PDF report
│   │
│   ├── generate-teams-card.js
│   │       ↓
│   │   Generates Teams Adaptive Card
│   │
│   └── template/
│       └── consolidated-template.xlsm
│               ↓
│           Excel report template
│
└── workflows/
    └── consolidate.yml
            ↓
        Complete orchestration
```

---

# Data Flow

```text
Cypress
   |
   v
Mochawesome
   |
   v
GitHub Actions Artifact
   |
   v
automation-report-aggregator
   |
   v
source-reports/<project>/
   |
   v
consolidate-mochawesome.js
   |
   v
consolidated.json
   |
   +------------------+
   |                  |
   v                  v
Mochawesome          Custom
HTML                 Reports
   |                  |
   |          +-------+-------+
   |          |       |       |
   |          v       v       v
   |        Excel    PDF    Teams
   |
   v
Final GitHub Artifact
```

---

# Report Consumption

Different users can consume different outputs.

## QA Engineers

Use:

```text
HTML report
```

for detailed test execution information.

## Developers

Use:

```text
HTML
Screenshots
Videos
```

to investigate failures.

## QA Leads / Managers

Use:

```text
Excel
PDF
Teams notification
```

for consolidated project-level status.

## CI/CD

Use:

```text
consolidated.json
```

as the machine-readable consolidated result.

---

# Advantages of the Solution

## Centralized reporting

All MFE test results are available from one workflow.

## Project separation

Each MFE remains identifiable in the consolidated report.

## Exact triggering result

The MFE that triggered the report is represented using its exact E2E run.

## Latest available data

Other MFEs use the latest successful run with a valid artifact.

## Multiple report formats

The same source data can be consumed as:

```text
JSON
HTML
Excel
PDF
Teams
```

## Evidence preservation

Screenshots and videos remain available.

## Failure prevention

The workflow validates source reports before generating final output.

## Event-driven execution

The system can execute immediately after an MFE is merged/pushed to `master`.

---

# Recommended MFE Workflow Pattern

Every MFE should follow this basic sequence:

```text
Checkout
   ↓
Build/Test Environment
   ↓
Run Cypress
   ↓
Generate Mochawesome
   ↓
Upload Mochawesome Artifact
   ↓
Generate MFE-specific summary reports
   ↓
Upload final MFE reports
   ↓
Trigger automation-report-aggregator
```

The aggregator then takes responsibility for cross-MFE reporting.

---

# Production Execution Example

Suppose:

```text
Q4US/dashboard
```

is merged into `master`.

The process becomes:

```text
Q4US/dashboard
      |
      v
QA E2E Tests
      |
      v
Mochawesome Report #77
      |
      v
mochawesome-report-77
      |
      v
repository_dispatch
      |
      v
automation-report-aggregator
      |
      +--> Dashboard
      |       Exact Run #77
      |
      +--> Ask AI
      |       Latest available successful run
      |
      +--> User Management
      |       Latest available successful run
      |
      +--> Profile
      |       Latest available successful run
      |
      +--> React Tree
      |       Latest available successful run
      |
      +--> Error Reports
      |       Latest available successful run
      |
      +--> Audit
              Latest available successful run

      |
      v
consolidated.json
      |
      +--> HTML
      +--> Excel
      +--> PDF
      +--> Teams
      |
      v
consolidated-final-reports
```

---

# Security Considerations

Tokens should always be stored as GitHub Actions secrets.

Do not hard-code:

```text
GitHub tokens
Teams webhook URLs
API keys
```

inside:

```text
JavaScript
YAML
README
```

Use:

```text
${{ secrets.SECRET_NAME }}
```

instead.

---

# Operational Considerations

## Artifact retention

The aggregator depends on the MFE Mochawesome artifacts being available.

If artifact retention is too short, older MFEs may not have usable reports.

The current workflow mitigates this by searching recent successful runs.

## MFE workflow consistency

All MFEs should use the same artifact naming convention:

```text
mochawesome-report-${{ github.run_number }}
```

and should contain an:

```text
index.json
```

file.

---

# Current Limitations

The current repository list is maintained in:

```text
.github/workflows/consolidate.yml
```

Therefore, when a completely new MFE is introduced, its repository currently needs to be added to the configured list.

The consolidation and reporting scripts themselves are project-discovery based and do not require a new project-specific processing block.

---

# Future Improvements

Potential future improvements include:

## Automatic MFE discovery

Use the GitHub API to dynamically discover all MFE repositories instead of maintaining:

```yaml
ALL_MFE_REPOSITORIES
```

manually.

## Central configuration

Move the MFE repository list into a dedicated configuration file, for example:

```text
config/mfes.json
```

## Artifact retention strategy

Increase or standardize artifact retention across all MFE repositories.

## Report history

Store historical consolidated reports for trend analysis.

## Dashboard

Create a dashboard showing:

```text
Pass rate trend
Failure trend
MFE health
Execution duration
Test count trend
```

---

# Quick Reference

## Main workflow

```text
.github/workflows/consolidate.yml
```

## Consolidation script

```text
.github/scripts/consolidate-mochawesome.js
```

## Excel script

```text
.github/scripts/generate-consolidated-excel.js
```

## Excel template

```text
.github/scripts/template/consolidated-template.xlsm
```

## PDF script

```text
.github/scripts/generate-consolidated-pdf.js
```

## Teams script

```text
.github/scripts/generate-teams-card.js
```

## Main JSON output

```text
consolidated-report/consolidated.json
```

## HTML output

```text
consolidated-report/html/index.html
```

## Final reports

```text
consolidated-report/final/
```

## Teams payload

```text
teams-card.json
```

## Final GitHub artifact

```text
consolidated-final-reports
```

---

# Summary

The **Automated MFE E2E Report Aggregator** provides a centralized solution for collecting and reporting Cypress/Mochawesome test results across multiple Micro Frontend repositories.

The solution:

1. Receives an event from an MFE after its E2E execution.
2. Downloads the exact report from the triggering MFE.
3. Finds the latest available successful report from the other configured MFEs.
4. Preserves screenshots and videos.
5. Validates all source reports.
6. Generates a project-grouped consolidated Mochawesome JSON.
7. Generates a consolidated HTML report.
8. Generates a formatted Excel report using the provided XLSM template.
9. Generates a formatted PDF report.
10. Generates a Microsoft Teams Adaptive Card.
11. Sends the notification to Teams.
12. Uploads all final reports as one GitHub Actions artifact.

The resulting process provides a single, automated reporting pipeline across the MFE ecosystem while keeping individual project results clearly separated and preserving the original test evidence.

```text
             MFE E2E Execution
                    |
                    v
             Mochawesome Report
                    |
                    v
          GitHub Actions Artifact
                    |
                    v
        +---------------------------+
        | Automation Report         |
        | Aggregator                |
        +---------------------------+
                    |
                    v
          Project-Grouped JSON
                    |
          +---------+---------+
          |         |         |
          v         v         v
        HTML      Excel      PDF
          |         |         |
          +---------+---------+
                    |
                    v
             Teams Notification
                    |
                    v
          Final GitHub Artifact

          Centralized MFE
          E2E Reporting
```

---
