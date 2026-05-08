import type { CaptionGenerationProvider, ImageGenerationProvider } from "./contracts";

const transparentPixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+pX8cAAAAASUVORK5CYII=";

const sanitizeFallbackText = (value: string): string =>
  value
    .replace(/data:image\/[^\s]+/gi, "[imagen]")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();

export class MockImageGenerationProvider implements ImageGenerationProvider {
  async generateImage(input: {
    prompt: string;
    styleId: string;
    sourceImageUrl?: string | null;
  }): Promise<{ imageUrl: string }> {
    if (input.sourceImageUrl) {
      return { imageUrl: input.sourceImageUrl };
    }

    return { imageUrl: transparentPixelPng };
  }

  async generateImages(input: {
    prompt: string;
    styleId: string;
    sourceImageUrl?: string | null;
    count: number;
  }): Promise<{ imageUrls: string[] }> {
    const count = Math.max(1, Math.floor(input.count));
    const image = await this.generateImage(input);
    return { imageUrls: Array.from({ length: count }, () => image.imageUrl) };
  }
}

export class MockCaptionGenerationProvider implements CaptionGenerationProvider {
  async generateCaption(input: {
    prompt: string;
    styleName: string;
    subjectDescription: string;
    businessTone: string;
    facebookSeoKeywords?: string[];
    facebookSeoContext?: string | null;
    creativeAngle?: string | null;
    visualDirection?: string | null;
    variantIndex?: number | null;
    totalVariants?: number | null;
    avoidCaptions?: string[];
  }): Promise<{ caption: string }> {
    const promptPreview = sanitizeFallbackText(input.prompt).slice(0, 80);
    const subjectPreview = sanitizeFallbackText(input.subjectDescription);
    const seoPreview = input.facebookSeoKeywords?.length ? ` SEO: ${input.facebookSeoKeywords.slice(0, 3).join(", ")}` : "";
    const anglePreview = input.creativeAngle ? ` ${sanitizeFallbackText(input.creativeAngle)}.` : "";
    const variantPreview = input.variantIndex && input.totalVariants ? ` V${input.variantIndex}/${input.totalVariants}.` : "";
    const caption = `${input.businessTone} | ${input.styleName}${variantPreview}: ${subjectPreview}.${anglePreview} ${promptPreview}${seoPreview}`;
    return { caption };
  }
}
