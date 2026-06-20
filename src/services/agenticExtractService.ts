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
   * Processes a single file from the source to the target directory.
   */
  private async processFile(filePath: string, sourceBasePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return;

      // Only process .json files which hold the vector chunks
      if (path.extname(filePath) !== '.json') return;

      // Ensure zero side effects on source: open read-only
      const rawContent = await fs.readFile(filePath, 'utf-8');
      
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(rawContent);
      } catch (e) {
        return; // Not a valid json file, skip
      }

      // Reconstruct original text by joining all chunk texts
      if (!parsedJson.chunks || !Array.isArray(parsedJson.chunks)) {
        return; // Doesn't match expected schema
      }

      const reconstructedText = parsedJson.chunks.map((c: any) => c.text).join('\n\n');

      // Preserve relative structure in the target directory
      // The original filePath is likely .../vector-store/quicktour.md/index.json
      // We want to reconstruct it as .../vector-source/quicktour.md
      const dirName = path.basename(path.dirname(filePath)); // 'quicktour.md'
      const relativeDirPath = path.dirname(path.relative(sourceBasePath, filePath)); // 'quicktour.md'
      
      const targetFilePath = path.join(this.targetPath, relativeDirPath);

      await fs.ensureDir(path.dirname(targetFilePath));
      
      // Write to the new vector-source directory
      await fs.writeFile(targetFilePath, reconstructedText, 'utf-8');
      
      console.log(chalk.green(`  ✓ Reconstructed: `) + chalk.dim(relativeDirPath));
    } catch (error) {
      // Graceful Error Handling: Log securely without crashing
      logger.error(error as Error, `[AgenticExtractService] Error processing file ${filePath}:`);
      console.log(chalk.red(`  ✗ Failed: `) + chalk.dim(filePath));
    }
  }


  /**
   * Public method to run the non-destructive pipeline.
   * Traverses the source directory and processes each file safely.
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
   * Recursively traverses the directory safely.
   */
  private async traverseDirectory(currentPath: string, sourceBasePath: string): Promise<void> {
    const entries = await fs.readdir(currentPath);

    const promises = entries.map(async (entry) => {
      const fullPath = path.join(currentPath, entry);
      const stats = await fs.stat(fullPath);

      if (stats.isDirectory()) {
        await this.traverseDirectory(fullPath, sourceBasePath);
      } else {
        await this.processFile(fullPath, sourceBasePath);
      }
    });

    // Run concurrently but handle all internal promise rejections gracefully
    await Promise.allSettled(promises);
  }
}
