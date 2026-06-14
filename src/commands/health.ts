import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { readConfig } from '../utils/config.js';

export function registerHealthCommand(program: Command) {
  program
    .command('health')
    .description('Verify system health and model assets')
    .action(async () => {
      const config = await readConfig();
      let isHealthy = true;
      console.log(chalk.bold('\n🔍 Running System Health Check...\n'));

      const checks = [
        { name: 'Model Path Access', path: config.storage.find((s: any) => s.classification === 'models_root')?.path },
        { name: 'Vector Store Access', path: config.storage.find((s: any) => s.classification === 'vector_store_root')?.path },
        { name: 'Source Docs Path', path: config.ingestion[0].source_path }
      ];

      for (const check of checks) {
        const fullPath = path.resolve(process.cwd(), check.path || '');
        try {
          await fs.access(fullPath, fs.constants.R_OK | fs.constants.W_OK);
          console.log(`${chalk.green('✔')} ${check.name}: ${chalk.gray(fullPath)}`);
        } catch {
          console.log(`${chalk.red('✘')} ${check.name}: ${chalk.red('Unreachable or No Permissions')}`);
          isHealthy = false;
        }
      }

      console.log('\n' + chalk.gray('─────────────────────────────────────────'));
      console.log(`Overall Status: ${isHealthy ? chalk.bgGreen.bold(' HEALTHY ') : chalk.bgRed.bold(' UNHEALTHY ')}`);
      if (!isHealthy) process.exit(1);
    });
}