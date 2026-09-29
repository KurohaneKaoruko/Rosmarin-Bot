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

function getEndpointLabel(cfg) {
    const protocol = cfg.protocol || 'https';
    const hostname = cfg.hostname || 'screeps.com';
    const port = cfg.port ? `:${cfg.port}` : '';
    const apiPath = cfg.path || '';
    return `${protocol}://${hostname}${port}${apiPath}`;
}

function getErrorStatus(err) {
    return err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.response?.statusCode ?? null;
}

function getErrorCode(err) {
    return err?.code ?? err?.errno ?? null;
}

function toSingleLine(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function formatScreepsUploadError(err, { endpoint, branch, usingToken, payloadBytes = 0 }) {
    const status = getErrorStatus(err);
    const code = getErrorCode(err);
    const message = toSingleLine(err?.message ?? err);
    const lower = message.toLowerCase();

    const parts = [];
    parts.push(`Screeps 上传失败：${endpoint} (branch: ${branch})`);

    const meta = [];
    if (status) meta.push(`HTTP ${status}`);
    if (code) meta.push(String(code));
    if (meta.length) parts.push(meta.join(' / '));
    if (message) parts.push(message);

    const hints = [];
    const networkCodes = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
    if (code && networkCodes.has(String(code))) {
        hints.push('无法连接服务器：检查网络/代理/hostname/port/protocol/path');
    }
    // screeps-api 会把带状态码的原始错误重抛成 new Error(res.data)，状态码丢失；
    // 空消息且无状态码时，最常见的是请求体超过服务器限制被掐断 (body-parser 413 只回状态码不带 body)。
    if (!status && !message && payloadBytes > 2 * 1024 * 1024) {
        hints.push(`载荷 ${(payloadBytes / 1024 / 1024).toFixed(2)}MB 超过服务器请求体限制（实测 >3~4MB 会被掐断）；检查是否上传了 sourcemap 等大文件`);
    }
    if (status === 401 || status === 403 || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid token') || lower.includes('token')) {
        hints.push(usingToken ? '认证失败：token 可能失效/无权限，请重新生成 token' : '认证失败：账号密码可能错误，建议改用 token');
    }
    if (status === 404) {
        hints.push('接口路径可能不正确：检查 config.path');
    }
    if (status === 429 || lower.includes('rate limit')) {
        hints.push('请求过于频繁：稍后重试或减少 watch 推送频率');
    }
    if (status && status >= 500) {
        hints.push('服务器异常：可稍后重试或检查私服状态');
    }

    if (hints.length) parts.push(`建议：${hints.join('；')}`);
    return parts.join('\n');
}
// 上传编译后的代码到 Screeps 服务器
async function uploadSource(config, options) {
    // 自托管服务器证书过期/自签时，可在 .secret.json 对应条目加 "insecure": true 跳过校验
    if (config?.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    if (!config) {
        throw new Error('screeps() 需要提供 config/configFile，例如 screeps({configFile: \'./screeps.json\'})');
    }
    if (typeof config === "string")
        config = loadConfigFile(config);
    let code = getFileList(options.file, { includeSourceMap: config.uploadSourceMap === true });
    let branch = getBranchName(config.branch);
    let api = new screepsApi.ScreepsAPI(config);

    const endpoint = getEndpointLabel(config);
    const usingToken = Boolean(config.token);

    const payloadBytes = Object.values(code).reduce((sum, item) => (
        sum + (typeof item === 'string' ? Buffer.byteLength(item) : Math.ceil(item.binary.length * 0.75))
    ), 0);

    try {
        console.log(`[submit] 阶段 2/2: 开始上传到 Screeps -> ${endpoint} (branch: ${branch}, 载荷 ${(payloadBytes / 1024 / 1024).toFixed(2)}MB)`);
        if (!config.token) {
            await api.auth();
        }
        await runUpload(api, branch, code);
        console.log(`[submit] 阶段 2/2: 上传完成 -> ${endpoint} (branch: ${branch})`);
    } catch (err) {
        throw new Error(formatScreepsUploadError(err, { endpoint, branch, usingToken, payloadBytes }));
    }
}
// 执行上传操作, 先检查目标分支是否存在, 存在则直接上传, 不存在则先克隆一个空分支再上传
async function runUpload(api, branch, code) {
    const data = await api.raw.user.branches();
    if (!data || !Array.isArray(data.list)) {
        const snippet = toSingleLine(JSON.stringify(data)).slice(0, 200);
        throw new Error(`branches() 返回异常: ${snippet}`);
    }
    let branches = data.list.map((b) => b.branch);
    if (branches.includes(branch)) {
        await api.code.set(branch, code);
    }
    else {
        await api.raw.user.cloneBranch('', branch, code);
    }
}
// 从指定的输出文件中获取所有需要上传的文件列表
// sourcemap (main.js.map.js) 默认不上传：服务器对大请求体会直接掐断连接 (实测 >3~4MB 即 ECONNRESET)，
// 且 xxscreeps 控制台不消费 map；map 保留在 dist/ 本地供 scripts/stackmap.js 还原报错。
// 如确需上传 (如 Steam 客户端连私服做符号化)，在 .secret.json 对应目标加 "uploadSourceMap": true。
function getFileList(outputFile, { includeSourceMap = false } = {}) {
    let code = {};
    let base = path.dirname(outputFile);
    let files = fs.readdirSync(base).filter((f) => path.extname(f) === '.js' || path.extname(f) === '.wasm');
    if (!includeSourceMap) {
        files = files.filter((f) => !f.endsWith('.map.js'));
    }
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
// 获取目标分支名称, 如果指定为 'auto' 则使用main
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
