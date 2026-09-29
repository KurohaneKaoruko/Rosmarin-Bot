// Screeps 代码上传核心逻辑
// 被 plugins/plugin-screeps.js (构建产物上传) 与 scripts/submit.js (--dir 自定义目录上传) 共用
import screepsApi from 'screeps-api';
import fs from 'fs';
import path from 'path';
import git from 'git-rev-sync';

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

// 获取目标分支名称, 如果指定为 'auto' 则使用当前 git 分支
export function getBranchName(branch) {
    if (branch === 'auto') {
        return git.branch();
    }
    else {
        return branch;
    }
}

// 读取目录内所有 .js/.wasm 文件, 组装成 { 模块名: 源码 } 形式的上传载荷
// sourcemap (*.map.js) 默认不上传：服务器对大请求体会直接掐断连接 (实测 >3~4MB 即 ECONNRESET)，
// 如确需上传 (如 Steam 客户端连私服做符号化)，在配置中加 "uploadSourceMap": true。
export function collectDir(baseDir, { includeSourceMap = false } = {}) {
    let code = {};
    let files = fs.readdirSync(baseDir).filter((f) => path.extname(f) === '.js' || path.extname(f) === '.wasm');
    if (!includeSourceMap) {
        files = files.filter((f) => !f.endsWith('.map.js'));
    }
    files.map((file) => {
        if (file.endsWith('.js')) {
            code[file.replace(/\.js$/i, '')] = fs.readFileSync(path.join(baseDir, file), 'utf8');
        }
        else {
            code[file.replace(/\.wasm$/i, '')] = {
                binary: fs.readFileSync(path.join(baseDir, file)).toString('base64')
            };
        }
    });
    return code;
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

// 建立连接并把载荷上传到 Screeps 服务器
export async function uploadCode(config, code) {
    // 自托管服务器证书过期/自签时，可在配置里加 "insecure": true 跳过校验
    if (config?.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    if (!config) {
        throw new Error('需要提供 Screeps 服务器配置 (hostname/port/branch 及认证信息)');
    }
    let branch = getBranchName(config.branch || 'main');
    let api = new screepsApi.ScreepsAPI(config);

    const endpoint = getEndpointLabel(config);
    const usingToken = Boolean(config.token);

    const payloadBytes = Object.values(code).reduce((sum, item) => (
        sum + (typeof item === 'string' ? Buffer.byteLength(item) : Math.ceil(item.binary.length * 0.75))
    ), 0);

    try {
        console.log(`[submit] 阶段 2/2: 开始上传到 Screeps -> ${endpoint} (branch: ${branch}, 载荷 ${(payloadBytes / 1024 / 1024).toFixed(2)}MB)`);
        // 账密配置总是重新登录: 私服会轮换 token, 固定 token 过期会导致 Not Authorized
        if (config.email && config.password) {
            await api.auth();
        } else if (!config.token) {
            throw new Error('配置缺少 token 或 email/password，无法认证');
        }
        await runUpload(api, branch, code);
        console.log(`[submit] 阶段 2/2: 上传完成 -> ${endpoint} (branch: ${branch})`);
    } catch (err) {
        throw new Error(formatScreepsUploadError(err, { endpoint, branch, usingToken, payloadBytes }));
    }
}
