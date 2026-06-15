import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { readConfig } from '../utils/config.js';
import { LanceDbService } from '../services/storage/lanceDbService.js';

export function registerSyncCommand(program: Command) {
  program
    .command('sync')
    .description('Sync vector store with disk: removes index entries for files no longer on disk')
    .action(async () => {
      const spinner = ora('Starting index sync...').start();
      try {
        const config = await readConfig();
        const vectorRoot = config.storage.find((s: any) => s.classification === 'vector_store_root')?.path || './vector-store';
        const vectorStoreType = config.storage.find((s: any) => s.classification === 'vector_store_type')?.value || 'lancedb';

        if (vectorStoreType !== 'lancedb') {
          spinner.fail(chalk.red('Sync logic is currently only supported for LanceDB storage.'));
          return;
        }

        const lanceDbService = new LanceDbService(vectorRoot);
        const indexedFiles = await lanceDbService.getAllIndexedFiles();
        
        let prunedCount = 0;
        spinner.text = `Scanning ${indexedFiles.length} indexed files...`;

        for (const filePath of indexedFiles) {
          const exists = await fs.pathExists(filePath);
          if (!exists) {
            spinner.text = `Pruning: ${path.basename(filePath)}...`;
            await lanceDbService.deleteByFilePath(filePath);
            prunedCount++;
          }
        }

        if (prunedCount > 0) {
          spinner.succeed(chalk.green(`Sync complete! Pruned ${prunedCount} orphaned files from the index.`));
        } else {
          spinner.succeed(chalk.green('Sync complete! Index is already perfectly synchronized with disk.'));
        }
      } catch (error: any) {
        spinner.fail(chalk.red(`Sync failed: ${error.message}`));
      }
    });
}