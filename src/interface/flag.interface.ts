interface Flag {
    // 移动旗帜（读取 memory.setPosition）
    handleSetPositionFlag(): boolean;

    // 核弹打击旗帜（处理 nuke-* / nuke_*）
    handleNukeFlag(): boolean;

    // 旗帜触发孵化（CLAIM/RESERVE/CLEAN/ACLAIM/AID-*）
    handleSpawnFlag(): boolean;
}
