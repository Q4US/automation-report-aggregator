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

function uuid() {
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

function calculateStats(stats) {
    if (stats.tests > 0) {
        stats.passPercent =
            (stats.passes / stats.tests) * 100;

        stats.pendingPercent =
            (stats.pending / stats.tests) * 100;
    }

    stats.hasOther = stats.other > 0;
    stats.hasSkipped = stats.skipped > 0;
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

    /*
     * The downloaded report directory may look like:
     *
     * dashboard/
     *   2026-08-19.../
     *     index.json
     *     screenshots/
     *     videos/
     *
     * We keep the actual artifact structure.
     */

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
            (
                key === 'screenshots'
            )
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
 * Ensure every Mochawesome suite has the fields
 * expected by marge.
 */
function normalizeSuite(
    suite,
    parentTitle = ''
) {
    const normalized = {
        ...suite,

        uuid: suite.uuid || uuid(),

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

        root:
            suite.root ?? false,

        _timeout:
            suite._timeout ?? 0,

        passes:
            suite.passes || [],

        failures:
            suite.failures || [],

        pending:
            suite.pending || [],

        skipped:
            suite.skipped || [],
    };

    /*
     * Normalize tests.
     */
    normalized.tests =
        normalized.tests.map(test => ({
            ...test,
            uuid: test.uuid || uuid(),
        }));

    /*
     * Recalculate suite UUID lists from tests.
     */
    normalized.passes = [];
    normalized.failures = [];
    normalized.pending = [];
    normalized.skipped = [];

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

    /*
     * Recursively normalize child suites.
     */
    normalized.suites =
        normalized.suites.map(child =>
            normalizeSuite(
                child,
                normalized.title
            )
        );

    return normalized;
}

/**
 * Create one project suite containing all original
 * Mochawesome suites.
 */
function createProjectSuite(
    projectName,
    report
) {
    const projectSuites = [];

    for (const result of report.results || []) {
        for (const suite of result.suites || []) {
            projectSuites.push(
                normalizeSuite(
                    suite,
                    projectName
                )
            );
        }
    }

    /*
     * Project itself becomes a suite.
     *
     * Dashboard
     *   ├── suite 1
     *   ├── suite 2
     *
     * Ask AI
     *   ├── suite 1
     *   └── suite 2
     */
    const projectSuite = {
        uuid: uuid(),

        title: projectName,

        fullFile: projectName,

        file: projectName,

        beforeHooks: [],

        afterHooks: [],

        tests: [],

        suites: projectSuites,

        root: false,

        _timeout: 0,

        passes: [],
        failures: [],
        pending: [],
        skipped: [],
    };

    /*
     * Project-level status arrays.
     */
    function collectFromSuites(suites) {
        for (const suite of suites || []) {

            projectSuite.passes.push(
                ...(suite.passes || [])
            );

            projectSuite.failures.push(
                ...(suite.failures || [])
            );

            projectSuite.pending.push(
                ...(suite.pending || [])
            );

            projectSuite.skipped.push(
                ...(suite.skipped || [])
            );

            collectFromSuites(
                suite.suites
            );
        }
    }

    collectFromSuites(
        projectSuite.suites
    );

    return projectSuite;
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

    const stats = emptyStats();

    /*
     * Root result expected by Mochawesome.
     */
    const rootResult = {
        uuid: uuid(),

        title: 'Consolidated E2E Tests',

        fullFile: 'consolidated',

        file: 'consolidated',

        beforeHooks: [],

        afterHooks: [],

        tests: [],

        suites: [],

        root: true,

        _timeout: 0,

        passes: [],
        failures: [],
        pending: [],
        skipped: [],
    };

    for (
        const projectDirectory
        of projectDirectories
    ) {

        const projectName =
            PROJECT_NAMES[
                projectDirectory
            ] ||
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
            findIndexJson(
                projectPath
            );

        if (!reportPath) {
            throw new Error(
                `No index.json found for ${projectName}`
            );
        }

        const report =
            JSON.parse(
                fs.readFileSync(
                    reportPath,
                    'utf8'
                )
            );

        /*
         * Find the directory containing index.json.
         *
         * Example:
         *
         * dashboard/
         *   2026-08-19.../
         *
         * reportDirectory =
         *   2026-08-19...
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

        console.log(
            `Report: ${reportPath}`
        );

        console.log(
            `Report directory: ${reportDirectory}`
        );

        /*
         * Rewrite screenshots/videos.
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

        /*
         * Create project grouping.
         */
        const projectSuite =
            createProjectSuite(
                projectName,
                report
            );

        rootResult.suites.push(
            projectSuite
        );

        /*
         * Add project UUIDs to root.
         */
        rootResult.passes.push(
            ...projectSuite.passes
        );

        rootResult.failures.push(
            ...projectSuite.failures
        );

        rootResult.pending.push(
            ...projectSuite.pending
        );

        rootResult.skipped.push(
            ...projectSuite.skipped
        );

        /*
         * Add statistics.
         */
        addStats(
            stats,
            report.stats
        );
    }

    calculateStats(stats);

    /*
     * Final Mochawesome-compatible structure.
     */
    const consolidated = {
        stats,

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
        `Projects: ${projectDirectories.length}`
    );

    console.log(
        `Tests: ${stats.tests}`
    );

    console.log(
        `Passed: ${stats.passes}`
    );

    console.log(
        `Failed: ${stats.failures}`
    );

    console.log(
        `Pending: ${stats.pending}`
    );

    console.log(
        `Pass %: ${stats.passPercent.toFixed(2)}`
    );

    console.log(
        `Output: ${OUTPUT_FILE}`
    );
}

main();