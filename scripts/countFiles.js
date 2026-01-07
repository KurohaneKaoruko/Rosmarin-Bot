// 统计src目录下所有 .ts 和 .js 文件的行数和字符数，排除指定文件和文件夹
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function countFilesAndLines(basePath, excludeFiles, excludeDirs, maxFiles = 10) {
    let fileStats = [];

    function traverseDirectory(dirPath) {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                if (!excludeDirs.includes(entry.name)) {
                    traverseDirectory(fullPath);
                }
            } else if (!excludeFiles.includes(entry.name) && ['.ts', '.js'].includes(path.extname(entry.name))) {
                const fileContent = fs.readFileSync(fullPath, 'utf-8');
                const lines = fileContent.split(/\r?\n/);
                const lineCount = lines.length;
                const charCount = fileContent.length;
                fileStats.push({ filePath: fullPath, lineCount, charCount });
            }
        }
    }

    traverseDirectory(basePath);

    // 统计总数
    const tsCount = fileStats.filter(f => f.filePath.endsWith('.ts')).length;
    const jsCount = fileStats.filter(f => f.filePath.endsWith('.js')).length;
    const totalLines = fileStats.reduce((sum, f) => sum + f.lineCount, 0);
    const totalChars = fileStats.reduce((sum, f) => sum + f.charCount, 0);

    console.log(`总 .ts 文件数量: ${tsCount}; 总 .js 文件数量: ${jsCount};`);
    console.log(`总行数: ${totalLines}; 总字符数: ${totalChars}`);
    // console.log('统计排除项:', excludeFiles);

    // 按行数排序并列出前 N 个文件
    const topFiles = fileStats.sort((a, b) => b.lineCount - a.lineCount).slice(0, maxFiles);
    console.log("\n文件按行数排名:");
    topFiles.forEach((file, index) => {
        console.log(`${index + 1} - ${file.filePath}: 行数 ${file.lineCount}, 字符数 ${file.charCount}`);
    });
}

// 设置要排除的文件名
const excludeFiles = ['betterMove.ts', 'autoPlanner63.ts', 'screeps-profiler.js', 'roomResource.ts'];
// 设置要排除的文件夹名
const excludeDirs = ['wheel', 'planner'];

const maxFilesArg = process.argv[2] ? parseInt(process.argv[2], 10) : 10;
countFilesAndLines(path.join(__dirname, '../src'), excludeFiles, excludeDirs, maxFilesArg);
