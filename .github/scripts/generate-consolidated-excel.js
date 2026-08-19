'use strict';

const fs = require('fs').promises;
const path = require('path');
const XlsxPopulate = require('xlsx-populate');

const CONFIG = {
    jsonPath:
        process.argv[2] ||
        './consolidated-report/consolidated.json',

    templatePath:
        process.argv[3] ||
        './.github/scripts/template/consolidated-template.xlsm',

    outputDir:
        process.argv[4] ||
        './consolidated-report/final',
};

const SHEETS = {
    summary: 'Test_Execution_Summary',
    details: 'Project_Details',
};

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
    const stats =
        emptyStats();

    for (
        const test of
        suite?.tests || []
    ) {
        stats.total++;

        const state =
            getTestState(test);

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
                 * Unknown states should not be
                 * counted as passed.
                 */
                stats.failed++;
                break;
        }
    }

    for (
        const child of
        suite?.suites || []
    ) {
        addStats(
            stats,
            getSuiteStats(child)
        );
    }

    return stats;
}

function getProjectStats(project) {
    const stats =
        emptyStats();

    for (
        const suite of
        project?.suites || []
    ) {
        addStats(
            stats,
            getSuiteStats(suite)
        );
    }

    /*
     * Fallback to project-level
     * stats if suites aren't available.
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

function collectSuiteRows(
    suites,
    projectName,
    rows,
    depth = 0
) {
    for (
        const suite of
        suites || []
    ) {
        const stats =
            getSuiteStats(suite);

        rows.push({
            project:
                projectName,

            suite:
                cleanSuiteTitle(
                    suite.title
                ),

            depth,

            ...stats,
        });

        collectSuiteRows(
            suite.suites || [],
            projectName,
            rows,
            depth + 1
        );
    }
}

async function main() {
    /*
     * ---------------------------------------------------------
     * Prepare output directory
     * ---------------------------------------------------------
     */

    await fs.mkdir(
        CONFIG.outputDir,
        {
            recursive: true,
        }
    );

    /*
     * ---------------------------------------------------------
     * Load consolidated JSON
     * ---------------------------------------------------------
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

    if (
        projects.length === 0
    ) {
        throw new Error(
            'No project results found in consolidated JSON.'
        );
    }

    console.log(
        `Found ${projects.length} projects.`
    );

    /*
     * ---------------------------------------------------------
     * Load Excel template
     * ---------------------------------------------------------
     */

    const workbook =
        await XlsxPopulate.fromFileAsync(
            CONFIG.templatePath
        );

    const summarySheet =
        workbook.sheet(
            SHEETS.summary
        );

    const detailsSheet =
        workbook.sheet(
            SHEETS.details
        );

    if (!summarySheet) {
        throw new Error(
            `Missing worksheet "${SHEETS.summary}" in template.`
        );
    }

    if (!detailsSheet) {
        throw new Error(
            `Missing worksheet "${SHEETS.details}" in template.`
        );
    }

    /*
     * ---------------------------------------------------------
     * Calculate overall/project statistics
     * ---------------------------------------------------------
     */

    const overall =
        emptyStats();

    const projectStats = [];

    for (
        const project of
        projects
    ) {
        const stats =
            getProjectStats(
                project
            );

        const projectName =
            project.title ||
            project.name ||
            'Unknown Project';

        projectStats.push({
            name:
                projectName,

            stats,
        });

        addStats(
            overall,
            stats
        );

        console.log(
            `${projectName}: ` +
            `Total=${stats.total}, ` +
            `Passed=${stats.passed}, ` +
            `Failed=${stats.failed}, ` +
            `Skipped=${stats.skipped}, ` +
            `Pending=${stats.pending}`
        );
    }

    /*
     * ---------------------------------------------------------
     * Date
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
     * =========================================================
     * SUMMARY SHEET
     * =========================================================
     */

    summarySheet
        .cell('B2')
        .value(
            'Consolidated E2E Test Results'
        );

    summarySheet
        .cell('B3')
        .value(
            reportDate
        );

    /*
     * Overall values
     *
     * B7 = Total
     * C7 = Passed
     * D7 = Failed
     * E7 = Skipped
     * F7 = Pending
     */

    summarySheet
        .cell('B7')
        .value(
            overall.total
        );

    summarySheet
        .cell('C7')
        .value(
            overall.passed
        );

    summarySheet
        .cell('D7')
        .value(
            overall.failed
        );

    summarySheet
        .cell('E7')
        .value(
            overall.skipped
        );

    summarySheet
        .cell('F7')
        .value(
            overall.pending
        );

    /*
     * Clear old project rows.
     */

    for (
        let row = 11;
        row <= 200;
        row++
    ) {
        for (
            let col = 2;
            col <= 7;
            col++
        ) {
            summarySheet
                .cell(row, col)
                .value(null);
        }
    }

    /*
     * Project table header
     *
     * B10:G10
     */

    summarySheet
        .cell('B10')
        .value('Project');

    summarySheet
        .cell('C10')
        .value('Total');

    summarySheet
        .cell('D10')
        .value('Passed');

    summarySheet
        .cell('E10')
        .value('Failed');

    summarySheet
        .cell('F10')
        .value('Skipped');

    summarySheet
        .cell('G10')
        .value('Pending');

    /*
     * Write projects.
     */

    let summaryRow = 11;

    for (
        const project of
        projectStats
    ) {
        summarySheet
            .cell(summaryRow, 2)
            .value(project.name);

        summarySheet
            .cell(summaryRow, 3)
            .value(project.stats.total);

        summarySheet
            .cell(summaryRow, 4)
            .value(project.stats.passed);

        summarySheet
            .cell(summaryRow, 5)
            .value(project.stats.failed);

        summarySheet
            .cell(summaryRow, 6)
            .value(project.stats.skipped);

        summarySheet
            .cell(summaryRow, 7)
            .value(project.stats.pending);

        summaryRow++;
    }

    /*
     * =========================================================
     * PROJECT DETAILS SHEET
     * =========================================================
     */

    detailsSheet
        .cell('B2')
        .value(
            'Consolidated E2E Test Details'
        );

    detailsSheet
        .cell('B3')
        .value(
            reportDate
        );

    /*
     * Clear previous details.
     */

    for (
        let row = 6;
        row <= 2000;
        row++
    ) {
        for (
            let col = 2;
            col <= 8;
            col++
        ) {
            detailsSheet
                .cell(row, col)
                .value(null);
        }
    }

    /*
     * Header:
     *
     * B = Project
     * C = Suite
     * D = Total
     * E = Passed
     * F = Failed
     * G = Skipped
     * H = Pending
     */

    detailsSheet
        .cell('B5')
        .value('Project');

    detailsSheet
        .cell('C5')
        .value(
            'Test Area (Suite)'
        );

    detailsSheet
        .cell('D5')
        .value('Total');

    detailsSheet
        .cell('E5')
        .value('Passed');

    detailsSheet
        .cell('F5')
        .value('Failed');

    detailsSheet
        .cell('G5')
        .value('Skipped');

    detailsSheet
        .cell('H5')
        .value('Pending');

    /*
     * Collect all suite rows.
     */

    const detailRows = [];

    for (
        const project of
        projects
    ) {
        const projectName =
            project.title ||
            project.name ||
            'Unknown Project';

        collectSuiteRows(
            project.suites || [],
            projectName,
            detailRows
        );
    }

    /*
     * Write detail rows.
     */

    let detailRow = 6;

    for (
        const row of
        detailRows
    ) {
        detailsSheet
            .cell(detailRow, 2)
            .value(
                row.project
            );

        /*
         * Indent nested suites.
         */

        const indentation =
            '  '.repeat(
                row.depth
            );

        detailsSheet
            .cell(detailRow, 3)
            .value(
                indentation +
                row.suite
            );

        detailsSheet
            .cell(detailRow, 4)
            .value(
                row.total
            );

        detailsSheet
            .cell(detailRow, 5)
            .value(
                row.passed
            );

        detailsSheet
            .cell(detailRow, 6)
            .value(
                row.failed
            );

        detailsSheet
            .cell(detailRow, 7)
            .value(
                row.skipped
            );

        detailsSheet
            .cell(detailRow, 8)
            .value(
                row.pending
            );

        detailRow++;
    }

    /*
     * ---------------------------------------------------------
     * Save final Excel
     * ---------------------------------------------------------
     */

    const outputPath =
        path.resolve(
            CONFIG.outputDir,
            'consolidated-e2e-report.xlsm'
        );

    await workbook.toFileAsync(
        outputPath
    );

    /*
     * ---------------------------------------------------------
     * Final logging
     * ---------------------------------------------------------
     */

    console.log('');

    console.log(
        '========================================'
    );

    console.log(
        'CONSOLIDATED EXCEL GENERATED'
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
        'ERROR generating consolidated Excel:'
    );

    console.error(
        error
    );

    process.exit(1);
});