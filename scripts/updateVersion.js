import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PACKAGE_JSON_PATH = path.join(rootDir, 'package.json');
const CONFIG_TS_PATH = path.join(rootDir, 'src/constant/config.ts');
const README_PATH = path.join(rootDir, 'README.md');

function runCommand(cmd, args, { stdio = 'inherit' } = {}) {
    const result = spawnSync(cmd, args, {
        cwd: rootDir,
        stdio,
        shell: false,
        encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    return result;
}

function runShellCommand(cmd, args, { stdio = 'inherit' } = {}) {
    const result = spawnSync(cmd, args, {
        cwd: rootDir,
        stdio,
        shell: process.platform === 'win32',
        encoding: 'utf-8',
    });
    if (result.error) throw result.error;
    return result;
}

function runGit(args, { stdio = 'inherit' } = {}) {
    const result = runCommand('git', args, { stdio });
    if (typeof result.status === 'number' && result.status !== 0) {
        const detail = stdio === 'pipe' ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
        throw new Error(`git ${args.join(' ')} 失败 (exit code: ${result.status})${detail ? `\n${detail}` : ''}`);
    }
    return result;
}

function isGitAvailable() {
    try {
        runGit(['--version'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

function isInsideGitWorkTree() {
    try {
        const result = runGit(['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
        return String(result.stdout).trim() === 'true';
    } catch {
        return false;
    }
}

function getGitChangedFiles() {
    const result = runGit(['status', '--porcelain'], { stdio: 'pipe' });

    const lines = String(result.stdout)
        .split('\n')
        .map((s) => s.trimEnd())
        .filter(Boolean);

    const files = new Set();
    for (const line of lines) {
        const rawPath = line.slice(3).trim();
        if (!rawPath) continue;
        const parsed = rawPath.includes('->') ? rawPath.split('->').pop().trim() : rawPath;
        files.add(parsed.replaceAll('\\', '/'));
    }
    return files;
}

function getGitStagedFiles() {
    const result = runGit(['diff', '--cached', '--name-only'], { stdio: 'pipe' });
    return String(result.stdout)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
}

function getVersionChangedFiles() {
    const candidates = [
        PACKAGE_JSON_PATH,
        CONFIG_TS_PATH,
        README_PATH,
        path.join(rootDir, 'pnpm-lock.yaml'),
        path.join(rootDir, 'package-lock.json'),
        path.join(rootDir, 'yarn.lock'),
    ];
    return candidates
        .filter((p) => fs.existsSync(p))
        .map((p) => path.relative(rootDir, p).split(path.sep).join('/'));
}

function gitCommitVersion(newVersion) {
    if (!isGitAvailable()) {
        console.log('! 未检测到 git，跳过自动提交');
        return;
    }
    if (!isInsideGitWorkTree()) {
        console.log('! 当前目录不是 git 仓库，跳过自动提交');
        return;
    }

    const stagedBefore = getGitStagedFiles();
    if (stagedBefore.length > 0) {
        console.log('! 检测到已有暂存区内容，跳过自动提交');
        return;
    }

    const versionRelatedFiles = getVersionChangedFiles();
    const changedFiles = getGitChangedFiles();
    const filesToCommit = versionRelatedFiles.filter((p) => changedFiles.has(p));

    if (filesToCommit.length === 0) {
        console.log('! 未找到需要提交的文件，跳过自动提交');
        return;
    }

    runGit(['add', '--', ...filesToCommit], { stdio: 'inherit' });

    const diffCheck = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...filesToCommit], {
        cwd: rootDir,
        stdio: 'pipe',
        shell: false,
        encoding: 'utf-8',
    });
    if (diffCheck.error) throw diffCheck.error;
    if (typeof diffCheck.status === 'number' && diffCheck.status === 0) {
        console.log('! 暂存区无变更，跳过提交');
        return;
    }
    if (typeof diffCheck.status === 'number' && diffCheck.status !== 1) {
        throw new Error(`git diff --cached 检查失败 (exit code: ${diffCheck.status})`);
    }

    runGit(['commit', '-m', `chore: 更新版本号至${newVersion}`, '--', ...filesToCommit], { stdio: 'inherit' });
    console.log(`✓ git 已提交: chore: 更新版本号至${newVersion}`);
}

/**
 * 解析版本号
 */
function parseVersion(version) {
    const [major, minor, patch] = version.split('.').map(Number);
    return { major, minor, patch };
}

/**
 * 递增版本号
 */
function bumpVersion(currentVersion, type) {
    const { major, minor, patch } = parseVersion(currentVersion);
    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            return currentVersion;
    }
}

/**
 * 获取当前版本号
 */
function getCurrentVersion() {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
    return packageJson.version;
}

/**
 * 更新 package.json 中的版本号
 */
function detectPackageManager() {
    try {
        const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
        if (typeof packageJson.packageManager === 'string') {
            if (packageJson.packageManager.startsWith('pnpm@')) return 'pnpm';
            if (packageJson.packageManager.startsWith('npm@')) return 'npm';
        }
    } catch {}

    const userAgent = process.env.npm_config_user_agent;
    if (typeof userAgent === 'string') {
        if (userAgent.startsWith('pnpm/')) return 'pnpm';
        if (userAgent.startsWith('npm/')) return 'npm';
    }

    if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')) || fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(rootDir, 'package-lock.json'))) {
        return 'npm';
    }

    return 'npm';
}

function updatePackageVersion(newVersion) {
    const packageManager = detectPackageManager();
    const args = ['version', newVersion, '--no-git-tag-version'];

    if (packageManager === 'pnpm' && fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
        args.push('--workspace-root');
    }

    const result = runShellCommand(packageManager, args, { stdio: 'inherit' });
    if (typeof result.status === 'number' && result.status !== 0) {
        throw new Error(`${packageManager} version 失败 (exit code: ${result.status})`);
    }

    const updatedVersion = getCurrentVersion();
    console.log(`✓ package.json 版本已更新为 ${updatedVersion}`);
    return updatedVersion;
}

/**
 * 更新 config.ts 中的版本号
 */
function updateConfigTs(newVersion) {
    if (!fs.existsSync(CONFIG_TS_PATH)) return;
    let content = fs.readFileSync(CONFIG_TS_PATH, 'utf-8');
    const nextContent = content.replace(
        /export const VERSION = '[^']+';/,
        `export const VERSION = '${newVersion}';`
    );
    if (content === nextContent) {
        throw new Error('config.ts 未找到可替换的 VERSION 常量');
    }
    content = nextContent;
    fs.writeFileSync(CONFIG_TS_PATH, content, 'utf-8');
    console.log(`✓ config.ts 版本已更新为 ${newVersion}`);
}

/**
 * 更新 README.md 中的版本徽章
 */
function updateReadme(newVersion) {
    if (!fs.existsSync(README_PATH)) return;
    let content = fs.readFileSync(README_PATH, 'utf-8');
    const badgeRegex = /!\[version\]\(https:\/\/img\.shields\.io\/badge\/version-[^-]+-orange([^)]*)\)/;
    const nextContent = content.replace(
        badgeRegex,
        `![version](https://img.shields.io/badge/version-${newVersion}-orange$1)`
    );
    if (content === nextContent) {
        throw new Error('README.md 未找到可替换的 version 徽章');
    }
    content = nextContent;
    fs.writeFileSync(README_PATH, content, 'utf-8');
    console.log(`✓ README.md 版本徽章已更新为 ${newVersion}`);
}

/**
 * 主函数
 */
async function main() {
    const currentVersion = getCurrentVersion();
    
    console.log(`\n当前版本: ${currentVersion}\n`);

    const { updateType } = await inquirer.prompt([
        {
            type: 'list',
            name: 'updateType',
            message: '选择版本更新方式:',
            choices: [
                { name: `patch (${bumpVersion(currentVersion, 'patch')})`, value: 'patch' },
                { name: `minor (${bumpVersion(currentVersion, 'minor')})`, value: 'minor' },
                { name: `major (${bumpVersion(currentVersion, 'major')})`, value: 'major' },
                { name: '自定义版本号', value: 'custom' },
            ],
        },
    ]);

    let newVersion;

    if (updateType === 'custom') {
        const { customVersion } = await inquirer.prompt([
            {
                type: 'input',
                name: 'customVersion',
                message: '输入新版本号 (格式: x.y.z):',
                validate: (input) => {
                    if (/^\d+\.\d+\.\d+$/.test(input)) {
                        return true;
                    }
                    return '请输入有效的版本号格式 (例如: 2.0.0)';
                },
            },
        ]);
        newVersion = customVersion;
    } else {
        newVersion = bumpVersion(currentVersion, updateType);
    }

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `确认将版本从 ${currentVersion} 更新为 ${newVersion}?`,
            default: true,
        },
    ]);

    if (!confirm) {
        console.log('已取消更新');
        return;
    }

    const updatedVersion = updatePackageVersion(newVersion);
    updateConfigTs(updatedVersion);
    updateReadme(updatedVersion);
    gitCommitVersion(updatedVersion);

    console.log('\n✓ 版本更新完成!');
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
