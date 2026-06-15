import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readConfig } from '../utils/config.js';
import { LanceDbService } from '../services/storage/lanceDbService.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show indexing status and document counts in LanceDB')
    .action(async () => {
      const spinner = ora('Fetching index status...').start();
      try {
        const config = await readConfig();
        const vectorRoot = config.storage.find((s: any) => s.classification === 'vector_store_root')?.path || './vector-store';
        const vectorStoreType = config.storage.find((s: any) => s.classification === 'vector_store_type')?.value || 'lancedb';

        if (vectorStoreType !== 'lancedb') {
          spinner.info(chalk.yellow(`Current vector store type is '${vectorStoreType}'. Status command is optimized for LanceDB.`));
        }

        const lanceDbService = new LanceDbService(vectorRoot);
        const chunkCount = await lanceDbService.getTableStats();
        const docCount = await lanceDbService.getDocumentCount();

        spinner.stop();
        console.log(chalk.bold.cyan('\n📊 LanceDB Index Status'));
        console.log(chalk.gray('─────────────────────────────────────────'));
        console.log(`${chalk.white('Store Path:')}      ${chalk.yellow(vectorRoot)}`);
        console.log(`${chalk.white('Total Documents:')} ${chalk.green.bold(docCount)}`);
        console.log(`${chalk.white('Total Chunks:')}    ${chalk.green.bold(chunkCount)}`);
        
        if (chunkCount > 0 && docCount > 0) {
          console.log(`${chalk.white('Avg. Chunks/Doc:')} ${chalk.blue((chunkCount / docCount).toFixed(1))}`);
        }
        console.log(chalk.gray('─────────────────────────────────────────\n'));

      } catch (error: any) {
        spinner.fail(chalk.red(`Failed to get status: ${error.message}`));
      }
    });
}