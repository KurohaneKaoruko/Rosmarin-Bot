import { beginInterShardTick, cleanupInterShardLocalRoot, endInterShardTick } from '@/modules/feature/interShard';

const InterShardModule = {
    start: function () {
        beginInterShardTick();
    },
    end: function () {
        cleanupInterShardLocalRoot();
        endInterShardTick();
    },
};

export { InterShardModule };
