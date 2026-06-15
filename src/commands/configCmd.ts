import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { readConfig, saveConfig } from '../utils/config.js';

export function registerConfigCommand(program: Command) {
  const configGroup = program.command('config').description('Manage application configuration');

  configGroup
    .command('all')
    .description('Get all configuration settings')
    .action(async () => {
      try {
        const config = await readConfig();
        console.log(chalk.cyan(`\nComplete Application Configuration:`));
        console.log(chalk.white(JSON.stringify(config, null, 2)));
      } catch (error: any) {
        console.error(chalk.red(`Failed to read config: ${error.message}`));
      }
    });

  configGroup
    .command('list-ingestion')
    .description('List all available ingestion configurations')
    .action(async () => {
      try {
        const config = await readConfig();
        console.log(chalk.cyan('\nAvailable Ingestion Configurations:'));
        config.ingestion.forEach((ing: any, i: number) => {
          console.log(chalk.white(`${i + 1}. Path: ${ing.source_path} (Ext: ${ing.supported_extensions?.join(', ')})`));
        });
      } catch (error: any) {
        console.error(chalk.red(`Failed to list ingestion configs: ${error.message}`));
      }
    });

  configGroup
    .command('use-model <id>')
    .description('Switch the active embedding model by ID')
    .action(async (id) => {
      try {
        const config = await readConfig();
        let found = false;
        config.models.forEach((m: any) => {
          if (m.type === 'embedding') {
            m.active = m.id === id;
            if (m.active) found = true;
          }
        });
        if (!found) throw new Error(`Model ID '${id}' not found in configuration.`);
        await saveConfig(config);
        console.log(chalk.green(`\nSuccess: Model '${id}' is now set as the active embedding model.`));
      } catch (error: any) {
        console.error(chalk.red(`\nSwitch Failed: ${error.message}`));
      }
    });

  configGroup
    .command('list <classification>')
    .description('List all available keys in a configuration classification')
    .action(async (classification) => {
      try {
        const config = await readConfig();
        if (!(classification in config)) {
          console.error(chalk.red(`Error: Classification '${classification}' not found in config.`));
          return;
        }

        const target = config[classification];
        let keys: string[] = [];

        if (Array.isArray(target)) {
          if (target.length > 0) {
            keys = Object.keys(target[0]);
          } else {
            console.log(chalk.yellow(`The classification '${classification}' is an empty array.`));
            return;
          }
        } else if (typeof target === 'object' && target !== null) {
          keys = Object.keys(target);
        }

        console.log(chalk.cyan(`\nAvailable keys in [${classification}]:`));
        keys.forEach(key => console.log(chalk.white(`- ${key}`)));
      } catch (error: any) {
        console.error(chalk.red(`Failed to list keys: ${error.message}`));
      }
    });

  configGroup
    .command('get <classification>')
    .description('Pretty-print a configuration classification')
    .action(async (classification) => {
      try {
        const config = await readConfig();
        if (!(classification in config)) {
          console.error(chalk.red(`Error: Classification '${classification}' not found in config.`));
          return;
        }
        console.log(chalk.cyan(`\nConfiguration for [${classification}]:`));
        console.log(chalk.white(JSON.stringify(config[classification], null, 2)));
      } catch (error: any) {
        console.error(chalk.red(`Failed to read config: ${error.message}`));
      }
    });

  configGroup
    .command('set <classification>')
    .description('Update a property within a classification array')
    .requiredOption('--key <property_name>', 'The property key to update')
    .requiredOption('--value <new_value>', 'The new value to set')
    .option('--id <item_id>', 'The ID of the item to update (optional)')
    .action(async (classification, options) => {
      try {
        const config = await readConfig();
        const { key, value, id } = options;

        if (!(classification in config)) {
          throw new Error(`Classification '${classification}' does not exist.`);
        }

        const targetArray = config[classification];
        if (!Array.isArray(targetArray)) {
          throw new Error(`Target classification '${classification}' is not an array.`);
        }

        let itemIndex = -1;

        if (id) {
          itemIndex = targetArray.findIndex((item: any) => item.id === id);
        } else {
          // Default to classification-based match if no ID (for ingestion/storage blocks)
          itemIndex = targetArray.findIndex((item: any) => item.classification === classification || targetArray.length === 1);
        }

        if (itemIndex === -1) {
          throw new Error(`Could not find a matching item in '${classification}' to update.`);
        }

        const item = targetArray[itemIndex];
        if (!(key in item)) {
          throw new Error(`Property '${key}' does not exist in the targeted ${classification} item.`);
        }

        // Cast value based on existing type
        const originalType = typeof item[key];
        let castedValue: any = value;
        
        if (originalType === 'number') castedValue = Number(value);
        if (originalType === 'boolean') castedValue = value === 'true';
        if (Array.isArray(item[key])) {
           try {
             castedValue = JSON.parse(value);
           } catch {
             castedValue = value.split(',').map((s: string) => s.trim());
           }
        }

        // Update and save
        targetArray[itemIndex][key] = castedValue;
        await saveConfig(config);

        console.log(chalk.green(`\nSuccess: Updated [${classification}].${key} to '${castedValue}'.`));
        if (id) console.log(chalk.dim(`Target ID: ${id}`));

      } catch (error: any) {
        console.error(chalk.red(`\nUpdate Failed: ${error.message}`));
        process.exit(1);
      }
    });
}