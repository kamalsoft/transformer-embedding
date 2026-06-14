import fs from 'fs-extra';
import path from 'path';

export async function walkDirectory(dir: string, ext: string | string[]): Promise<string[]> {
  let results: string[] = [];
  const list = await fs.readdir(dir);
  const extensions = Array.isArray(ext) ? ext : [ext];
  const extLower = extensions.map(e => e.toLowerCase());

  for (const file of list) {
    const filePath = path.resolve(dir, file);
    const stat = await fs.stat(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(await walkDirectory(filePath, extensions));
    } else if (extLower.some(e => filePath.toLowerCase().endsWith(e))) {
      results.push(filePath);
    }
  }
  return results;
}