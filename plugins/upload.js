// Screeps 代码上传 + 本地客户端部署的共用逻辑
//   上传: plugins/plugin-screeps.js (构建产物) 与 scripts/submit.js (--dir 自定义目录)
//   本地部署: rolldown.config.js 的 copy-to-local-client 插件与 scripts/submit.js
import screepsApi from 'screeps-api';
import fs from 'fs';
import path from 'path';
import git from 'git-rev-sync';

// ── 错误信息格式化 ──

function getEndpointLabel(cfg) {
    const protocol = cfg.protocol || 'https';
    const hostname = cfg.hostname || 'screeps.com';
    const port = cfg.port ? `:${cfg.port}` : '';
    return `${protocol}://${hostname}${port}${cfg.path || ''}`;
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
        hints.push(`载荷 ${(payloadBytes / 1024 / 1024).toFixed(2)}MB 超过服务器请求体限制（实测 >3~4MB 会被掐断）；带上 sourcemap 后上传体必然变大，需调高私服的 body 上限`);
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

// ── 构建产物整理 / 本地客户端部署 ──

// 递归复制目录内容 (保留子目录结构)
export function copyDirInto(fromDir, toDir) {
    if (!fs.existsSync(fromDir)) return;
    fs.mkdirSync(toDir, { recursive: true });
    for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
        const src = path.join(fromDir, entry.name);
        const dst = path.join(toDir, entry.name);
        if (entry.isDirectory()) copyDirInto(src, dst);
        else fs.copyFileSync(src, dst);
    }
}

// sourcemap 内容包一层 module.exports, 便于服务器/客户端按模块加载
export function wrapSourceMap(content) {
    const prefix = 'module.exports = ';
    return content.trim().startsWith(prefix) ? content : `${prefix}${content};`;
}

// 把 <output>.map 整理成可直接上传/复制的 <output>.map.js:
//   1. 剥掉 sourcesContent —— 它占 map 体积的 60% 以上 (实测 2.4MB/3.7MB), 删掉后 mappings/sources 仍在,
//      errorMapper 照样能定位到「文件:行:列」, 只是打不出源码片段;
//   2. 改名为 .map.js 并包一层 module.exports —— 上传后模块名正好是 main.js.map,
//      对上 src/framework/errorMapper.ts 里的 require('main.js.map')。
// 幂等: 已经整理过 (只剩 .map.js) 就直接返回, 打包与复制两条路径可以各自调用。
export function prepareSourceMap({ distDir, outputFile = 'main.js' }) {
    const mapFile = path.join(distDir, `${outputFile}.map`);
    const mapJsFile = path.join(distDir, `${outputFile}.map.js`);
    if (!fs.existsSync(mapFile)) return fs.existsSync(mapJsFile) ? mapJsFile : null;

    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    delete map.sourcesContent;
    fs.writeFileSync(mapJsFile, wrapSourceMap(JSON.stringify(map)));
    fs.rmSync(mapFile);
    return mapJsFile;
}

// 把构建产物复制到本地客户端目录: main.js + wasm + main.js.map.js
export function deployToLocalClient({ distDir, outputFile = 'main.js', wasmDir, copyPath }) {
    fs.mkdirSync(copyPath, { recursive: true });
    prepareSourceMap({ distDir, outputFile });
    for (const name of [outputFile, `${outputFile}.map.js`]) {
        const src = path.join(distDir, name);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(copyPath, name));
    }
    if (wasmDir) copyDirInto(wasmDir, copyPath);
}

// ── 上传 ──

// 读取目录内所有 .js/.wasm 文件, 组装成 { 模块名: 源码 } 形式的上传载荷
// main.js.map 必须一起上传: src/framework/errorMapper.ts 运行时靠 require('main.js.map') 把打包后的
// 堆栈还原成源码行号, 少了这个模块线上报错只能看到 main.js 的行, 等于没有堆栈。
// 映射表里的 sourcesContent (约 2.4MB) 已在打包阶段剥掉, 保留 mappings 足够定位到「文件:行:列」。
export function collectDir(baseDir) {
    const code = {};
    const files = fs.readdirSync(baseDir).filter((f) => path.extname(f) === '.js' || path.extname(f) === '.wasm');
    files.forEach((file) => {
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

// 目标分支名: 'auto' 取当前 git 分支, 缺省 main
const resolveBranch = (branch) => (branch === 'auto' ? git.branch() : (branch || 'main'));

// 分支不存在时先克隆一个空分支, 再上传
async function runUpload(api, branch, code) {
    const data = await api.raw.user.branches();
    if (!data || !Array.isArray(data.list)) {
        throw new Error(`branches() 返回异常: ${toSingleLine(JSON.stringify(data)).slice(0, 200)}`);
    }
    const branches = data.list.map((b) => b.branch);
    if (branches.includes(branch)) {
        await api.code.set(branch, code);
    }
    else {
        await api.raw.user.cloneBranch('', branch, code);
    }
}

// 建立连接并把载荷上传到 Screeps 服务器
export async function uploadCode(config, code) {
    if (!config) throw new Error('需要提供 Screeps 服务器配置 (hostname/port/branch 及认证信息)');
    // 自托管服务器证书过期/自签时，可在配置里加 "insecure": true 跳过校验
    if (config.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    const branch = resolveBranch(config.branch);
    const api = new screepsApi.ScreepsAPI(config);
    const endpoint = getEndpointLabel(config);
    const usingToken = Boolean(config.token);
    const hasSourceMap = Object.prototype.hasOwnProperty.call(code, 'main.js.map');
    const payloadBytes = Object.values(code).reduce((sum, item) => (
        sum + (typeof item === 'string' ? Buffer.byteLength(item) : Math.ceil(item.binary.length * 0.75))
    ), 0);

    try {
        console.log(`[submit] 阶段 2/2: 上传 -> ${endpoint} (分支 ${branch}, 载荷 ${(payloadBytes / 1024 / 1024).toFixed(2)}MB${hasSourceMap ? ', 含 main.js.map' : ''})`);
        // 账密配置总是重新登录: 私服会轮换 token, 固定 token 过期会导致 Not Authorized
        if (config.email && config.password) {
            await api.auth();
        } else if (!config.token) {
            throw new Error('配置缺少 token 或 email/password，无法认证');
        }
        await runUpload(api, branch, code);
    } catch (err) {
        throw new Error(formatScreepsUploadError(err, { endpoint, branch, usingToken, payloadBytes }));
    }
}
