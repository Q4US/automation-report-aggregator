'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCE_DIR = 'consolidated-report/source-reports';
const OUTPUT_FILE = 'consolidated-report/consolidated.json';

const PROJECT_NAMES = {
    dashboard: 'Dashboard',
    'ask-ai': 'Ask AI',
    'user-management': 'User Management',
    profile: 'Profile',
    'react-tree': 'React Tree',
    'error-reports': 'Error Reports',
    audit: 'Audit',
};

function generateUUID() {
    return crypto.randomUUID();
}

function emptyStats() {
    return {
        suites: 0,
        tests: 0,
        passes: 0,
        pending: 0,
        failures: 0,
        testsRegistered: 0,
        passPercent: 0,
        pendingPercent: 0,
        other: 0,
        hasOther: false,
        skipped: 0,
        hasSkipped: false,
        start: null,
        end: null,
        duration: 0,
    };
}

function addStats(total, stats) {
    total.suites += stats?.suites || 0;
    total.tests += stats?.tests || 0;
    total.passes += stats?.passes || 0;
    total.pending += stats?.pending || 0;
    total.failures += stats?.failures || 0;
    total.testsRegistered += stats?.testsRegistered || 0;
    total.other += stats?.other || 0;
    total.skipped += stats?.skipped || 0;

    if (stats?.start) {
        if (
            !total.start ||
            new Date(stats.start) < new Date(total.start)
        ) {
            total.start = stats.start;
        }
    }

    if (stats?.end) {
        if (
            !total.end ||
            new Date(stats.end) > new Date(total.end)
        ) {
            total.end = stats.end;
        }
    }

    total.duration += stats?.duration || 0;
}

function calculatePercentages(stats) {
    if (stats.tests > 0) {
        stats.passPercent =
            (stats.passes / stats.tests) * 100;

        stats.pendingPercent =
            (stats.pending / stats.tests) * 100;
    }

    stats.hasOther = stats.other > 0;
    stats.hasSkipped = stats.skipped > 0;

    return stats;
}

function findIndexJson(directory) {
    const entries = fs.readdirSync(directory, {
        withFileTypes: true
    });

    for (const entry of entries) {
        const fullPath = path.join(
            directory,
            entry.name
        );

        if (
            entry.isFile() &&
            entry.name === 'index.json'
        ) {
            return fullPath;
        }

        if (entry.isDirectory()) {
            const found = findIndexJson(fullPath);

            if (found) {
                return found;
            }
        }
    }

    return null;
}

/**
 * Convert an asset path from the original Mochawesome report
 * into a path relative to the consolidated report.
 *
 * Example original:
 *
 *   videos/test.cy.ts.mp4
 *
 * becomes:
 *
 *   source-reports/dashboard/videos/test.cy.ts.mp4
 *
 * The exact relative path is calculated from consolidated.json,
 * which lives at:
 *
 *   consolidated-report/consolidated.json
 */
function rewriteAssetPath(assetPath, projectDirectory) {
    if (!assetPath || typeof assetPath !== 'string') {
        return assetPath;
    }

    /*
     * Ignore:
     * - URLs
     * - data URLs
     * - already absolute URLs
     */

    if (
        assetPath.startsWith('http://') ||
        assetPath.startsWith('https://') ||
        assetPath.startsWith('data:')
    ) {
        return assetPath;
    }

    /*
     * Mochawesome normally stores paths such as:
     *
     * screenshots/...
     * videos/...
     *
     * We want:
     *
     * source-reports/<project>/screenshots/...
     * source-reports/<project>/videos/...
     */

    const normalized = assetPath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

    if (
        normalized.startsWith('screenshots/') ||
        normalized.startsWith('videos/')
    ) {
        return path
            .posix
            .join(
                'source-reports',
                projectDirectory,
                normalized
            );
    }

    return assetPath;
}

/**
 * Recursively walk the Mochawesome result structure and
 * update screenshot/video paths.
 */
function rewriteAssetPathsInObject(
    object,
    projectDirectory
) {
    if (!object || typeof object !== 'object') {
        return;
    }

    if (Array.isArray(object)) {
        for (const item of object) {
            rewriteAssetPathsInObject(
                item,
                projectDirectory
            );
        }

        return;
    }

    for (const key of Object.keys(object)) {
        const value = object[key];

        if (
            typeof value === 'string' &&
            (
                key === 'screenshots' ||
                key === 'video' ||
                key === 'videoPath' ||
                key === 'screenshot'
            )
        ) {
            object[key] =
                rewriteAssetPath(
                    value,
                    projectDirectory
                );

            continue;
        }

        if (typeof value === 'object') {
            rewriteAssetPathsInObject(
                value,
                projectDirectory
            );
        }
    }
}

function collectSuites(suites, target) {
    for (const suite of suites || []) {
        target.push(suite);
    }
}

function main() {
    if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(
            `Source directory not found: ${SOURCE_DIR}`
        );
    }

    const projectDirectories = fs
        .readdirSync(
            SOURCE_DIR,
            { withFileTypes: true }
        )
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);

    if (projectDirectories.length === 0) {
        throw new Error(
            'No project directories found.'
        );
    }

    console.log(
        `Found ${projectDirectories.length} projects.`
    );

    const consolidated = {
        stats: emptyStats(),

        results: [],

        meta: {
            framework: 'mochawesome',
            version: 'project-grouped',
            projectCount:
                projectDirectories.length,
            projects: [],
        },
    };

    for (
        const projectDirectory
        of projectDirectories
    ) {
        const projectName =
            PROJECT_NAMES[projectDirectory] ||
            projectDirectory;

        console.log('');
        console.log(
            '========================================'
        );
        console.log(
            `Processing: ${projectName}`
        );
        console.log(
            '========================================'
        );

        const projectPath =
            path.join(
                SOURCE_DIR,
                projectDirectory
            );

        const reportPath =
            findIndexJson(projectPath);

        if (!reportPath) {
            throw new Error(
                `No index.json found for ${projectName}`
            );
        }

        console.log(
            `Report: ${reportPath}`
        );

        const report = JSON.parse(
            fs.readFileSync(
                reportPath,
                'utf8'
            )
        );

        /*
         * Rewrite screenshot/video paths BEFORE
         * adding the report to consolidated.json.
         */
        rewriteAssetPathsInObject(
            report,
            projectDirectory
        );

        console.log(
            `Tests: ${report.stats?.tests || 0}`
        );

        console.log(
            `Passed: ${report.stats?.passes || 0}`
        );

        console.log(
            `Failed: ${report.stats?.failures || 0}`
        );

        /*
         * One top-level result per MFE.
         */
        const projectResult = {
            uuid: generateUUID(),

            title: projectName,

            fullFile: projectName,

            file: projectName,

            beforeHooks: [],

            afterHooks: [],

            tests: [],

            suites: [],
        };

        /*
         * Preserve the original Mochawesome suite hierarchy.
         */
        for (const result of report.results || []) {
            collectSuites(
                result.suites,
                projectResult.suites
            );

            if (result.tests?.length) {
                projectResult.tests.push(
                    ...result.tests
                );
            }
        }

        consolidated.results.push(
            projectResult
        );

        /*
         * Add project metadata.
         */
        consolidated.meta.projects.push({
            id: projectDirectory,

            name: projectName,

            sourceReport:
                path.relative(
                    '.',
                    reportPath
                ),

            stats: {
                suites:
                    report.stats?.suites || 0,

                tests:
                    report.stats?.tests || 0,

                passed:
                    report.stats?.passes || 0,

                failed:
                    report.stats?.failures || 0,

                pending:
                    report.stats?.pending || 0,
            },
        });

        addStats(
            consolidated.stats,
            report.stats
        );
    }

    calculatePercentages(
        consolidated.stats
    );

    fs.mkdirSync(
        path.dirname(OUTPUT_FILE),
        {
            recursive: true
        }
    );

    fs.writeFileSync(
        OUTPUT_FILE,
        JSON.stringify(
            consolidated,
            null,
            2
        )
    );

    console.log('');
    console.log(
        '========================================'
    );
    console.log(
        'Consolidated Report Created'
    );
    console.log(
        '========================================'
    );

    console.log(
        `Projects: ${consolidated.results.length}`
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
        `Pass %: ${
            consolidated.stats.passPercent.toFixed(2)
        }`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();