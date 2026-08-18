'use strict';

const fs = require('fs').promises;
const path = require('path');

const inputDir = process.argv[2] || './source-reports';
const outputFile = process.argv[3] || './consolidated.json';

async function findJsonFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await findJsonFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            files.push(fullPath);
        }
    }

    return files;
}

async function main() {
    console.log(`Reading reports from: ${inputDir}`);

    const files = await findJsonFiles(inputDir);

    if (files.length === 0) {
        throw new Error(`No JSON reports found in ${inputDir}`);
    }

    console.log(`Found ${files.length} JSON report(s)`);

    const mergedResults = [];

    let total = 0;
    let passed = 0;
    let failed = 0;
    let pending = 0;
    let skipped = 0;
    let other = 0;

    let start = null;
    let end = null;

    for (const file of files) {
        console.log(`Reading: ${file}`);

        const raw = await fs.readFile(file, 'utf8');
        const report = JSON.parse(raw);

        const repository =
            report.metadata?.repository ||
            path.basename(path.dirname(file));

        // Add repository information to each root result
        for (const result of report.results || []) {
            mergedResults.push({
                ...result,
                title: result.title
                    ? `${repository} - ${result.title}`
                    : repository,
                _sourceRepository: repository
            });
        }

        const stats = report.stats || {};

        total += stats.testsRegistered || stats.tests || 0;
        passed += stats.passes || 0;
        failed += stats.failures || 0;
        pending += stats.pending || 0;
        skipped += stats.skipped || 0;
        other += stats.other || 0;

        if (stats.start) {
            if (!start || new Date(stats.start) < new Date(start)) {
                start = stats.start;
            }
        }

        if (stats.end) {
            if (!end || new Date(stats.end) > new Date(end)) {
                end = stats.end;
            }
        }
    }

    const duration =
        start && end
            ? new Date(end).getTime() - new Date(start).getTime()
            : 0;

    const consolidated = {
        stats: {
            suites: mergedResults.reduce(
                (count, result) => count + (result.suites?.length || 0),
                0
            ),
            tests: total,
            passes: passed,
            failures: failed,
            pending,
            skipped,
            other,
            testsRegistered: total,
            passPercent: total
                ? (passed / total) * 100
                : 0,
            pendingPercent: total
                ? (pending / total) * 100
                : 0,
            hasOther: other > 0,
            hasSkipped: skipped > 0,
            start,
            end,
            duration
        },

        results: mergedResults,

        metadata: {
            consolidated: true,
            generatedAt: new Date().toISOString(),
            sourceReports: files
        }
    };

    await fs.mkdir(path.dirname(outputFile), { recursive: true });

    await fs.writeFile(
        outputFile,
        JSON.stringify(consolidated, null, 2),
        'utf8'
    );

    console.log('');
    console.log('======================================');
    console.log('CONSOLIDATED REPORT');
    console.log('======================================');
    console.log(`Reports:  ${files.length}`);
    console.log(`Total:    ${total}`);
    console.log(`Passed:   ${passed}`);
    console.log(`Failed:   ${failed}`);
    console.log(`Pending:  ${pending}`);
    console.log(`Skipped:  ${skipped}`);
    console.log(`Pass %:   ${total ? (passed / total * 100).toFixed(2) : 0}%`);
    console.log(`Output:   ${outputFile}`);
    console.log('======================================');
}

main().catch(error => {
    console.error('ERROR:', error);
    process.exit(1);
});