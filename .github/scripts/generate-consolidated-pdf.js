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
    target.total += source?.total || 0;
    target.passed += source?.passed || 0;
    target.failed += source?.failed || 0;
    target.skipped += source?.skipped || 0;
    target.pending += source?.pending || 0;

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

    /*
     * Include nested suites.
     */
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
     * Fallback to project-level stats if no suites
     * are available.
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

/*
 * -------------------------------------------------------------
 * Collect failed / skipped / pending tests
 * -------------------------------------------------------------
 */

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

                suite:
                    cleanSuiteTitle(
                        suite.title
                    ),

                state,

                id: parsed.id,

                description:
                    parsed.description,
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

/*
 * -------------------------------------------------------------
 * Generate one project test row
 * -------------------------------------------------------------
 */

function createSuiteRow(
    moduleName,
    suiteName,
    stats,
    indent = false
) {
    const hasIssues =
        stats.failed > 0 ||
        stats.skipped > 0 ||
        stats.pending > 0;

    const background =
        hasIssues
            ? '#fff4f4'
            : '#ffffff';

    const suitePadding =
        indent ? '18px' : '8px';

    return `
        <tr
            style="
                background:${background};
                page-break-inside:avoid;
                break-inside:avoid;
            "
        >

            <!-- Module -->
            <td
                style="
                    padding:7px 8px;
                    vertical-align:top;
                    font-weight:500;
                    word-wrap:break-word;
                    overflow-wrap:break-word;
                "
            >
                ${escapeHtml(moduleName)}
            </td>

            <!-- Suite -->
            <td
                style="
                    padding:7px ${suitePadding}px;
                    vertical-align:top;
                    word-wrap:break-word;
                    overflow-wrap:break-word;
                "
            >
                ${escapeHtml(suiteName)}
            </td>

            <!-- Total -->
            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    vertical-align:top;
                "
            >
                ${stats.total}
            </td>

            <!-- Passed -->
            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    vertical-align:top;
                    color:${COLORS.Passed};
                "
            >
                ${stats.passed}
            </td>

            <!-- Failed -->
            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    vertical-align:top;
                    color:${COLORS.Failed};
                "
            >
                ${stats.failed}
            </td>

            <!-- Skipped -->
            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    vertical-align:top;
                    color:${COLORS.Skipped};
                "
            >
                ${stats.skipped}
            </td>

            <!-- Pending -->
            <td
                style="
                    padding:7px 8px;
                    text-align:center;
                    vertical-align:top;
                    color:${COLORS.Pending};
                "
            >
                ${stats.pending}
            </td>

        </tr>
    `;
}

/*
 * -------------------------------------------------------------
 * Render nested suites
 * -------------------------------------------------------------
 */

function nestedSuiteRows(
    suites,
    parentModule
) {
    let html = '';

    for (const suite of suites || []) {
        const suiteName =
            cleanSuiteTitle(
                suite.title
            );

        const stats =
            getSuiteStats(suite);

        html += createSuiteRow(
            parentModule,
            suiteName,
            stats,
            true
        );

        /*
         * Continue recursively if another
         * suite level exists.
         */
        if (
            suite.suites &&
            suite.suites.length > 0
        ) {
            html += nestedSuiteRows(
                suite.suites,
                suiteName
            );
        }
    }

    return html;
}

/*
 * -------------------------------------------------------------
 * Generate Module + Suite rows
 * -------------------------------------------------------------
 *
 * Expected structure:
 *
 * Module                         Suite
 * ----------------------------------------------------------
 * Ask AI Multiple View Tests     Ask AI Multiple View Functionality
 * Ask AI Security Tests          Ask AI Security Functionality
 *
 * If there are no child suites:
 *
 * Module                         Suite
 * ----------------------------------------------------------
 * Some Module                    Some Module
 *
 * -------------------------------------------------------------
 */

function suiteRows(suites) {
    let html = '';

    for (const module of suites || []) {
        const moduleName =
            cleanSuiteTitle(
                module.title
            );

        /*
         * Normal case:
         *
         * Top-level suite = Module
         * Child suite = Suite
         */
        if (
            module.suites &&
            module.suites.length > 0
        ) {
            for (
                const suite
                of module.suites
            ) {
                const suiteName =
                    cleanSuiteTitle(
                        suite.title
                    );

                const stats =
                    getSuiteStats(suite);

                html += createSuiteRow(
                    moduleName,
                    suiteName,
                    stats
                );

                /*
                 * Support deeper nesting.
                 */
                if (
                    suite.suites &&
                    suite.suites.length > 0
                ) {
                    html += nestedSuiteRows(
                        suite.suites,
                        suiteName
                    );
                }
            }
        } else {
            /*
             * No child suite.
             *
             * Use the module name as both
             * Module and Suite.
             */
            const stats =
                getSuiteStats(module);

            html += createSuiteRow(
                moduleName,
                moduleName,
                stats
            );
        }
    }

    return html;
}

/*
 * -------------------------------------------------------------
 * Issue details
 * -------------------------------------------------------------
 */

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

    /*
     * Group issues by project + suite.
     */
    const groups =
        new Map();

    for (const issue of issues) {
        const key =
            `${issue.project}|||${issue.suite}`;

        if (!groups.has(key)) {
            groups.set(
                key,
                []
            );
        }

        groups
            .get(key)
            .push(issue);
    }

    let html = '';

    for (
        const [key, items]
        of groups.entries()
    ) {
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
                        table-layout:fixed;
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
                            word-wrap:break-word;
                            overflow-wrap:break-word;
                        "
                    >
                        ${escapeHtml(item.id)}
                    </td>

                    <td
                        style="
                            padding:5px;
                            border:1px solid #ddd;
                            word-wrap:break-word;
                            overflow-wrap:break-word;
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

/*
 * -------------------------------------------------------------
 * Main
 * -------------------------------------------------------------
 */

async function main() {
    await fs.mkdir(
        CONFIG.outputDir,
        {
            recursive: true,
        }
    );

    /*
     * Read consolidated JSON.
     */
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

    /*
     * ---------------------------------------------------------
     * Overall statistics
     * ---------------------------------------------------------
     */

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

        const projectName =
            project.title ||
            project.name ||
            'Unknown Project';

        projectRows.push({
            name:
                projectName,

            stats,
        });

        /*
         * Collect failed/skipped/pending
         * tests.
         */
        for (
            const suite
            of project.suites || []
        ) {
            collectIssues(
                suite,
                projectName,
                allIssues
            );
        }
    }

    /*
     * ---------------------------------------------------------
     * Report date
     * ---------------------------------------------------------
     */

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
     * Project summary rows
     * ---------------------------------------------------------
     */

    const projectSummaryRows =
        projectRows
            .map(
                project => `
                    <tr
                        style="
                            page-break-inside:avoid;
                            break-inside:avoid;
                        "
                    >

                        <td
                            style="
                                padding:7px 8px;
                                font-weight:500;
                                word-wrap:break-word;
                                overflow-wrap:break-word;
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
     * Individual project sections
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
                        page-break-after:avoid;
                        break-after:avoid;
                    "
                >
                    ${escapeHtml(name)}
                </h2>

                <table
                    style="
                        width:100%;
                        table-layout:fixed;
                        border-collapse:collapse;
                        margin-top:5px;
                    "
                >

                    <colgroup>

                        <col style="width:28%;">

                        <col style="width:32%;">

                        <col style="width:8%;">

                        <col style="width:8%;">

                        <col style="width:8%;">

                        <col style="width:8%;">

                        <col style="width:8%;">

                    </colgroup>

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
                                Module
                            </th>

                            <th
                                style="
                                    padding:7px 8px;
                                    text-align:left;
                                "
                            >
                                Suite
                            </th>

                            <th
                                style="
                                    padding:7px 5px;
                                    text-align:center;
                                "
                            >
                                Total
                            </th>

                            <th
                                style="
                                    padding:7px 5px;
                                    text-align:center;
                                "
                            >
                                Passed
                            </th>

                            <th
                                style="
                                    padding:7px 5px;
                                    text-align:center;
                                "
                            >
                                Failed
                            </th>

                            <th
                                style="
                                    padding:7px 5px;
                                    text-align:center;
                                "
                            >
                                Skipped
                            </th>

                            <th
                                style="
                                    padding:7px 5px;
                                    text-align:center;
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

@page {
    size: A4;
    margin: 20px;
}

body {
    margin:0;
    font-family:Arial, Helvetica, sans-serif;
    font-size:11px;
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

th {
    font-weight:bold;
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

section {
    page-break-inside:auto;
}

</style>

</head>

<body>

<!-- =========================================================
     TITLE
     ========================================================= -->

<h1
    style="
        text-align:center;
        margin:0;
        font-size:22px;
    "
>
    E2E Test Results
</h1>

<h3
    style="
        text-align:center;
        margin:8px 0 15px;
        font-weight:normal;
        color:#555;
    "
>
    ${escapeHtml(reportDate)}
</h3>


<!-- =========================================================
     OVERALL SUMMARY
     ========================================================= -->

<table
    style="
        margin-top:15px;
        text-align:center;
    "
>

<thead>

<tr
    style="
        background:#8ac7f0;
    "
>

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


<!-- =========================================================
     PROJECT SUMMARY
     ========================================================= -->

<h2
    style="
        margin-top:28px;
        margin-bottom:8px;
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


<!-- =========================================================
     INDIVIDUAL PROJECT REPORTS
     ========================================================= -->

${projectSections}


<!-- =========================================================
     FAILED / SKIPPED / PENDING DETAILS
     ========================================================= -->

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
     * Generate PDF using Puppeteer
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

            preferCSSPageSize:
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

    /*
     * ---------------------------------------------------------
     * Console output
     * ---------------------------------------------------------
     */

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

/*
 * -------------------------------------------------------------
 * Error handling
 * -------------------------------------------------------------
 */

main().catch(error => {
    console.error('');

    console.error(
        'ERROR generating consolidated PDF:'
    );

    console.error(error);

    process.exit(1);
});