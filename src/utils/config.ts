import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.resolve(__dirname, '../../config.json');

export async function readConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
  // Strip comments for JSONC parsing
  const cleanJson = raw.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(cleanJson);
}

export async function saveConfig(config: any) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}