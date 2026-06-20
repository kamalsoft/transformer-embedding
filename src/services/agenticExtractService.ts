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

      const fileName = path.basename(filePath);

      // Only process the original binary backups created by ingest
      if (!fileName.startsWith('original.')) return;

      // The parent directory is the actual document ID (e.g. ERP requirement.docx)
      const relativeDirPath = path.dirname(path.relative(sourceBasePath, filePath));
      
      const targetFilePath = path.join(this.targetPath, relativeDirPath);

      await fs.ensureDir(path.dirname(targetFilePath));
      
      // Zero Data Loss: Direct binary copy
      await fs.copyFile(filePath, targetFilePath);
      
      console.log(chalk.green(`  ✓ Restored: `) + chalk.dim(relativeDirPath));
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
