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
        withFileTypes: true,
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
 * Rewrite screenshot/video paths so they point to
 * the project-specific directory.
 *
 * Example:
 *
 * screenshots/foo.png
 *
 * becomes:
 *
 * source-reports/dashboard/screenshots/foo.png
 */
function rewriteAssetPath(
    assetPath,
    projectDirectory
) {
    if (
        !assetPath ||
        typeof assetPath !== 'string'
    ) {
        return assetPath;
    }

    if (
        assetPath.startsWith('http://') ||
        assetPath.startsWith('https://') ||
        assetPath.startsWith('data:')
    ) {
        return assetPath;
    }

    const normalized = assetPath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

    if (
        normalized.startsWith('screenshots/') ||
        normalized.startsWith('videos/')
    ) {
        return path.posix.join(
            'source-reports',
            projectDirectory,
            normalized
        );
    }

    return assetPath;
}

/**
 * Recursively update Mochawesome asset references.
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
                key === 'screenshot' ||
                key === 'video' ||
                key === 'videoPath'
            )
        ) {
            object[key] =
                rewriteAssetPath(
                    value,
                    projectDirectory
                );

            continue;
        }

        if (
            value &&
            typeof value === 'object'
        ) {
            rewriteAssetPathsInObject(
                value,
                projectDirectory
            );
        }
    }
}

/**
 * Collect test UUIDs recursively.
 *
 * Mochawesome expects passes/failures/pending/skipped
 * at the result level as arrays of test UUIDs.
 */
function collectTestStatusUUIDs(
    suites,
    status
) {
    const result = {
        passes: [],
        failures: [],
        pending: [],
        skipped: [],
    };

    function walk(suiteList) {
        for (const suite of suiteList || []) {
            for (const test of suite.tests || []) {
                if (!test.uuid) {
                    continue;
                }

                if (test.pass) {
                    result.passes.push(test.uuid);
                }

                if (test.fail) {
                    result.failures.push(test.uuid);
                }

                if (test.pending) {
                    result.pending.push(test.uuid);
                }

                if (test.skipped) {
                    result.skipped.push(test.uuid);
                }
            }

            walk(suite.suites);
        }
    }

    walk(suites);

    return result;
}

/**
 * Create one project-level suite.
 *
 * This gives us:
 *
 * Dashboard
 *   ├── suite 1
 *   ├── suite 2
 *   └── suite 3
 *
 * Ask AI
 *   ├── suite 1
 *   └── suite 2
 */
function createProjectSuite(
    projectName,
    report,
    projectDirectory
) {
    const suites = [];

    for (const result of report.results || []) {
        for (const suite of result.suites || []) {
            suites.push(suite);
        }
    }

    return {
        uuid: generateUUID(),
        title: projectName,
        fullFile: projectName,
        file: projectName,

        beforeHooks: [],
        afterHooks: [],

        tests: [],

        suites,
    };
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
            {
                withFileTypes: true,
            }
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

    const consolidatedStats = emptyStats();

    /*
     * These arrays are required by Mochawesome.
     */
    const allPasses = [];
    const allFailures = [];
    const allPending = [];
    const allSkipped = [];

    /*
     * One ROOT result.
     *
     * Under this root:
     *
     * Dashboard
     * Ask AI
     * User Management
     * etc.
     */
    const rootResult = {
        uuid: generateUUID(),

        title: 'Consolidated E2E Tests',

        fullFile: 'consolidated',

        file: 'consolidated',

        beforeHooks: [],

        afterHooks: [],

        tests: [],

        suites: [],

        passes: allPasses,

        failures: allFailures,

        pending: allPending,

        skipped: allSkipped,

        duration: 0,

        root: true,

        _timeout: 0,
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
         * Rewrite asset paths before using the report.
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
         * Create project-level grouping.
         */
        const projectSuite =
            createProjectSuite(
                projectName,
                report,
                projectDirectory
            );

        rootResult.suites.push(
            projectSuite
        );

        /*
         * Collect test UUIDs.
         */
        const status =
            collectTestStatusUUIDs(
                projectSuite.suites
            );

        allPasses.push(
            ...status.passes
        );

        allFailures.push(
            ...status.failures
        );

        allPending.push(
            ...status.pending
        );

        allSkipped.push(
            ...status.skipped
        );

        /*
         * Add project statistics.
         */
        addStats(
            consolidatedStats,
            report.stats
        );
    }

    calculatePercentages(
        consolidatedStats
    );

    rootResult.duration =
        consolidatedStats.duration;

    /*
     * Valid Mochawesome meta structure.
     *
     * Do NOT put custom fields such as:
     *
     * meta.framework
     * meta.projectCount
     * meta.projects
     *
     * because marge validates the schema.
     */
    const consolidated = {
        stats: consolidatedStats,

        results: [
            rootResult,
        ],

        meta: {
            mocha: {
                version: 'unknown',
            },

            mochawesome: {
                options: {},
                version: '7.1.3',
            },

            marge: {
                options: {},
                version: '6.2.2',
            },
        },
    };

    fs.mkdirSync(
        path.dirname(OUTPUT_FILE),
        {
            recursive: true,
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
        'PROJECT-GROUPED MOCHAWESOME REPORT'
    );

    console.log(
        '========================================'
    );

    console.log(
        `Projects: ${projectDirectories.length}`
    );

    console.log(
        `Tests: ${consolidatedStats.tests}`
    );

    console.log(
        `Passed: ${consolidatedStats.passes}`
    );

    console.log(
        `Failed: ${consolidatedStats.failures}`
    );

    console.log(
        `Pending: ${consolidatedStats.pending}`
    );

    console.log(
        `Pass %: ${consolidatedStats.passPercent.toFixed(2)}`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();