import { shouldRun } from "@/modules/infra/qos";
import { getNukerData } from "@/modules/utils/memory";

export const NukeModule = {
    tick: function () {
        if (!shouldRun({ every: 10, minBucket: 2000, allowLevels: ['normal', 'constrained'] })) return;

        const nukerData = getNukerData();
        if (nukerData.requests.length === 0) return;

        const now = Game.time;
        nukerData.requests = nukerData.requests.filter(req => now - req.createdTick <= req.ttl);
        if (nukerData.requests.length === 0) return;

        for (const req of nukerData.requests) {
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

        nukerData.requests = nukerData.requests.filter(req => {
            if (!req.flagName) return true;
            return !!Game.flags[req.flagName];
        });
    }
}
