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

function getProjectStats(project) {

    // Preferred source
    if (project.stats) {
        return {
            tests: toNumber(project.stats.tests),
            passed: toNumber(project.stats.passed),
            failed: toNumber(project.stats.failed),
            pending: toNumber(project.stats.pending),
        };
    }

    // Fallback calculation
    const stats = {
        tests: 0,
        passed: 0,
        failed: 0,
        pending: 0,
    };

    function processTests(tests) {

        for (const test of tests || []) {

            stats.tests++;

            if (
                test.pass === true ||
                test.state === 'passed'
            ) {
                stats.passed++;
            }
            else if (
                test.fail === true ||
                test.state === 'failed'
            ) {
                stats.failed++;
            }
            else {
                stats.pending++;
            }
        }
    }

    function processSuite(suite) {

        processTests(suite.tests);

        for (const child of suite.suites || []) {
            processSuite(child);
        }
    }

    for (const suite of project.suites || []) {
        processSuite(suite);
    }

    processTests(project.tests);

    return stats;
}

function createProjectRow(project) {

    const stats = getProjectStats(project);

    const passRate =
        stats.tests > 0
            ? (
                (stats.passed / stats.tests) *
                100
            ).toFixed(1)
            : '0.0';

    let status = 'PASS';
    let statusColor = 'Good';

    if (stats.failed > 0) {
        status = 'FAIL';
        statusColor = 'Attention';
    }
    else if (stats.pending > 0) {
        status = 'WARNING';
        statusColor = 'Warning';
    }

    return {
        type: 'Container',
        separator: true,
        spacing: 'Small',

        items: [

            {
                type: 'ColumnSet',

                columns: [

                    {
                        type: 'Column',
                        width: 'stretch',

                        items: [
                            {
                                type: 'TextBlock',
                                text:
                                    project.name ||
                                    project.title ||
                                    project.id ||
                                    'Unknown Project',

                                wrap: true,

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
                                text:
                                    `${stats.tests} tests`,

                                size: 'Small',

                                horizontalAlignment:
                                    'Right',
                            },
                        ],
                    },

                    {
                        type: 'Column',
                        width: 'auto',

                        items: [
                            {
                                type: 'TextBlock',
                                text:
                                    `${stats.passed} passed`,

                                size: 'Small',

                                color: 'Good',

                                horizontalAlignment:
                                    'Right',
                            },
                        ],
                    },

                    {
                        type: 'Column',
                        width: 'auto',

                        items: [
                            {
                                type: 'TextBlock',
                                text:
                                    `${stats.failed} failed`,

                                size: 'Small',

                                color:
                                    stats.failed > 0
                                        ? 'Attention'
                                        : 'Default',

                                horizontalAlignment:
                                    'Right',
                            },
                        ],
                    },

                    {
                        type: 'Column',
                        width: 'auto',

                        items: [
                            {
                                type: 'TextBlock',
                                text:
                                    `${stats.pending} N/E`,

                                size: 'Small',

                                color:
                                    stats.pending > 0
                                        ? 'Warning'
                                        : 'Default',

                                horizontalAlignment:
                                    'Right',
                            },
                        ],
                    },

                    {
                        type: 'Column',
                        width: 'auto',

                        items: [
                            {
                                type: 'TextBlock',
                                text:
                                    `${passRate}%`,

                                size: 'Small',

                                color: statusColor,

                                horizontalAlignment:
                                    'Right',
                            },
                        ],
                    },
                ],
            },
        ],
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

    const report =
        JSON.parse(
            fs.readFileSync(
                JSON_PATH,
                'utf8'
            )
        );

    const stats =
        report.stats || {};

    /*
     * ----------------------------------------------------
     * Get projects
     * ----------------------------------------------------
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
    }

    else if (
        Array.isArray(
            report.results
        )
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
     * ----------------------------------------------------
     * Overall statistics
     * ----------------------------------------------------
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

    let overallStatus =
        'PASSED';

    let overallColor =
        'Good';

    if (totalFailed > 0) {

        overallStatus =
            'FAILED';

        overallColor =
            'Attention';
    }

    else if (totalPending > 0) {

        overallStatus =
            'PASSED WITH WARNINGS';

        overallColor =
            'Warning';
    }

    /*
     * ----------------------------------------------------
     * Adaptive Card body
     * ----------------------------------------------------
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
                    title:
                        'Projects',

                    value:
                        String(
                            projects.length
                        ),
                },

                {
                    title:
                        'Total Tests',

                    value:
                        String(
                            totalTests
                        ),
                },

                {
                    title:
                        'Passed',

                    value:
                        String(
                            totalPassed
                        ),
                },

                {
                    title:
                        'Failed',

                    value:
                        String(
                            totalFailed
                        ),
                },

                {
                    title:
                        'Not Executed',

                    value:
                        String(
                            totalPending
                        ),
                },

                {
                    title:
                        'Pass Rate',

                    value:
                        `${passRate}%`,
                },
            ],
        },

        {
            type: 'TextBlock',

            text:
                'Project Results',

            weight: 'Bolder',

            size: 'Medium',

            spacing: 'Medium',
        },

        /*
         * Header
         */

        {
            type: 'ColumnSet',

            separator: true,

            columns: [

                {
                    type: 'Column',
                    width: 'stretch',

                    items: [
                        {
                            type: 'TextBlock',
                            text: 'Project',
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
                            text: 'Tests',
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
                            text: 'Pass',
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
                            text: 'Fail',
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
                            text: 'N/E',
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
                            text: 'Pass %',
                            weight: 'Bolder',
                            size: 'Small',
                        },
                    ],
                },
            ],
        },
    ];

    /*
     * ----------------------------------------------------
     * Add one compact row per MFE
     * ----------------------------------------------------
     */

    for (const project of projects) {

        body.push(
            createProjectRow(
                project
            )
        );
    }

    /*
     * ----------------------------------------------------
     * Timestamp
     * ----------------------------------------------------
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
     * ----------------------------------------------------
     * GitHub Actions button
     * ----------------------------------------------------
     */

    const actions = [];

    const runUrl =
        process.env.REPORT_RUN_URL ||
        '';

    if (runUrl) {

        actions.push({

            type:
                'Action.OpenUrl',

            title:
                'Download Artifacts / View Run',

            url:
                runUrl,
        });
    }

    /*
     * ----------------------------------------------------
     * Final card
     * ----------------------------------------------------
     */

    const card = {

        type:
            'message',

        attachments: [

            {

                contentType:
                    'application/vnd.microsoft.card.adaptive',

                content: {

                    '$schema':
                        'http://adaptivecards.io/schemas/adaptive-card.json',

                    type:
                        'AdaptiveCard',

                    version:
                        '1.4',

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

    /*
     * ----------------------------------------------------
     * Size check
     * ----------------------------------------------------
     */

    const fileSize =
        fs.statSync(
            OUTPUT_FILE
        ).size;

    const fileSizeKB =
        (
            fileSize /
            1024
        ).toFixed(2);

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
        `Card size: ${fileSizeKB} KB`
    );

    console.log(
        `Run URL: ${runUrl}`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );

    /*
     * Warning if approaching Teams limit
     */

    if (fileSize > 25 * 1024) {

        console.warn(
            `WARNING: Teams card is ${fileSizeKB} KB.`
        );

        console.warn(
            'Keep the card below the 28 KB Teams limit.'
        );
    }
}

main();