'use strict';

const fs = require('fs').promises;
const path = require('path');
const XlsxPopulate = require('xlsx-populate');

const CONFIG = {
    jsonPath:
        process.argv[2] ||
        './consolidated-report/consolidated.json',

    templatePath:
        './.github/scripts/template/consolidated-template.xlsm',

    outputDir:
        './consolidated-report',

    outputFile:
        'Consolidated_E2E_Test_Report.xlsm',
};

const SHEETS = {
    SUMMARY: 'Consolidated_Summary',
    CONFIGURATIONS: 'Configurations',
    DETAILS: 'Project_Details',
    COVERAGE: 'Test_Coverage',
    EXECUTION: 'Test_Execution_Summary',
};

function normalize(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase();
}

function displayName(value) {
    return String(value ?? '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, char =>
            char.toUpperCase()
        );
}

function getProjectIdFromResult(result) {
    return normalize(
        result?.title ||
        result?.file ||
        result?.fullFile
    );
}

function getProjectName(result) {
    return (
        result?.title ||
        result?.file ||
        result?.fullFile ||
        'Unknown Project'
    );
}

function emptyStats() {
    return {
        suites: 0,
        tests: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
    };
}

function addStats(target, stats) {
    target.suites +=
        Number(stats?.suites) || 0;

    target.tests +=
        Number(stats?.tests) || 0;

    target.passed +=
        Number(stats?.passes) ||
        Number(stats?.passed) ||
        0;

    target.failed +=
        Number(stats?.failures) ||
        Number(stats?.failed) ||
        0;

    target.pending +=
        Number(stats?.pending) || 0;

    target.skipped +=
        Number(stats?.skipped) || 0;
}

function getAllTests(suites) {
    const tests = [];

    function walk(currentSuites) {
        for (const suite of currentSuites || []) {
            if (suite.tests?.length) {
                tests.push(...suite.tests);
            }

            if (suite.suites?.length) {
                walk(suite.suites);
            }
        }
    }

    walk(suites);

    return tests;
}

function getSuiteStats(suite) {
    const stats = {
        passed: 0,
        failed: 0,
        pending: 0,
        skipped: 0,
    };

    function walk(currentSuite) {
        for (const test of currentSuite.tests || []) {
            if (
                test.state === 'passed' ||
                test.pass === true
            ) {
                stats.passed++;
            } else if (
                test.state === 'pending' ||
                test.pending === true
            ) {
                stats.pending++;
            } else if (
                test.state === 'skipped' ||
                test.skipped === true
            ) {
                stats.skipped++;
            } else {
                stats.failed++;
            }
        }

        for (const child of currentSuite.suites || []) {
            walk(child);
        }
    }

    walk(suite);

    return stats;
}

function collectSuites(
    suites,
    projectName,
    rows,
    parentSuite = null
) {
    for (const suite of suites || []) {
        const currentSuiteName =
            suite.title || 'Unnamed Suite';

        const moduleName =
            parentSuite ||
            currentSuiteName;

        const suiteName =
            parentSuite
                ? currentSuiteName
                : currentSuiteName;

        const stats =
            getSuiteStats(suite);

        rows.push({
            project: projectName,
            module: moduleName,
            suite: suiteName,
            passed: stats.passed,
            failed: stats.failed,
            pending: stats.pending,
            skipped: stats.skipped,
        });

        if (suite.suites?.length) {
            collectSuites(
                suite.suites,
                projectName,
                rows,
                moduleName
            );
        }
    }
}

function getProjectStatistics(report) {
    const stats = emptyStats();

    stats.suites =
        Number(report.stats?.suites) || 0;

    stats.tests =
        Number(report.stats?.tests) || 0;

    stats.passed =
        Number(report.stats?.passes) || 0;

    stats.failed =
        Number(report.stats?.failures) || 0;

    stats.pending =
        Number(report.stats?.pending) || 0;

    stats.skipped =
        Number(report.stats?.skipped) || 0;

    /*
     * If Mochawesome stats are missing,
     * calculate from the actual tests.
     */
    if (
        stats.tests === 0 &&
        report.results
    ) {
        const tests = getAllTests(
            report.results.flatMap(
                result => result.suites || []
            )
        );

        stats.tests = tests.length;

        for (const test of tests) {
            if (
                test.state === 'passed' ||
                test.pass === true
            ) {
                stats.passed++;
            } else if (
                test.pending ||
                test.state === 'pending'
            ) {
                stats.pending++;
            } else if (
                test.skipped ||
                test.state === 'skipped'
            ) {
                stats.skipped++;
            } else {
                stats.failed++;
            }
        }
    }

    return stats;
}

function getHeaderMap(sheet) {
    const headers = {};

    if (!sheet) {
        return headers;
    }

    const usedRange = sheet.usedRange();

    if (!usedRange) {
        return headers;
    }

    const startRow =
        usedRange.startCell().rowNumber();

    const endCol =
        usedRange.endCell().columnNumber();

    for (
        let col = 1;
        col <= endCol;
        col++
    ) {
        const value =
            sheet
                .cell(startRow, col)
                .value();

        if (value) {
            headers[
                normalize(value)
            ] = col;
        }
    }

    return headers;
}

function findColumn(
    headers,
    possibleNames
) {
    for (const name of possibleNames) {
        const column =
            headers[normalize(name)];

        if (column) {
            return column;
        }
    }

    return null;
}

function clearDataRows(
    sheet,
    startRow = 2
) {
    if (!sheet) {
        return;
    }

    const usedRange =
        sheet.usedRange();

    if (!usedRange) {
        return;
    }

    const endRow =
        usedRange.endCell().rowNumber();

    const endCol =
        usedRange.endCell().columnNumber();

    if (endRow >= startRow) {
        sheet
            .range(
                startRow,
                1,
                endRow,
                endCol
            )
            .clear();
    }
}

function writeRowsToSheet(
    sheet,
    rows
) {
    if (!sheet || rows.length === 0) {
        return;
    }

    const headers =
        getHeaderMap(sheet);

    const projectCol =
        findColumn(headers, [
            'Project',
            'Project Name',
        ]);

    const moduleCol =
        findColumn(headers, [
            'Module',
            'Module Name',
        ]);

    const suiteCol =
        findColumn(headers, [
            'Suite',
            'Suite Name',
        ]);

    const passCol =
        findColumn(headers, [
            'Pass',
            'Passed',
        ]);

    const failCol =
        findColumn(headers, [
            'Fail',
            'Failed',
        ]);

    const pendingCol =
        findColumn(headers, [
            'Not Executed',
            'Pending',
        ]);

    const skippedCol =
        findColumn(headers, [
            'Skipped',
        ]);

    let rowNumber = 2;

    for (const row of rows) {
        if (projectCol) {
            sheet
                .cell(rowNumber, projectCol)
                .value(row.project);
        }

        if (moduleCol) {
            sheet
                .cell(rowNumber, moduleCol)
                .value(row.module);
        }

        if (suiteCol) {
            sheet
                .cell(rowNumber, suiteCol)
                .value(row.suite);
        }

        if (passCol) {
            sheet
                .cell(rowNumber, passCol)
                .value(row.passed);
        }

        if (failCol) {
            sheet
                .cell(rowNumber, failCol)
                .value(row.failed);
        }

        if (pendingCol) {
            sheet
                .cell(rowNumber, pendingCol)
                .value(row.pending);
        }

        if (skippedCol) {
            sheet
                .cell(rowNumber, skippedCol)
                .value(row.skipped);
        }

        rowNumber++;
    }
}

function writeSummarySheet(
    sheet,
    projectRows
) {
    if (!sheet) {
        return;
    }

    clearDataRows(sheet, 2);

    const headers =
        getHeaderMap(sheet);

    const projectCol =
        findColumn(headers, [
            'Project',
            'Project Name',
        ]);

    const suitesCol =
        findColumn(headers, [
            'Suites',
            'Total Suites',
        ]);

    const testsCol =
        findColumn(headers, [
            'Tests',
            'Total Tests',
        ]);

    const passedCol =
        findColumn(headers, [
            'Pass',
            'Passed',
            'Passed Tests',
        ]);

    const failedCol =
        findColumn(headers, [
            'Fail',
            'Failed',
            'Failed Tests',
        ]);

    const pendingCol =
        findColumn(headers, [
            'Pending',
            'Not Executed',
        ]);

    const skippedCol =
        findColumn(headers, [
            'Skipped',
        ]);

    const passPercentCol =
        findColumn(headers, [
            'Pass %',
            'Pass Percentage',
            'Pass Rate',
        ]);

    let row = 2;

    for (const project of projectRows) {
        if (projectCol) {
            sheet
                .cell(row, projectCol)
                .value(project.name);
        }

        if (suitesCol) {
            sheet
                .cell(row, suitesCol)
                .value(project.stats.suites);
        }

        if (testsCol) {
            sheet
                .cell(row, testsCol)
                .value(project.stats.tests);
        }

        if (passedCol) {
            sheet
                .cell(row, passedCol)
                .value(project.stats.passed);
        }

        if (failedCol) {
            sheet
                .cell(row, failedCol)
                .value(project.stats.failed);
        }

        if (pendingCol) {
            sheet
                .cell(row, pendingCol)
                .value(project.stats.pending);
        }

        if (skippedCol) {
            sheet
                .cell(row, skippedCol)
                .value(project.stats.skipped);
        }

        if (passPercentCol) {
            const percent =
                project.stats.tests > 0
                    ? project.stats.passed /
                      project.stats.tests
                    : 0;

            sheet
                .cell(row, passPercentCol)
                .value(percent);

            sheet
                .cell(row, passPercentCol)
                .style({
                    numberFormat: '0.00%',
                });
        }

        row++;
    }

    /*
     * Overall row
     */
    const overall =
        projectRows.reduce(
            (result, project) => {
                result.suites +=
                    project.stats.suites;

                result.tests +=
                    project.stats.tests;

                result.passed +=
                    project.stats.passed;

                result.failed +=
                    project.stats.failed;

                result.pending +=
                    project.stats.pending;

                result.skipped +=
                    project.stats.skipped;

                return result;
            },
            emptyStats()
        );

    if (projectCol) {
        sheet
            .cell(row, projectCol)
            .value('TOTAL');
    }

    if (suitesCol) {
        sheet
            .cell(row, suitesCol)
            .value(overall.suites);
    }

    if (testsCol) {
        sheet
            .cell(row, testsCol)
            .value(overall.tests);
    }

    if (passedCol) {
        sheet
            .cell(row, passedCol)
            .value(overall.passed);
    }

    if (failedCol) {
        sheet
            .cell(row, failedCol)
            .value(overall.failed);
    }

    if (pendingCol) {
        sheet
            .cell(row, pendingCol)
            .value(overall.pending);
    }

    if (skippedCol) {
        sheet
            .cell(row, skippedCol)
            .value(overall.skipped);
    }

    if (passPercentCol) {
        const percent =
            overall.tests > 0
                ? overall.passed /
                  overall.tests
                : 0;

        sheet
            .cell(row, passPercentCol)
            .value(percent);

        sheet
            .cell(row, passPercentCol)
            .style({
                numberFormat: '0.00%',
            });
    }

    sheet
        .range(
            row,
            1,
            row,
            Math.max(
                Object.values(headers).length,
                1
            )
        )
        .style({
            bold: true,
        });
}

function writeExecutionSummary(
    sheet,
    consolidated
) {
    if (!sheet) {
        return;
    }

    const headers =
        getHeaderMap(sheet);

    /*
     * Try to populate a table if the
     * sheet has Project / Tests columns.
     */
    const projectCol =
        findColumn(headers, [
            'Project',
            'Project Name',
        ]);

    const testsCol =
        findColumn(headers, [
            'Tests',
            'Total Tests',
        ]);

    const passCol =
        findColumn(headers, [
            'Pass',
            'Passed',
        ]);

    const failCol =
        findColumn(headers, [
            'Fail',
            'Failed',
        ]);

    const pendingCol =
        findColumn(headers, [
            'Pending',
            'Not Executed',
        ]);

    if (
        projectCol &&
        testsCol
    ) {
        clearDataRows(sheet, 2);

        let row = 2;

        for (
            const project of
            consolidated.meta.projects
        ) {
            if (projectCol) {
                sheet
                    .cell(row, projectCol)
                    .value(project.name);
            }

            if (testsCol) {
                sheet
                    .cell(row, testsCol)
                    .value(
                        project.stats.tests
                    );
            }

            if (passCol) {
                sheet
                    .cell(row, passCol)
                    .value(
                        project.stats.passed
                    );
            }

            if (failCol) {
                sheet
                    .cell(row, failCol)
                    .value(
                        project.stats.failed
                    );
            }

            if (pendingCol) {
                sheet
                    .cell(row, pendingCol)
                    .value(
                        project.stats.pending
                    );
            }

            row++;
        }
    }

    /*
     * Also update common summary cells
     * if the template contains labels.
     */
    const usedRange =
        sheet.usedRange();

    if (!usedRange) {
        return;
    }

    const endRow =
        usedRange.endCell().rowNumber();

    const endCol =
        usedRange.endCell().columnNumber();

    for (
        let row = 1;
        row <= endRow;
        row++
    ) {
        for (
            let col = 1;
            col <= endCol;
            col++
        ) {
            const value =
                sheet
                    .cell(row, col)
                    .value();

            if (!value) {
                continue;
            }

            const label =
                normalize(value);

            const target =
                sheet.cell(row, col + 1);

            if (
                label === 'total projects'
            ) {
                target.value(
                    consolidated.meta
                        .projectCount
                );
            }

            if (
                label === 'total tests'
            ) {
                target.value(
                    consolidated.stats.tests
                );
            }

            if (
                label === 'passed'
            ) {
                target.value(
                    consolidated.stats.passes
                );
            }

            if (
                label === 'failed'
            ) {
                target.value(
                    consolidated.stats.failures
                );
            }

            if (
                label === 'pending' ||
                label === 'not executed'
            ) {
                target.value(
                    consolidated.stats.pending
                );
            }

            if (
                label === 'pass %' ||
                label === 'pass percentage'
            ) {
                const percent =
                    consolidated.stats
                        .tests > 0
                        ? consolidated.stats
                              .passes /
                          consolidated.stats
                              .tests
                        : 0;

                target
                    .value(percent)
                    .style({
                        numberFormat:
                            '0.00%',
                    });
            }
        }
    }
}

async function saveWorkbook(workbook) {
    await fs.mkdir(
        CONFIG.outputDir,
        {
            recursive: true,
        }
    );

    const outputPath =
        path.resolve(
            CONFIG.outputDir,
            CONFIG.outputFile
        );

    await workbook.toFileAsync(
        outputPath
    );

    return outputPath;
}

async function main() {
    console.log(
        '========================================'
    );

    console.log(
        'GENERATING CONSOLIDATED EXCEL REPORT'
    );

    console.log(
        '========================================'
    );

    /*
     * ----------------------------------------------------
     * Read consolidated JSON
     * ----------------------------------------------------
     */

    const content =
        await fs.readFile(
            CONFIG.jsonPath,
            'utf8'
        );

    const consolidated =
        JSON.parse(content);

    if (
        !consolidated.results ||
        !Array.isArray(
            consolidated.results
        )
    ) {
        throw new Error(
            'Invalid consolidated JSON: results[] not found.'
        );
    }

    /*
     * ----------------------------------------------------
     * Load Excel template
     * ----------------------------------------------------
     */

    const workbook =
        await XlsxPopulate.fromFileAsync(
            CONFIG.templatePath
        );

    /*
     * ----------------------------------------------------
     * Build dynamic project list
     * ----------------------------------------------------
     */

    const projectRows = [];

    for (
        const result
        of consolidated.results
    ) {
        const name =
            getProjectName(result);

        const projectStats =
            getProjectStatistics({
                stats:
                    consolidated.meta
                        ?.projects
                        ?.find(
                            p =>
                                normalize(
                                    p.name
                                ) ===
                                normalize(
                                    name
                                )
                        )
                        ?.stats,

                results: [
                    {
                        suites:
                            result.suites,
                    },
                ],
            });

        /*
         * Prefer the statistics stored in
         * consolidated.meta.projects.
         */
        const metaProject =
            consolidated.meta
                ?.projects
                ?.find(
                    p =>
                        normalize(
                            p.name
                        ) ===
                        normalize(name)
                );

        if (metaProject?.stats) {
            projectRows.push({
                id:
                    metaProject.id ||
                    normalize(name),

                name,

                stats: {
                    suites:
                        Number(
                            metaProject
                                .stats
                                .suites
                        ) || 0,

                    tests:
                        Number(
                            metaProject
                                .stats
                                .tests
                        ) || 0,

                    passed:
                        Number(
                            metaProject
                                .stats
                                .passed
                        ) || 0,

                    failed:
                        Number(
                            metaProject
                                .stats
                                .failed
                        ) || 0,

                    pending:
                        Number(
                            metaProject
                                .stats
                                .pending
                        ) || 0,

                    skipped:
                        Number(
                            metaProject
                                .stats
                                .skipped
                        ) || 0,
                },

                result,
            });
        } else {
            projectRows.push({
                id: normalize(name),

                name,

                stats: projectStats,

                result,
            });
        }
    }

    /*
     * ----------------------------------------------------
     * Create Configuration rows
     * ----------------------------------------------------
     */

    const configurationRows = [];

    for (
        const project
        of projectRows
    ) {
        const suites =
            project.result.suites || [];

        collectSuites(
            suites,
            project.name,
            configurationRows
        );
    }

    /*
     * ----------------------------------------------------
     * Fill Consolidated Summary
     * ----------------------------------------------------
     */

    const summarySheet =
        workbook.sheet(
            SHEETS.SUMMARY
        );

    if (summarySheet) {
        writeSummarySheet(
            summarySheet,
            projectRows
        );

        console.log(
            '✓ Consolidated_Summary updated'
        );
    } else {
        console.warn(
            `WARNING: Sheet "${SHEETS.SUMMARY}" not found.`
        );
    }

    /*
     * ----------------------------------------------------
     * Fill Configurations
     * ----------------------------------------------------
     */

    const configurationSheet =
        workbook.sheet(
            SHEETS.CONFIGURATIONS
        );

    if (configurationSheet) {
        clearDataRows(
            configurationSheet,
            2
        );

        writeRowsToSheet(
            configurationSheet,
            configurationRows
        );

        console.log(
            '✓ Configurations updated'
        );
    } else {
        console.warn(
            `WARNING: Sheet "${SHEETS.CONFIGURATIONS}" not found.`
        );
    }

    /*
     * ----------------------------------------------------
     * Fill Project Details
     * ----------------------------------------------------
     */

    const detailsSheet =
        workbook.sheet(
            SHEETS.DETAILS
        );

    if (detailsSheet) {
        clearDataRows(
            detailsSheet,
            2
        );

        const detailsRows =
            projectRows.map(
                project => ({
                    project:
                        project.name,

                    module: '',

                    suite:
                        `${project.stats.suites} Suites`,

                    passed:
                        project.stats.passed,

                    failed:
                        project.stats.failed,

                    pending:
                        project.stats.pending,

                    skipped:
                        project.stats.skipped,
                })
            );

        writeRowsToSheet(
            detailsSheet,
            detailsRows
        );

        console.log(
            '✓ Project_Details updated'
        );
    }

    /*
     * ----------------------------------------------------
     * Fill Test Coverage
     * ----------------------------------------------------
     */

    const coverageSheet =
        workbook.sheet(
            SHEETS.COVERAGE
        );

    if (coverageSheet) {
        clearDataRows(
            coverageSheet,
            2
        );

        const coverageRows =
            projectRows.map(
                project => {
                    const tests =
                        project.stats.tests;

                    const passed =
                        project.stats.passed;

                    return {
                        project:
                            project.name,

                        module: '',

                        suite:
                            'Overall',

                        passed,

                        failed:
                            project.stats
                                .failed,

                        pending:
                            project.stats
                                .pending,

                        skipped:
                            project.stats
                                .skipped,

                        coverage:
                            tests > 0
                                ? passed /
                                  tests
                                : 0,
                    };
                }
            );

        writeRowsToSheet(
            coverageSheet,
            coverageRows
        );

        console.log(
            '✓ Test_Coverage updated'
        );
    }

    /*
     * ----------------------------------------------------
     * Fill Test Execution Summary
     * ----------------------------------------------------
     */

    const executionSheet =
        workbook.sheet(
            SHEETS.EXECUTION
        );

    if (executionSheet) {
        writeExecutionSummary(
            executionSheet,
            consolidated
        );

        console.log(
            '✓ Test_Execution_Summary updated'
        );
    }

    /*
     * ----------------------------------------------------
     * Add report metadata
     * ----------------------------------------------------
     */

    const generatedDate =
        new Date().toLocaleString(
            'en-GB',
            {
                timeZone:
                    'Asia/Colombo',
            }
        );

    for (
        const sheetName of [
            SHEETS.SUMMARY,
            SHEETS.DETAILS,
            SHEETS.COVERAGE,
            SHEETS.EXECUTION,
        ]
    ) {
        const sheet =
            workbook.sheet(
                sheetName
            );

        if (!sheet) {
            continue;
        }

        const usedRange =
            sheet.usedRange();

        if (!usedRange) {
            continue;
        }

        const endRow =
            usedRange.endCell()
                .rowNumber();

        const endCol =
            usedRange.endCell()
                .columnNumber();

        /*
         * Search for "Generated Date"
         * label and populate next cell.
         */
        for (
            let row = 1;
            row <= endRow;
            row++
        ) {
            for (
                let col = 1;
                col <= endCol;
                col++
            ) {
                const value =
                    sheet
                        .cell(row, col)
                        .value();

                if (
                    normalize(value) ===
                    'generated date'
                ) {
                    sheet
                        .cell(
                            row,
                            col + 1
                        )
                        .value(
                            generatedDate
                        );
                }
            }
        }
    }

    /*
     * ----------------------------------------------------
     * Save
     * ----------------------------------------------------
     */

    const outputPath =
        await saveWorkbook(
            workbook
        );

    console.log('');
    console.log(
        '========================================'
    );

    console.log(
        'CONSOLIDATED EXCEL CREATED'
    );

    console.log(
        '========================================'
    );

    console.log(
        `Projects: ${projectRows.length}`
    );

    console.log(
        `Tests: ${consolidated.stats.tests}`
    );

    console.log(
        `Passed: ${consolidated.stats.passes}`
    );

    console.log(
        `Failed: ${consolidated.stats.failures}`
    );

    console.log(
        `Pending: ${consolidated.stats.pending}`
    );

    console.log(
        `Output: ${outputPath}`
    );
}

main().catch(error => {
    console.error('');
    console.error(
        'ERROR generating consolidated Excel:'
    );
    console.error(error);
    process.exit(1);
});