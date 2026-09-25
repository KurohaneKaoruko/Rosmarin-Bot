interface Flag {
    // 移动旗帜（读取 memory.setPosition）
    handleSetPositionFlag(): boolean;

    // 核弹打击旗帜（处理 nuke-* / nuke_*）
    handleNukeFlag(): boolean;

    // 战争孵化旗帜（处理 AIO/CLEAN/ACLAIM/DIS/LOOT 等战斗相关旗帜）
    handleWarSpawnFlag(): boolean;

    // 旗帜触发孵化（CLAIM/RESERVE/AID-*）
    handleAidSpawnFlag(): boolean;

    // 房间内冲级/刷墙旗帜（UP-UPGRADE/UP-REPAIR）
    handleUpSpawnFlag(): boolean;

    // 布局预览旗（layoutVisual：持续显示所在房布局）
    handleLayoutVisualFlag(): boolean;
}
