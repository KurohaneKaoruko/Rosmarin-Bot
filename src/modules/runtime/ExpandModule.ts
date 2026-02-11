import { CreepMemoryTransfer, ExpandController } from '@/modules/feature/Expand';

const ExpandModule = {
    start: function () {
        CreepMemoryTransfer.run();
        ExpandController.run();
    },
};

export { ExpandModule };
