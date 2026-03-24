export type CreepRoleHandler = {
    prepare?: (creep: Creep) => boolean;
    run: (creep: Creep) => void;
};
