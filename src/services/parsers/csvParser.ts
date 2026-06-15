import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';

/**
 * Extracts text from a CSV file.
 * Converts rows into a string format suitable for embedding.
 */
export async function parseCsv(filePath: string): Promise<string> {
  try {
    const fileContent = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    
    // Parse the CSV content into an array of objects/arrays
    // Using sync for CLI predictability; columns: true treats the first row as headers
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: extension === '.tsv' ? '\t' : ','
    });

    // Convert records to a newline-separated string
    // Each row is mapped to a "Key: Value" string to preserve semantic context for RAG
    return records
      .map((row: any) => Object.entries(row).map(([key, val]) => `${key}: ${val}`).join(', '))
      .join('\n');
  } catch (error) {
    throw new Error(`Failed to parse CSV at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}