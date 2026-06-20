import fs from 'fs-extra';
import path from 'path';
import { getTargetSourcePath } from '../utils/agenticExtractConfig.js';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';

interface PipelineOptions {
  sourcePath: string;
  force?: boolean;
}

export class AgenticExtractService {
  private targetPath: string;

  constructor() {
    this.targetPath = getTargetSourcePath();
  }

  /**
   * NLP Overlap Deduplication:
   * The ingest pipeline creates overlapping chunks so the AI model has context
   * across chunk boundaries. This means the END of chunk[N] is repeated at
   * the START of chunk[N+1].
   *
   * This function finds the longest suffix of `prev` that matches the prefix
   * of `next`, and strips it before joining — producing clean, non-repeated text.
   */
  private deduplicateOverlap(prev: string, next: string): string {
    const maxOverlap = Math.min(prev.length, next.length, 500);

    for (let len = maxOverlap; len > 10; len--) {
      const suffix = prev.slice(-len);
      if (next.startsWith(suffix)) {
        return next.slice(len).replace(/^[\s\n]+/, '');
      }
    }
    return next;
  }

  /**
   * Reads a vector-store index.json, extracts all chunk texts, deduplicates
   * overlapping context windows, and writes clean reconstructed text to vector-source.
   */
  private async processIndexFile(filePath: string, sourceBasePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return;

      if (path.basename(filePath) !== 'index.json') return;

      const rawContent = await fs.readFile(filePath, 'utf-8');

      let parsedJson: any;
      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        return;
      }

      if (!parsedJson.chunks || !Array.isArray(parsedJson.chunks) || parsedJson.chunks.length === 0) {
        return;
      }

      const chunks: string[] = parsedJson.chunks
        .map((c: any) => (typeof c.text === 'string' ? c.text : ''))
        .filter((t: string) => t.trim().length > 0);

      if (chunks.length === 0) return;

      // Deduplicate overlap between consecutive chunks
      const deduplicated: string[] = [chunks[0]];
      for (let i = 1; i < chunks.length; i++) {
        const cleanNext = this.deduplicateOverlap(chunks[i - 1], chunks[i]);
        if (cleanNext.trim().length > 0) {
          deduplicated.push(cleanNext);
        }
      }

      const reconstructedText = deduplicated.join('\n');

      // Original document name is the parent folder name in vector-store (e.g. "ERP requirement.docx")
      const originalName = path.dirname(path.relative(sourceBasePath, filePath));
      const originalExt = path.extname(originalName).replace('.', '') || 'txt';

      // Build YAML frontmatter to preserve file metadata
      const frontmatter =
        `---\n` +
        `source: "${originalName}"\n` +
        `format: ${originalExt}\n` +
        `chunks: ${deduplicated.length}\n` +
        `extracted_at: ${new Date().toISOString()}\n` +
        `---\n\n`;

      const finalContent = frontmatter + reconstructedText;

      // Replace the original extension with .md for a clean Markdown filename
      // "ERP requirement.docx" → "ERP requirement.md"
      // "quicktour.md"         → "quicktour.md"
      const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
      const targetFilePath = path.join(this.targetPath, nameWithoutExt) + '.md';

      await fs.ensureDir(path.dirname(targetFilePath));
      await fs.writeFile(targetFilePath, finalContent, 'utf-8');

      const displayName = path.basename(targetFilePath);
      console.log(chalk.green(`  ✓ Extracted: `) + chalk.cyan(displayName) + chalk.dim(` ← ${originalName} (${deduplicated.length} chunks)`));
    } catch (error) {
      logger.error(error as Error, `[AgenticExtractService] Error processing ${filePath}:`);
      console.log(chalk.red(`  ✗ Failed: `) + chalk.dim(filePath));
    }
  }

  /**
   * Public method to run the extraction pipeline.
   */
  public async runPipeline(options: PipelineOptions): Promise<void> {
    console.log(chalk.blue.bold(`\n[Agentic Extract] Starting cognitive synthesis pipeline...`));
    console.log(chalk.dim(`Source: ${options.sourcePath}`));
    console.log(chalk.dim(`Target: ${this.targetPath}\n`));

    try {
      if (options.force) {
        console.log(chalk.yellow(`[Agentic Extract] Force flag provided. Clearing target directory...`));
        await fs.emptyDir(this.targetPath);
      }

      const exists = await fs.pathExists(options.sourcePath);
      if (!exists) {
        console.log(chalk.yellow(`Source path does not exist: ${options.sourcePath}. Nothing to extract.`));
        return;
      }

      await this.traverseDirectory(options.sourcePath, options.sourcePath);
      console.log(chalk.blue.bold(`\n[Agentic Extract] Pipeline completed successfully!\n`));
    } catch (error) {
      logger.error(error as Error, `[AgenticExtractService] Pipeline encountered a critical error:`);
      console.log(chalk.red.bold(`[Agentic Extract] Pipeline encountered a critical error.`));
    }
  }

  /**
   * Recursively traverses the vector-store directory.
   */
  private async traverseDirectory(currentPath: string, sourceBasePath: string): Promise<void> {
    const entries = await fs.readdir(currentPath);

    const promises = entries.map(async (entry) => {
      const fullPath = path.join(currentPath, entry);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        await this.traverseDirectory(fullPath, sourceBasePath);
      } else {
        await this.processIndexFile(fullPath, sourceBasePath);
      }
    });

    await Promise.allSettled(promises);
  }
}
