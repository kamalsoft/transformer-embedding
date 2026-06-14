import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../utils/config.js';

export function registerClearCommand(program: Command) {
  program
    .command('clear')
    .description('Clear the entire vector store index')
    .action(async () => {
      const spinner = ora('Clearing vector store...').start();
      try {
        const config = await readConfig();
        const vectorRoot = config.storage.find((s: any) => s.classification === 'vector_store_root')?.path || './vector-store';
        const targetDir = path.resolve(process.cwd(), vectorRoot);
        await fs.emptyDir(targetDir);
        spinner.succeed(chalk.green('Vector store cleared successfully.'));
      } catch (error: any) {
        spinner.fail(chalk.red(`Failed to clear vector store: ${error.message}`));
      }
    });
}