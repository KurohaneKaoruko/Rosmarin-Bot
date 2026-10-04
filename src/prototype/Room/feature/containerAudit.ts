import { getCoreDepotPoint, isCoreDepotContainer } from '@/modules/shared/coreDepot';

/**
 * 容器唯一性巡检：每个产出锚点（source ×2 格 / controller ×3 格 / mineral ×2 格）
 * 至多保留 1 个容器 + 1 个容器工地，锚点圈外的容器/工地按残留清退。
 * 核心库占位容器（storage/terminal 点位）豁免——归布局换位流程管。
 * 链接期（RCL5+ 且 controller 旁有 link）：controller 圈容器整体退役（升级供给已切 link）。
 * 拆除只在存量 ≤ 阈值时执行（掉落由搬运层捡拾），整箱能量不砸地。
 */
const SOURCE_ZONE_RANGE = 2;
const CONTROLLER_ZONE_RANGE = 3;
const MINERAL_ZONE_RANGE = 2;
/** 残留容器拆除的存量上限：超出则本轮跳过，先让搬运层腾空 */
const RETIRE_STORE_LIMIT = 200;

type ContainerZone = {
    key: string;
    x: number;
    y: number;
    range: number;
    /** 链接期退役：圈内容器全部清退 */
    retire?: boolean;
};

const retireContainer = (container: StructureContainer): void => {
    if ((container.store[RESOURCE_ENERGY] || 0) > RETIRE_STORE_LIMIT) return;
    container.destroy();
};

const isCoreDepotPoint = (roomName: string, pos: RoomPosition): boolean => {
    const p = getCoreDepotPoint(roomName, 'storage');
    if (p && p.x === pos.x && p.y === pos.y) return true;
    const t = getCoreDepotPoint(roomName, 'terminal');
    return !!t && t.x === pos.x && t.y === pos.y;
};

export default class ContainerAudit extends Room {
    auditRoomContainers() {
        const controller = this.controller;
        if (!controller?.my) return;
        if (!(this.source || []).length) return;

        const zones: ContainerZone[] = [];
        for (const source of this.source || []) {
            zones.push({
                key: `src:${source.id}`,
                x: source.pos.x,
                y: source.pos.y,
                range: SOURCE_ZONE_RANGE,
            });
        }
        zones.push({
            key: 'ctrl',
            x: controller.pos.x,
            y: controller.pos.y,
            range: CONTROLLER_ZONE_RANGE,
            retire:
                this.level >= 5 &&
                (this.link || []).some(l => l.pos.inRangeTo(controller.pos, CONTROLLER_ZONE_RANGE)),
        });
        if (this.mineral) {
            zones.push({
                key: 'min',
                x: this.mineral.pos.x,
                y: this.mineral.pos.y,
                range: MINERAL_ZONE_RANGE,
            });
        }

        const inZone = (zone: ContainerZone, pos: RoomPosition): boolean =>
            Math.max(Math.abs(pos.x - zone.x), Math.abs(pos.y - zone.y)) <= zone.range;

        const containers = this.container || [];
        const kept = new Set<string>();

        // 圈内归席：每锚点保 1（占位容器优先占席，其余耐久最高者保留）
        for (const zone of zones) {
            const members = containers.filter(c => inZone(zone, c.pos));
            if (members.length === 0) continue;

            if (zone.retire) {
                for (const c of members) retireContainer(c);
                continue;
            }

            const keeper =
                members.find(c => isCoreDepotContainer(this, c)) ??
                members.reduce((a, b) => (b.hits > a.hits ? b : a));
            kept.add(keeper.id);
            for (const c of members) {
                if (c.id !== keeper.id) retireContainer(c);
            }
        }

        // 圈外残留清退（占位容器豁免）
        for (const c of containers) {
            if (kept.has(c.id)) continue;
            if (isCoreDepotContainer(this, c)) continue;
            if (zones.some(z => inZone(z, c.pos))) continue;
            retireContainer(c);
        }

        // 工地同口径：每锚点至多 1 个容器工地，圈外工地移除
        // 核心库占位工地豁免（归布局换位流程管，不与巡检互拆）
        const sites = this.find(FIND_MY_CONSTRUCTION_SITES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
        }) as ConstructionSite[];
        const claimedZones = new Set<string>();
        for (const site of sites) {
            const zone = zones.find(z => inZone(z, site.pos));
            if (isCoreDepotPoint(this.name, site.pos)) continue;
            if (!zone || zone.retire || claimedZones.has(zone.key)) {
                site.remove();
                continue;
            }
            claimedZones.add(zone.key);
        }
    }
}
