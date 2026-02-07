interface Flag {
    // 移动旗帜（读取 memory.setPosition）
    handleSetPositionFlag(): boolean;

    // 核弹打击旗帜（处理 nuke-* / nuke_*）
    handleNukeFlag(): boolean;

    // 战争孵化旗帜（处理 AIO/CLEAN/ACLAIM 等战斗相关旗帜）
    handleWarSpawnFlag(): boolean;

    // 旗帜触发孵化（CLAIM/RESERVE/AID-*）
    handleAidSpawnFlag(): boolean;
}
