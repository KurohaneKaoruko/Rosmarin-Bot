export default {
    nuker: {
        launch(...rooms: string[]) {
            const cpu0 = Game.cpu.getUsed();
            const flags = Object.keys(Game.flags).filter(flagName => flagName.startsWith('nuke-'));
            for (const flagName of flags) {
                const launchNukeMatch = flagName.match(/^nuke[-_](\d+)?$/);
                if (!launchNukeMatch) continue;
                // 获取目标
                const targetPos = Game.flags[flagName].pos;
                const targetRoomName = targetPos.roomName;
                // 获取发射数量，默认为1
                const amount = Math.max(1, Number(launchNukeMatch[1] || 1));
                let launchedCount = 0; // 已发射数量
                // 获取符合发射条件的房间
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
