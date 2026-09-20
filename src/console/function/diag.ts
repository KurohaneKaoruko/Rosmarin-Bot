import { evaluateSourceWorkTiles } from '@/prototype/Creep/function/sourceFunction';

/**
 * 采集/搬运决策诊断命令
 * @description 用法: diag.worktile('creep 名字')
 * 输出 creep 的绑定 source、moveHomeRoom 判定、以及 source 周边八个工作位的
 * 通行性/交通惩罚/评分与当前选中的最佳位——用于定位"采集工不去空位"类问题。
 */
export default {
    diag: {
        worktile(creepName: string) {
            const creep = Game.creeps[creepName] as any;
            if (!creep) return `未找到 creep: ${creepName}`;

            const report: Record<string, any> = {
                role: creep.memory?.role,
                home: creep.memory?.home,
                room: creep.room?.name,
                pos: `${creep.pos}`,
                fatigue: creep.fatigue,
                ticksToLive: creep.ticksToLive,
                targetSourceId: creep.memory?.targetSourceId,
                moveHomeRoom: typeof creep.moveHomeRoom === 'function' ? creep.moveHomeRoom() : '(无此方法)',
            };

            const source: Source | null =
                (typeof creep.getBoundSource === 'function' ? creep.getBoundSource() : null) ??
                (creep.memory?.targetSourceId ? Game.getObjectById(creep.memory.targetSourceId) : null);

            if (!source) {
                report.boundSource = null;
                report.note = '未绑定 source——采集工不会移动到任何工作位';
                return report;
            }

            report.boundSource = {
                pos: `${source.pos}`,
                energy: source.energy,
                regenIn: source.ticksToRegeneration,
            };

            const evaluation = evaluateSourceWorkTiles(creep, source);
            report.tiles = evaluation.tiles.map((t) => ({
                tile: `${t.pos.x},${t.pos.y}`,
                passable: t.passable,
                penalty: t.penalty,
                score: t.score,
            }));
            report.bestPos = evaluation.bestPos ? `${evaluation.bestPos.x},${evaluation.bestPos.y}` : null;
            report['已站在最佳位'] = evaluation.bestPos ? creep.pos.isEqualTo(evaluation.bestPos) : null;
            return report;
        },
    },
};
