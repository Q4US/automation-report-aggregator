'use strict';

const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');

const CONFIG = {
    jsonPath:
        process.argv[2] ||
        './consolidated-report/consolidated.json',

    outputDir:
        process.argv[3] ||
        './consolidated-report/final',
};

const COLORS = {
    Passed: '#008000',
    Failed: '#d00000',
    Skipped: '#2499c7',
    Pending: '#c49a00',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function emptyStats() {
    return {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
    };
}

function addStats(target, source) {
    target.total += source.total || 0;
    target.passed += source.passed || 0;
    target.failed += source.failed || 0;
    target.skipped += source.skipped || 0;
    target.pending += source.pending || 0;

    return target;
}

function getTestState(test) {
    if (test?.pass === true) {
        return 'passed';
    }

    if (test?.fail === true) {
        return 'failed';
    }

    if (test?.pending === true) {
        return 'pending';
    }

    if (test?.skipped === true) {
        return 'skipped';
    }

    if (test?.state === 'passed') {
        return 'passed';
    }

    if (test?.state === 'failed') {
        return 'failed';
    }

    if (test?.state === 'pending') {
        return 'pending';
    }

    if (test?.state === 'skipped') {
        return 'skipped';
    }

    return 'unknown';
}

function getSuiteStats(suite) {
    const stats = emptyStats();

    for (const test of suite?.tests || []) {
        stats.total++;

        const state = getTestState(test);

        switch (state) {
            case 'passed':
                stats.passed++;
                break;

            case 'failed':
                stats.failed++;
                break;

            case 'pending':
                stats.pending++;
                break;

            case 'skipped':
                stats.skipped++;
                break;

            default:
                /*
                 * Unknown test state should not silently
                 * become passed.
                 */
                stats.failed++;
                break;
        }
    }

    for (const child of suite?.suites || []) {
        addStats(
            stats,
            getSuiteStats(child)
        );
    }

    return stats;
}

function getProjectStats(project) {
    const stats = emptyStats();

    for (const suite of project?.suites || []) {
        addStats(
            stats,
            getSuiteStats(suite)
        );
    }

    /*
     * Fallback to project-level stats if there
     * are no suites available.
     */
    if (
        stats.total === 0 &&
        project?.stats
    ) {
        stats.total =
            project.stats.testsRegistered ??
            project.stats.tests ??
            0;

        stats.passed =
            project.stats.passes ??
            project.stats.passed ??
            0;

        stats.failed =
            project.stats.failures ??
            project.stats.failed ??
            0;

        stats.pending =
            project.stats.pending ??
            0;

        stats.skipped =
            project.stats.skipped ??
            0;
    }

    return stats;
}

function cleanSuiteTitle(title) {
    return String(title || '')
        .replace(
            /\s*Test Objective\s*[:|-]\s*/gi,
            ''
        )
        .trim();
}

function formatTestTitle(title) {
    const value = String(title || '');

    const match = value.match(
        /(TC_[A-Za-z0-9_]*?_\d+(?:_\d+)*)/
    );

    if (!match) {
        return {
            id: '',
            description: value,
        };
    }

    const id = match[0].trim();

    let description =
        value
            .replace(id, '')
            .trim();

    description =
        description
            .replace(/^[\s\-\|\:_]+/, '')
            .replace(/[\s\-\|\:_]+$/, '')
            .trim();

    return {
        id,
        description,
    };
}

function collectIssues(
    suite,
    projectName,
    output
) {
    for (const test of suite?.tests || []) {
        const state = getTestState(test);

        if (
            state === 'failed' ||
            state === 'pending' ||
            state === 'skipped'
        ) {
            const parsed =
                formatTestTitle(test.title);

            output.push({
                project: projectName,
                suite: cleanSuiteTitle(
                    suite.title
                ),
                state,
                id: parsed.id,
                description: parsed.description,
            });
        }
    }

    for (const child of suite?.suites || []) {
        collectIssues(
            child,
            projectName,
            output
        );
    }
}

function suiteRows(
    suites,
    depth = 0
) {
    let html = '';

    for (const suite of suites || []) {
        const stats =
            getSuiteStats(suite);

        const title =
            cleanSuiteTitle(
                suite.title
            );

        const hasIssues =
            stats.failed > 0 ||
            stats.skipped > 0 ||
            stats.pending > 0;

        const background =
            hasIssues
                ? '#fff4f4'
                : '#ffffff';

        html += `
            <tr style="background:${background};">
                <td
                    style="
                        padding:7px 8px;
                        padding-left:${8 + depth * 18}px;
                    "
                >
                    ${escapeHtml(title)}
                </td>

                <td
                    style="
                        padding:7px 8px;
                        text-align:center;
                    "
                >
                    ${stats.total}
                </td>

                <td
                    style="
                        padding:7px 8px;
                        text-align:center;
                        color:${COLORS.Passed};
                    "
                >
                    ${stats.passed}
                </td>

                <td
                    style="
                        padding:7px 8px;
                        text-align:center;
                        color:${COLORS.Failed};
                    "
                >
                    ${stats.failed}
                </td>

                <td
                    style="
                        padding:7px 8px;
                        text-align:center;
                        color:${COLORS.Skipped};
                    "
                >
                    ${stats.skipped}
                </td>

                <td
                    style="
                        padding:7px 8px;
                        text-align:center;
                        color:${COLORS.Pending};
                    "
                >
                    ${stats.pending}
                </td>
            </tr>
        `;

        html += suiteRows(
            suite.suites || [],
            depth + 1
        );
    }

    return html;
}

function issueDetails(issues) {
    if (issues.length === 0) {
        return `
            <div
                style="
                    margin:10px 0 25px;
                    padding:10px;
                    border:1px solid #ddd;
                "
            >
                No failed, skipped, or pending tests.
            </div>
        `;
    }

    const groups = new Map();

    for (const issue of issues) {
        const key =
            `${issue.project}|||${issue.suite}`;

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups
            .get(key)
            .push(issue);
    }

    let html = '';

    for (const [key, items] of groups.entries()) {
        const [
            project,
            suite,
        ] = key.split('|||');

        html += `
            <div
                style="
                    margin-top:15px;
                    page-break-inside:avoid;
                "
            >
                <div
                    style="
                        font-weight:bold;
                        padding:7px;
                        border-bottom:2px solid #999;
                    "
                >
                    ${escapeHtml(project)}
                    —
                    ${escapeHtml(suite)}
                </div>

                <table
                    style="
                        width:100%;
                        border-collapse:collapse;
                        margin-top:5px;
                    "
                >
                    <thead>
                        <tr>
                            <th
                                style="
                                    padding:5px;
                                    border:1px solid #ddd;
                                    width:18%;
                                "
                            >
                                Status
                            </th>

                            <th
                                style="
                                    padding:5px;
                                    border:1px solid #ddd;
                                    width:22%;
                                "
                            >
                                Test ID
                            </th>

                            <th
                                style="
                                    padding:5px;
                                    border:1px solid #ddd;
                                "
                            >
                                Description
                            </th>
                        </tr>
                    </thead>

                    <tbody>
        `;

        for (const item of items) {
            const label =
                item.state
                    .charAt(0)
                    .toUpperCase() +
                item.state.slice(1);

            const color =
                COLORS[label] ||
                '#333';

            html += `
                <tr>
                    <td
                        style="
                            padding:5px;
                            border:1px solid #ddd;
                            color:${color};
                            font-weight:bold;
                        "
                    >
                        ${escapeHtml(label)}
                    </td>

                    <td
                        style="
                            padding:5px;
                            border:1px solid #ddd;
                            font-family:monospace;
                        "
                    >
                        ${escapeHtml(item.id)}
                    </td>

                    <td
                        style="
                            padding:5px;
                            border:1px solid #ddd;
                        "
                    >
                        ${escapeHtml(
                            item.description
                        )}
                    </td>
                </tr>
            `;
        }

        html += `
                    </tbody>
                </table>
            </div>
        `;
    }

    return html;
}

async function main() {
    await fs.mkdir(
        CONFIG.outputDir,
        {
            recursive: true,
        }
    );

    const raw =
        await fs.readFile(
            CONFIG.jsonPath,
            'utf8'
        );

    const json =
        JSON.parse(raw);

    const projects =
        json.results || [];

    if (projects.length === 0) {
        throw new Error(
            'No project results found in consolidated JSON.'
        );
    }

    const overall =
        emptyStats();

    const projectRows = [];
    const allIssues = [];

    /*
     * ---------------------------------------------------------
     * Calculate project statistics
     * ---------------------------------------------------------
     */

    for (const project of projects) {
        const stats =
            getProjectStats(project);

        addStats(
            overall,
            stats
        );

        projectRows.push({
            name:
                project.title ||
                project.name ||
                'Unknown Project',

            stats,
        });

        for (
            const suite of
            project.suites || []
        ) {
            collectIssues(
                suite,
                project.title ||
                    project.name ||
                    'Unknown Project',
                allIssues
            );
        }
    }

    const reportDate =
        new Date().toLocaleString(
            'en-GB',
            {
                timeZone:
                    'Asia/Colombo',

                weekday:
                    'long',

                year:
                    'numeric',

                month:
                    'short',

                day:
                    'numeric',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                hour12:
                    false,
            }
        );

    /*
     * ---------------------------------------------------------
     * Project summary
     * ---------------------------------------------------------
     */

    const projectSummaryRows =
        projectRows
            .map(
                project => `
        <tr>
            <td
                style="
                    padding:7px 8px;
                    font-weight:500;
                "
            >
                ${escapeHtml(
                    project.name
                )}
            </td>

            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                "
            >
                ${project.stats.total}
            </td>

            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    color:${COLORS.Passed};
                "
            >
                ${project.stats.passed}
            </td>

            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    color:${COLORS.Failed};
                "
            >
                ${project.stats.failed}
            </td>

            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    color:${COLORS.Skipped};
                "
            >
                ${project.stats.skipped}
            </td>

            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    color:${COLORS.Pending};
                "
            >
                ${project.stats.pending}
            </td>
        </tr>
    `
            )
            .join('');

    /*
     * ---------------------------------------------------------
     * Project sections
     * ---------------------------------------------------------
     */

    let projectSections = '';

    for (const project of projects) {
        const name =
            project.title ||
            project.name ||
            'Unknown Project';

        projectSections += `
            <section
                style="
                    margin-top:28px;
                    page-break-inside:auto;
                "
            >
                <h2
                    style="
                        margin:0 0 8px;
                        padding:8px;
                        background:#e6f3fb;
                        border-left:5px solid #4a9fd0;
                    "
                >
                    ${escapeHtml(name)}
                </h2>

                <table
                    style="
                        width:100%;
                        border-collapse:collapse;
                        margin-top:5px;
                    "
                >
                    <thead>
                        <tr
                            style="
                                background:#8ac7f0;
                            "
                        >
                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:left;
                                "
                            >
                                Test Area (Suite)
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:center;
                                    width:60px;
                                "
                            >
                                Total
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:center;
                                    width:60px;
                                "
                            >
                                Passed
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:center;
                                    width:60px;
                                "
                            >
                                Failed
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:center;
                                    width:60px;
                                "
                            >
                                Skipped
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:center;
                                    width:60px;
                                "
                            >
                                Pending
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        ${suiteRows(
                            project.suites || []
                        )}
                    </tbody>
                </table>
            </section>
        `;
    }

    /*
     * ---------------------------------------------------------
     * Final HTML
     * ---------------------------------------------------------
     */

    const html = `
<!DOCTYPE html>

<html>

<head>

<meta charset="utf-8">

<title>
    Consolidated E2E Test Results
</title>

<style>

body {
    margin:20px;
    font-family:Arial,sans-serif;
    color:#222;
}

table {
    border-collapse:collapse;
    width:100%;
}

th,
td {
    border:1px solid #999;
}

tr {
    page-break-inside:avoid;
    break-inside:avoid;
}

h1,
h2,
h3 {
    page-break-after:avoid;
    break-after:avoid;
}

</style>

</head>

<body>

<h1
    style="
        text-align:center;
        margin-bottom:0;
    "
>
    E2E Test Results
</h1>

<h3
    style="
        text-align:center;
        margin-top:8px;
    "
>
    ${escapeHtml(reportDate)}
</h3>

<!-- Overall Summary -->

<table
    style="
        margin-top:15px;
        text-align:center;
    "
>

<thead>

<tr>

<th style="padding:10px;">
    Total
</th>

<th style="padding:10px;">
    Passed
</th>

<th style="padding:10px;">
    Failed
</th>

<th style="padding:10px;">
    Skipped
</th>

<th style="padding:10px;">
    Pending
</th>

</tr>

</thead>

<tbody>

<tr>

<td
    style="
        padding:10px;
        font-weight:bold;
    "
>
    ${overall.total}
</td>

<td
    style="
        padding:10px;
        font-weight:bold;
        color:${COLORS.Passed};
    "
>
    ${overall.passed}
</td>

<td
    style="
        padding:10px;
        font-weight:bold;
        color:${COLORS.Failed};
    "
>
    ${overall.failed}
</td>

<td
    style="
        padding:10px;
        font-weight:bold;
        color:${COLORS.Skipped};
    "
>
    ${overall.skipped}
</td>

<td
    style="
        padding:10px;
        font-weight:bold;
        color:${COLORS.Pending};
    "
>
    ${overall.pending}
</td>

</tr>

</tbody>

</table>

<!-- Project Summary -->

<h2
    style="
        margin-top:28px;
    "
>
    Project Summary
</h2>

<table>

<thead>

<tr
    style="
        background:#8ac7f0;
    "
>

<th
    style="
        padding:8px;
        text-align:left;
    "
>
    Project
</th>

<th style="padding:8px;">
    Total
</th>

<th style="padding:8px;">
    Passed
</th>

<th style="padding:8px;">
    Failed
</th>

<th style="padding:8px;">
    Skipped
</th>

<th style="padding:8px;">
    Pending
</th>

</tr>

</thead>

<tbody>

${projectSummaryRows}

</tbody>

</table>

<!-- Individual project sections -->

${projectSections}

<!-- Failed / skipped / pending -->

<h2
    style="
        margin-top:35px;
        page-break-before:always;
    "
>
    Test Details - Failed, Skipped and Pending
</h2>

${issueDetails(allIssues)}

</body>

</html>
`;

    /*
     * ---------------------------------------------------------
     * Generate PDF
     * ---------------------------------------------------------
     */

    const outputPath =
        path.resolve(
            CONFIG.outputDir,
            'consolidated-e2e-report.pdf'
        );

    const browser =
        await puppeteer.launch({
            headless: 'new',

            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
            ],
        });

    try {
        const page =
            await browser.newPage();

        await page.setContent(
            html,
            {
                waitUntil:
                    'networkidle0',
            }
        );

        await page.pdf({
            path: outputPath,

            format: 'A4',

            printBackground:
                true,

            margin: {
                top: '20px',
                bottom: '20px',
                left: '20px',
                right: '20px',
            },
        });
    } finally {
        await browser.close();
    }

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'CONSOLIDATED PDF GENERATED'
    );
    console.log(
        '========================================'
    );

    console.log(
        `Projects: ${projects.length}`
    );

    console.log(
        `Total: ${overall.total}`
    );

    console.log(
        `Passed: ${overall.passed}`
    );

    console.log(
        `Failed: ${overall.failed}`
    );

    console.log(
        `Skipped: ${overall.skipped}`
    );

    console.log(
        `Pending: ${overall.pending}`
    );

    console.log(
        `Output: ${outputPath}`
    );
}

main().catch(error => {
    console.error('');
    console.error(
        'ERROR generating consolidated PDF:'
    );
    console.error(error);

    process.exit(1);
});