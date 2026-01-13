import screepsApi from 'screeps-api';
import fs from 'fs';
import git from 'git-rev-sync';
import path from 'path';

// 删除 source map 中的 sourcesContent 属性
// 优点: 优化 source map 文件大小, 上传到 Screeps 服务器时更快
// 缺点: 无法显示原始源代码内容（只能看到编译后的代码）
function generateSourceMaps(bundle) {
    for (const [_, item] of Object.entries(bundle)) {
        if (item.type === "chunk" && item.map) {
            delete item.map.sourcesContent;
        }
    }
}
// 重命名 source map 文件, 并添加 module.exports 前缀, 以便在 Screeps 服务器中加载
function writeSourceMaps(options) {
    const mapFile = options.file + '.map';
    const mapJsFile = options.file + '.map.js';
    fs.renameSync(mapFile, mapJsFile);
    const mapContent = fs.readFileSync(mapJsFile, 'utf8');
    const prefix = 'module.exports = ';
    const finalContent = mapContent.trim().startsWith(prefix) ? mapContent : prefix + mapContent + ';';
    fs.writeFileSync(mapJsFile, finalContent);
}
// 验证配置项是否符合要求
function validateConfig(cfg) {
    if (cfg.hostname && cfg.hostname === 'screeps.com') {
        return [
            typeof cfg.token === "string",
            cfg.protocol === "http" || cfg.protocol === "https",
            typeof cfg.hostname === "string",
            typeof cfg.port === "number",
            typeof cfg.path === "string",
            typeof cfg.branch === "string"
        ].reduce((a, b) => a && b);
    }
    return [
        (typeof cfg.email === 'string' && typeof cfg.password === 'string') || typeof cfg.token === 'string',
        cfg.protocol === "http" || cfg.protocol === "https",
        typeof cfg.hostname === "string",
        typeof cfg.port === "number",
        typeof cfg.path === "string",
        typeof cfg.branch === "string"
    ].reduce((a, b) => a && b);
}
// 从指定的配置文件中加载配置项
function loadConfigFile(configFile) {
    let data = fs.readFileSync(configFile, 'utf8');
    let cfg = JSON.parse(data);
    if (!validateConfig(cfg))
        throw new TypeError("Invalid config");
    if (cfg.email && cfg.password && !cfg.token && cfg.hostname === 'screeps.com') {
        console.log('Please change your email/password to a token');
    }
    return cfg;
}
// 上传编译后的代码到 Screeps 服务器
function uploadSource(config, options, bundle) {
    if (!config) {
        console.log('screeps() needs a config e.g. screeps({configFile: \'./screeps.json\'}) or screeps({config: { ... }})');
    }
    else {
        if (typeof config === "string")
            config = loadConfigFile(config);
        let code = getFileList(options.file);
        let branch = getBranchName(config.branch);
        let api = new screepsApi.ScreepsAPI(config);
        if (!config.token) {
            api.auth().then(() => {
                runUpload(api, branch, code);
            });
        }
        else {
            runUpload(api, branch, code);
        }
    }
}
// 执行上传操作, 先检查目标分支是否存在, 存在则直接上传, 不存在则先克隆一个空分支再上传
function runUpload(api, branch, code) {
    api.raw.user.branches().then((data) => {
        let branches = data.list.map((b) => b.branch);
        if (branches.includes(branch)) {
            api.code.set(branch, code);
        }
        else {
            api.raw.user.cloneBranch('', branch, code);
        }
    });
}
// 从指定的输出文件中获取所有需要上传的文件列表
function getFileList(outputFile) {
    let code = {};
    let base = path.dirname(outputFile);
    let files = fs.readdirSync(base).filter((f) => path.extname(f) === '.js' || path.extname(f) === '.wasm');
    files.map((file) => {
        if (file.endsWith('.js')) {
            code[file.replace(/\.js$/i, '')] = fs.readFileSync(path.join(base, file), 'utf8');
        }
        else {
            code[file.replace(/\.wasm$/i, '')] = {
                binary: fs.readFileSync(path.join(base, file)).toString('base64')
            };
        }
    });
    return code;
}
// 获取目标分支名称, 如果指定为 'auto' 则使用当前 Git 分支
function getBranchName(branch) {
    if (branch === 'auto') {
        return git.branch();
    }
    else {
        return branch;
    }
}
// 插件主函数, 用于配置和执行上传操作
function screeps(screepsOptions = {}) {
    return {
        name: "screeps",
        generateBundle(options, bundle, isWrite) {
            if (options.sourcemap)
                generateSourceMaps(bundle);
        },
        writeBundle(options, bundle) {
            if (options.sourcemap)
                writeSourceMaps(options);
            if (!screepsOptions.dryRun) {
                uploadSource((screepsOptions.configFile || screepsOptions.config), options);
            }
        }
    };
}

export default screeps;
