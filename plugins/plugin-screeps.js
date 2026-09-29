import fs from 'fs';
import path from 'path';
import { uploadCode, collectDir } from './upload.js';

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
// 认证/分支检查/错误诊断等核心逻辑在 ./upload.js, 这里只负责从 dist 产物收集文件
async function uploadSource(config, options) {
    if (typeof config === "string")
        config = loadConfigFile(config);
    const code = collectDir(path.dirname(options.file), { includeSourceMap: config.uploadSourceMap === true });
    await uploadCode(config, code);
}
// 插件主函数, 用于配置和执行上传操作
function screeps(screepsOptions = {}) {
    return {
        name: "screeps",
        generateBundle(options, bundle, isWrite) {
            if (options.sourcemap)
                generateSourceMaps(bundle);
        },
        async writeBundle(options, bundle) {
            if (options.sourcemap)
                writeSourceMaps(options);
            if (!screepsOptions.dryRun) {
                await uploadSource((screepsOptions.configFile || screepsOptions.config), options);
            }
        }
    };
}

export default screeps;
