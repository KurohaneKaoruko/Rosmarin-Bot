import { isPixelGenEnabled } from '@/modules/shared/memory';
/**
 * 搓Pixel
 */
export const GeneratePixel = {
    end: function () {
        if (!isPixelGenEnabled()) return;
        try {
            if (Game.cpu.bucket < 10000) return;
            Game.cpu.generatePixel();
        } catch (e) { };
    }
}
