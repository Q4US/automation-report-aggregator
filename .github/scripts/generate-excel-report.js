'use strict';

const fs = require('fs').promises;
const path = require('path');
const XlsxPopulate = require('xlsx-populate');

const CONFIG = {
    jsonPath: process.argv[2] || './.github/scripts/max-e2e-report/index.json',
    templatePath: './.github/scripts/template/template.xlsm',
    outputDir: './summary-report',
    tables: [
        { id: 'ui', anchor: 'B5' },
        // { id: 'api', anchor: 'H5' },
    ],
};

const CONFIG_SHEET_NAME = 'Configurations';

async function loadMapsFromWorkbook(workbook, tables) {
    const sheet = workbook.sheet(CONFIG_SHEET_NAME) || workbook.sheet('Configurations');
    if (!sheet) throw new Error(`Sheet "${CONFIG_SHEET_NAME}" not found in template.`);

    const allTableMaps = {};

    for (const table of tables) {
        allTableMaps[table.id] = [];
        const startCell = sheet.cell(table.anchor);
        const startRow = startCell.rowNumber();
        const startCol = startCell.columnNumber();

        // Stop scanning after an empty row is found
        for (let row = startRow; ; row++) {
            const modName = sheet.cell(row, startCol).value();
            const suiteName = sheet.cell(row, startCol + 1).value();

            if (!modName && !suiteName) break;
            if (!modName || !suiteName) continue;

            allTableMaps[table.id].push({
                moduleName: String(modName).trim(),
                suiteName: String(suiteName).trim(),
                row,
                col: startCol
            });
        }
    }

    return allTableMaps;
}

function countTestResults(suite) {
    const results = { passed: 0, failed: 0, pending: 0 };

    for (const test of suite.tests ?? []) {
        if (test.pass) {
            results.passed++;
        } else if (test.fail || test.skipped || (test.state === null && !test.pending)) {
            results.failed++;
        } else if (test.pending) {
            results.pending++;
        }
    }

    for (const child of suite.suites ?? []) {
        const c = countTestResults(child);
        results.passed += c.passed;
        results.failed += c.failed;
        results.pending += c.pending;
    }

    return results;
}

function removeSuitePrefix(title) {
    return title.replace(/^\s*Test Objective\s*[:|-]\s*/i, '').trim();
}

function suiteMatchesMapEntry(suiteTitle, mapEntryName) {
    const a = suiteTitle.toLowerCase().trim();
    const b = mapEntryName.toLowerCase().trim();
    return a === b || a.startsWith(b);
}

function writeConfigurationStats(configSheet, tableMapList, resultsByRow) {
    for (const tableMap of tableMapList) {
        const rowStats = resultsByRow[tableMap.id] || {};
        for (const entry of tableMap.mapEntries) {
            const stats = rowStats[entry.row] || { passed: 0, failed: 0, notExecuted: 0 };
            if (stats.passed === 0 && stats.failed === 0 && stats.notExecuted === 0) {
                console.warn(`  ! Configured suite "${entry.suiteName}" in table "${tableMap.id.toUpperCase()}" (Module: "${entry.moduleName}") was not found in the JSON test results.`);
            }

            const row = entry.row;
            const col = entry.col;

            // D, E, F are relative to B (column 2)
            // If col is 2 (B), then D is 4 (col+2), E is 5 (col+3), F is 6 (col+4)
            // If col is 8 (H), then J is 10 (col+2), K is 11 (col+3), L is 12 (col+4)
            configSheet.cell(row, col + 2).value(stats.passed);
            configSheet.cell(row, col + 3).value(stats.failed);
            configSheet.cell(row, col + 4).value(stats.notExecuted);
        }
    }
}

async function saveReport(workbook) {
    await fs.mkdir(CONFIG.outputDir, { recursive: true });

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

    const outputPath = path.resolve(CONFIG.outputDir, `e2e-report-${stamp}.xlsm`);
    await workbook.toFileAsync(outputPath);

    return outputPath;
}

async function main() {
    // Load data
    let testResults;
    try {
        const content = await fs.readFile(CONFIG.jsonPath, 'utf8');
        testResults = JSON.parse(content);
    } catch (err) {
        console.error(`Error reading test results from ${CONFIG.jsonPath}:`, err.message);
        throw err;
    }

    const workbook = await XlsxPopulate.fromFileAsync(CONFIG.templatePath);

    // Load maps
    const allTableMaps = await loadMapsFromWorkbook(workbook, CONFIG.tables);
    const tableMapList = CONFIG.tables.map(t => ({ id: t.id, mapEntries: allTableMaps[t.id] }));

    // Initialize stats
    const resultsByTable = {};
    const resultsByRow = {};
    for (const table of CONFIG.tables) {
        resultsByTable[table.id] = {};
        resultsByRow[table.id] = {};
        for (const entry of tableMapList.find(m => m.id === table.id).mapEntries) {
            resultsByTable[table.id][entry.moduleName] = { passed: 0, failed: 0, notExecuted: 0 };
            resultsByRow[table.id][entry.row] = { passed: 0, failed: 0, notExecuted: 0 };
        }
    }

    // Process test suites
    function processSuites(suites, topLevelTitle = null) {
        for (const suite of suites ?? []) {
            const suiteTitle = removeSuitePrefix(suite.title);
            const currentTopLevel = topLevelTitle || suiteTitle;
            let matched = false;
            let counts = null;

            for (const tableMap of tableMapList) {
                for (const entry of tableMap.mapEntries) {
                    if (suiteMatchesMapEntry(suiteTitle, entry.suiteName)) {
                        if (!counts) counts = countTestResults(suite);
                        resultsByTable[tableMap.id][entry.moduleName].passed += counts.passed;
                        resultsByTable[tableMap.id][entry.moduleName].failed += counts.failed;
                        resultsByTable[tableMap.id][entry.moduleName].notExecuted += counts.pending;
                        resultsByRow[tableMap.id][entry.row].passed += counts.passed;
                        resultsByRow[tableMap.id][entry.row].failed += counts.failed;
                        resultsByRow[tableMap.id][entry.row].notExecuted += counts.pending;
                        matched = true;
                    }
                }
            }

            if (matched) continue;

            if (suite.suites?.length) processSuites(suite.suites, currentTopLevel);
            else if (suite.tests?.length) console.warn(`  ? No map entry for suite: "${currentTopLevel}" (childs: "${suiteTitle}")`);
        }
    }

    processSuites((testResults.results ?? []).flatMap(r => r.suites ?? []));

    const configSheet = workbook.sheet(CONFIG_SHEET_NAME) || workbook.sheet('Configurations');
    if (!configSheet) {
        throw new Error(
            `Missing required worksheet "${CONFIG_SHEET_NAME}" (fallback: "Configurations") in template: ${CONFIG.templatePath}`
        );
    }
    writeConfigurationStats(configSheet, tableMapList, resultsByRow);

    const summarySheet = workbook.sheet('Test_Execution_Summary');
    if (summarySheet) {
        const version = process.env.DEPLOY_VERSION || '';
        const testRunDate = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' });
        summarySheet.cell('C12').value(version);
        summarySheet.cell('C13').value(testRunDate);
    }

    const outputPath = await saveReport(workbook);
    console.log(`\nReport saved -> ${outputPath}\n`);
}

main().catch(err => {
    console.error('\nERROR:', err.message);
    process.exit(1);
});
