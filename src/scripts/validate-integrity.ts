import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import chalk from 'chalk';

const CONFIG_PATH = './config.json';

function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

async function validateIntegrity() {
  try {
    const config = await fs.readJson(CONFIG_PATH);
    const storageConfig = config.storage.find((s: any) => s.classification === 'vector_store_root');
    const vectorStorePath = path.resolve(storageConfig.path);

    if (!fs.existsSync(vectorStorePath)) {
      console.error(chalk.red('Vector store directory not found. Please run ingestion first.'));
      return;
    }

    const files = await fs.readdir(vectorStorePath);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    console.log(chalk.cyan(`Validating ${jsonFiles.length} vector chunks against source files...\n`));

    const fileStats = new Map<string, { recordedHash?: string; chunks: number }>();

    for (const file of jsonFiles) {
      const content = await fs.readJson(path.join(vectorStorePath, file));
      const sourcePath = content.metadata?.source_path;
      const recordedHash = content.metadata?.file_hash;

      if (!sourcePath) continue;

      if (!fileStats.has(sourcePath)) {
        fileStats.set(sourcePath, { recordedHash, chunks: 0 });
      }
      fileStats.get(sourcePath)!.chunks++;
    }

    let ok = 0, modified = 0, missing = 0, noHash = 0;

    for (const [sourcePath, stats] of fileStats.entries()) {
      if (!fs.existsSync(sourcePath)) {
        console.log(chalk.red(`[MISSING]  ${sourcePath}`));
        missing++;
        continue;
      }

      if (!stats.recordedHash) {
        console.log(chalk.yellow(`[NO HASH]  ${sourcePath} (Re-ingestion recommended)`));
        noHash++;
        continue;
      }

      const currentHash = calculateFileHash(sourcePath);
      if (currentHash === stats.recordedHash) {
        console.log(chalk.green(`[OK]       ${sourcePath} (${stats.chunks} chunks)`));
        ok++;
      } else {
        console.log(chalk.red(`[MODIFIED] ${sourcePath}`));
        modified++;
      }
    }

    console.log(`\n${chalk.bold('Final Report:')}`);
    console.log(chalk.green(`  Healthy:  ${ok}`));
    console.log(chalk.red(`  Modified: ${modified}`));
    console.log(chalk.red(`  Missing:  ${missing}`));
    console.log(chalk.yellow(`  Untracked:${noHash}`));

  } catch (err) {
    console.error(chalk.red('Validation failed:'), err);
  }
}

validateIntegrity();