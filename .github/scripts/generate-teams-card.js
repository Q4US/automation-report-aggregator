'use strict';

const fs = require('fs');

const JSON_PATH =
    process.argv[2] ||
    './consolidated-report/consolidated.json';

const OUTPUT_FILE =
    process.argv[3] ||
    './teams-card.json';

function main() {
    console.log('========================================');
    console.log('GENERATING TEAMS NOTIFICATION');
    console.log('========================================');

    if (!fs.existsSync(JSON_PATH)) {
        throw new Error(
            `Consolidated JSON not found: ${JSON_PATH}`
        );
    }

    const report = JSON.parse(
        fs.readFileSync(JSON_PATH, 'utf8')
    );

    const stats = report.stats || {};

    const projects =
        report.meta?.projects ||
        [];

    const totalTests =
        Number(stats.tests) || 0;

    const totalPassed =
        Number(stats.passes) || 0;

    const totalFailed =
        Number(stats.failures) || 0;

    const totalPending =
        Number(stats.pending) || 0;

    const totalSkipped =
        Number(stats.skipped) || 0;

    const passPercentage =
        totalTests > 0
            ? ((totalPassed / totalTests) * 100).toFixed(2)
            : '0.00';

    /*
     * --------------------------------------------------------
     * Determine overall status
     * --------------------------------------------------------
     */

    let status = 'PASSED';
    let statusColor = 'Good';

    if (totalFailed > 0) {
        status = 'FAILED';
        statusColor = 'Attention';
    } else if (
        totalPending > 0 ||
        totalSkipped > 0
    ) {
        status = 'PASSED WITH WARNINGS';
        statusColor = 'Warning';
    }

    /*
     * --------------------------------------------------------
     * Project rows
     * --------------------------------------------------------
     */

    const projectRows = [];

    for (const project of projects) {
        const projectStats =
            project.stats || {};

        const tests =
            Number(projectStats.tests) || 0;

        const passed =
            Number(projectStats.passed) || 0;

        const failed =
            Number(projectStats.failed) || 0;

        const pending =
            Number(projectStats.pending) || 0;

        const skipped =
            Number(projectStats.skipped) || 0;

        const projectPassRate =
            tests > 0
                ? ((passed / tests) * 100).toFixed(1)
                : '0.0';

        let projectStatus = 'PASS';

        if (failed > 0) {
            projectStatus = 'FAIL';
        } else if (
            pending > 0 ||
            skipped > 0
        ) {
            projectStatus = 'WARNING';
        }

        projectRows.push({
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
                            text:
                                project.name ||
                                project.id ||
                                'Unknown',
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
                            text: String(tests),
                            horizontalAlignment:
                                'Center',
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
                            text: String(passed),
                            color: 'Good',
                            horizontalAlignment:
                                'Center',
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
                            text: String(failed),
                            color:
                                failed > 0
                                    ? 'Attention'
                                    : 'Default',
                            horizontalAlignment:
                                'Center',
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
                                String(
                                    pending +
                                    skipped
                                ),
                            color:
                                pending +
                                    skipped >
                                0
                                    ? 'Warning'
                                    : 'Default',
                            horizontalAlignment:
                                'Center',
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
                                `${projectPassRate}%`,
                            color:
                                failed > 0
                                    ? 'Attention'
                                    : 'Good',
                            horizontalAlignment:
                                'Center',
                            size: 'Small',
                        },
                    ],
                },
            ],
        });
    }

    /*
     * --------------------------------------------------------
     * Adaptive Card
     * --------------------------------------------------------
     */

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

                    body: [
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
                                `Overall Status: ${status}`,
                            weight: 'Bolder',
                            color: statusColor,
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
                                            totalPending +
                                            totalSkipped
                                        ),
                                },
                                {
                                    title:
                                        'Pass Rate',
                                    value:
                                        `${passPercentage}%`,
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
                                            text:
                                                'Project',
                                            weight:
                                                'Bolder',
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
                                                'Tests',
                                            weight:
                                                'Bolder',
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
                                                'Pass',
                                            weight:
                                                'Bolder',
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
                                                'Fail',
                                            weight:
                                                'Bolder',
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
                                                'N/E',
                                            weight:
                                                'Bolder',
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
                                                'Pass %',
                                            weight:
                                                'Bolder',
                                            size: 'Small',
                                        },
                                    ],
                                },
                            ],
                        },

                        ...projectRows,

                        {
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
                        },
                    ],
                },
            },
        ],
    };

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(card, null, 2)
    );

    console.log('');
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
        `Pass Rate: ${passPercentage}%`
    );
    console.log(
        `Status: ${status}`
    );
    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();