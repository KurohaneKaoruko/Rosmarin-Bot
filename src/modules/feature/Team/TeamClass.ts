import TeamUtils from './TeamUtils';
import TeamAction from './TeamAction';
import TeamBattle from './TeamBattle';
import TeamVisual from './TeamVisual';

// 小队类
class Team {
    name: string;
    status: 'ready' | 'attack' | 'flee' | 'avoid' | 'sleep'; // 状态
    toward: '↑' | '←' | '→' | '↓';    // 朝向
    formation: 'line' | 'quad';  // 队形
    moveMode: string;    // 移动模式
    homeRoom: string;    // 孵化房间
    targetRoom: string;  // 目标房间
    creeps: Creep[] | undefined;     // 成员数组
    cache: { [key: string]: any };    // 缓存
    flag: Flag;          // 小队指挥旗
    moved: boolean;       // 本tick是否移动过

    // 构造函数
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
        this.moved = false;
        
        // 即使是缓存的对象，也需要从 memory 中获取最新的 creep 列表（因为可能有成员死亡被移除）
        const creepIds = teamData.creeps || [];
        const liveCreeps = creepIds.map(id => Game.getObjectById(id)).filter(Boolean) as Creep[];
        this.creeps = liveCreeps.length > 0 ? liveCreeps : undefined;
    }

    // 保存数据
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
    execUpdate(): void {
        // 没有旗帜则创建, 目标房间不一致则更新
        if (!this.flag && this.creeps && this.creeps.length > 0) {
            this.creeps[0].pos.createFlag(`Team-${this.name}`);
        }
        else if (this.flag && this.targetRoom != this.flag.pos.roomName) {
            this.targetRoom = this.flag.pos.roomName;
        }

        if (!this.creeps) return;

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

        if (this.flag?.secondaryColor === COLOR_PURPLE) {
            // rush模式, 不算伤
            this.status = 'attack'
        } else {
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
    execAttack(): void {
        if (!this.flag) return;
        // 选择目标
        TeamBattle.chooseTargets(this)
        // 自动攻击
        TeamBattle.autoAttack(this)
        // 添加避让
        TeamBattle.addAvoidObjs(this)
        // 绘制一些信息
        TeamVisual.drawTargets(this)
        TeamVisual.drawAvoidObjs(this)
    }
    
    // 移动行为
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
        if (this.formation === 'line' && this['_targets'].length) {
            TeamAction.LinearMove(this, this['_targets'][0].pos);
            this.moved = true;
        }
        else if (this.formation === 'line') {
            TeamAction.LinearMove(this);
            this.moved = true;
        }
        // 方阵队形移动
        else if (this.formation === 'quad' && !isQuad &&
            this.creeps.length >= 2 && this.creeps[0].pos.isRoomEdge()
        ) {
            TeamAction.LinearMove(this, this.creeps[this.creeps.length - 1].pos, true);
            this.moved = true;
        } else if (this.formation === 'quad') {
            if (isQuad || this.status === 'flee') {
                if (hasOnEdge || !TeamAction.switchTeam4Pos(this)) {
                    if (!this['_targets']) this['_targets'] = [this.flag];
                    let direction = TeamAction.getTeamMoveDirection(this, this['_targets'])
                    if (!direction && this.status === 'avoid') {
                        direction = TeamAction.getTeamMoveDirection(this, this['_targets'], 'flee')
                    }
                    if (direction) {
                        TeamAction.move(this, direction);
                        this.moved = true;
                    }
                }
            }
            if (!isQuad) this.moved = TeamAction.Gather(this);
        }
    }

    // 调整朝向
    execAdjust(): void {
        if (this.moved) return;
        if (this.creeps.length < 3) return;
        if (TeamUtils.checkToward(this)) return;
        TeamAction.AdjustToward(this);
        this.moved = true;
    }

    // 主运行逻辑
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