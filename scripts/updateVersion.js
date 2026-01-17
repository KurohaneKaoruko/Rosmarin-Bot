import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import inquirer from 'inquirer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PACKAGE_JSON_PATH = path.join(rootDir, 'package.json');
const HELP_TS_PATH = path.join(rootDir, 'src/console/help.ts');
const README_PATH = path.join(rootDir, 'README.md');

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

    const result = spawnSync(packageManager, args, {
        cwd: rootDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });

    if (result.error) throw result.error;
    if (typeof result.status === 'number' && result.status !== 0) {
        throw new Error(`${packageManager} version 失败 (exit code: ${result.status})`);
    }

    const updatedVersion = getCurrentVersion();
    console.log(`✓ package.json 版本已更新为 ${updatedVersion}`);
    return updatedVersion;
}

/**
 * 更新 help.ts 中的版本号
 */
function updateHelpTs(newVersion) {
    let content = fs.readFileSync(HELP_TS_PATH, 'utf-8');
    content = content.replace(
        /const VERSION = '[^']+';/,
        `const VERSION = '${newVersion}';`
    );
    fs.writeFileSync(HELP_TS_PATH, content, 'utf-8');
    console.log(`✓ src/console/help.ts 版本已更新为 ${newVersion}`);
}

/**
 * 更新 README.md 中的版本徽章
 */
function updateReadme(newVersion) {
    let content = fs.readFileSync(README_PATH, 'utf-8');
    content = content.replace(
        /!\[version\]\(https:\/\/img\.shields\.io\/badge\/version-[^-]+-orange\)/,
        `![version](https://img.shields.io/badge/version-${newVersion}-orange)`
    );
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
    updateHelpTs(updatedVersion);
    updateReadme(updatedVersion);

    console.log('\n✓ 版本更新完成!');
}

main();
