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
    SUMMARY: 'Test_Execution_Summary',
    CONFIGURATIONS: 'Configurations',
};

/* ============================================================
 * Utility functions
 * ============================================================ */

function normalize(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase();
}

function getProjectName(result) {
    return (
        result?.title ||
        result?.project ||
        result?.file ||
        result?.fullFile ||
        'Unknown Project'
    );
}

function getProjectId(result) {
    return normalize(
        result?.projectId ||
        result?.id ||
        result?.title ||
        result?.project ||
        result?.file ||
        result?.fullFile
    );
}

/* ============================================================
 * Statistics
 * ============================================================ */

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

function getProjectStatistics(report) {
    const stats = emptyStats();

    stats.suites =
        Number(report?.stats?.suites) || 0;

    stats.tests =
        Number(report?.stats?.tests) || 0;

    stats.passed =
        Number(report?.stats?.passes) ||
        Number(report?.stats?.passed) ||
        0;

    stats.failed =
        Number(report?.stats?.failures) ||
        Number(report?.stats?.failed) ||
        0;

    stats.pending =
        Number(report?.stats?.pending) || 0;

    stats.skipped =
        Number(report?.stats?.skipped) || 0;

    /*
     * If Mochawesome statistics are unavailable,
     * calculate them from the actual tests.
     */
    if (
        stats.tests === 0 &&
        Array.isArray(report?.results)
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

/* ============================================================
 * Suite / configuration processing
 * ============================================================ */

function collectSuites(
    suites,
    projectName,
    rows,
    parentModule = null
) {
    for (const suite of suites || []) {
        const suiteName =
            suite.title || 'Unnamed Suite';

        /*
         * Top-level suite becomes the module.
         * Nested suite remains under that module.
         */
        const moduleName =
            parentModule || suiteName;

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

/* ============================================================
 * Excel helpers
 * ============================================================ */

function getHeaderRow(
    sheet,
    requiredHeaders = []
) {
    if (!sheet) {
        return null;
    }

    const usedRange = sheet.usedRange();

    if (!usedRange) {
        return null;
    }

    const startRow =
        usedRange.startCell().rowNumber();

    const endRow =
        usedRange.endCell().rowNumber();

    const endCol =
        usedRange.endCell().columnNumber();

    for (
        let row = startRow;
        row <= endRow;
        row++
    ) {
        const values = [];

        for (
            let col = 1;
            col <= endCol;
            col++
        ) {
            values.push(
                normalize(
                    sheet.cell(row, col).value()
                )
            );
        }

        const matched =
            requiredHeaders.every(header =>
                values.includes(
                    normalize(header)
                )
            );

        if (matched) {
            return row;
        }
    }

    return null;
}

function getHeaderMap(
    sheet,
    headerRow
) {
    const headers = {};

    if (!sheet || !headerRow) {
        return headers;
    }

    const usedRange = sheet.usedRange();

    if (!usedRange) {
        return headers;
    }

    const endCol =
        usedRange.endCell().columnNumber();

    for (
        let col = 1;
        col <= endCol;
        col++
    ) {
        const value =
            sheet
                .cell(headerRow, col)
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
    startRow
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

/* ============================================================
 * Configurations
 *
 * This keeps the configuration functionality dynamic.
 * No project names are hard-coded.
 * ============================================================ */

function writeConfigurations(
    sheet,
    configurationRows
) {
    if (!sheet) {
        throw new Error(
            'Configurations sheet not found.'
        );
    }

    const headerRow =
        getHeaderRow(
            sheet,
            [
                'Project',
                'Module',
                'Suite',
            ]
        );

    if (!headerRow) {
        throw new Error(
            'Could not find Project / Module / Suite headers in Configurations sheet.'
        );
    }

    const headers =
        getHeaderMap(
            sheet,
            headerRow
        );

    const projectCol =
        findColumn(
            headers,
            [
                'Project',
                'Project Name',
            ]
        );

    const moduleCol =
        findColumn(
            headers,
            [
                'Module',
                'Module Name',
            ]
        );

    const suiteCol =
        findColumn(
            headers,
            [
                'Suite',
                'Suite Name',
            ]
        );

    const passCol =
        findColumn(
            headers,
            [
                'Pass',
                'Passed',
            ]
        );

    const failCol =
        findColumn(
            headers,
            [
                'Fail',
                'Failed',
            ]
        );

    const notExecutedCol =
        findColumn(
            headers,
            [
                'Not Executed',
                'Pending',
            ]
        );

    const skippedCol =
        findColumn(
            headers,
            [
                'Skipped',
            ]
        );

    const startRow =
        headerRow + 1;

    clearDataRows(
        sheet,
        startRow
    );

    let rowNumber = startRow;

    for (const row of configurationRows) {
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

        if (notExecutedCol) {
            sheet
                .cell(rowNumber, notExecutedCol)
                .value(row.pending);
        }

        if (skippedCol) {
            sheet
                .cell(rowNumber, skippedCol)
                .value(row.skipped);
        }

        rowNumber++;
    }

    console.log(
        `✓ Configurations updated: ${configurationRows.length} rows`
    );
}

/* ============================================================
 * Test Execution Summary
 * ============================================================ */

function writeExecutionSummary(
    sheet,
    projectRows,
    consolidatedStats
) {
    if (!sheet) {
        throw new Error(
            'Test_Execution_Summary sheet not found.'
        );
    }

    /*
     * --------------------------------------------------------
     * Existing template structure:
     *
     * B5:E5
     * Tests | Pass | Fail | Not Executed
     *
     * G5:J5
     * Module | Pass | Fail | Not Executed
     *
     * We preserve the template and populate the data.
     * --------------------------------------------------------
     */

    const headerRow = 5;

    const testsCol = 2;       // B
    const passCol = 3;        // C
    const failCol = 4;        // D
    const pendingCol = 5;     // E

    const moduleCol = 7;      // G
    const modulePassCol = 8;  // H
    const moduleFailCol = 9;  // I
    const modulePendingCol = 10; // J

    /*
     * --------------------------------------------------------
     * Clear old dynamic project/module data.
     * Keep the header and template title.
     * --------------------------------------------------------
     */

    /*
     * Left section
     *
     * Start at row 6.
     *
     * We need enough rows for all projects.
     */
    const projectStartRow = 6;

    /*
     * Find existing TOTAL row if present.
     */
    const usedRange =
        sheet.usedRange();

    let totalRow = null;

    if (usedRange) {
        const endRow =
            usedRange.endCell()
                .rowNumber();

        for (
            let row = projectStartRow;
            row <= endRow;
            row++
        ) {
            const value =
                normalize(
                    sheet
                        .cell(row, testsCol)
                        .value()
                );

            if (value === 'total') {
                totalRow = row;
                break;
            }
        }
    }

    /*
     * If the template has a TOTAL row, clear rows
     * between the project start and TOTAL.
     */
    if (totalRow) {
        if (totalRow > projectStartRow) {
            sheet
                .range(
                    projectStartRow,
                    testsCol,
                    totalRow - 1,
                    pendingCol
                )
                .clear();
        }
    }

    /*
     * If there are more projects than the available rows,
     * use rows above TOTAL and move TOTAL downward by
     * inserting rows.
     *
     * This keeps the report dynamic when a new MFE is added.
     */
    const requiredProjectRows =
        projectRows.length;

    if (totalRow) {
        const availableRows =
            totalRow - projectStartRow;

        const additionalRows =
            requiredProjectRows -
            availableRows;

        if (additionalRows > 0) {
            /*
             * Insert rows before TOTAL.
             *
             * xlsx-populate supports inserting a range.
             */
            sheet
                .range(
                    totalRow,
                    1,
                    totalRow + additionalRows - 1,
                    sheet.usedRange()
                        .endCell()
                        .columnNumber()
                )
                .insert('down');

            totalRow += additionalRows;
        }
    } else {
        totalRow =
            projectStartRow +
            requiredProjectRows;
    }

    /*
     * --------------------------------------------------------
     * Write project results
     * --------------------------------------------------------
     */

    let row = projectStartRow;

    for (const project of projectRows) {
        sheet
            .cell(row, testsCol)
            .value(project.name);

        sheet
            .cell(row, passCol)
            .value(project.stats.passed);

        sheet
            .cell(row, failCol)
            .value(project.stats.failed);

        sheet
            .cell(row, pendingCol)
            .value(
                project.stats.pending +
                project.stats.skipped
            );

        row++;
    }

    /*
     * --------------------------------------------------------
     * Overall total
     * --------------------------------------------------------
     */

    const total = projectRows.reduce(
        (result, project) => {
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
        {
            tests: 0,
            passed: 0,
            failed: 0,
            pending: 0,
            skipped: 0,
        }
    );

    /*
     * Put TOTAL after all projects.
     */
    sheet
        .cell(totalRow, testsCol)
        .value('Total');

    sheet
        .cell(totalRow, passCol)
        .value(total.passed);

    sheet
        .cell(totalRow, failCol)
        .value(total.failed);

    sheet
        .cell(totalRow, pendingCol)
        .value(
            total.pending +
            total.skipped
        );

    /*
     * Preserve total-row formatting.
     */
    sheet
        .range(
            totalRow,
            testsCol,
            totalRow,
            pendingCol
        )
        .style({
            bold: true,
        });

    /*
     * --------------------------------------------------------
     * Overall Results row
     *
     * Template contains:
     *
     * B9 = Overall Results
     * C9 = Pass
     * D9 = Fail
     * E9 = Not Executed
     *
     * B10:E10 = values
     * --------------------------------------------------------
     */

    let overallLabelRow = null;

    const currentUsedRange =
        sheet.usedRange();

    if (currentUsedRange) {
        const endRow =
            currentUsedRange.endCell()
                .rowNumber();

        for (
            let r = 1;
            r <= endRow;
            r++
        ) {
            if (
                normalize(
                    sheet
                        .cell(r, testsCol)
                        .value()
                ) === 'overall results'
            ) {
                overallLabelRow = r;
                break;
            }
        }
    }

    if (overallLabelRow) {
        const valueRow =
            overallLabelRow + 1;

        sheet
            .cell(valueRow, passCol)
            .value(total.passed);

        sheet
            .cell(valueRow, failCol)
            .value(total.failed);

        sheet
            .cell(valueRow, pendingCol)
            .value(
                total.pending +
                total.skipped
            );
    }

    /*
     * --------------------------------------------------------
     * Right-side project/module details
     *
     * The updated template has:
     *
     * G5 = Module
     * H5 = Pass
     * I5 = Fail
     * J5 = Not Executed
     *
     * We populate it with project names.
     *
     * If the template already contains module rows,
     * they will be replaced with the current project list.
     * --------------------------------------------------------
     */

    const moduleStartRow = 6;

    /*
     * Clear existing right-side data.
     */
    const rightEndRow =
        Math.max(
            sheet.usedRange()
                ? sheet.usedRange()
                    .endCell()
                    .rowNumber()
                : moduleStartRow,
            moduleStartRow +
                projectRows.length
        );

    sheet
        .range(
            moduleStartRow,
            moduleCol,
            rightEndRow,
            modulePendingCol
        )
        .clear();

    row = moduleStartRow;

    for (const project of projectRows) {
        sheet
            .cell(row, moduleCol)
            .value(project.name);

        sheet
            .cell(row, modulePassCol)
            .value(project.stats.passed);

        sheet
            .cell(row, moduleFailCol)
            .value(project.stats.failed);

        sheet
            .cell(row, modulePendingCol)
            .value(
                project.stats.pending +
                project.stats.skipped
            );

        row++;
    }

    /*
     * Add right-side total.
     */
    sheet
        .cell(row, moduleCol)
        .value('Total');

    sheet
        .cell(row, modulePassCol)
        .value(total.passed);

    sheet
        .cell(row, moduleFailCol)
        .value(total.failed);

    sheet
        .cell(row, modulePendingCol)
        .value(
            total.pending +
            total.skipped
        );

    sheet
        .range(
            row,
            moduleCol,
            row,
            modulePendingCol
        )
        .style({
            bold: true,
        });

    /*
     * --------------------------------------------------------
     * Release information
     * --------------------------------------------------------
     */

    const generatedDate =
        new Date().toLocaleDateString(
            'en-GB',
            {
                timeZone: 'Asia/Colombo',
            }
        );

    /*
     * Find "Release Date" and populate next cell.
     */
    const summaryUsedRange =
        sheet.usedRange();

    if (summaryUsedRange) {
        const endRow =
            summaryUsedRange.endCell()
                .rowNumber();

        const endCol =
            summaryUsedRange.endCell()
                .columnNumber();

        for (
            let r = 1;
            r <= endRow;
            r++
        ) {
            for (
                let c = 1;
                c <= endCol;
                c++
            ) {
                const value =
                    normalize(
                        sheet
                            .cell(r, c)
                            .value()
                    );

                if (
                    value === 'release date'
                ) {
                    sheet
                        .cell(r, c + 1)
                        .value(
                            generatedDate
                        );
                }
            }
        }
    }

    console.log(
        `✓ Test_Execution_Summary updated: ${projectRows.length} projects`
    );
}

/* ============================================================
 * Save workbook
 * ============================================================ */

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

/* ============================================================
 * MAIN
 * ============================================================ */

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
     * --------------------------------------------------------
     * Read consolidated JSON
     * --------------------------------------------------------
     */

    const content =
        await fs.readFile(
            CONFIG.jsonPath,
            'utf8'
        );

    const consolidated =
        JSON.parse(content);

    if (
        !Array.isArray(
            consolidated.results
        )
    ) {
        throw new Error(
            'Invalid consolidated JSON: results[] not found.'
        );
    }

    /*
     * --------------------------------------------------------
     * Load Excel template
     * --------------------------------------------------------
     */

    console.log(
        `Template: ${CONFIG.templatePath}`
    );

    const workbook =
        await XlsxPopulate.fromFileAsync(
            CONFIG.templatePath
        );

    /*
     * --------------------------------------------------------
     * Build project list dynamically
     *
     * New MFEs automatically appear here.
     * No project names are hard-coded.
     * --------------------------------------------------------
     */

    const projectRows = [];

    for (
        const result of
        consolidated.results
    ) {
        const name =
            getProjectName(result);

        const id =
            getProjectId(result);

        /*
         * First preference:
         * consolidated.meta.projects
         */
        const metaProject =
            consolidated.meta
                ?.projects
                ?.find(project =>
                    normalize(
                        project.id
                    ) === normalize(id)
                ) ||
            consolidated.meta
                ?.projects
                ?.find(project =>
                    normalize(
                        project.name
                    ) === normalize(name)
                );

        let stats;

        if (metaProject?.stats) {
            stats = {
                suites:
                    Number(
                        metaProject.stats.suites
                    ) || 0,

                tests:
                    Number(
                        metaProject.stats.tests
                    ) || 0,

                passed:
                    Number(
                        metaProject.stats.passed
                    ) || 0,

                failed:
                    Number(
                        metaProject.stats.failed
                    ) || 0,

                pending:
                    Number(
                        metaProject.stats.pending
                    ) || 0,

                skipped:
                    Number(
                        metaProject.stats.skipped
                    ) || 0,
            };
        } else {
            /*
             * Fallback:
             * calculate directly from result.
             */
            stats =
                getProjectStatistics({
                    stats:
                        result.stats,

                    results: [
                        {
                            suites:
                                result.suites ||
                                [],
                        },
                    ],
                });
        }

        projectRows.push({
            id,
            name,
            stats,
            result,
        });
    }

    console.log('');
    console.log(
        `Projects found: ${projectRows.length}`
    );

    for (const project of projectRows) {
        console.log(
            `  ${project.name}: ` +
            `${project.stats.tests} tests, ` +
            `${project.stats.passed} passed, ` +
            `${project.stats.failed} failed, ` +
            `${project.stats.pending} pending`
        );
    }

    /*
     * --------------------------------------------------------
     * Create Configuration rows
     * --------------------------------------------------------
     */

    const configurationRows = [];

    for (
        const project of projectRows
    ) {
        collectSuites(
            project.result.suites || [],
            project.name,
            configurationRows
        );
    }

    /*
     * --------------------------------------------------------
     * Update Test Execution Summary
     * --------------------------------------------------------
     */

    const summarySheet =
        workbook.sheet(
            SHEETS.SUMMARY
        );

    if (!summarySheet) {
        throw new Error(
            `Sheet "${SHEETS.SUMMARY}" not found in template.`
        );
    }

    writeExecutionSummary(
        summarySheet,
        projectRows,
        consolidated.stats
    );

    /*
     * --------------------------------------------------------
     * Update Configurations
     * --------------------------------------------------------
     */

    const configurationSheet =
        workbook.sheet(
            SHEETS.CONFIGURATIONS
        );

    if (!configurationSheet) {
        throw new Error(
            `Sheet "${SHEETS.CONFIGURATIONS}" not found in template.`
        );
    }

    writeConfigurations(
        configurationSheet,
        configurationRows
    );

    /*
     * --------------------------------------------------------
     * Save
     * --------------------------------------------------------
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