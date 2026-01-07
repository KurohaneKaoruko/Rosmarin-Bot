export default {
    nuker: {
        launch(...rooms: string[]) {
            const cpu0 = Game.cpu.getUsed();
            const flags = Object.keys(Game.flags).filter(flagName => flagName.startsWith('nuke-'));
            for (const flagName of flags) {
                const launchNukeMatch = flagName.match(/^nuke[-_](\d+)/);
                if (!launchNukeMatch) continue;
                // 获取目标
                const targetPos = Game.flags[flagName].pos;
                const targetRoomName = targetPos.roomName;
                // 获取符合发射条件的房间
                if(!rooms || rooms.length === 0) rooms = Object.keys(Game.rooms);
                const nearbyRooms = rooms.filter(room =>
                    Game.map.getRoomLinearDistance(room, targetRoomName, true) <= 10 &&
                    Game.rooms[room] &&
                    Game.rooms[room].my &&
                    Game.rooms[room].nuker &&
                    Game.rooms[room].nuker.cooldown === 0 &&
                    Game.rooms[room].nuker.store[RESOURCE_GHODIUM] == 5000 &&
                    Game.rooms[room].nuker.store[RESOURCE_ENERGY] == 300000
                )
                // 获取发射数量，默认为1
                const amount = launchNukeMatch[1] ? parseInt(launchNukeMatch[1]) : 1;
                let launchedCount = 0; // 已发射数量
                for (const room of nearbyRooms) {
                    // 获取该房间的核弹发射器
                    const nuker = Game.rooms[room].nuker;
                    nuker.launchNuke(targetPos);    // 发射核弹
                    launchedCount++;    // 已发射数量加1
                    console.log(`从房间 ${nuker.room.name} 发射核弹到 ${targetRoomName} (x:${targetPos.x}  y:${targetPos.y})`);
                    if (launchedCount >= amount) break; // 达到发射数量后退出循环
                }
                Game.flags[flagName].remove();
                break;
            }
            return `CPU used:${Game.cpu.getUsed() - cpu0}`;
        },
        // 清除所有nuke发射标记
        clear() {
            for (const flagName of Object.keys(Game.flags)) {
                const launchNukeMatch = flagName.match(/^nuke[-#/ ](\d+)$/);
                if (!launchNukeMatch) continue;
                Game.flags[flagName].remove();
            }
            return `已清除所有nuke发射标记`;
        }
    }
}