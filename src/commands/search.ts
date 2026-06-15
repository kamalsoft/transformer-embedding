import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { EmbeddingService } from '../services/embedding.js';
import { readConfig } from '../utils/config.js';
import { EmbeddingCache } from '../utils/cache.js';
import { LanceDbService } from '../services/storage/lanceDbService.js';
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
        const vectorStoreType = config.storage.find((s: any) => s.classification === 'vector_store_type')?.value || 'lancedb';

        const embeddingService = new EmbeddingService(activeModel);
        const queryVector = await embeddingService.generate(query);

        let topResults = [];
        if (vectorStoreType === 'lancedb') {
            const lanceDbService = new LanceDbService(vectorRoot);
            
            // Perform the vector search
            const dbResults = await lanceDbService.search(queryVector, parseInt(options.top));

            // LanceDB returns _distance (L2). Convert to a 0-100% similarity score for display
            topResults = dbResults.map(res => {
              // L2 distance to percentage (simplified)
              const score = 1 / (1 + res._distance);
              return {
                score,
                text: res.text,
                source: res.file_path
              };
            });
        } else {
            // Fallback to IO file search
            const vectorDir = path.resolve(process.cwd(), vectorRoot);
            const files = await walkDirectory(vectorDir, 'index.json');
            const results = [];
            for (const file of files) {
                const data = await fs.readJson(file);
                for (const chunk of data.chunks) {
                    results.push({
                        score: dotProduct(queryVector, chunk.vector),
                        text: chunk.text,
                        source: data.metadata.source
                    });
                }
            }
            results.sort((a, b) => b.score - a.score);
            topResults = results.slice(0, parseInt(options.top));
        }

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