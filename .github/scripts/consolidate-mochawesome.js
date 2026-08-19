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

function getProjectName(projectDirectory) {
    return projectDirectory
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
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

function addStats(target, source) {
    target.suites += source?.suites || 0;
    target.tests += source?.tests || 0;
    target.passes += source?.passes || 0;
    target.pending += source?.pending || 0;
    target.failures += source?.failures || 0;
    target.testsRegistered += source?.testsRegistered || 0;
    target.other += source?.other || 0;
    target.skipped += source?.skipped || 0;

    if (source?.start) {
        if (
            !target.start ||
            new Date(source.start) < new Date(target.start)
        ) {
            target.start = source.start;
        }
    }

    if (source?.end) {
        if (
            !target.end ||
            new Date(source.end) > new Date(target.end)
        ) {
            target.end = source.end;
        }
    }

    target.duration += source?.duration || 0;
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
}

/**
 * Recursively find index.json inside a project directory.
 */
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
 * Rewrite screenshot/video paths so the generated
 * consolidated HTML can still find the original assets.
 */
function rewriteAssetPath(
    value,
    projectDirectory,
    reportDirectory
) {
    if (
        !value ||
        typeof value !== 'string'
    ) {
        return value;
    }

    if (
        value.startsWith('http://') ||
        value.startsWith('https://') ||
        value.startsWith('data:')
    ) {
        return value;
    }

    const normalized = value
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');

    if (
        normalized.startsWith('screenshots/') ||
        normalized.startsWith('videos/')
    ) {
        return path.posix.join(
            'source-reports',
            projectDirectory,
            reportDirectory,
            normalized
        );
    }

    return value;
}

function rewriteAssets(
    object,
    projectDirectory,
    reportDirectory
) {
    if (!object || typeof object !== 'object') {
        return;
    }

    if (Array.isArray(object)) {
        for (const item of object) {
            rewriteAssets(
                item,
                projectDirectory,
                reportDirectory
            );
        }

        return;
    }

    for (const key of Object.keys(object)) {
        const value = object[key];

        if (
            typeof value === 'string' &&
            (
                key === 'video' ||
                key === 'videoPath' ||
                key === 'screenshot'
            )
        ) {
            object[key] =
                rewriteAssetPath(
                    value,
                    projectDirectory,
                    reportDirectory
                );

            continue;
        }

        if (
            Array.isArray(value) &&
            key === 'screenshots'
        ) {
            object[key] = value.map(item =>
                rewriteAssetPath(
                    item,
                    projectDirectory,
                    reportDirectory
                )
            );

            continue;
        }

        if (
            value &&
            typeof value === 'object'
        ) {
            rewriteAssets(
                value,
                projectDirectory,
                reportDirectory
            );
        }
    }
}

/**
 * Normalize a Mochawesome suite so marge receives
 * all required fields.
 */
function normalizeSuite(
    suite,
    parentTitle = ''
) {
    const normalized = {
        ...suite,

        uuid:
            suite.uuid ||
            generateUUID(),

        title:
            suite.title ||
            'Unnamed Suite',

        fullFile:
            suite.fullFile ||
            suite.file ||
            parentTitle ||
            '',

        file:
            suite.file ||
            suite.fullFile ||
            '',

        beforeHooks:
            suite.beforeHooks || [],

        afterHooks:
            suite.afterHooks || [],

        tests:
            suite.tests || [],

        suites:
            suite.suites || [],

        // IMPORTANT: marge expects a number
        root:
            suite.root ?? false,

        _timeout:
            typeof suite._timeout === 'number'
                ? suite._timeout
                : 0,

        passes: [],
        failures: [],
        pending: [],
        skipped: [],
    };

    /**
     * Make sure every test has a UUID.
     */
    normalized.tests =
        normalized.tests.map(test => ({
            ...test,
            uuid:
                test.uuid ||
                generateUUID(),
        }));

    /**
     * Rebuild status UUID arrays.
     */
    for (const test of normalized.tests) {
        if (test.pass) {
            normalized.passes.push(test.uuid);
        }

        if (test.fail) {
            normalized.failures.push(test.uuid);
        }

        if (test.pending) {
            normalized.pending.push(test.uuid);
        }

        if (test.skipped) {
            normalized.skipped.push(test.uuid);
        }
    }

    /**
     * Recursively normalize child suites.
     */
    normalized.suites =
        normalized.suites.map(child =>
            normalizeSuite(
                child,
                normalized.title
            )
        );

    /**
     * Include child-suite statuses in
     * the parent suite.
     */
    for (const child of normalized.suites) {
        normalized.passes.push(
            ...(child.passes || [])
        );

        normalized.failures.push(
            ...(child.failures || [])
        );

        normalized.pending.push(
            ...(child.pending || [])
        );

        normalized.skipped.push(
            ...(child.skipped || [])
        );
    }

    return normalized;
}

/**
 * Create ONE result for each project.
 *
 * Final structure:
 *
 * results
 *   ├── Dashboard
 *   │     ├── suite
 *   │     └── suite
 *   │
 *   ├── Ask AI
 *   │     ├── suite
 *   │     └── suite
 *   │
 *   └── User Management
 *         └── suite
 */
function createProjectResult(
    projectName,
    report
) {
    const projectResult = {
        uuid:
            generateUUID(),

        title:
            projectName,

        fullFile:
            projectName,

        file:
            projectName,

        beforeHooks: [],
        afterHooks: [],

        tests: [],

        suites: [],

        // IMPORTANT: These must be arrays
        passes: [],
        failures: [],
        pending: [],
        skipped: [],

        root: true,

        // IMPORTANT: Number, not false
        _timeout: 0,
    };

    for (
        const result
        of report.results || []
    ) {
        /**
         * Add tests directly under result.
         */
        if (result.tests?.length) {
            projectResult.tests.push(
                ...result.tests.map(test => ({
                    ...test,
                    uuid:
                        test.uuid ||
                        generateUUID(),
                }))
            );
        }

        /**
         * Add all suites under project.
         */
        for (
            const suite
            of result.suites || []
        ) {
            projectResult.suites.push(
                normalizeSuite(
                    suite,
                    projectName
                )
            );
        }
    }

    /**
     * Build project-level UUID arrays.
     */
    function collectStatus(suites) {
        for (const suite of suites || []) {
            projectResult.passes.push(
                ...(suite.passes || [])
            );

            projectResult.failures.push(
                ...(suite.failures || [])
            );

            projectResult.pending.push(
                ...(suite.pending || [])
            );

            projectResult.skipped.push(
                ...(suite.skipped || [])
            );

            collectStatus(
                suite.suites
            );
        }
    }

    collectStatus(
        projectResult.suites
    );

    /**
     * Also collect status from direct tests.
     */
    for (
        const test
        of projectResult.tests
    ) {
        if (test.pass) {
            projectResult.passes.push(
                test.uuid
            );
        }

        if (test.fail) {
            projectResult.failures.push(
                test.uuid
            );
        }

        if (test.pending) {
            projectResult.pending.push(
                test.uuid
            );
        }

        if (test.skipped) {
            projectResult.skipped.push(
                test.uuid
            );
        }
    }

    return projectResult;
}

function main() {
    if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(
            `Source directory not found: ${SOURCE_DIR}`
        );
    }

    const projectDirectories =
        fs.readdirSync(
            SOURCE_DIR,
            {
                withFileTypes: true,
            }
        )
        .filter(entry =>
            entry.isDirectory()
        )
        .map(entry =>
            entry.name
        );

    if (
        projectDirectories.length === 0
    ) {
        throw new Error(
            'No project directories found.'
        );
    }

    console.log(
        `Found ${projectDirectories.length} projects.`
    );

    const consolidated = {
        stats:
            emptyStats(),

        results: [],

        /**
         * IMPORTANT:
         * This must follow Mochawesome's expected
         * metadata structure.
         *
         * Do NOT add custom fields such as:
         * projectCount
         * projects
         * framework
         * version
         */
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

    for (
        const projectDirectory
        of projectDirectories
    ) {
        const projectName = getProjectName(projectDirectory);

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
            findIndexJson(
                projectPath
            );

        if (!reportPath) {
            console.warn(
                `WARNING: No index.json found for ${projectName}`
            );

            continue;
        }

        console.log(
            `Report: ${reportPath}`
        );

        const report =
            JSON.parse(
                fs.readFileSync(
                    reportPath,
                    'utf8'
                )
            );

        /**
         * Find the directory containing
         * index.json.
         *
         * Example:
         *
         * dashboard/
         *   2026-08-19.../
         *      index.json
         */
        const relativeReportPath =
            path.relative(
                projectPath,
                reportPath
            );

        const reportDirectory =
            path.dirname(
                relativeReportPath
            );

        /**
         * Rewrite screenshot/video paths.
         */
        rewriteAssets(
            report,
            projectDirectory,
            reportDirectory === '.'
                ? ''
                : reportDirectory
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

        /**
         * Create ONE Mochawesome result
         * for this MFE.
         */
        const projectResult =
            createProjectResult(
                projectName,
                report
            );

        consolidated.results.push(
            projectResult
        );

        addStats(
            consolidated.stats,
            report.stats
        );
    }

    calculatePercentages(
        consolidated.stats
    );

    fs.mkdirSync(
        path.dirname(
            OUTPUT_FILE
        ),
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
        'PROJECT-GROUPED JSON CREATED'
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
        `Pass %: ${consolidated.stats.passPercent.toFixed(2)}`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();