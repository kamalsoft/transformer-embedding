import fs from 'fs-extra';
import path from 'path';

export class StorageService {
  private vectorRoot: string;

  constructor(storageConfigs: any[]) {
    const root = storageConfigs.find(s => s.classification === 'vector_store_root');
    this.vectorRoot = root ? root.path : './vector-store';
  }

  async saveDocumentBundle(subDir: string, chunks: any[], metadata: { source: string; processedAt: string; hash: string; updatedAt: string }) {
    const sanitizedSubDir = subDir.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const targetDir = path.resolve(process.cwd(), this.vectorRoot, sanitizedSubDir);
    
    await fs.ensureDir(targetDir);
    
    const filePath = path.join(targetDir, `index.json`);
    await fs.writeJson(filePath, { metadata, chunks });
  }

  async deleteIndex(subDir: string) {
    // Calculate the same sanitized directory used during saving
    const sanitizedSubDir = subDir.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const targetDir = path.resolve(process.cwd(), this.vectorRoot, sanitizedSubDir);
    
    // Remove the entire directory associated with the source file
    await fs.remove(targetDir);
  }

  async getDocumentBundle(subDir: string) {
    const sanitizedSubDir = subDir.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const targetDir = path.resolve(process.cwd(), this.vectorRoot, sanitizedSubDir);
    const bundlePath = path.join(targetDir, 'index.json');
    if (await fs.pathExists(bundlePath)) {
      return await fs.readJson(bundlePath);
    }
    return null;
  }
}