import { parseShardRoomName } from '@/modules/utils/shardRoom';

const isRoomEdgePosition = (pos: { x: number; y: number }): boolean => (
    pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49
);

const toExitDirection = (exitDir: number): DirectionConstant | null => {
    switch (exitDir) {
        case FIND_EXIT_TOP:
            return TOP;
        case FIND_EXIT_RIGHT:
            return RIGHT;
        case FIND_EXIT_BOTTOM:
            return BOTTOM;
        case FIND_EXIT_LEFT:
            return LEFT;
        default:
            return null;
    }
};

const isOnExitEdge = (pos: { x: number; y: number }, direction: DirectionConstant): boolean => {
    switch (direction) {
        case TOP:
            return pos.y === 0;
        case RIGHT:
            return pos.x === 49;
        case BOTTOM:
            return pos.y === 49;
        case LEFT:
            return pos.x === 0;
        default:
            return false;
    }
};

export default class MoveFunction extends Creep {
    /**
     * 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞幘椤︻偊姊虹紒姗嗘當闁绘妫濋幆浣姐亹閹烘挸鈧敻鎮峰▎蹇擃伀妞わ絾鐓￠弻娑㈠煘椤撶偞澶勯柍?     * @param roomName 闂傚倷鑳堕崕鐢稿疾閳哄懎绐楁俊銈呮噺閸嬪鏌ㄥ┑鍡╂Ц缂佺媴缍侀弻娑滎槼妞ゃ劌妫濋弫宥夋偄閸忚偐鍘卞┑顔斤供閸撴稖鍊撮柣?     * @param options 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞枤閸斿灚绻濋姀锝呯厫闁告梹鍨块崺鈧?(range, visualizePathStyle, plainCost, swampCost 缂?
     * @returns ScreepsReturnCode - ERR_TIRED 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔筋焾閸╂牠宕戦鍫熺厵缂備焦锚缁楁帡寮介埄鍐闁瑰鍋為幆鍕煕濞嗗繒绠虫俊鍙夊姇閳规垹鈧綆浜為ˇ褔姊洪崫鍕ⅱ闁轰焦鎮傞弻褔宕掑锝嗩潔?moveTo 闂備礁鎼ˇ顐﹀疾濠婂牆钃熼柕濞垮剭濞差亜鍐€妞ゆ挾鍋熼敍?     */
    moveToRoom(roomName: string, options = {}) {
        if (this.fatigue > 0) return ERR_TIRED;

        const { full: fullRoomName, roomName: localRoomName, shard } = parseShardRoomName(roomName);
        const sameShard = !shard || shard === Game.shard.name;

        const DETOUR_WINDOW = 20;
        const COOLDOWN_TTL = 15;
        const currentRoom = this.pos.roomName;
        const exitDir = sameShard && currentRoom !== localRoomName
            ? this.room.findExitTo(localRoomName)
            : null;
        const exitDirection = exitDir === null ? null : toExitDirection(exitDir);

        const opts: any = options || {};
        if (opts.range === undefined) opts.range = 3;

        if (sameShard && this.room.name === localRoomName && this.handleRoomEdge()) {
            return OK;
        }

        if (sameShard && currentRoom !== localRoomName && isRoomEdgePosition(this.pos)) {
            if (exitDirection && isOnExitEdge(this.pos, exitDirection)) {
                return this.move(exitDirection);
            }
            if (this.handleRoomEdge()) {
                return OK;
            }
        }

        let state = this.memory._moveToRoomState;
        if (!state || state.targetRoom !== fullRoomName) {
            state = this.memory._moveToRoomState = {
                targetRoom: fullRoomName,
                targetPos: null,
                lastRoom: currentRoom,
                leftTargetTick: 0,
                cooldownUntil: 0
            };
        }

        if (sameShard) {
            const lastRoom = state.lastRoom || currentRoom;
            if (lastRoom !== currentRoom) {
                if (lastRoom === localRoomName && currentRoom !== localRoomName) {
                    state.leftTargetTick = Game.time;
                }
                if (currentRoom === localRoomName && lastRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
                    state.cooldownUntil = Game.time + COOLDOWN_TTL;
                }
                state.lastRoom = currentRoom;
            }
        }

        let targetPos = state.targetPos as { x: number; y: number; roomName?: string } | null;
        if (sameShard) {
            const targetRoom = Game.rooms[localRoomName];
            const targetController = targetRoom?.controller;
            if (targetController) {
                const p = targetController.pos;
                if (!targetPos || targetPos.x !== p.x || targetPos.y !== p.y) {
                    targetPos = { x: p.x, y: p.y };
                    state.targetPos = targetPos;
                }
            }
        }
        if (!targetPos) {
            let seed = 0;
            const s = `${this.name}|${fullRoomName}`;
            for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
            const centerX = 25;
            const centerY = 25;
            const range = 10;
            const span = range * 2 + 1;
            const x = (seed % span) + (centerX - range);
            const y = (((seed >>> 8) % span) + (centerY - range));
            targetPos = { x, y };
            state.targetPos = targetPos;
        }

        if (sameShard && currentRoom !== localRoomName && state.leftTargetTick && (Game.time - state.leftTargetTick) <= DETOUR_WINDOW) {
            let exitPos = null;
            const bm: any = (global as any).BetterMove;
            if (bm && typeof bm.getClosestExitPos === 'function') {
                exitPos = bm.getClosestExitPos(this.pos, localRoomName);
            } else {
                const exitDir = this.room.findExitTo(localRoomName);
                if (exitDir === FIND_EXIT_TOP || exitDir === FIND_EXIT_RIGHT || exitDir === FIND_EXIT_BOTTOM || exitDir === FIND_EXIT_LEFT) {
                    const exits = this.room.find(exitDir);
                    exitPos = exits.length ? this.pos.findClosestByRange(exits) : null;
                }
            }
            if (exitPos) {
                if (opts.maxRooms === undefined) opts.maxRooms = 1;
                return this.moveTo(exitPos, Object.assign({}, opts, { maxRooms: 1, range: 0 }));
            }
        }

        if (sameShard && currentRoom === localRoomName && state.cooldownUntil && Game.time < state.cooldownUntil && opts.maxRooms === undefined) {
            opts.maxRooms = 1;
        }

        if (sameShard) {
            const tarPos = new RoomPosition(targetPos.x, targetPos.y, localRoomName);
            return this.moveTo(tarPos, opts);
        }
        return this.moveTo({ x: targetPos.x, y: targetPos.y, roomName: fullRoomName } as any, opts);
    }

    /**
     * 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞幘椤︻偊姊虹紒姗嗘當闁绘妫濋妴鍌炲蓟閵夛箑鈧爼鏌ｉ幇鐗堟锭濞寸媴绠撻弻娑㈠煘椤撶偞澶勯柍?(home)
     * @returns boolean - true 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔斤供閸擄箓宕崨瀛樼厵缂備焦锚缁楁帡鏌ｉ幘鍐测偓鍨嚕閸洖閱囬柕蹇曞С婢规洟姊洪幖鐐插Ω闁告梹鍨甸?home 闂備浇宕垫慨宕囩矆娴ｈ娅犲ù鐘差儐閸嬵亪鏌涢埄鍐姇闁哄拋鍓熼幃妤冩喆閸曨剛鐨絣se 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔斤供閸擄箑顭囨导瀛樼叆婵犻潧妫欓崳娲椤掑澧扮紒杈ㄥ笚瀵板嫭鎯旈鍏碱唲濠电姵顔栭崰鎺楀疾濠婂懐鐭?     */
    moveHomeRoom(): boolean {
        if(!this.memory.home) { return true; }
        const { roomName: localHome, shard } = parseShardRoomName(this.memory.home);
        if ((!shard || shard === Game.shard.name) && this.room.name === localHome) { return true; }
        this.moveToRoom(this.memory.home, { visualizePathStyle: { stroke: '#ff0000' } });
        return false;
    }

    /**
     * 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞幘椤︻偊姊虹憴鍕靛晱闁哥姵顨堢划锝呂旈崨顔惧幐閻庡箍鍎遍幊蹇斿緞閸曨垱鐓曢柍璇″幖濞诧箓鍩?     * @param options 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞枤閸斿灚绻濋姀锝呯厫闁告梹鍨块崺鈧?     * @returns boolean - true 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔斤供閸擄箓宕崨瀛樼厵缂備焦锚缁楁帡鏌ｉ幘鍐测偓鍨嚕閸洖閱囨繝闈涙閹稿啫鈹戦悙璺虹处闁告鍟块锝嗙鐎ｎ亞鍊為梺闈涱焾閸庢娊宕ｉ崟顖涒拻闁稿本鑹鹃埀顒冨吹閹广垹鈹戦崼銏㈢暥闂佸搫绉查崝搴ㄥ煝閺冨倵鍋撻獮鍨姎闁瑰啿绻橀悡顒勵敆閸曨偆楠囬梺鍓插亝缁诲啰鎷归敍鍕＜濡插本鐗曞顕€鏌℃担鍝バら柍褜鍓濋～澶娾攦娣囩e 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔筋焾濞夋稓鈧艾顦伴妵鍕疀閹炬剚浠奸梺缁樻尭閸婂灝顕?     */
    moveToTargetRoom(options?: MoveToOpts): boolean {
        const targetRoom = this.memory.targetRoom;
        if (!targetRoom) { return true; }
        
        const { roomName: localTarget, shard } = parseShardRoomName(targetRoom);
        if ((!shard || shard === Game.shard.name) && this.room.name === localTarget && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(targetRoom, options || {});
        return false;
    }

    /**
     * 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞幘椤︻偊姊洪悷鏉挎Щ闁活剙銈告俊鍫曨敃閿濆洨鐦堥悷婊冮叄瀹曟繈寮介鐐存К閻熸粍鏌ㄩ～?     * @param options 缂傚倸鍊风粈渚€藝閹剁瓔鏁嬬憸搴ㄥ箞閵娾晛鐓涢柛娑卞枤閸斿灚绻濋姀锝呯厫闁告梹鍨块崺鈧?     * @returns boolean - true 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔斤供閸擄箓宕崨瀛樼厵缂備焦锚缁楁帡鏌ｉ幘鍐测偓鍨嚕閸洖閱囬柣鏃堫棑椤︺劎绱撴担椋庤窗闁稿瀚伴崺鐐哄礃椤旇偐鐤€濡炪倖鎸鹃崑鐔煎矗閸曨垱鈷掗柛灞捐壘閳ь剝宕甸幑銏犫攽閸垻鐣堕梺鍝勭Р閸斿酣鍩㈤弮鍌楀亾楠炲灝鍔氶柟鍐茬箻閻擃剟顢楅崟顐ら獓闂佸壊鍋呯换鍐嫻閿涘嫮纾煎Σ灞剧墪瀵噣鏌℃担鍝バら柍褜鍓濋～澶娾攦娣囩e 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔筋焾濞夋稓鈧艾顦伴妵鍕疀閹炬剚浠奸梺缁樻尭閸婂灝顕?     */
    moveToSourceRoom(options?: MoveToOpts): boolean {
        const sourceRoom = this.memory.sourceRoom;
        if (!sourceRoom) { return true; }
        
        const { roomName: localSource, shard } = parseShardRoomName(sourceRoom);
        if ((!shard || shard === Game.shard.name) && this.room.name === localSource && !this.handleRoomEdge()) {
            return true;
        }
        
        this.moveToRoom(sourceRoom, options || {});
        return false;
    }

    /**
     * 濠电姷顣藉Σ鍛村磻閳ь剟鏌涚€ｎ偅宕岄柡宀嬬磿娴狅妇鎷犻幓鎺戭潥婵犵鈧啿绾ч柟顔煎€搁悾鐑藉Ψ閳哄倹娅囬梺閫炲苯澧柨鏇樺灲椤㈡棃宕煎┑鍫悈闂備胶顫嬮崟鍨暦闂佹寧绋撻崰鏍ь嚕閸洖閱囨繝闈涙穿绾偓缂傚倷绶氱涵鎼佸矗閸愵喗鍋樻い鏃傚亾瀹曞銆掑鐓庣仭鐞氣晠姊?     * @returns boolean - true 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔筋焾濞夋盯骞戦崼鏇熺厪濠电偛鐏濇俊鍧楁煟濠靛棗顣崇紒杈ㄦ崌瀹曟帒霉閵忊晙閭柟宕囧枛閹垺绺芥径瀣€冮梻浣瑰缁诲倿骞婅箛娑氬彆妞ゆ巻鍋撴い顓℃硶閹瑰嫰宕崟鍏哥磻闂備浇顕栭崰鏍晝椤忓牆鏋佺€广儱娲犻崑鎾舵喆閸曨剛鐨絣se 闂備浇宕甸崑鐐电矙韫囨稑绀夐幖娣妼妗呭┑顔斤供閸橀箖鍩㈤弮鍌楀亾楠炲灝鍔氶柟鍐茬箻閻擃剟顢楅崟顐ら獓闂佸壊鍋呯换鍐嫻閿涘嫮纾?     */
    handleRoomEdge(): boolean {
        const x = this.pos.x;
        const y = this.pos.y;
        
        // 濠电姷顣藉Σ鍛村磻閳ь剟鏌涚€ｎ偅宕岄柡宀嬬磿娴狅妇鎷犻幓鎺戭潥婵犵鈧啿绾ч柟顔煎€搁悾鐑藉Ψ閳哄倹娅囬梺閫炲苯澧柨鏇樺灲椤㈡棃宕煎┑鍫悈闂備胶顫嬮崟鍨暦闂佹寧绋撻崰鏍ь嚕閸洖閱囨繝闈涙穿绾偓缂?(x/y 婵?0 闂?49)
        if (x === 0 || x === 49 || y === 0 || y === 49) {
            let direction: DirectionConstant | undefined;
            
            if (x === 0) direction = RIGHT;
            else if (x === 49) direction = LEFT;
            else if (y === 0) direction = BOTTOM;
            else if (y === 49) direction = TOP;
            
            if (direction) {
                const code = this.move(direction);
                if (code !== OK && code !== ERR_TIRED) {
                    this.moveTo(new RoomPosition(25, 25, this.room.name), { maxRooms: 1, range: 20 });
                }
            }
            return true;
        }
        
        return false;
    }
}


