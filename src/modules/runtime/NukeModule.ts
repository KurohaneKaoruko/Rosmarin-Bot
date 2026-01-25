import { shouldRun } from "@/modules/infra/qos";

export const NukeModule = {
    tick: function () {
        if (!shouldRun({ every: 10, minBucket: 2000, allowLevels: ['normal', 'constrained'] })) return;

        if (!Memory.nuke?.requests || Memory.nuke.requests.length === 0) return;

        const now = Game.time;
        Memory.nuke.requests = Memory.nuke.requests.filter(req => now - req.createdTick <= req.ttl);
        if (Memory.nuke.requests.length === 0) return;

        for (const req of Memory.nuke.requests) {
            const flagName = req.flagName || `nuke-${Math.max(1, req.amount || 1)}-${req.id}`;
            req.flagName = flagName;

            const existing = Game.flags[flagName];
            if (existing) {
                existing.memory['amount'] = Math.max(1, req.amount || 1);
                if (Array.isArray(req.rooms) && req.rooms.length > 0) existing.memory['rooms'] = req.rooms;
                existing.memory['requestId'] = req.id;
                continue;
            }

            const room = Game.rooms[req.roomName];
            if (!room) continue;

            const pos = new RoomPosition(req.x, req.y, req.roomName);
            const created = room.createFlag(pos, flagName);
            if (typeof created === 'string') {
                const flag = Game.flags[created];
                if (!flag) continue;
                flag.memory['amount'] = Math.max(1, req.amount || 1);
                if (Array.isArray(req.rooms) && req.rooms.length > 0) flag.memory['rooms'] = req.rooms;
                flag.memory['requestId'] = req.id;
            } else {
                req.lastError = created;
                req.lastErrorTick = now;
            }
        }

        Memory.nuke.requests = Memory.nuke.requests.filter(req => {
            if (!req.flagName) return true;
            return !!Game.flags[req.flagName];
        });
    }
}

