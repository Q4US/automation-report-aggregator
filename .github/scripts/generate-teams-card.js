'use strict';

const fs = require('fs');

const JSON_PATH =
    process.argv[2] ||
    './consolidated-report/consolidated.json';

const OUTPUT_FILE =
    process.argv[3] ||
    './teams-card.json';


// ============================================================
// Helpers
// ============================================================

function toNumber(value) {
    return Number(value) || 0;
}


// ============================================================
// Get project statistics
// ============================================================

function getProjectStats(project) {

    // Preferred source:
    // consolidated.json -> meta.projects[].stats
    if (project.stats) {

        return {
            tests: toNumber(project.stats.tests),
            passed: toNumber(project.stats.passed),
            failed: toNumber(project.stats.failed),
            pending: toNumber(project.stats.pending),
        };
    }


    // --------------------------------------------------------
    // Fallback calculation
    // --------------------------------------------------------

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


// ============================================================
// Create one project row
// ============================================================

function createProjectRow(project) {

    const stats = getProjectStats(project);


    const passRate =
        stats.tests > 0
            ? (
                (stats.passed / stats.tests) *
                100
            ).toFixed(1)
            : '0.0';


    let passRateColor = 'Good';


    if (stats.failed > 0) {
        passRateColor = 'Attention';
    }

    else if (stats.pending > 0) {
        passRateColor = 'Warning';
    }


    return {

        type: 'ColumnSet',

        separator: true,

        spacing: 'Small',


        columns: [

            // =================================================
            // Project
            // =================================================

            {
                type: 'Column',

                width: '3',

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


            // =================================================
            // Tests
            // =================================================

            {
                type: 'Column',

                width: '1',

                items: [

                    {
                        type: 'TextBlock',

                        text:
                            String(stats.tests),

                        size: 'Small',

                        horizontalAlignment:
                            'Right',
                    },

                ],
            },


            // =================================================
            // Pass
            // =================================================

            {
                type: 'Column',

                width: '1',

                items: [

                    {
                        type: 'TextBlock',

                        text:
                            String(stats.passed),

                        size: 'Small',

                        color:
                            stats.passed > 0
                                ? 'Good'
                                : 'Default',

                        horizontalAlignment:
                            'Right',
                    },

                ],
            },


            // =================================================
            // Fail
            // =================================================

            {
                type: 'Column',

                width: '1',

                items: [

                    {
                        type: 'TextBlock',

                        text:
                            String(stats.failed),

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


            // =================================================
            // Not Executed
            // =================================================

            {
                type: 'Column',

                width: '1',

                items: [

                    {
                        type: 'TextBlock',

                        text:
                            String(stats.pending),

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


            // =================================================
            // Pass %
            // =================================================

            {
                type: 'Column',

                width: '1',

                items: [

                    {
                        type: 'TextBlock',

                        text:
                            `${passRate}%`,

                        size: 'Small',

                        color:
                            passRateColor,

                        horizontalAlignment:
                            'Right',
                    },

                ],
            },

        ],
    };
}


// ============================================================
// Main
// ============================================================

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


    // ========================================================
    // Validate consolidated JSON
    // ========================================================

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


    // ========================================================
    // Get projects dynamically
    // ========================================================

    let projects = [];


    // Preferred source:
    // consolidated.json -> meta.projects

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


    // Fallback:
    // consolidated.json -> results

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


    // ========================================================
    // Overall statistics
    // ========================================================

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


    // ========================================================
    // Adaptive Card body
    // ========================================================

    const body = [

        // ====================================================
        // Title
        // ====================================================

        {
            type: 'TextBlock',

            text:
                'MFE E2E Test Reports',

            weight: 'Bolder',

            size: 'Large',
        },


        // ====================================================
        // Overall Summary
        // ====================================================

        {
            type: 'FactSet',

            spacing: 'Medium',

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


        // ====================================================
        // Project Results title
        // ====================================================

        {
            type: 'TextBlock',

            text:
                'Project Results',

            weight: 'Bolder',

            size: 'Medium',

            spacing: 'Medium',
        },


        // ====================================================
        // Project table header
        // ====================================================

        {
            type: 'ColumnSet',

            separator: true,

            spacing: 'Small',

            columns: [

                // ------------------------------------------------
                // Project
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '3',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'Project',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                        },

                    ],
                },


                // ------------------------------------------------
                // Tests
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '1',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'Tests',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                            horizontalAlignment:
                                'Right',

                        },

                    ],
                },


                // ------------------------------------------------
                // Pass
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '1',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'Pass',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                            horizontalAlignment:
                                'Right',

                        },

                    ],
                },


                // ------------------------------------------------
                // Fail
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '1',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'Fail',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                            horizontalAlignment:
                                'Right',

                        },

                    ],
                },


                // ------------------------------------------------
                // Not Executed
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '1',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'N/E',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                            horizontalAlignment:
                                'Right',

                        },

                    ],
                },


                // ------------------------------------------------
                // Pass %
                // ------------------------------------------------

                {
                    type: 'Column',

                    width: '1',

                    items: [

                        {
                            type: 'TextBlock',

                            text:
                                'Pass %',

                            weight:
                                'Bolder',

                            size:
                                'Small',

                            horizontalAlignment:
                                'Right',

                        },

                    ],
                },

            ],
        },

    ];


    // ========================================================
    // Add one row per MFE project
    // ========================================================

    for (const project of projects) {

        body.push(
            createProjectRow(
                project
            )
        );
    }


    // ========================================================
    // Generated timestamp
    // ========================================================

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


    // ========================================================
    // GitHub Actions / Artifact button
    // ========================================================

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


    // ========================================================
    // Final Adaptive Card
    // ========================================================

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

                    body:
                        body,

                    actions:
                        actions,

                    msteams: {
                        width: 'Full',
                    },

                },

            },

        ],

    };


    // ========================================================
    // Write card JSON
    // ========================================================

    fs.writeFileSync(

        OUTPUT_FILE,

        JSON.stringify(
            card,
            null,
            2
        )

    );


    // ========================================================
    // Validate generated file
    // ========================================================

    const fileSize =
        fs.statSync(
            OUTPUT_FILE
        ).size;


    const fileSizeKB =
        (
            fileSize /
            1024
        ).toFixed(2);


    // ========================================================
    // Console output
    // ========================================================

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
        `Card size: ${fileSizeKB} KB`
    );


    console.log(
        `Run URL: ${runUrl}`
    );


    console.log(
        `Output: ${OUTPUT_FILE}`
    );


    // ========================================================
    // Teams payload size warning
    // ========================================================

    if (fileSize > 25 * 1024) {

        console.warn(
            `WARNING: Teams card is ${fileSizeKB} KB.`
        );

        console.warn(
            'Keep the card below the Teams payload limit.'
        );
    }
}


// ============================================================
// Execute
// ============================================================

main();