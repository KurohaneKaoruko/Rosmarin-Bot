import { getStructData } from '@/modules/utils/memory';

export default class FactoryControl extends Room {
    FactoryWork() {
        const factory = this.factory;
        // 工厂不存在时不处理
        if (!factory) return;
        // 冷却时不处理
        if (factory.cooldown != 0) return;
        if (Memory['warmode']) return;

        const memory = getStructData(this.name);
        // 关停时不处理
        if (!memory || !memory.factory) return;
        // 没有任务时不处理
        const product = memory.factoryProduct;
        if (!product) return;

        const info = (COMMODITIES as any)?.[product as any];
        const productLevel = Number(info?.level ?? 0);
        const flv = Number(factory.level || (memory as any).factoryLevel || 0);
        if (productLevel && productLevel !== flv) {
            (memory as any).factoryProduct = null;
            (memory as any).factoryAmount = 0;
            delete (memory as any).factoryWaitSince;
            return;
        }

        // 原料
        const components = COMMODITIES[product as CommodityConstant]?.components;
        // 原料不足时不处理
        if (!components || Object.keys(components).some((c: any) => factory.store[c] < components[c])) return;

        let result = factory.produce(product as CommodityConstant);
        
        if (Game.time % 100 == 0 || result != OK){
            if(factory.store[product] > 0) {
                this.ManageMissionAdd('f', 's', product, factory.store[product]);
            }
        }
    }
}
