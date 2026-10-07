import type { Page } from '@playwright/test';

/** Compare compositor output from the real map, away from sidebar controls. */
export async function mapPixelDifference(page: Page, before: Buffer, after: Buffer) {
  return page.evaluate(async ([first, second]) => {
    const decode = async (src: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${src}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [a, b] = await Promise.all([decode(first), decode(second)]);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed += 1;
    }
    return changed;
  }, [before.toString('base64'), after.toString('base64')]);
}

export async function mapColorPixelCounts(page: Page, png: Buffer, colors: readonly (readonly number[])[]) {
  return page.evaluate(async ({ encoded, colors }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    return colors.map(color => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ([0, 1, 2].every(channel => Math.abs(pixels[i + channel] - color[channel]) <= 8)) count += 1;
      }
      return count;
    });
  }, { encoded: png.toString('base64'), colors });
}
