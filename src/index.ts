#!/usr/bin/env node
import './utils/suppress.js';
import { Command } from 'commander';
import { registerIngestCommand } from './commands/ingest.js';
import { registerConfigCommand } from './commands/configCmd.js';
import { registerSearchCommand } from './commands/search.js';
import { registerClearCommand } from './commands/clear.js';
import { registerHealthCommand } from './commands/health.js';
import { registerDashboardCommand } from './commands/dashboard.js';
import { registerSyncCommand } from './commands/sync.js';
import { logger } from './utils/logger.js';
import { AppError } from './utils/errors.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('ask-doc')
  .description('Local CLI tool to ingest docs and manage configurations')
  .version('1.0.0');

registerIngestCommand(program);
registerConfigCommand(program);
registerSearchCommand(program);
registerClearCommand(program);
registerHealthCommand(program);
registerDashboardCommand(program);
registerSyncCommand(program);

program.parseAsync(process.argv).catch((err) => {
  if (err instanceof AppError) {
    logger.error({ errorCode: err.statusCode }, err.message);
    console.error(chalk.red(`\nError: ${err.message}`));
  } else {
    logger.fatal(err, 'Uncaught Exception');
    console.error(chalk.red.bold('\nCritical System Failure. See logs for details.'));
  }
  
  process.exit(1);
});