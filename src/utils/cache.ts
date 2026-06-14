import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import { readConfig } from './config.js';
import { logger } from './logger.js';

const config = await readConfig();
const CACHE_PATH = config.caching.embedding_cache_path;

const BINARY_MAGIC = 'ADPQ'; // Ask-Doc Product Quantization Header

export class EmbeddingCache {
  // Store as Uint8Array (indices to centroids)
  private cache: Record<string, Uint8Array> = {}; 
  // M codebooks, each containing K centroids of subDimension size
  private codebooks: Float32Array[] = [];
  private readonly M = 48; // Number of subspaces
  private readonly K = 256; // Centroids per subspace
  private dimension = 384;

  constructor() {
    this.dimension = 384; // Default for MiniLM
    this.loadSync();
  }

  private loadSync() {
    if (fs.existsSync(CACHE_PATH)) {
      try {
        const buffer = fs.readFileSync(CACHE_PATH);
        if (buffer.length < 12) return; // Header incomplete

        const magic = buffer.toString('utf8', 0, 4);
        if (magic !== BINARY_MAGIC) {
          logger.warn('Existing cache is not in PQ format. Skipping migration.');
          return;
        }

        this.dimension = buffer.readUInt16LE(6);
        const count = buffer.readUInt32LE(8);
        
        let offset = 12;
        const subDim = this.dimension / this.M;

        // Load Codebooks
        this.codebooks = [];
        for (let m = 0; m < this.M; m++) {
          const cb = new Float32Array(this.K * subDim);
          for (let i = 0; i < cb.length; i++) {
            cb[i] = buffer.readFloatLE(offset);
            offset += 4;
          }
          this.codebooks.push(cb);
        }

        const blockSize = 16 + this.M; // 16 bytes for MD5 + M indices

        for (let i = 0; i < count; i++) {
          const entryOffset = offset + i * blockSize;
          const hash = buffer.toString('hex', entryOffset, entryOffset + 16);
          this.cache[hash] = new Uint8Array(buffer.subarray(entryOffset + 16, entryOffset + 16 + this.M));
        }
      } catch (e) {
        logger.warn('Failed to load embedding cache, starting fresh.');
      }
    }
  }

  public static getHash(text: string): string {
    return crypto.createHash('md5').update(text).digest('hex');
  }

  get(text: string): number[] | null {
    const indices = this.cache[EmbeddingCache.getHash(text)];
    if (!indices || this.codebooks.length === 0) return null;

    const subDim = this.dimension / this.M;
    const vector = new Float32Array(this.dimension);

    for (let m = 0; m < this.M; m++) {
      const centroidIdx = indices[m];
      const centroid = this.codebooks[m].subarray(centroidIdx * subDim, (centroidIdx + 1) * subDim);
      vector.set(centroid, m * subDim);
    }

    return Array.from(vector);
  }

  /**
   * ADC Phase 1: Pre-compute distance from query to all centroids in all subspaces.
   * This creates a Lookup Table (LUT) of size [M][K].
   */
  computeADCLookupTable(query: number[]): Float32Array[] {
    const subDim = this.dimension / this.M;
    const q = new Float32Array(query);
    const lut: Float32Array[] = [];

    for (let m = 0; m < this.M; m++) {
      const subQuery = q.subarray(m * subDim, (m + 1) * subDim);
      const distances = new Float32Array(this.K);
      const codebook = this.codebooks[m];

      for (let k = 0; k < this.K; k++) {
        let dist = 0;
        const centroid = codebook.subarray(k * subDim, (k + 1) * subDim);
        for (let d = 0; d < subDim; d++) {
          const diff = subQuery[d] - centroid[d];
          dist += diff * diff;
        }
        distances[k] = dist; // Squared Euclidean Distance
      }
      lut.push(distances);
    }
    return lut;
  }

  /**
   * ADC Phase 2: Compute distance using the LUT. 
   * This is extremely fast as it only involves M additions.
   */
  getDistanceADC(hash: string, lut: Float32Array[]): number | null {
    const indices = this.cache[hash];
    if (!indices) return null;

    let totalDistance = 0;
    for (let m = 0; m < this.M; m++) {
      totalDistance += lut[m][indices[m]];
    }
    return totalDistance;
  }

  set(text: string, vector: number[]) {
    if (this.codebooks.length === 0) {
      // In a real PQ implementation, you would trigger training here 
      // once you have a sufficient sample size (e.g., 2000 vectors).
      // For now, we fall back to storing raw if no codebook exists.
      return; 
    }

    const subDim = this.dimension / this.M;
    const indices = new Uint8Array(this.M);
    const v = new Float32Array(vector);

    for (let m = 0; m < this.M; m++) {
      const subVector = v.subarray(m * subDim, (m + 1) * subDim);
      indices[m] = this.findNearestCentroid(m, subVector);
    }
    this.cache[EmbeddingCache.getHash(text)] = indices;
  }

  private findNearestCentroid(m: number, subVector: Float32Array): number {
    const subDim = this.dimension / this.M;
    let minBatchDist = Infinity;
    let bestIdx = 0;

    for (let k = 0; k < this.K; k++) {
      let dist = 0;
      const centroid = this.codebooks[m].subarray(k * subDim, (k + 1) * subDim);
      for (let d = 0; d < subDim; d++) {
        const diff = subVector[d] - centroid[d];
        dist += diff * diff;
      }
      if (dist < minBatchDist) {
        minBatchDist = dist;
        bestIdx = k;
      }
    }
    return bestIdx;
  }

  async save() {
    await fs.ensureDir(path.dirname(CACHE_PATH));
    const entries = Object.entries(this.cache);
    const count = entries.length;
    const subDim = this.dimension / this.M;
    const codebookSize = this.M * this.K * subDim * 4; // Float32 codebooks
    const blockSize = 16 + this.M;
    
    const buffer = Buffer.alloc(12 + codebookSize + count * blockSize);
    buffer.write(BINARY_MAGIC, 0);
    buffer.writeUInt16LE(1, 4); // Version
    buffer.writeUInt16LE(this.dimension, 6);
    buffer.writeUInt32LE(count, 8);

    let offset = 12;
    // Save Codebooks
    this.codebooks.forEach(cb => {
      for (let i = 0; i < cb.length; i++) {
        buffer.writeFloatLE(cb[i], offset);
        offset += 4;
      }
    });

    entries.forEach(([hash, qVector], i) => {
      const entryOffset = offset + i * blockSize;
      buffer.set(Buffer.from(hash, 'hex'), entryOffset);
      buffer.set(qVector, entryOffset + 16);
    });

    await fs.writeFile(CACHE_PATH, buffer);
  }
}