import * as lancedb from '@lancedb/lancedb';
import fs from 'fs-extra';
import path from 'path';
import { z } from 'zod';

export const DocumentChunkSchema = z.object({
  vector: z.array(z.number()),
  text: z.string(),
  file_path: z.string(),
  chunk_index: z.number(),
  metadata: z.string()
});

export interface DocumentChunk {
  vector: number[];
  text: string;
  file_path: string;
  chunk_index: number;
  metadata: string; // Store as JSON string for flexibility
  [key: string]: any; // Required for compatibility with LanceDB's Record<string, unknown> requirements
}

/**
 * Service for managing local vector storage using LanceDB.
 */
export class LanceDbService {
  private db: lancedb.Connection | null = null;
  private readonly TABLE_NAME = 'document_chunks';

  constructor(private dbPath: string) {}

  private async connect(): Promise<lancedb.Connection> {
    if (this.db) return this.db;
    
    await fs.ensureDir(this.dbPath);
    this.db = await lancedb.connect(this.dbPath);
    return this.db;
  }

  /**
   * Saves or appends chunks to the vector database.
   * Replaces existing records for the same file_path to ensure data integrity.
   */
  public async saveChunks(chunks: DocumentChunk[]): Promise<void> {
    // Validate chunks before processing
    chunks.forEach(chunk => DocumentChunkSchema.parse(chunk));

    const client = await this.connect();
    const tableNames = await client.tableNames();

    if (!tableNames.includes(this.TABLE_NAME)) {
      await client.createTable(this.TABLE_NAME, chunks);
    } else {
      const table = await client.openTable(this.TABLE_NAME);
      
      // Update logic: Delete old entries for these specific files before adding new ones
      const filePaths = [...new Set(chunks.map(c => c.file_path))];
      for (const filePath of filePaths) {
        // Use SQL-like filter for deletion
        await table.delete(`file_path = '${filePath}'`);
      }

      await table.add(chunks);
    }
  }

  /**
   * Checks if a file hash matches the stored metadata to skip unnecessary work.
   */
  public async isFileUnchanged(filePath: string, hash: string): Promise<boolean> {
    const client = await this.connect();
    if (!(await client.tableNames()).includes(this.TABLE_NAME)) return false;

    const table = await client.openTable(this.TABLE_NAME);
    const results = await table.query()
      .where(`file_path = '${filePath}'`)
      .limit(1)
      .toArray();

    if (results.length === 0) return false;

    try {
      const meta = JSON.parse(results[0].metadata);
      return meta.hash === hash;
    } catch {
      return false;
    }
  }

  /**
   * Returns the total count of vectors stored.
   */
  public async getTableStats(): Promise<number> {
    const client = await this.connect();
    if (!(await client.tableNames()).includes(this.TABLE_NAME)) return 0;
    const table = await client.openTable(this.TABLE_NAME);
    return await table.countRows();
  }

  public async deleteByFilePath(filePath: string): Promise<void> {
    const client = await this.connect();
    if ((await client.tableNames()).includes(this.TABLE_NAME)) {
      const table = await client.openTable(this.TABLE_NAME);
      await table.delete(`file_path = '${filePath}'`);
    }
  }

  /**
   * Performs a vector search against the stored chunks.
   */
  public async search(queryVector: number[], limit: number = 5) {
    const client = await this.connect();
    const tableNames = await client.tableNames();

    if (!tableNames.includes(this.TABLE_NAME)) {
      return [];
    }

    const table = await client.openTable(this.TABLE_NAME);
    return await table.vectorSearch(queryVector).limit(limit).toArray();
  }
}