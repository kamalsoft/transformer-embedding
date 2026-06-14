import { pipeline } from '@huggingface/transformers';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  // Simple regex to strip comments for JSONC parsing
  const cleanJson = raw.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(cleanJson);
}

async function downloadModel() {
  const spinner = ora('Starting model download...').start();
  try {
    const config = await readConfig();
    const modelConfig = config.models.find((m: any) => m.type === 'embedding' && m.active);

    if (!modelConfig) {
      spinner.fail(chalk.red('No active embedding model found in config.json.'));
      return;
    }

    const downloadName = modelConfig.name; // This is the Hugging Face identifier
    const targetLocalPath = path.resolve(process.cwd(), modelConfig.local_path); // This is where we want the files

    // Create a temporary directory for downloading
    const tempCacheDir = path.join(os.tmpdir(), `hf-transformers-cache-${Date.now()}`);
    await fs.ensureDir(tempCacheDir);

    spinner.text = `Downloading model: ${chalk.yellow(downloadName)} to temporary cache...`;

    // Trigger download to the temporary cache
    // local_files_only: false ensures it downloads if not present
    // cache_dir directs the download to our temporary cache
    await pipeline('feature-extraction', downloadName, {
      cache_dir: tempCacheDir,
      local_files_only: false,
    });

    // Determine the actual path where the model was downloaded within the cache
    // This typically follows the pattern: cache_dir/Xenova/model-name
    // We need to convert 'Xenova/all-MiniLM-L6-v2' to 'Xenova/all-MiniLM-L6-v2' (platform specific path separator)
    const modelSubPath = downloadName.replace(/\//g, path.sep);
    const downloadedModelSource = path.join(tempCacheDir, modelSubPath);

    // Ensure the target local path exists
    await fs.ensureDir(targetLocalPath);

    // Check if the model was actually downloaded to the expected subpath
    if (!await fs.pathExists(downloadedModelSource)) {
      throw new Error(`Downloaded model not found at expected temporary path: ${downloadedModelSource}`);
    }

    spinner.text = `Copying model files from temporary cache to ${chalk.cyan(targetLocalPath)}...`;

    // Copy the contents of the downloaded model directory to the target local path
    await fs.copy(downloadedModelSource, targetLocalPath, { overwrite: true });

    // Clean up the temporary cache directory
    await fs.remove(tempCacheDir);

    spinner.succeed(chalk.green(`Successfully downloaded and moved model ${downloadName} to ${targetLocalPath}`));
  } catch (error: any) {
    spinner.fail(chalk.red(`Model download failed: ${error.message}`));
    console.error(error);
    process.exit(1);
  }
}
downloadModel();