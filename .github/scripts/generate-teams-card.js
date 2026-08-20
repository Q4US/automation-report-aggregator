'use strict';

const fs = require('fs');

const JSON_PATH =
    process.argv[2] ||
    './consolidated-report/consolidated.json';

const OUTPUT_FILE =
    process.argv[3] ||
    './teams-card.json';

function toNumber(value) {
    return Number(value) || 0;
}

function getTestStats(tests) {
    const stats = {
        tests: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
    };

    for (const test of tests || []) {
        stats.tests++;

        if (test.pass === true) {
            stats.passed++;
        } else if (test.fail === true) {
            stats.failed++;
        } else if (test.pending === true) {
            stats.pending++;
        } else if (test.skipped === true) {
            stats.skipped++;
        } else if (test.state === 'passed') {
            stats.passed++;
        } else if (test.state === 'failed') {
            stats.failed++;
        } else if (test.state === 'pending') {
            stats.pending++;
        }
    }

    return stats;
}

function collectSuiteStats(suite, rows) {
    const stats = getTestStats(suite.tests || []);

    if (
        suite.title &&
        (stats.tests > 0 || suite.tests?.length)
    ) {
        rows.push({
            name: suite.title,
            tests: stats.tests,
            passed: stats.passed,
            failed: stats.failed,
            pending: stats.pending + stats.skipped,
        });
    }

    for (const child of suite.suites || []) {
        collectSuiteStats(child, rows);
    }
}

function getProjectStats(project) {
    /*
     * First preference:
     * consolidated.json meta.projects
     */
    if (project.stats) {
        return {
            tests: toNumber(project.stats.tests),
            passed: toNumber(project.stats.passed),
            failed: toNumber(project.stats.failed),
            pending: toNumber(project.stats.pending),
        };
    }

    /*
     * Fallback:
     * Calculate from the project's tests/suites.
     */
    const stats = {
        tests: 0,
        passed: 0,
        failed: 0,
        pending: 0,
    };

    function processSuite(suite) {
        const result = getTestStats(suite.tests || []);

        stats.tests += result.tests;
        stats.passed += result.passed;
        stats.failed += result.failed;
        stats.pending +=
            result.pending +
            result.skipped;

        for (const child of suite.suites || []) {
            processSuite(child);
        }
    }

    for (const suite of project.suites || []) {
        processSuite(suite);
    }

    for (const test of project.tests || []) {
        const result = getTestStats([test]);

        stats.tests += result.tests;
        stats.passed += result.passed;
        stats.failed += result.failed;
        stats.pending +=
            result.pending +
            result.skipped;
    }

    return stats;
}

function getProjectSuites(project) {
    const suites = [];

    for (const suite of project.suites || []) {
        collectSuiteStats(suite, suites);
    }

    return suites;
}

function createSuiteHeader() {
    return {
        type: 'ColumnSet',
        separator: true,
        spacing: 'Small',

        columns: [
            {
                type: 'Column',
                width: 'stretch',
                items: [
                    {
                        type: 'TextBlock',
                        text: 'Suite',
                        weight: 'Bolder',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: 'T',
                        weight: 'Bolder',
                        horizontalAlignment: 'Center',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: 'P',
                        weight: 'Bolder',
                        horizontalAlignment: 'Center',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: 'F',
                        weight: 'Bolder',
                        horizontalAlignment: 'Center',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: 'N/E',
                        weight: 'Bolder',
                        horizontalAlignment: 'Center',
                        size: 'Small',
                    },
                ],
            },
        ],
    };
}

function createSuiteRow(suite) {
    return {
        type: 'ColumnSet',
        spacing: 'Small',
        separator: true,

        columns: [
            {
                type: 'Column',
                width: 'stretch',
                items: [
                    {
                        type: 'TextBlock',
                        text: suite.name,
                        wrap: true,
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: String(suite.tests),
                        horizontalAlignment: 'Center',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: String(suite.passed),
                        horizontalAlignment: 'Center',
                        color:
                            suite.passed > 0
                                ? 'Good'
                                : 'Default',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: String(suite.failed),
                        horizontalAlignment: 'Center',
                        color:
                            suite.failed > 0
                                ? 'Attention'
                                : 'Default',
                        size: 'Small',
                    },
                ],
            },
            {
                type: 'Column',
                width: 'auto',
                items: [
                    {
                        type: 'TextBlock',
                        text: String(suite.pending),
                        horizontalAlignment: 'Center',
                        color:
                            suite.pending > 0
                                ? 'Warning'
                                : 'Default',
                        size: 'Small',
                    },
                ],
            },
        ],
    };
}

function createProjectContainer(project) {
    const stats = getProjectStats(project);

    const suites = getProjectSuites(project);

    const projectPassRate =
        stats.tests > 0
            ? (
                (stats.passed / stats.tests) *
                100
            ).toFixed(2)
            : '0.00';

    let projectStatus = 'PASSED';
    let projectColor = 'Good';

    if (stats.failed > 0) {
        projectStatus = 'FAILED';
        projectColor = 'Attention';
    } else if (stats.pending > 0) {
        projectStatus = 'PASSED WITH WARNINGS';
        projectColor = 'Warning';
    }

    const body = [
        {
            type: 'TextBlock',
            text:
                project.name ||
                project.title ||
                project.id ||
                'Unknown Project',
            weight: 'Bolder',
            size: 'Medium',
        },

        {
            type: 'TextBlock',
            text:
                `Status: ${projectStatus}`,
            color: projectColor,
            weight: 'Bolder',
            spacing: 'Small',
        },

        {
            type: 'FactSet',
            facts: [
                {
                    title: 'Total',
                    value: String(stats.tests),
                },
                {
                    title: 'Passed',
                    value: String(stats.passed),
                },
                {
                    title: 'Failed',
                    value: String(stats.failed),
                },
                {
                    title: 'Pending',
                    value: String(stats.pending),
                },
                {
                    title: 'Pass Rate',
                    value: `${projectPassRate}%`,
                },
            ],
        },
    ];

    /*
     * Add suite-level details
     */
    if (suites.length > 0) {
        body.push({
            type: 'TextBlock',
            text: 'Suite Results',
            weight: 'Bolder',
            spacing: 'Medium',
            size: 'Small',
        });

        body.push(
            createSuiteHeader()
        );

        for (const suite of suites) {
            body.push(
                createSuiteRow(suite)
            );
        }
    }

    return {
        type: 'Container',

        separator: true,

        spacing: 'Medium',

        items: body,
    };
}

function main() {
    console.log(
        '========================================'
    );
    console.log(
        'GENERATING TEAMS NOTIFICATION'
    );
    console.log(
        '========================================'
    );

    if (!fs.existsSync(JSON_PATH)) {
        throw new Error(
            `Consolidated JSON not found: ${JSON_PATH}`
        );
    }

    const report = JSON.parse(
        fs.readFileSync(
            JSON_PATH,
            'utf8'
        )
    );

    const stats = report.stats || {};

    /*
     * IMPORTANT:
     *
     * Support both:
     *
     * meta.projects
     *
     * and
     *
     * results
     *
     * This makes the script compatible
     * with your current consolidated JSON.
     */

    let projects = [];

    if (
        Array.isArray(
            report.meta?.projects
        ) &&
        report.meta.projects.length > 0
    ) {
        projects =
            report.meta.projects.map(
                project => ({
                    ...project,
                    name:
                        project.name ||
                        project.id,
                })
            );
    } else if (
        Array.isArray(report.results)
    ) {
        projects =
            report.results.map(
                project => ({
                    ...project,

                    id:
                        project.id ||
                        project.title,

                    name:
                        project.name ||
                        project.title ||
                        project.file,
                })
            );
    }

    console.log(
        `Projects detected: ${projects.length}`
    );

    /*
     * Overall statistics
     */

    const totalTests =
        toNumber(stats.tests);

    const totalPassed =
        toNumber(stats.passes);

    const totalFailed =
        toNumber(stats.failures);

    const totalPending =
        toNumber(stats.pending) +
        toNumber(stats.skipped);

    const passRate =
        totalTests > 0
            ? (
                (totalPassed / totalTests) *
                100
            ).toFixed(2)
            : '0.00';

    let overallStatus = 'PASSED';
    let overallColor = 'Good';

    if (totalFailed > 0) {
        overallStatus = 'FAILED';
        overallColor = 'Attention';
    } else if (totalPending > 0) {
        overallStatus =
            'PASSED WITH WARNINGS';

        overallColor = 'Warning';
    }

    /*
     * Build Adaptive Card body
     */

    const body = [
        {
            type: 'TextBlock',
            text:
                'Consolidated E2E Test Report',
            weight: 'Bolder',
            size: 'Large',
        },

        {
            type: 'TextBlock',
            text:
                `Overall Status: ${overallStatus}`,
            weight: 'Bolder',
            color: overallColor,
            spacing: 'Small',
        },

        {
            type: 'FactSet',
            facts: [
                {
                    title: 'Projects',
                    value:
                        String(
                            projects.length
                        ),
                },
                {
                    title: 'Total Tests',
                    value:
                        String(
                            totalTests
                        ),
                },
                {
                    title: 'Passed',
                    value:
                        String(
                            totalPassed
                        ),
                },
                {
                    title: 'Failed',
                    value:
                        String(
                            totalFailed
                        ),
                },
                {
                    title: 'Not Executed',
                    value:
                        String(
                            totalPending
                        ),
                },
                {
                    title: 'Pass Rate',
                    value:
                        `${passRate}%`,
                },
            ],
        },

        {
            type: 'TextBlock',
            text: 'Project Results',
            weight: 'Bolder',
            size: 'Medium',
            spacing: 'Medium',
        },
    ];

    /*
     * Add every MFE project
     */

    for (const project of projects) {
        body.push(
            createProjectContainer(
                project
            )
        );
    }

    /*
     * Generated timestamp
     */

    body.push({
        type: 'TextBlock',
        text:
            `Generated: ${new Date().toLocaleString(
                'en-GB',
                {
                    timeZone:
                        'Asia/Colombo',
                }
            )}`,
        isSubtle: true,
        size: 'Small',
        spacing: 'Medium',
    });

    /*
     * Artifact / GitHub Actions URL
     *
     * Passed from GitHub Actions as:
     *
     * REPORT_RUN_URL
     */

    const runUrl =
        process.env.REPORT_RUN_URL || '';

    const actions = [];

    if (runUrl) {
        actions.push({
            type: 'Action.OpenUrl',
            title:
                'Download Artifacts / View Run',
            url: runUrl,
        });
    }

    const card = {
        type: 'message',

        attachments: [
            {
                contentType:
                    'application/vnd.microsoft.card.adaptive',

                content: {
                    '$schema':
                        'http://adaptivecards.io/schemas/adaptive-card.json',

                    type: 'AdaptiveCard',

                    version: '1.4',

                    body,

                    actions,
                },
            },
        ],
    };

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
            card,
            null,
            2
        )
    );

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'TEAMS CARD CREATED'
    );
    console.log(
        '========================================'
    );

    console.log(
        `Projects: ${projects.length}`
    );

    console.log(
        `Tests: ${totalTests}`
    );

    console.log(
        `Passed: ${totalPassed}`
    );

    console.log(
        `Failed: ${totalFailed}`
    );

    console.log(
        `Not Executed: ${totalPending}`
    );

    console.log(
        `Pass Rate: ${passRate}%`
    );

    console.log(
        `Status: ${overallStatus}`
    );

    console.log(
        `Run URL: ${runUrl || 'Not provided'}`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();