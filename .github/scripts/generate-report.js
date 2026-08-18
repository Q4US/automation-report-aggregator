const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');

const COLORS = {
    Passed: 'green',
    Failed: 'red',
    Skipped: '#29a2ca',
    Pending: '#d4a017'
};

const jsonPath = process.argv[2] || 'reports/mochawesome-report/index.json';
const outputDir = 'summary-report';

const reportDate = new Date().toLocaleString('en-GB', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hour24: true
});

const pdfOutputPath = path.resolve(
    outputDir,
    `e2e-report-${reportDate.split(',').slice(1).join('').trim().replace(/[\/,:\s]+/g, '_')}.pdf`
);

async function generateReport() {
    const browserPromise = puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    let json;
    let browser;
    try {
        await fs.mkdir(outputDir, { recursive: true });
        const rawData = await fs.readFile(jsonPath, 'utf8');
        json = JSON.parse(rawData);
    } catch (err) {
        console.error('ERROR: Failed to prepare report data : ' + err);
        try {
            browser = await browserPromise;
            await browser.close();
        } catch { }
        process.exit(1);
    }

    const stats = json.stats;
    const suiteSummaries = [];

    const summaryHeaderHtml = `
        <div style="font-family: sans-serif; text-align: center; margin: 20px;">
        <h1 style="margin: 0;">E2E Test Results</h1>
        <h3 style="margin: 0; margin-top: 8px;">${reportDate}</h3>
        <table style="border-collapse: collapse; margin-top: 10px; width: 100%; text-align: center; border: 1px solid black; table-layout: fixed;">
            <tr>
                <th style="padding: 12px 6px; border: 1px solid; width: 20%;">Total</th>
                <th style="padding: 12px 6px; border: 1px solid; width: 20%;">Passed</th>
                <th style="padding: 12px 6px; border: 1px solid; width: 20%;">Failed</th>
                <th style="padding: 12px 6px; border: 1px solid; width: 20%;">Skipped</th>
                <th style="padding: 12px 6px; border: 1px solid; width: 20%;">Pending</th>
            </tr>
            <tr>
                <td style="padding: 12px 6px; border: 1px solid black; font-weight: bold;">${stats.testsRegistered}</td>
                <td style="padding: 12px 6px; border: 1px solid black; font-weight: bold;"><span style="color: ${COLORS.Passed}">${stats.passes}</span></td>
                <td style="padding: 12px 6px; border: 1px solid black; font-weight: bold;"><span style="color: ${COLORS.Failed}">${stats.failures}</span></td>
                <td style="padding: 12px 6px; border: 1px solid black; font-weight: bold;"><span style="color: ${COLORS.Skipped}">${stats.skipped}</span></td>
                <td style="padding: 12px 6px; border: 1px solid black; font-weight: bold;"><span style="color: ${COLORS.Pending}">${stats.pending}</span></td>
            </tr>
        </table>
    </div>`;

    let htmlBody = summaryHeaderHtml;
    let emailBody = summaryHeaderHtml;

    let summaryTableHtml = `
    <div style="font-family: sans-serif; margin: 20px;">
        <table border="1" style="border-collapse: collapse; width: 100%; text-align: left; margin-top: 10px;">
            <tr style="background-color: #8ac7f0ff;">
                <th style="padding: 8px;">Test Area (Suite)</th>
                <th style="padding: 8px; text-align: center; width: 60px;">Total</th>
                <th style="padding: 8px; text-align: center; width: 60px;">Passed</th>
                <th style="padding: 8px; text-align: center; width: 60px;">Failed</th>
                <th style="padding: 8px; text-align: center; width: 60px;">Skipped</th>
                <th style="padding: 8px; text-align: center; width: 60px;">Pending</th>
            </tr>`;

    for (const root of json.results || []) {
        for (const suite of root.suites || []) {
            const suiteStats = getRecursiveStats(suite);
            const title = suite.title.replace(/\s*Test Objective\s*[:|-]\s*/gi, '') || '';
            const isIssue = suiteStats.failed > 0 || suiteStats.skipped > 0 || suiteStats.pending > 0;
            const bg = isIssue ? '#fff0f0' : '#ffffff';

            summaryTableHtml += `
            <tr style="background-color: ${bg};">
                <td style="padding: 8px; font-weight: 500;">${title}</td>
                <td style="padding: 8px; text-align: center; font-weight: 500;">${suiteStats.total}</td>
                <td style="padding: 8px; text-align: center; color: ${COLORS.Passed}; font-weight: 500">${suiteStats.passed}</td>
                <td style="padding: 8px; text-align: center; color: ${COLORS.Failed}; font-weight: ${suiteStats.failed > 0 ? 'bold' : '500'}">${suiteStats.failed}</td>
                <td style="padding: 8px; text-align: center; color: ${COLORS.Skipped}; font-weight: ${suiteStats.skipped > 0 ? 'bold' : '500'}">${suiteStats.skipped}</td>
                <td style="padding: 8px; text-align: center; color: ${COLORS.Pending}; font-weight: ${suiteStats.pending > 0 ? 'bold' : '500'}">${suiteStats.pending}</td>
            </tr>`;

            suiteSummaries.push({
                name: title,
                failed: suiteStats.failed,
                pending: suiteStats.pending,
                skipped: suiteStats.skipped,
                total: suiteStats.total
            });
        }
    }
    summaryTableHtml += `</table></div>`;
    htmlBody += summaryTableHtml;
    emailBody += summaryTableHtml;
    htmlBody += `<h3 style="margin: 20px; text-align: center;">Test Details that are Failed, Skipped, Pending</h3>`;
    htmlBody += `<div style="font-family: sans-serif; text-align: left; margin: 20px;">`;
    for (const root of json.results || []) {
        for (const suite of root.suites || []) {
            htmlBody += getSuiteHtml(suite, 0);
        }
    }
    htmlBody += `</div>`;

    const artifactUrl = (process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
        ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : '';

    const jobDuration = process.env.JOB_DURATION || '';
    const repoName = process.env.GITHUB_REPOSITORY || '';
    const adaptiveCard = buildAdaptiveCard(stats, suiteSummaries, artifactUrl, jobDuration, repoName);

    try {
        const browser = await browserPromise;
        const page = await browser.newPage();
        const styledHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { margin: 20px; font-family: sans-serif; }
                    .suite-section { page-break-inside: auto; break-inside: auto; }
                    .suite-header {
                        display: block;
                        margin-bottom: 0px;
                        page-break-inside: avoid;
                        page-break-after: avoid;
                        break-inside: avoid;
                        break-after: avoid;
                    }
                    .header-content-group {
                        page-break-inside: avoid;
                        break-inside: avoid;
                        margin-bottom: 15px;
                    }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
                    tr { page-break-inside: avoid; break-inside: avoid; }
                    td, th { vertical-align: top; }
                    h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
                    p, div, td { orphans: 3; widows: 3; }
                </style>
            </head>
            <body>${htmlBody}</body>
            </html>`;

        await page.setContent(styledHtml, { waitUntil: 'networkidle0' });
        await page.pdf({
            path: pdfOutputPath,
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();
        console.log('PDF generated successfully');
    } catch (err) {
        console.error('ERROR: Failed to generate PDF:', err);
    }

    if (process.env.GITHUB_OUTPUT) {
        // for sending an email
        // await fs.appendFile(
        //     process.env.GITHUB_OUTPUT, 
        //     `pdf_path=${pdfOutputPath}\n`
        // );
        await fs.appendFile(
            process.env.GITHUB_OUTPUT,
            `email_html<<EOF\n${emailBody}\nEOF\n`
        );
        await fs.appendFile(
            process.env.GITHUB_OUTPUT,
            `adaptive_card<<EOF\n${adaptiveCard}\nEOF\n`
        );

        const wisemapMapId = process.env.WISEMAP_MAP_ID;
        if (wisemapMapId && Object.keys(tagStatuses).length > 0) {
            const wisemapPayload = JSON.stringify({ mapId: parseInt(wisemapMapId, 10), tags: tagStatuses });
            await fs.appendFile(
                process.env.GITHUB_OUTPUT,
                `wisemap_payload<<EOF\n${wisemapPayload}\nEOF\n`
            );
        }
    }
}

const tagStatuses = {};

function getRecursiveStats(suite) {
    let stats = { passed: 0, failed: 0, skipped: 0, pending: 0, total: 0 };
    for (const test of suite.tests) {
        stats.total++;
        if (test.pass) { stats.passed++; collectTag(test, 'success'); }
        else if (test.fail) { stats.failed++; collectTag(test, 'failure'); }
        else if (test.pending) { stats.pending++; collectTag(test, 'pending'); }
        else if (test.skipped) { stats.skipped++; collectTag(test, 'skipped'); }
    }
    for (const child of suite.suites) {
        const c = getRecursiveStats(child);
        Object.keys(stats).forEach(k => {
            stats[k] += c[k];
        });
    }
    return stats;
}

function collectTag(test, status) {
    const { id } = formatTestTitle(test.title);
    if (id) tagStatuses[id] = status;
}

function formatTestTitle(title) {
    if (!title) return { id: '', description: '' };

    const match = title.match(/(TC_[A-Za-z0-9_]*?_\d+(?:_\d+)*)/);
    if (match) {
        const id = match[0].trim();
        let description = title.replace(id, '').trim();
        description = description.replace(/^[\s\-\|\:_]+/, '').replace(/[\s\-\|\:_]+$/, '').trim();
        return { id, description };
    }
    return { id: '', description: title };
}

function getSuiteHtml(suite, depth) {
    const stats = getRecursiveStats(suite);
    if (stats.failed === 0 && stats.skipped === 0 && stats.pending === 0) return '';

    const cleanTitle = suite.title.replace(/\s*Test Objective\s*[:|-]\s*/gi, '');
    const bg = depth === 0 ? '#f9f9f9' : 'transparent';

    let borderColor;
    if (stats.failed >= stats.skipped && stats.failed >= stats.pending) {
        borderColor = COLORS.Failed;
    } else if (stats.skipped >= stats.pending) {
        borderColor = COLORS.Skipped;
    } else {
        borderColor = COLORS.Pending;
    }

    const border = depth === 0
        ? `border-bottom: 1.5px solid ${borderColor};`
        : `border-left: 1.5px solid ${borderColor};`;

    let html = `<div class='suite-section' style='margin-left: ${depth * 20}px; margin-top: 10px;'>
        <div class='header-content-group'>
            <div class='suite-header' style='padding: 8px; background-color: ${bg}; ${border}'>
                <span style='font-weight: bold; font-family: sans-serif; font-size: ${depth === 0 ? '1.1em' : '1.0em'}; color: #333;'>${cleanTitle}</span>
                <span style='font-family: sans-serif; font-size: 0.85em; color: #666; margin-left: 10px;'>
                    (Total: ${stats.total} tests | <span style='color:${COLORS.Passed}'>${stats.passed} Passed</span>
                    ${stats.failed > 0 ? ` | <span style='color:${COLORS.Failed}'>${stats.failed} Failed</span>` : ''}
                    ${stats.pending > 0 ? ` | <span style='color:${COLORS.Pending}'>${stats.pending} Pending</span>` : ''}
                    ${stats.skipped > 0 ? ` | <span style='color:${COLORS.Skipped}'>${stats.skipped} Skipped</span>` : ''}
                )</span>
            </div>`;

    if (suite.tests.length > 0) {
        const lists = { Failed: [], Pending: [], Skipped: [] };
        suite.tests.forEach(test => {
            const parsed = formatTestTitle(test.title);
            if (test.fail) lists.Failed.push(parsed);
            else if (test.pending) lists.Pending.push(parsed);
            else if (test.skipped) lists.Skipped.push(parsed);
        });

        Object.entries(lists).forEach(([label, items]) => {
            if (items.length > 0) {
                html += `<div style='color: ${COLORS[label]}; font-size: 0.85em; font-weight: bold; margin-top: 10px; padding-bottom: 2px;'>${label} Tests</div>
                         <table style='width: 100%; border-collapse: collapse; margin-top: 5px;'>
                            <tbody>`;
                items.forEach(item => {
                    html += `<tr>
                                <td style='padding: 5px; border: 1px solid #ddd; font-family: monospace; font-weight: bold;'><span style='color: ${COLORS[label]};'>${item.id}</span></td>
                                <td style='padding: 5px; border: 1px solid #ddd;'>${item.description}</td>
                             </tr>`;
                });
                html += `</tbody></table>`;
            }
        });
        html += `</div>`;
    }

    html += `</div>`;
    suite.suites.forEach(child => {
        html += getSuiteHtml(child, depth + 1);
    });
    return html;
}

function buildAdaptiveCard(stats = {}, suiteSummaries = [], artifactUrl = '', jobDuration = '', repoName = '') {
    const passed = stats.passes ?? 0;
    const failed = stats.failures ?? 0;

    const createCol = (text, width = 'auto', color = 'default', weight = 'default') => ({
        type: 'Column', width, items: [{ type: 'TextBlock', text: String(text), color, weight }]
    });

    const suiteRows = suiteSummaries.map(s => ({
        type: 'ColumnSet', spacing: 'small', separator: true,
        columns: [
            { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: s.name, wrap: true, weight: s.failed > 0 ? 'bolder' : 'default' }] },
            createCol(s.total, '45px'),
            createCol(s.total - s.failed - s.skipped - s.pending, '45px', 'good'),
            createCol(s.failed, '45px', s.failed > 0 ? 'attention' : 'default', s.failed > 0 ? 'bolder' : 'default'),
            createCol(s.skipped, '45px', s.skipped > 0 ? 'accent' : 'default', s.skipped > 0 ? 'bolder' : 'default'),
            createCol(s.pending, '45px', s.pending > 0 ? 'warning' : 'default', s.pending > 0 ? 'bolder' : 'default'),
        ]
    }));

    const card = {
        type: 'AdaptiveCard', version: '1.4', msteams: { width: 'Full' },
        body: [
            { type: 'TextBlock', text: `E2E Test Results - ${repoName}`, weight: 'bolder', size: 'large' },
            ...(jobDuration ? [{ type: 'TextBlock', text: `Test Runner Duration: ${jobDuration}`, spacing: 'small', isSubtle: true }] : []),
            {
                type: 'ColumnSet', spacing: 'medium',
                columns: [
                    { type: 'Column', width: 'stretch', items: [{ type: 'FactSet', facts: [{ title: 'Total', value: String(stats.testsRegistered ?? 0) }, { title: 'Passed', value: String(passed) }] }] },
                    { type: 'Column', width: 'stretch', items: [{ type: 'FactSet', facts: [{ title: 'Failed', value: String(failed) }, { title: 'Skipped', value: String(stats.skipped ?? 0) }] }] },
                    { type: 'Column', width: 'stretch', items: [{ type: 'FactSet', facts: [{ title: 'Pending', value: String(stats.pending ?? 0) }] }] }
                ]
            },
            {
                type: 'ColumnSet', style: 'accent', bleed: true, spacing: 'medium',
                columns: [
                    { type: 'Column', width: 'stretch', items: [{ type: 'TextBlock', text: 'Suite', weight: 'bolder' }] },
                    createCol('T', '45px', 'default', 'bolder'),
                    createCol('P', '45px', 'default', 'bolder'),
                    createCol('F', '45px', 'default', 'bolder'),
                    createCol('S', '45px', 'default', 'bolder'),
                    createCol('Pen', '45px', 'default', 'bolder'),
                ]
            },
            ...suiteRows
        ],
        actions: artifactUrl ? [
            { type: 'Action.OpenUrl', title: 'Download Artifacts / View Run', url: artifactUrl }
        ] : []
    };
    return JSON.stringify(card);
}

generateReport().catch(err => {
    console.error(err);
    process.exit(1);
});