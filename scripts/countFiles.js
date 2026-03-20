import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CODE_EXTENSIONS = ['.ts', '.js'];
const TYPE_FILE_DIR_NAMES = new Set(['interface', 'interfaces', 'types', 'typings']);
const TYPE_FILE_NAME_PATTERNS = [
    /\.d\.ts$/i,
    /\.interface\.[jt]s$/i,
    /\.types?\.[jt]s$/i,
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function toPosixPath(filePath) {
    return filePath.split(path.sep).join('/');
}

function toRelativePath(rootPath, targetPath) {
    const relativePath = path.relative(rootPath, targetPath) || '.';
    return toPosixPath(relativePath);
}

function formatInteger(value) {
    return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDecimal(value, digits = 2) {
    const [integerPart, decimalPart] = Number(value).toFixed(digits).split('.');
    const formattedInteger = formatInteger(Number(integerPart));
    return digits > 0 ? `${formattedInteger}.${decimalPart}` : formattedInteger;
}

function formatPercent(value, total) {
    if (!total) return '0.00%';
    return `${formatDecimal((value / total) * 100, 2)}%`;
}

function formatDate(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    ].join(' ');
}

function isPositiveInteger(value) {
    return /^\d+$/.test(value) && Number.parseInt(value, 10) > 0;
}

function isTypeFile(relativePath) {
    const normalizedPath = toPosixPath(relativePath);
    const pathSegments = normalizedPath.split('/');
    const fileName = pathSegments[pathSegments.length - 1] || '';

    if (TYPE_FILE_NAME_PATTERNS.some((pattern) => pattern.test(fileName))) {
        return true;
    }

    return pathSegments.slice(0, -1).some((segment) => TYPE_FILE_DIR_NAMES.has(segment.toLowerCase()));
}

function sumBy(items, key) {
    return items.reduce((sum, item) => sum + item[key], 0);
}

function getContentMetrics(fileContent) {
    if (fileContent.length === 0) {
        return {
            lineCount: 0,
            nonEmptyLineCount: 0,
            blankLineCount: 0,
            charCount: 0,
        };
    }

    const lines = fileContent.split(/\r?\n/);
    const lineCount = lines.length;
    const nonEmptyLineCount = lines.reduce((count, line) => count + (line.trim() ? 1 : 0), 0);

    return {
        lineCount,
        nonEmptyLineCount,
        blankLineCount: lineCount - nonEmptyLineCount,
        charCount: fileContent.length,
    };
}

function summarizeFileStats(fileStats) {
    const fileCount = fileStats.length;
    const lineCount = sumBy(fileStats, 'lineCount');
    const nonEmptyLineCount = sumBy(fileStats, 'nonEmptyLineCount');
    const blankLineCount = sumBy(fileStats, 'blankLineCount');
    const charCount = sumBy(fileStats, 'charCount');

    return {
        fileCount,
        lineCount,
        nonEmptyLineCount,
        blankLineCount,
        charCount,
        avgLines: fileCount > 0 ? lineCount / fileCount : 0,
        avgChars: fileCount > 0 ? charCount / fileCount : 0,
    };
}

function alignText(text, width, align = 'left') {
    if (align === 'right') return text.padStart(width, ' ');
    if (align === 'center') {
        const padding = width - text.length;
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
    }
    return text.padEnd(width, ' ');
}

function renderTable(columns, rows) {
    if (rows.length === 0) return '(no data)';

    const widths = columns.map((column) => {
        const cellWidth = rows.reduce((maxWidth, row) => {
            const value = String(row[column.key] ?? '');
            return Math.max(maxWidth, value.length);
        }, 0);
        return Math.max(column.title.length, cellWidth);
    });

    const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
    const renderRow = (row, isHeader = false) => {
        const cells = columns.map((column, index) => {
            const value = String(isHeader ? column.title : row[column.key] ?? '');
            const align = isHeader ? 'left' : (column.align || 'left');
            return alignText(value, widths[index], align);
        });

        return `| ${cells.join(' | ')} |`;
    };

    return [
        border,
        renderRow({}, true),
        border,
        ...rows.map((row) => renderRow(row)),
        border,
    ].join('\n');
}

function printSection(title) {
    console.log(`\n${title}`);
    console.log('-'.repeat(Math.max(title.length * 2, 16)));
}

function sortEntries(entries) {
    return entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

function getTopLevelPath(basePath, relativeToBase) {
    const baseRelativePath = toRelativePath(projectRoot, basePath);
    const [topLevelSegment] = relativeToBase.split('/');
    return relativeToBase.includes('/') ? `${baseRelativePath}/${topLevelSegment}` : baseRelativePath;
}

function collectFileStats(basePath, excludeFiles, excludeDirs) {
    const fileStats = [];

    function traverseDirectory(dirPath) {
        const entries = sortEntries(fs.readdirSync(dirPath, { withFileTypes: true }));

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                if (!excludeDirs.includes(entry.name)) {
                    traverseDirectory(fullPath);
                }
                continue;
            }

            const extension = path.extname(entry.name);
            if (excludeFiles.includes(entry.name) || !CODE_EXTENSIONS.includes(extension)) {
                continue;
            }

            const fileContent = fs.readFileSync(fullPath, 'utf-8');
            const relativePath = toRelativePath(projectRoot, fullPath);
            const relativeToBase = toRelativePath(basePath, fullPath);

            fileStats.push({
                relativePath,
                directoryPath: toRelativePath(projectRoot, path.dirname(fullPath)),
                topLevelPath: getTopLevelPath(basePath, relativeToBase),
                extension,
                isTypeFile: isTypeFile(relativePath),
                ...getContentMetrics(fileContent),
            });
        }
    }

    traverseDirectory(basePath);
    return fileStats;
}

function buildExtensionRows(fileStats) {
    const extensionMap = new Map();

    for (const file of fileStats) {
        const current = extensionMap.get(file.extension) || {
            extension: file.extension,
            fileCount: 0,
            lineCount: 0,
            nonEmptyLineCount: 0,
            blankLineCount: 0,
            charCount: 0,
        };

        current.fileCount += 1;
        current.lineCount += file.lineCount;
        current.nonEmptyLineCount += file.nonEmptyLineCount;
        current.blankLineCount += file.blankLineCount;
        current.charCount += file.charCount;

        extensionMap.set(file.extension, current);
    }

    return Array.from(extensionMap.values())
        .sort((a, b) => b.lineCount - a.lineCount || a.extension.localeCompare(b.extension))
        .map((item) => ({
            ext: item.extension,
            files: formatInteger(item.fileCount),
            lines: formatInteger(item.lineCount),
            nonEmpty: formatInteger(item.nonEmptyLineCount),
            blank: formatInteger(item.blankLineCount),
            chars: formatInteger(item.charCount),
            avgLines: formatDecimal(item.lineCount / item.fileCount, 2),
        }));
}

function buildTopLevelRows(fileStats, totalLines, maxRows) {
    const topLevelMap = new Map();

    for (const file of fileStats) {
        const current = topLevelMap.get(file.topLevelPath) || {
            path: file.topLevelPath,
            fileCount: 0,
            lineCount: 0,
            charCount: 0,
        };

        current.fileCount += 1;
        current.lineCount += file.lineCount;
        current.charCount += file.charCount;

        topLevelMap.set(file.topLevelPath, current);
    }

    return Array.from(topLevelMap.values())
        .sort((a, b) => b.lineCount - a.lineCount || b.fileCount - a.fileCount || a.path.localeCompare(b.path))
        .slice(0, maxRows)
        .map((item) => ({
            path: item.path,
            files: formatInteger(item.fileCount),
            lines: formatInteger(item.lineCount),
            share: formatPercent(item.lineCount, totalLines),
            avgLines: formatDecimal(item.lineCount / item.fileCount, 2),
            chars: formatInteger(item.charCount),
        }));
}

function buildFileRows(fileStats, totalValue, sortKey, maxRows) {
    return [...fileStats]
        .sort((a, b) => b[sortKey] - a[sortKey] || b.lineCount - a.lineCount || a.relativePath.localeCompare(b.relativePath))
        .slice(0, maxRows)
        .map((file, index) => ({
            rank: String(index + 1),
            path: file.relativePath,
            lines: formatInteger(file.lineCount),
            nonEmpty: formatInteger(file.nonEmptyLineCount),
            blank: formatInteger(file.blankLineCount),
            chars: formatInteger(file.charCount),
            share: formatPercent(file[sortKey], totalValue),
        }));
}

function buildScopeRows(fileStats) {
    const allSummary = summarizeFileStats(fileStats);
    const typeOnlySummary = summarizeFileStats(fileStats.filter((file) => file.isTypeFile));
    const nonTypeSummary = summarizeFileStats(fileStats.filter((file) => !file.isTypeFile));

    const rows = [
        { label: '全部代码', summary: allSummary },
        { label: '不含类型文件', summary: nonTypeSummary },
        { label: '仅类型文件', summary: typeOnlySummary },
    ];

    return rows.map(({ label, summary }) => ({
        scope: label,
        files: formatInteger(summary.fileCount),
        lines: formatInteger(summary.lineCount),
        nonEmpty: formatInteger(summary.nonEmptyLineCount),
        blank: formatInteger(summary.blankLineCount),
        chars: formatInteger(summary.charCount),
        lineShare: formatPercent(summary.lineCount, allSummary.lineCount),
        charShare: formatPercent(summary.charCount, allSummary.charCount),
        avgLines: formatDecimal(summary.avgLines, 2),
    }));
}

function printOverview(basePath, fileStats, maxFiles) {
    const totalSummary = summarizeFileStats(fileStats);
    const directoryCount = new Set(fileStats.map((file) => file.directoryPath)).size;

    console.log('代码统计报告');
    console.log('============');
    console.log(`项目根目录   : .`);
    console.log(`统计目录     : ${toRelativePath(projectRoot, basePath)}`);
    console.log(`统计类型     : ${CODE_EXTENSIONS.join(', ')}`);
    console.log(`排行榜数量   : Top ${maxFiles}`);
    console.log(`生成时间     : ${formatDate()}`);

    printSection('总览');
    console.log(`文件总数     : ${formatInteger(totalSummary.fileCount)}`);
    console.log(`覆盖目录     : ${formatInteger(directoryCount)}`);
    console.log(`总行数       : ${formatInteger(totalSummary.lineCount)}`);
    console.log(`非空行       : ${formatInteger(totalSummary.nonEmptyLineCount)} (${formatPercent(totalSummary.nonEmptyLineCount, totalSummary.lineCount)})`);
    console.log(`空行         : ${formatInteger(totalSummary.blankLineCount)} (${formatPercent(totalSummary.blankLineCount, totalSummary.lineCount)})`);
    console.log(`总字符数     : ${formatInteger(totalSummary.charCount)}`);
    console.log(`平均每文件   : ${formatDecimal(totalSummary.avgLines, 2)} 行 / ${formatDecimal(totalSummary.avgChars, 2)} 字符`);

    printSection('统计口径对比');
    console.log(renderTable([
        { key: 'scope', title: 'Scope' },
        { key: 'files', title: 'Files', align: 'right' },
        { key: 'lines', title: 'Lines', align: 'right' },
        { key: 'nonEmpty', title: 'NonEmpty', align: 'right' },
        { key: 'blank', title: 'Blank', align: 'right' },
        { key: 'chars', title: 'Chars', align: 'right' },
        { key: 'lineShare', title: 'LineShare', align: 'right' },
        { key: 'charShare', title: 'CharShare', align: 'right' },
        { key: 'avgLines', title: 'AvgLines', align: 'right' },
    ], buildScopeRows(fileStats)));
    console.log('类型文件规则 : *.d.ts、*.interface.ts、*.type.ts、*.types.ts，以及 interface(s)/types/typings 目录');

    return {
        totalLines: totalSummary.lineCount,
        totalChars: totalSummary.charCount,
    };
}

function countFilesAndLines(basePath, excludeFiles, excludeDirs, maxFiles = 10) {
    if (!fs.existsSync(basePath) || !fs.statSync(basePath).isDirectory()) {
        console.error(`统计目录不存在或不是文件夹: ${toRelativePath(projectRoot, basePath)}`);
        process.exitCode = 1;
        return;
    }

    const fileStats = collectFileStats(basePath, excludeFiles, excludeDirs);
    if (fileStats.length === 0) {
        console.log(`未在 ${toRelativePath(projectRoot, basePath)} 中找到可统计的 ${CODE_EXTENSIONS.join(', ')} 文件。`);
        return;
    }

    const { totalLines, totalChars } = printOverview(basePath, fileStats, maxFiles);

    printSection('按扩展名分布');
    console.log(renderTable([
        { key: 'ext', title: 'Ext' },
        { key: 'files', title: 'Files', align: 'right' },
        { key: 'lines', title: 'Lines', align: 'right' },
        { key: 'nonEmpty', title: 'NonEmpty', align: 'right' },
        { key: 'blank', title: 'Blank', align: 'right' },
        { key: 'chars', title: 'Chars', align: 'right' },
        { key: 'avgLines', title: 'AvgLines', align: 'right' },
    ], buildExtensionRows(fileStats)));

    printSection('一级目录分布（按行数）');
    console.log(renderTable([
        { key: 'path', title: 'Path' },
        { key: 'files', title: 'Files', align: 'right' },
        { key: 'lines', title: 'Lines', align: 'right' },
        { key: 'share', title: 'Share', align: 'right' },
        { key: 'avgLines', title: 'AvgLines', align: 'right' },
        { key: 'chars', title: 'Chars', align: 'right' },
    ], buildTopLevelRows(fileStats, totalLines, maxFiles)));

    printSection('文件排行（按行数）');
    console.log(renderTable([
        { key: 'rank', title: '#' , align: 'right' },
        { key: 'path', title: 'Path' },
        { key: 'lines', title: 'Lines', align: 'right' },
        { key: 'nonEmpty', title: 'NonEmpty', align: 'right' },
        { key: 'blank', title: 'Blank', align: 'right' },
        { key: 'chars', title: 'Chars', align: 'right' },
        { key: 'share', title: 'Share', align: 'right' },
    ], buildFileRows(fileStats, totalLines, 'lineCount', maxFiles)));

    printSection('文件排行（按字符数）');
    console.log(renderTable([
        { key: 'rank', title: '#', align: 'right' },
        { key: 'path', title: 'Path' },
        { key: 'chars', title: 'Chars', align: 'right' },
        { key: 'lines', title: 'Lines', align: 'right' },
        { key: 'nonEmpty', title: 'NonEmpty', align: 'right' },
        { key: 'blank', title: 'Blank', align: 'right' },
        { key: 'share', title: 'Share', align: 'right' },
    ], buildFileRows(fileStats, totalChars, 'charCount', maxFiles)));
}

function printHelp() {
    console.log([
        '代码统计脚本用法:',
        '  node scripts/countFiles.js',
        '  node scripts/countFiles.js src/modules',
        '  node scripts/countFiles.js 20',
        '  node scripts/countFiles.js src/modules 20',
        '  node scripts/countFiles.js --path src/modules --top 20',
        '',
        '说明:',
        '  - 默认统计目录: src',
        '  - 默认排行榜数量: Top 10',
        '  - 位置参数支持目录和 Top N 混合传入，顺序不限',
        '  - 排行路径统一按项目根目录输出相对路径',
    ].join('\n'));
}

function parseCliArgs(argv) {
    const options = {
        maxFiles: 10,
        targetPath: path.join(projectRoot, 'src'),
        maxFilesSpecified: false,
        targetSpecified: false,
    };
    const positionals = [];

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--help' || arg === '-h') {
            return { help: true };
        }

        if (arg === '--path' || arg === '-p') {
            const nextArg = argv[index + 1];
            if (!nextArg) return { error: '参数错误: --path 之后需要提供目录。' };
            options.targetPath = path.resolve(projectRoot, nextArg);
            options.targetSpecified = true;
            index += 1;
            continue;
        }

        if (arg.startsWith('--path=')) {
            const pathValue = arg.slice('--path='.length);
            if (!pathValue) return { error: '参数错误: --path= 之后需要提供目录。' };
            options.targetPath = path.resolve(projectRoot, pathValue);
            options.targetSpecified = true;
            continue;
        }

        if (arg === '--top' || arg === '-t') {
            const nextArg = argv[index + 1];
            if (!nextArg || !isPositiveInteger(nextArg)) {
                return { error: '参数错误: --top 之后需要提供正整数。' };
            }
            options.maxFiles = Number.parseInt(nextArg, 10);
            options.maxFilesSpecified = true;
            index += 1;
            continue;
        }

        if (arg.startsWith('--top=')) {
            const topValue = arg.slice('--top='.length);
            if (!isPositiveInteger(topValue)) {
                return { error: '参数错误: --top= 之后需要提供正整数。' };
            }
            options.maxFiles = Number.parseInt(topValue, 10);
            options.maxFilesSpecified = true;
            continue;
        }

        positionals.push(arg);
    }

    for (const arg of positionals) {
        if (isPositiveInteger(arg) && !options.maxFilesSpecified) {
            options.maxFiles = Number.parseInt(arg, 10);
            options.maxFilesSpecified = true;
            continue;
        }

        if (!options.targetSpecified) {
            options.targetPath = path.resolve(projectRoot, arg);
            options.targetSpecified = true;
            continue;
        }

        return { error: `参数错误: 无法识别多余参数 "${arg}"。` };
    }

    return {
        maxFiles: options.maxFiles,
        targetPath: options.targetPath,
    };
}

const excludeFiles = [];
const excludeDirs = [];

const cliOptions = parseCliArgs(process.argv.slice(2));

if (cliOptions.help) {
    printHelp();
    process.exit(0);
}

if (cliOptions.error) {
    console.error(cliOptions.error);
    console.error('使用 --help 查看支持的参数形式。');
    process.exit(1);
}

countFilesAndLines(cliOptions.targetPath, excludeFiles, excludeDirs, cliOptions.maxFiles);
