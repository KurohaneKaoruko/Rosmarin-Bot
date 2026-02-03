import TeamUtils from './TeamUtils';
import TeamAction from '../ai/TeamAction';
import TeamBattle from '../ai/TeamBattle';
import TeamVisual from '../debug/TeamVisual';

/**
 * 小队实体（Team 状态机）。
 *
 * @remarks
 * - 该类每 tick 会被 TeamController 实例化一次（非持久对象），真实状态落在 Memory.TeamData。\n
 * - exec() 的顺序非常重要：Update（更新数据/绘制）→ Attack（选目标/火力/避让）→ Move（移动/集结/变阵）→ Adjust（朝向微调）→ Save。\n
 * - moved 用于保证每 tick 最多触发一次“移动类行为”，避免同 tick 多次 move 互相覆盖。
 */
class Team {
    name: string;
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '←' | '→' | '↓';    // 朝向
    formation: 'line' | 'quad';  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom: string;  // 目标房间
    creeps: Creep[];     // 成员数组
    cache: { [key: string]: any };    // 缓存
    flag: Flag;          // 小队指挥旗
    actionMode: 'normal' | 'rush' | 'press';
    targetMode: 'default' | 'structure' | 'creep' | 'flag';
    moved: boolean;       // 本tick是否移动过

    // 构造函数
    /**
     * 从 Memory 中的 TeamData 构建运行时 Team 实例。
     *
     * @remarks
     * - creeps 列表会过滤掉已死亡成员（Game.getObjectById 为 null）。\n
     * - cache 是可写的临时存储，会在 save() 时写回 Memory.TeamData[teamID].cache。
     */
    constructor(teamData: TeamMemory) {
        const { name, status, toward, formation, homeRoom, targetRoom, moveMode, cache } = teamData;
        this.name = name;
        this.status = status;
        this.toward = toward;
        this.formation = formation;
        this.homeRoom = homeRoom;
        this.targetRoom = targetRoom;
        this.moveMode = moveMode;
        this.cache = cache || {};
        this.flag = Game.flags[`Team-${this.name}`];
        this.actionMode = 'normal'
        this.targetMode = 'default'
        this.updateModesFromFlag()
        this.moved = false;

        const creepIds = teamData.creeps || [];
        const liveCreeps = creepIds.map(id => Game.getObjectById(id)).filter(Boolean) as Creep[];
        this.creeps = liveCreeps;
    }

    /**
     * 从指挥旗的主色/副色解析并刷新队伍模式字段。
     * @remarks 若指挥旗不存在，回退到 default/normal。
     */
    private updateModesFromFlag(): void {
        const flag = this.flag
        if (!flag) {
            this.actionMode = 'normal'
            this.targetMode = 'default'
            return
        }

        // - normal：默认
        // - rush：强攻（跳过伤害评估，直接 attack）
        // - press：压制推进（更激进的推进/贴近策略，算伤更不保守）
        if (flag.secondaryColor === COLOR_PURPLE) this.actionMode = 'rush'
        else if (flag.secondaryColor === COLOR_BLUE) this.actionMode = 'press'
        else this.actionMode = 'normal'
        
        // - default：默认
        // - structure：优先打建筑
        // - creep：优先打 creep
        // - flag：优先打旗
        if (flag.color === COLOR_YELLOW) this.targetMode = 'structure'
        else if (flag.color === COLOR_GREEN) this.targetMode = 'creep'
        else if (flag.color === COLOR_RED) this.targetMode = 'flag'
        else this.targetMode = 'default'
    }

    // 保存数据
    /**
     * 把运行时状态写回 Memory.TeamData。
     *
     * @remarks
     * - creeps 会写回为 id 数组。\n
     * - teamData.room 用于记录队伍当前所在房间（取第一个成员）。
     */
    save(): void {
        const teamData = Memory['TeamData'][this.name];
        if (!teamData) return;

        teamData.status = this.status;
        teamData.toward = this.toward;
        teamData.formation = this.formation;
        teamData.targetRoom = this.targetRoom;
        teamData.moveMode = this.moveMode;
        teamData.cache = this.cache as any;
        if (this.creeps) {
            teamData.creeps = this.creeps.map((c: Creep) => c.id);
            if (this.creeps.length > 0) {
                teamData.room = this.creeps[0].room.name;
            }
        }
    }

    // 更新数据
    /**
     * 更新队伍状态（回血评估/目标房间同步/绘制）。
     *
     * @remarks
     * - 若 Team-xxxx 指挥旗不存在，则尝试在第一个成员位置创建。\n
     * - flag.pos.roomName 与 targetRoom 不一致时，targetRoom 以旗帜为准。\n
     * - 根据战斗评估切换 status（attack/avoid/flee/sleep）。\n
     * - 防止对穿：当队形稳定时设置 creep.memory.dontPullMe=true，减少 moveOptimization 的对穿打散。
     */
    execUpdate(): void {
        // 没有旗帜则创建, 目标房间不一致则更新
        if (!this.flag && this.creeps && this.creeps.length > 0) {
            this.creeps[0].pos.createFlag(`Team-${this.name}`);
        }
        else if (this.flag && this.targetRoom != this.flag.pos.roomName) {
            this.targetRoom = this.flag.pos.roomName;
        }

        this.updateModesFromFlag()

        if (!this.creeps) return;

        if (this.creeps.length < 3) {
            this.formation = 'line';
        }

        // 防止队形被对穿打散
        if (this.formation === 'quad' && TeamUtils.isQuad(this)) {
            this.creeps.forEach((c: Creep) => {
                if (c.memory.dontPullMe) return;
                c.memory.dontPullMe = true;
            })
        } else if (this.formation === 'line' && TeamUtils.isLinear(this)) {
            this.creeps.forEach((c: Creep) => {
                if (c.memory.dontPullMe) return;
                c.memory.dontPullMe = true;
            })
        } else {
            this.creeps.forEach((c: Creep) => {
                if (!c.memory.dontPullMe) return;
                c.memory.dontPullMe = false;
            })
        }

        if (this.actionMode === 'rush') {
            this.status = 'attack'
        }
        else if (this.actionMode === 'press') {
            // 2 tick 内能奶住
            if (TeamBattle.canHealInNTick(this, 2, { threatTick: 0, minHitsRate: 0.4 })) {
                if (this.status === 'sleep' && Game.time % 7) return
                this.status = 'attack'
            }
            // 1 tick 内能奶住
            else if (TeamBattle.canHealInNTick(this, 1, { threatTick: 0, minHitsRate: 0.4 })) {
                this.status = 'avoid'
            }
            // 不能奶住
            else {
                this.status = 'flee'
            }
        }
        else {
            // 2 tick 内能奶住
            if (TeamBattle.canHealInNTick(this, 2)) {
                if (this.status === 'sleep' && Game.time % 7) return
                this.status = 'attack'
            }
            // 1 tick 内能奶住
            else if (TeamBattle.canHealInNTick(this, 1)) {
                this.status = 'avoid'
            }
            // 不能奶住
            else {
                this.status = 'flee'
            }
        }

        // 实际奶
        TeamBattle.canHealInNTick(this, 0);

        // 计算破防伤害
        TeamBattle.maxBreakDamage(this);

        // 绘制状态
        TeamVisual.drawTeamStatus(this)
        TeamVisual.drawCreepHealNeed(this)
    }

    // 索敌攻击与规避
    /**
     * 战斗决策与火力执行。
     *
     * @remarks
     * - 目标选择、自动攻击与避让对象均由 TeamBattle 负责。\n
     * - 最终会更新推进目标点（targetPos），供移动模块参考。
     */
    execAttack(): void {
        if (!this.flag) return;
        // 选择目标
        TeamBattle.chooseTargets(this)
        // 自动攻击
        TeamBattle.autoAttack(this)
        // 添加避让目标
        TeamBattle.addAvoidObjs(this)
        // 更新推进目标点
        TeamAction.updateTargetPos(this)
        // 绘制一些信息
        TeamVisual.drawTargets(this)
        TeamVisual.drawTargetPos(this)
        TeamVisual.drawAvoidObjs(this)
    }
    
    // 移动行为
    /**
     * 队伍移动入口（队形保持/集结/跨房/追击/撤退）。
     *
     * @remarks
     * - line：线性跟随推进，必要时可尝试重组成 quad。\n
     * - quad：优先保持矩阵推进；当队形被打散时会 Gather 重组。\n
     * - 边缘跨房：由 TeamAction.move 内部做降级处理（通过边界时不强行保持矩阵）。
     */
    execMove(): void {
        if (this.moved) return;
        
        // 队伍集结
        const isLinear = TeamUtils.isLinear(this);
        if (this.formation === 'line' &&
            TeamUtils.inSameRoom(this) &&
            !isLinear
        ) {
            this.moved = TeamAction.Gather(this);
            return;
        }

        // 队伍移动
        if (!this.flag) return;
        if (this.creeps.some(c => c.fatigue > 0)) return;
        const isQuad = TeamUtils.isQuad(this);
        const inSamaRoom = TeamUtils.inSameRoom(this);
        const hasOnEdge = TeamUtils.hasCreepOnEdge(this);

        // 线性队形转方阵队形
        if (this.formation === 'line') {
            const roomName = this.creeps[0].room.name;
            const exits = Game.map.describeExits(this.targetRoom);
            const isInExits = [...Object.values(exits), this.targetRoom].includes(roomName);
            if (isQuad && isInExits) this.formation = 'quad';
            if (this.creeps.length >= 3 && inSamaRoom &&
                !hasOnEdge && !isQuad && isInExits) {
                if (TeamAction.formLineToQuad(this)) {
                    this.moved = true;
                    return;
                }
            }
        }
        // 特殊情况归位
        else if (!isQuad && isLinear && !hasOnEdge && this.creeps.length >= 3) {
            if (TeamAction.formLineToQuad(this)) {
                this.moved = true;
                return;
            }
        }

        // 线性队形移动
        if (this.formation === 'line' && this['_targets']?.[0]?.pos) {
            TeamAction.LinearMove(this, this['_targets'][0].pos);
            this.moved = true;
            TeamVisual.drawMoveDirection(this)
        }
        else if (this.formation === 'line') {
            TeamAction.LinearMove(this);
            this.moved = true;
            TeamVisual.drawMoveDirection(this)
        }
        // 方阵队形移动
        else if (this.formation === 'quad' && !isQuad &&
            this.creeps.length >= 2 && hasOnEdge
        ) {
            if (!this['_targets']) this['_targets'] = [this.flag];
            const moveGoals: any[] = this['_targets']
            let direction = TeamAction.getTeamMoveDirection(this, moveGoals)
            if (!direction && this.status === 'avoid') {
                direction = TeamAction.getTeamMoveDirection(this, this['_targets'], 'flee')
            }
            if (direction) {
                TeamAction.move(this, direction);
                this.moved = true;
                TeamVisual.drawMoveDirection(this)
                return;
            }

            TeamAction.LinearMove(this, this.creeps[this.creeps.length - 1].pos, true);
            this.moved = true;
        } else if (this.formation === 'quad') {
            if (isQuad || this.status === 'flee') {
                if (hasOnEdge || !TeamAction.switchTeam4Pos(this)) {
                    if (!this['_targets']) this['_targets'] = [this.flag];
                    let moveGoals: any[] = this['_targets']
                    let direction = TeamAction.getTeamMoveDirection(this, moveGoals)
                    if (!direction && this.status === 'avoid') {
                        direction = TeamAction.getTeamMoveDirection(this, this['_targets'], 'flee')
                    }
                    if (direction) {
                        TeamAction.move(this, direction);
                        this.moved = true;
                        TeamVisual.drawMoveDirection(this)
                    }
                }
            }
            if (!this.moved && !isQuad) this.moved = TeamAction.Gather(this);
        }
    }

    // 调整朝向
    /**
     * 矩阵队形的朝向微调（四人成形矩阵）。
     *
     * @remarks
     * - 仅用于四人成形矩阵的“角位纠正”，三人缺角矩阵不做朝向纠偏。\n
     * - AdjustToward 会返回是否实际执行调整，用于决定 moved 标记。
     */
    execAdjust(): void {
        if (this.moved) return;
        if (this.creeps.length < 3) return;
        if (TeamUtils.checkToward(this)) return;
        this.moved = TeamAction.AdjustToward(this);
        if (this.moved) TeamVisual.drawMoveDirection(this)
    }

    // 主运行逻辑
    /**
     * 队伍单 tick 主逻辑。
     *
     * @remarks
     * 顺序：Update → Attack → Move → Adjust → Save
     */
    exec(): void {
        // 更新数据
        this.execUpdate();
        
        // 索敌攻击
        this.execAttack();

        // 移动
        this.execMove();

        // 调整朝向
        this.execAdjust();

        // 保存数据
        this.save();
    }
}


export default Team;
