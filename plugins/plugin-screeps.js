import path from 'path';
import { uploadCode, collectDir } from './upload.js';

// rolldown 插件: 把 dist 产物上传到目标分支
// sourcemap 由 rolldown.config.js 的 prepare-sourcemap 插件先整理成 main.js.map.js, collectDir 一并收走
// (认证/分支解析/错误诊断等核心逻辑在 ./upload.js)
function screeps({ config } = {}) {
    return {
        name: 'screeps',
        async writeBundle(options) {
            await uploadCode(config, collectDir(path.dirname(options.file)));
        }
    };
}

export default screeps;
