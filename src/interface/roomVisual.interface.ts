interface RoomVisual {
    roads?: [number, number][];

    structure(x: number, y: number, type: StructureConstant, opts?: any): RoomVisual;
    connectRoads(opts?: any): RoomVisual;
    speech(text: string, x: number, y: number, opts?: any): RoomVisual;
    animatedPosition(x: number, y: number, opts?: any): RoomVisual;
    test(): RoomVisual;

    resource(type: ResourceConstant, x: number, y: number, size?: number): ScreepsReturnCode;
    _fluid(type: ResourceConstant, x: number, y: number, size?: number): void;
    _mineral(type: ResourceConstant, x: number, y: number, size?: number): void;
    _compound(type: ResourceConstant, x: number, y: number, size?: number): void;
}

