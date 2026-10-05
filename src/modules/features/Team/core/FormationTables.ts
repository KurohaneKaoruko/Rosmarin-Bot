/**
 * 扩展队形（cross/square3）模板与八向朝向工具。
 *
 * cross（5 人）：中心 (0,0) + 四臂；正朝向臂位落在正交格（+ 形），斜朝向落在对角格（× 形）。
 * square3（9 人）：3×3 九格；正朝向轴对齐（方形），斜朝向呈菱形。
 * 模板旋转：45° 步进坐标旋转 + 就近取整。
 */
export type TowardName = '↑' | '↗' | '→' | '↘' | '↓' | '↙' | '←' | '↖';
export type TeamFormationName = 'line' | 'quad' | 'cross' | 'square3';

/** 朝向 → 45° 步进旋转次数（↑ 为 0 次基准，顺时针） */
export const TOWARD_STEPS: Record<TowardName, number> = {
    '↑': 0, '↗': 1, '→': 2, '↘': 3, '↓': 4, '↙': 5, '←': 6, '↖': 7,
};
const TOWARD_ORDER: TowardName[] = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const COS = [1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707];
const SIN = [0, 0.707, 1, 0.707, 0, -0.707, -1, -0.707];

export type TemplateSlot = {
    x: number;
    y: number;
    /** 朝向前沿（受击优先，攻击/远攻占位） */
    front: boolean;
    /** 治疗优先占位（中心/后排） */
    heal: boolean;
};

/** 基准模板（↑ 朝向） */
const BASE_TEMPLATES: Record<'cross' | 'square3', TemplateSlot[]> = {
    cross: [
        { x: 0, y: -1, front: true, heal: false },  // 前臂
        { x: -1, y: 0, front: true, heal: false },  // 左臂
        { x: 1, y: 0, front: true, heal: false },   // 右臂
        { x: 0, y: 1, front: false, heal: false },  // 后臂
        { x: 0, y: 0, front: false, heal: true },   // 中心
    ],
    square3: [
        { x: -1, y: -1, front: true, heal: false }, // 前排
        { x: 0, y: -1, front: true, heal: false },
        { x: 1, y: -1, front: true, heal: false },
        { x: -1, y: 0, front: false, heal: false }, // 中排
        { x: 0, y: 0, front: false, heal: true },   // 中心
        { x: 1, y: 0, front: false, heal: false },
        { x: -1, y: 1, front: false, heal: true },  // 后排
        { x: 0, y: 1, front: false, heal: true },
        { x: 1, y: 1, front: false, heal: true },
    ],
};

const rotateOffset = (x: number, y: number, steps: number): { x: number; y: number } => ({
    x: Math.round(x * COS[steps % 8] - y * SIN[steps % 8]),
    y: Math.round(x * SIN[steps % 8] + y * COS[steps % 8]),
});

/** 当前朝向的旋转模板（cross 正朝向呈 + 形、斜朝向呈 × 形） */
export const formationTemplate = (shape: 'cross' | 'square3', toward: TowardName): TemplateSlot[] => {
    const steps = TOWARD_STEPS[toward] ?? 0;
    return BASE_TEMPLATES[shape].map(slot => {
        const p = rotateOffset(slot.x, slot.y, steps);
        return { x: p.x, y: p.y, front: slot.front, heal: slot.heal };
    });
};

/** 攻击目标相对队伍中心的八向扇区解析（dx = 目标x - 中心x，dy 同理） */
export const sectorToward = (dx: number, dy: number): TowardName => {
    const norm = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    return TOWARD_ORDER[Math.round(norm / 45) % 8];
};

/** 由成员数推导扩展队形名 */
export const shapeOfCount = (count: number): 'cross' | 'square3' | undefined =>
    count === 5 ? 'cross' : count === 9 ? 'square3' : undefined;
