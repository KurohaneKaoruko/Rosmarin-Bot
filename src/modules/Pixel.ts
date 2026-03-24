/**
 * 搓Pixel
 */
export const GeneratePixel = {
    end: function () {
        if (!Memory['GenPixel']) return;
        try {
            if (Game.cpu.bucket < 10000) return;
            Game.cpu.generatePixel();
        } catch (e) { };
    }
}
