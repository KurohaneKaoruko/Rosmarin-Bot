export const THRESHOLDS = {
    ENERGY: {
        WALL_MIN: 50000,
        SEND_BATCH_ENERGY: 5000,
        SEND_BATCH_MINERAL: 100,
        SEND_REQUEST_MIN: 10000,
        TRANSPORT_MIN: 3000,
        TOWER_REPAIR_THRESHOLD: 200,
        PICKUP_THRESHOLD: 100,
        PICKUP_LARGE: 1000,
        CONTAINER_MIN: 500,
        LINK_MIN: 400,
        STORAGE_MIN: 5000,
        LAB_MIN_ENERGY: 2000,
        LAB_FILL: 3000,
        LAB_TRIGGER: 50,
        LAB_MIN_CAPACITY: 100,
    },
    UNIVERSAL: {
        CONTROLLER_CONTAINER_BUFFER_TARGET: 1200,
        CONTROLLER_LINK_BUFFER_TARGET: 400,
        CONTROLLER_DOWNGRADE_FORCE_TTD: 5000,
        CONTROLLER_DOWNGRADE_FORCE_TARGET: 2,
    },
    SPAWN: {
        MIN_ENERGY: 200,
        EMERGENCY_ENERGY_THRESHOLD: 1000,
        BODY_REDUCTION_THRESHOLD: 1000,
        // 是否允许 spawn 因等待更高优先级任务的能量而空转。
        // 关掉时执行器会兜底选「任意可负担任务」——廉价任务（reserver/外矿缩水体）
        // 会持续把能量压在昂贵任务的成本线下，最高优先级被无限饿死（race 实测：6 只
        // upgrader 任务在池、extension 永远到不了 800，升级吞吐归零）。
        ALLOW_WAIT_FOR_PRIORITY_ENERGY: true,
        // 当开启“等待高优先级能量”时，仅允许 level 小于该值的任务插队。
        // 例如该值为 10，则 5 可以在 2 孵不起时先孵，而 10/11/12 不行。
        // 注意：任务 level 数值越小，优先级越高。
        // 11 而非 10：加急升级任务本身就是 10——若阈值卡在 10，它会被
        // 更高层（外矿采集 L6）的固定大体型永久堵死，升级端颗粒无收。
        WAIT_ENERGY_QUEUE_JUMP_ALLOW_BELOW_LEVEL: 11,
        UNIV_EMERGENCY_CAP: {
            RCL1_2: 3,
            RCL1_2_HIGH: 4,
            RCL3: 2,
            RCL3_HIGH: 2,
            RCL4P: 1,
            RCL4P_HIGH: 1,
        },
    },
    REPAIR: {
        URGENT_STRUCTURE: 0.1,
        NORMAL_STRUCTURE: 0.8,
        NORMAL_WALL: { BELOW_RCL7: 300000, RCL8: 1000000 },
        URGENT_WALL: 3000,
        URGENT_RAMPART: 50000,
        RAMPART_BUILD_BUFFER: 50000,
        RAMPIRT_MAX_THRESHOLD: 0.9,
    },
    TRANSPORT: {
        MIN_AMOUNT: 10000,
        HIGH_AMOUNT: 100000,
    },
    TOWER: {
        HEAL_THRESHOLD: 100,
        TARGET_RANGE: 50,
    },
    TICK: {
        BUILD_CHECK: 100,
        ROOM_EXECUTE_OFFSET: 100,
        NUKER_CHECK: 50,
        LAB_CHECK: 20,
        WALL_REPAIR_COOLDOWN: 5,
    },
    TERMINAL: {
        CHECK_MOD: 30,
        CHECK_OFFSET: 2,
        ENERGY_COST_SAMPLE_AMOUNT: 1000,
    },
    RUSH: {
        // 分段目标：目标等级 → { achieve 达成线, pass 合格线（可省略） }；
        // 无 pass 的段，达成线即判废线；耗时单位为相对 lv1 基线的 tick
        SEGMENT_TARGETS: {
            2: { achieve: 500, pass: 1000 },
            3: { achieve: 3000, pass: 5000 },
            4: { achieve: 5000, pass: 10000 },
            5: { achieve: 15000, pass: 20000 },
            6: { achieve: 30000, pass: 40000 },
        },
    },
} as const;
