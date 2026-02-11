import { beginInterShardTick, cleanupInterShardLocalRoot, endInterShardTick } from '@/modules/infra/interShard';

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
