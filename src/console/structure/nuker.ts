export default {
    nuker: {
        launch(...rooms: string[]) {
            const cpu0 = Game.cpu.getUsed();
            const flags = Object.keys(Game.flags).filter(flagName => flagName.startsWith('nuke-') || flagName.startsWith('nuke_'));
            for (const flagName of flags) {
                const launchNukeMatch = flagName.match(/^nuke[-_](\d+)?(?:[-_].+)?$/);
                if (!launchNukeMatch) continue;
                // 获取目标
                const flag = Game.flags[flagName];
                const targetPos = flag.pos;
                const targetRoomName = targetPos.roomName;
                // 获取发射数量，默认为1
                const amount = Math.max(1, Number(launchNukeMatch[1] || 1));
                let launchedCount = 0; // 已发射数量
                // 获取符合发射条件的房间
                if (rooms.length > 0) flag.memory['rooms'] = rooms;
                const roomNames = rooms.length > 0 ? rooms : Object.keys(Game.rooms);
                for (const roomName of roomNames) {
                    const roomObj = Game.rooms[roomName];
                    if (!roomObj || !roomObj.my) continue;
                    if (!roomObj.NukerCanLaunchTo(targetPos)) continue;

                    const code = roomObj.NukerLaunchTo(targetPos);
                    if (code !== OK) {
                        console.log(`房间 ${roomName} 发射核弹失败，code: ${code}`);
                        continue;
                    }
                    launchedCount++;    // 已发射数量加1
                    console.log(`从房间 ${roomName} 发射核弹到 ${targetRoomName} (x:${targetPos.x}  y:${targetPos.y})`);
                    if (launchedCount >= amount) break; // 达到发射数量后退出循环
                }
                if (launchedCount >= amount) flag.remove();
            }
            return `CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        request(roomName: string, x: number, y: number, amount: number = 1, ttl: number = 2000, ...rooms: string[]) {
            const cpu0 = Game.cpu.getUsed();
            if (!Memory.nuke) Memory.nuke = { landTime: {} };
            if (!Memory.nuke.requests) Memory.nuke.requests = [];

            const id = `${Game.time}-${Math.floor(Math.random() * 1000000)}`;
            Memory.nuke.requests.push({
                id,
                roomName,
                x,
                y,
                amount: Math.max(1, Number(amount || 1)),
                rooms: rooms.length > 0 ? rooms : undefined,
                createdTick: Game.time,
                ttl: Math.max(1, Number(ttl || 2000)),
            });

            return `已添加 nuke 请求：${id}  CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        list() {
            const cpu0 = Game.cpu.getUsed();
            const reqs = Memory.nuke?.requests || [];
            return `${JSON.stringify(reqs)}  CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        cancel(id: string) {
            const cpu0 = Game.cpu.getUsed();
            const list = Memory.nuke?.requests;
            if (!list || list.length === 0) return `无 nuke 请求  CPU used:${Game.cpu.getUsed() - cpu0}`;

            const next = [];
            let removed = 0;
            for (const req of list) {
                if (req.id !== id) {
                    next.push(req);
                    continue;
                }
                removed++;
                if (req.flagName && Game.flags[req.flagName]) Game.flags[req.flagName].remove();
            }
            Memory.nuke!.requests = next;
            return `已取消 ${removed} 条 nuke 请求  CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        cluster(targetRoomName: string, count: number = 4, ...rooms: string[]) {
            const cpu0 = Game.cpu.getUsed();
            const room = Game.rooms[targetRoomName];
            if (!room) return `目标房间不可见  CPU used:${Game.cpu.getUsed() - cpu0}`;

            const weights: Partial<Record<StructureConstant, number>> = {
                spawn: 10,
                tower: 8,
                storage: 6,
                terminal: 6,
                lab: 5,
                powerSpawn: 4,
                factory: 4,
                nuker: 4,
                extension: 1,
            };

            const structures = room.find(FIND_STRUCTURES).filter(s => (weights as any)[s.structureType]);
            if (structures.length === 0) return `无可用于 cluster 的目标建筑  CPU used:${Game.cpu.getUsed() - cpu0}`;

            const candidates: { x: number; y: number; score: number }[] = [];
            const seen = new Set<number>();
            for (const s of structures) {
                const key = s.pos.x * 100 + s.pos.y;
                if (seen.has(key)) continue;
                seen.add(key);

                let score = 0;
                for (const other of structures) {
                    if (!other.pos.inRangeTo(s.pos, 2)) continue;
                    score += (weights as any)[other.structureType] || 0;
                }
                candidates.push({ x: s.pos.x, y: s.pos.y, score });
            }

            candidates.sort((a, b) => b.score - a.score);

            const picked: { x: number; y: number; score: number }[] = [];
            const need = Math.max(1, Math.floor(Number(count || 1)));
            for (const c of candidates) {
                if (picked.length >= need) break;
                let ok = true;
                for (const p of picked) {
                    const dist = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
                    if (dist < 5) {
                        ok = false;
                        break;
                    }
                }
                if (!ok) continue;
                picked.push(c);
            }

            const created: string[] = [];
            let failed = 0;
            for (let i = 0; i < picked.length; i++) {
                const p = picked[i];
                const name = `nuke-1-${targetRoomName}-${Game.time}-${i}`;
                const code = room.createFlag(p.x, p.y, name);
                if (typeof code !== 'string') {
                    failed++;
                    continue;
                }
                const flag = Game.flags[code];
                if (flag && rooms.length > 0) flag.memory['rooms'] = rooms;
                created.push(code);
            }

            return `已创建 ${created.length} 个 cluster nuke flags，失败 ${failed}  CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        // 清除所有nuke发射标记
        clear() {
            for (const flagName of Object.keys(Game.flags)) {
                if (!(flagName.startsWith('nuke-') || flagName.startsWith('nuke_'))) continue;
                Game.flags[flagName].remove();
            }
            return `已清除所有nuke发射标记`;
        }
    }
}
