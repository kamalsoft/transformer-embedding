import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { EmbeddingService } from '../services/embedding.js';
import { readConfig } from '../utils/config.js';
import { EmbeddingCache } from '../utils/cache.js';
import { walkDirectory } from '../utils/fileWalker.js';

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Search ingested documents using semantic vector similarity')
    .option('--top <number>', 'Number of results to return', '5')
    .action(async (query, options) => {
      const spinner = ora('Searching vectors...').start();
      
      try {
        const config = await readConfig();
        const activeModel = config.models.find((m: any) => m.active);
        const vectorRoot = config.storage.find((s: any) => s.classification === 'vector_store_root')?.path || './vector-store';

        const embeddingService = new EmbeddingService(activeModel);
        const queryVector = await embeddingService.generate(query);

        const cache = new EmbeddingCache();
        const lut = cache.computeADCLookupTable(queryVector);

        const vectorDir = path.resolve(process.cwd(), vectorRoot);
        if (!(await fs.pathExists(vectorDir))) {
          throw new Error('Vector store not found. Please run "ingest" first.');
        }

        const files = await walkDirectory(vectorDir, 'index.json');
        const results = [];

        for (const file of files) {
          const data = await fs.readJson(file);
          
          for (const chunk of data.chunks) {
            let score = 0;
            const chunkHash = chunk.metadata?.chunkHash;

            // Use ADC for fast ranking if the chunk is in the PQ cache
            const adcDist = chunkHash ? cache.getDistanceADC(chunkHash, lut) : null;
            
            if (adcDist !== null) {
              // Convert Squared Euclidean Distance to a similarity-like score for display
              score = 1 / (1 + adcDist);
            } else {
              score = dotProduct(queryVector, chunk.vector);
            }

            results.push({
              score,
              text: chunk.text,
              source: chunk.metadata.source
            });
          }
        }

        // Sort by similarity score descending
        results.sort((a, b) => b.score - a.score);
        const topResults = results.slice(0, parseInt(options.top));

        spinner.stop();
        console.log(chalk.cyan(`\nTop ${topResults.length} matches for: "${query}"\n`));

        topResults.forEach((res, i) => {
          console.log(chalk.green(`[${i + 1}] Similarity: ${(res.score * 100).toFixed(2)}%`));
          console.log(chalk.gray(`Source: ${res.source}`));
          console.log(chalk.white(`${res.text}\n`));
        });

      } catch (error: any) {
        spinner.fail(chalk.red(`Search failed: ${error.message}`));
      }
    });
}

function dotProduct(a: number[], b: number[]) {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}