import { Command } from 'commander';
import path from 'path';
import { AgenticExtractService } from '../services/agenticExtractService.js';
import { initializeTargetSource } from '../utils/agenticExtractConfig.js';
import { readConfig } from '../utils/config.js';
import chalk from 'chalk';

export function registerAgenticExtractCommand(program: Command) {
  program
    .command('agentic-extract')
    .alias('distill')
    .description('Run a non-destructive cognitive synthesis pipeline to extract vector-store contents into readable format.')
    .option('-f, --force', 'Force recreate the target directory by clearing it first')
    .action(async (cmdOptions) => {
      try {
        await initializeTargetSource();

        const config = await readConfig();
        
        // Find vector store path from config
        const vectorStoreConfig = config.storage?.find((s: any) => s.classification === 'vector_store_root');
        
        let sourcePath = path.resolve(process.cwd(), 'vector-store'); // default
        if (vectorStoreConfig && vectorStoreConfig.path) {
          sourcePath = path.resolve(process.cwd(), vectorStoreConfig.path);
        }

        const service = new AgenticExtractService();
        await service.runPipeline({ sourcePath, force: cmdOptions.force });
        
      } catch (error: any) {
        console.error(chalk.red(`\nAgentic extract failed: ${error.message}`));
        process.exit(1);
      }
    });
}
