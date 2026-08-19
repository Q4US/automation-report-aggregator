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

function findProjectReports() {
    const projects = [];

    if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(
            `Source directory not found: ${SOURCE_DIR}`
        );
    }

    const projectDirectories = fs
        .readdirSync(SOURCE_DIR, {
            withFileTypes: true,
        })
        .filter(entry => entry.isDirectory());

    for (const directory of projectDirectories) {
        const projectId = directory.name;

        const projectDirectory = path.join(
            SOURCE_DIR,
            projectId
        );

        const jsonFiles = [];

        function scan(dir) {
            for (const entry of fs.readdirSync(dir, {
                withFileTypes: true,
            })) {
                const fullPath = path.join(
                    dir,
                    entry.name
                );

                if (entry.isDirectory()) {
                    scan(fullPath);
                } else if (
                    entry.isFile() &&
                    entry.name === 'index.json'
                ) {
                    jsonFiles.push(fullPath);
                }
            }
        }

        scan(projectDirectory);

        if (jsonFiles.length === 0) {
            console.warn(
                `WARNING: No index.json found for ${projectId}`
            );
            continue;
        }

        /*
         * Normally there should be one index.json.
         * If there are multiple, use the first one.
         */
        const reportPath = jsonFiles[0];

        projects.push({
            projectId,
            projectName:
                PROJECT_NAMES[projectId] ||
                projectId,
            reportPath,
        });
    }

    return projects;
}

function createProjectResult(
    projectName,
    report
) {
    const projectResult = {
        uuid: generateUUID(),

        /*
         * IMPORTANT:
         * This is the project name.
         */
        title: projectName,

        fullFile: projectName,
        file: projectName,

        root: true,

        _timeout: false,

        beforeHooks: [],
        afterHooks: [],

        tests: [],
        passes: [],
        failures: [],
        pending: [],
        skipped: [],

        suites: [],
    };

    /*
     * Preserve all suites belonging to
     * this project.
     */
    for (const result of report.results || []) {
        for (const suite of result.suites || []) {
            projectResult.suites.push(suite);
        }

        if (result.tests?.length) {
            projectResult.tests.push(
                ...result.tests
            );
        }
    }

    return projectResult;
}

function main() {
    const projectReports =
        findProjectReports();

    if (projectReports.length === 0) {
        throw new Error(
            'No project reports found.'
        );
    }

    console.log(
        `Found ${projectReports.length} project reports.`
    );

    const consolidated = {
        stats: emptyStats(),

        results: [],

        meta: {
            framework: 'mochawesome',
            version: 'project-grouped',
            projectCount:
                projectReports.length,

            projects: [],
        },
    };

    for (const project of projectReports) {
        console.log('');
        console.log(
            `Processing: ${project.projectName}`
        );

        console.log(
            `JSON: ${project.reportPath}`
        );

        const report = JSON.parse(
            fs.readFileSync(
                project.reportPath,
                'utf8'
            )
        );

        const projectResult =
            createProjectResult(
                project.projectName,
                report
            );

        /*
         * ONE result per MFE project.
         */
        consolidated.results.push(
            projectResult
        );

        addStats(
            consolidated.stats,
            report.stats
        );

        consolidated.meta.projects.push({
            id: project.projectId,
            name: project.projectName,

            sourceReport:
                project.reportPath,

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
    }

    calculatePercentages(
        consolidated.stats
    );

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
        `Output: ${OUTPUT_FILE}`
    );
}

main();