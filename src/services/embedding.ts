import { pipeline } from '@huggingface/transformers';
import path from 'path';
export class EmbeddingService {
  private extractor: any = null;
  private modelConfig: any;

  constructor(modelConfig: any) {
    this.modelConfig = modelConfig;
  }

  private async init() {
    if (!this.extractor) {
      // Loads the local model using the path from config.json
      this.extractor = await pipeline('feature-extraction', path.resolve(process.cwd(), this.modelConfig.local_path), {
        local_files_only: true,
        dtype: this.modelConfig.dtype || 'fp32',
      });
    }
  }

  async generate(text: string): Promise<number[]> {
    await this.init();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Explicitly release model resources to ensure clean worker termination.
   */
  async dispose() {
    this.extractor = null;
  }
}