/**
 * 任务池被存储在Memory的MissionPools中, 每个room独立存储
 * 
 * 任务池的格式:
 * [ roomName: string ]: {
 *      "任务池名称": [任务数组],
 *      ...
 * }
 * 
 * 
 * 任务的格式:
 * {
 *      id: string,     // 任务id
 *      type: string,   // 任务类型
 *      level: number,  // 优先级, 越小越优先
 *      data: any,      // 任务数据, 该模块并不关心任务数据的具体内容, 在执行任务时处理即可
 *      lock?: Id,      // 可选, 绑定该任务的creep Id, 如果任务被锁定, 则其他creep无法获取该任务。
 * }
 */

import { decompress } from "@/utils";

/** 通用的任务池模块 */
export default class MissionPools extends Room {
    // 任务池初始化
    public initMissionPool() {
        if(!Memory.MissionPools) Memory.MissionPools = {}
        if(!Memory.MissionPools[this.name]) Memory.MissionPools[this.name] = {}
        const Pools = Memory.MissionPools[this.name];
        const PoolTypes = [
            'transport',
            'manage',
            'build',
            'repair',
            'terminal',
            'spawn'
        ]
        for (const type of Object.keys(Pools)) { if(!PoolTypes.includes(type)) delete Pools[type] }
        for (const type of PoolTypes) { if(!Pools[type]) Pools[type] = [] }
        return OK;
    }

    // (私有方法) 获取任务池
    private getPool(PoolName: string) {
        const memory = Memory.MissionPools[this.name];
        if(!memory) return null;
        if(memory[PoolName]) return memory[PoolName];
        console.log(`房间 ${this.name} 的任务池 ${PoolName} 不存在`);
        return null;
    }
    
    // (私有方法) 添加任务到任务池
    private pushTaskToPool(PoolName: string, task: Task) {
        if(!Memory.MissionPools[this.name][PoolName]) {
            console.log(`任务池 ${PoolName} 不存在`);
            return ERR_NOT_FOUND;
        }
        if(!task) return ERR_NOT_FOUND;
        Memory.MissionPools[this.name][PoolName].push(task);
        return OK;
    }

    // (私有方法) 删除任务池中的任务
    private removeTaskFromPool(PoolName: string, index: number) {
        if(!Memory.MissionPools[this.name][PoolName]) {
            console.log(`任务池 ${PoolName} 不存在`);
            return ERR_NOT_FOUND;
        }
        Memory.MissionPools[this.name][PoolName].splice(index, 1);
        return OK;
    }

    // (私有方法) 修改任务池中的任务
    private modifyTaskInPool(PoolName: string, index: number, task: Task) {
        if(!Memory.MissionPools[this.name][PoolName]) {
            console.log(`任务池 ${PoolName} 不存在`);
            return ERR_NOT_FOUND;
        }
        Memory.MissionPools[this.name][PoolName][index] = task;
        return OK;
    }

    // (私有方法) 生成一个16进制id
    private generateId() {
        const Gametime = Game.time.toString(16);
        const Random = Math.random().toString(16).slice(2,-1);
        return (Gametime + Random).toUpperCase();
    }

    // 添加任务到任务池
    public addMissionToPool(PoolName: string, type: Task["type"], level: Task["level"], data: Task["data"]) {
        const id = `${type.toUpperCase()}-${this.generateId()}`; // 生成id
        let task: Task = {id, type, level, data}
        this.pushTaskToPool(PoolName, task);
        return OK;
    }

    // 计算切比雪夫距离
    private getDistance(pos1: number, pos2: number): number {
        const [x1, y1] = decompress(pos1);
        const [x2, y2] = decompress(pos2);
        return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
    }

    // 获取任务池中的任务
    public getMissionFromPool(PoolName: string, pos?: number, filter?: (task: Task) => boolean) {
        const tasks = this.getPool(PoolName);
        if (!tasks) { return null; }
        if (tasks.length === 0) return null; // 如果没有任务，返回null

        // 筛选未锁且有效的任务
        if (!filter) filter = () => true;
        const unlockedTasks = tasks.filter(task => task && !task.lock && filter(task));

        if (unlockedTasks.length === 0) return null; // 如果没有可用任务，返回null
        if (unlockedTasks.length === 1) return unlockedTasks[0]; // 如果只有一个任务，返回该任务
        let resultTasks = [], level = Infinity;
        for (const task of unlockedTasks) {
            if (task.level < level) {
                level = task.level;
                resultTasks = [task];
            } else if (task.level === level) {
                resultTasks.push(task);
            }
        }
        
        if (resultTasks.length === 0) return null; // 如果没有任务，返回null
        if (resultTasks.length === 1) return resultTasks[0];
        let Task = null, distance = Infinity;
        for (const task of resultTasks) {
            if (!task.data.pos || !pos) continue;
            const taskDistance = this.getDistance(task.data.pos, pos);
            if (taskDistance > distance) continue;
            distance = taskDistance;
            Task = task;
        }
        if (!Task) return resultTasks[0];
        return Task;
    }

    // 不考虑优先级，直接获取第一个任务
    public getMissionFromPoolFirst(PoolName: string, filter?: (task: Task) => boolean) {
        if (!filter) filter = () => true;
        const tasks = this.getPool(PoolName).filter(task => task && !task.lock && filter(task));
        if (!tasks) { return; }
        if (tasks.length === 0) return null; // 如果没有任务，返回null
        return tasks[0];
    }

    // 获取随机一个任务
    public getMissionFromPoolRandom(PoolName: string) {
        const tasks = this.getPool(PoolName);
        if (!tasks) { return; }
        if (tasks.length === 0) return null; // 如果没有任务，返回null
        return tasks[Math.floor(Math.random() * tasks.length)];
    }

    // 获取全部任务
    public getAllMissionFromPool(PoolName: string) {
        return this.getPool(PoolName);
    }

    // 用id获取任务池中的任务
    public getMissionFromPoolById(PoolName: string, id: Task["id"]) {
        const tasks = this.getPool(PoolName);
        if (!tasks) { return; }
        if (tasks.length === 0) return null; // 如果没有任务，返回null
        return tasks.find(t => t.id === id);
    }

    // 检查是否有相同任务
    public checkSameMissionInPool(PoolName: string, type: Task["type"], data: Task["data"]) {
        const tasks = this.getPool(PoolName);
        if (!tasks) { return; }
        if (!tasks.length) return null; // 如果没有任务，返回null

        for(const task of tasks) {
            if (task.type !== type) continue;
            const sameInPool = Object.keys(data).every(key => data[key] === task.data[key]);
            if (!sameInPool) continue;
            return task.id; // 如果存在相同任务，返回任务的id
        }
        return null; // 如果不存在相同任务，返回null
    }

    // 检查任务池中是否存在任务
    public checkMissionInPool(PoolName: string) {
        const tasks = this.getPool(PoolName);
        return tasks && tasks.length > 0
    }

    // 获取任务池中的任务数量
    public getMissionNumInPool(PoolName: string) {
        const tasks = this.getPool(PoolName);
        return tasks ? tasks.length : 0;
    }

    // 锁定任务池中的任务
    public lockMissionInPool(PoolName: string, id: Task["id"], creepId: Id<Creep>) {
        const tasks = Memory.MissionPools[this.name][PoolName];
        if (!tasks) { return; }
        if (tasks.length === 0) return; // 如果没有任务，不处理

        const task = tasks.find(t => t.id === id);
        if (!task) { console.log(`任务${id}不存在`);return;}

        task.lock = true;
        task.bindCreep = creepId;
        return OK;
    }

    // 解锁任务池中的任务
    public unlockMissionInPool(PoolName: string, id: Task["id"]) {
        const tasks = Memory.MissionPools[this.name][PoolName];
        if (!tasks) { return; }
        if (!tasks.length) return; // 如果没有任务，不处理

        const task = tasks.find(t => t.id === id)
        if (task) {console.log(`任务${id}不存在`);return;}

        task.lock = false;
        task.bindCreep = null;
        return OK;
    }

    // 更新任务池中的任务
    public updateMissionPool(PoolName: string, id: Task["id"], {level, data}) {
        const tasks = Memory.MissionPools[this.name][PoolName];
        if (!tasks) { return; }
        if (!tasks.length) return; // 如果没有任务，不处理

        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex == -1) { console.log(`任务 ${id} 不存在`); return;}

        const task = Memory.MissionPools[this.name][PoolName][taskIndex]
        if (level !== undefined) {
            task.level = level;
        }
        if (data) {
            for(const key in data){
                task.data[key] = data[key];
            }
        }

        return OK;
}

    // 用id删除任务池中的任务
    public deleteMissionFromPool(PoolName: string, id: Task["id"]) {
        const memory = Memory.MissionPools[this.name];
        if (!memory) { return; }
        const tasks = memory[PoolName];
        if (!tasks) { return; }
        if (!tasks.length) return; // 如果没有任务，不处理

        const index = tasks.findIndex(t => t.id == id);
        if (index === -1) {return;}

        Memory.MissionPools[this.name][PoolName].splice(index, 1);

        return OK
    }

    // 检查任务池中的任务是否已完成、过期、失效
    public checkMissionPool(PoolName: string, checkFunc: (t: Task) => boolean) {
        const tasks = this.getPool(PoolName);
        if (!tasks) { return; }
        if (!tasks.length) return; // 如果没有任务，不处理

        for (const task of tasks) {
            // 检查函数返回false，则删除任务
            if (!checkFunc(task))
                this.deleteMissionFromPool(PoolName, task.id)
        }
        return OK;
    }

    // 提交任务完成信息
    public submitMission(PoolName: string, id: Task["id"], data: Task["data"], deleteFunc: (t: any) => boolean) {
        // 定位任务
        const tasks = Memory.MissionPools[this.name][PoolName];
        if (!tasks) { return; }
        if (!tasks.length) return; // 如果没有任务，不处理
        const task = tasks.find(t => t.id === id);
        if (!task) { console.log(`任务${id}不存在`);return;}
        // 更新数据
        for(const key in data){
            task.data[key] = data[key];
        }
        // 去除锁定
        task.lock = false;
        task.bindCreep = null;
        // 判断任务是否该被删除
        if(deleteFunc(task.data))
            this.deleteMissionFromPool(PoolName, id);
        return OK;
    }
}
