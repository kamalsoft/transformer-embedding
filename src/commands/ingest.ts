import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { walkDirectory } from '../utils/fileWalker.js';
import { LanceDbService } from '../services/storage/lanceDbService.js';
import { BM25Service } from '../services/bm25.js';
import fs from 'fs-extra';
import { readConfig } from '../utils/config.js';
import { performance } from 'perf_hooks';
import chokidar from 'chokidar';
import crypto from 'crypto';
import os from 'os';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import ort from 'onnxruntime-node';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import Table from 'cli-table3';
import Tesseract from 'tesseract.js';
import si from 'systeminformation';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { AppError, ValidationError, EmbeddingError } from '../utils/errors.js';
import { EmbeddingCache } from '../utils/cache.js';

/**
 * Helper for retrying async operations with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
  onRetry?: (attempt: number, error: any) => void
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      
      // Check if error is non-retryable
      if (err instanceof EmbeddingError && !err.isRetryable) {
        throw err;
      }

      if (onRetry && i < retries - 1) onRetry(i + 1, err);
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, delay * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

/**
 * Calculates file hash using a stream to avoid loading large files into RAM
 */
async function getFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Helper to extract text from different file formats.
 */
const extractText = async (filePath: string, buffer: Buffer, spinner: any): Promise<string> => {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // Handle library interop for ESM/CJS
  const pdfParser = (pdf as any).default || pdf;
  const mammothParser = (mammoth as any).default || mammoth;

  switch (ext) {
    case '.md':
    case '.txt':
      return buffer.toString('utf-8');
    case '.pdf':
      try {
        const data = await pdfParser(buffer);
        return data.text || "";
      } catch (error: any) {
        spinner.warn(chalk.yellow(`Failed to extract text from PDF ${path.basename(filePath)}: ${error.message}`)).start();
        return "";
      }
    case '.docx':
      try {
        const result = await mammothParser.extractRawText({ buffer });
        return result.value || "";
      } catch (error: any) {
        spinner.warn(chalk.yellow(`Failed to extract text from DOCX ${path.basename(filePath)}: ${error.message}`)).start();
        return "";
      }
    case '.png':
    case '.jpg':
    case '.jpeg':
      try {
        const { data: { text } } = await Tesseract.recognize(buffer, 'eng', {
          logger: m => {
            if (m.status === 'recognizing text') {
              spinner.text = `OCR in progress for ${chalk.cyan(fileName)}: ${Math.round(m.progress * 100)}%`;
            }
          }
        });
        return text || "";
      } catch (error: any) {
        spinner.warn(chalk.yellow(`OCR failed for ${fileName}: ${error.message}`)).start();
        return "";
      }
    case '.csv':
      // Assuming parseCsv is imported or defined elsewhere
      // For now, a simple buffer.toString() for CSV, a dedicated parser would be better
      return buffer.toString('utf-8');
    case '.xlsx':
      // XLSX parsing is complex and usually requires a library like 'xlsx'
      // For now, return empty string or a placeholder
      spinner.warn(chalk.yellow(`XLSX parsing not fully implemented for ${fileName}. Returning empty content.`)).start();
      return "";
    case '.mermaid':
    case '.puml':
      // Mermaid and PlantUML are text based; we wrap them in context for the embedder
      return `This is a diagram description in ${ext.substring(1)} format:\n${buffer.toString('utf-8')}`;
    default:
      // Fallback for unknown extensions, treat as plain text
      // Or, if strict, throw an error
      spinner.warn(chalk.yellow(`Unknown file type for ${fileName}. Attempting to read as plain text.`)).start();
      return buffer.toString('utf-8');
  }
};

export function registerIngestCommand(program: Command) {
  program
    .command('ingest')
    .description('Ingest documents from a path')
    .option('--filetype <type>', 'File extension to filter (e.g., .md)')
    .option('--path <folder_path>', 'Path to the directory to scan')
    .option('--force', 'Force regeneration of embeddings (clears existing vector store)')
    .option('--watch', 'Watch the source directory for changes and automatically ingest')
    .option('--concurrency <number>', 'Number of files to process in parallel')
    .option('--dry-run', 'Estimate chunks and data size without generating embeddings')
    .action(async (options) => {
      const spinner = ora('Initializing ingestion...').start();
      
      const isDryRun = !!options.dryRun;
      if (isDryRun) {
        spinner.info(chalk.magenta('Dry Run Mode: No embeddings will be generated or stored.')).start();
      }

      const config = await readConfig();
      const ingestionCfg = config.ingestion[0];

      // Security: Strict Input Validation using Zod
      const IngestOptionsSchema = z.object({
        path: z.string().optional().refine(p => !p || !p.includes('..'), {
          message: "Directory traversal (..) is strictly prohibited for security reasons."
        }),
        filetype: z.string().optional(),
        concurrency: z.string().optional().transform(v => v ? parseInt(v) : undefined)
      });

      const validated = IngestOptionsSchema.safeParse(options);
      if (!validated.success) {
        spinner.stop();
        throw new ValidationError(validated.error.errors[0].message);
      }

      const embeddingCache = config.caching.enabled ? new EmbeddingCache() : null;
      const maxChunksPerMin = config.security.max_chunks_per_minute || 60;
      const telemetryPath = path.resolve(process.cwd(), '.telemetry.log');
      await fs.remove(telemetryPath); // Reset telemetry at start

      const dynamicEnabled = config.security.dynamic_throttling_enabled || false;
      const targetLoad = config.security.target_cpu_load || 80;
      const maxTemp = config.security.max_cpu_temp || 75;

      let dynamicDelay = 0;
      let systemTelemetry = { load: 0, temp: 0 };

      const updateTelemetry = async () => {
        const load = await si.currentLoad();
        const temp = await si.cpuTemperature();
        systemTelemetry = {
          load: Math.round(load.currentLoad),
          temp: Math.round(temp.main || 0)
        };
        
        // Append to telemetry log for the dashboard
        await fs.appendFile(telemetryPath, JSON.stringify({
          t: Date.now(),
          l: systemTelemetry.load,
          tp: systemTelemetry.temp
        }) + '\n');
      };

      let chunksInCurrentWindow = 0;
      let windowStartTime = Date.now();

      // Warn users about non-LTS Node versions which are prone to native crashes
      if (process.version.startsWith('v25') || process.version.startsWith('v23')) {
        spinner.warn(chalk.yellow(
          `You are using Node ${process.version}. Non-LTS versions can be unstable with AI native modules. ` +
          `If you experience crashes, consider using Node v20 or v22 (LTS).`
        )).start();
      }

      // Determine optimal concurrency: 1 worker per 2GB of RAM, capped at 4 or CPU count
      const totalRamGb = os.totalmem() / (1024 ** 3);
      const ramSuggestedLimit = Math.max(1, Math.floor(totalRamGb / 2));
      const defaultConcurrency = Math.min(ramSuggestedLimit, os.cpus().length, 4);
      
      let concurrency = options.concurrency ? parseInt(options.concurrency) : defaultConcurrency;

      // Hard limit for experimental Node versions: Force single-concurrency to prevent HandleScope collisions
      if (process.version.startsWith('v25') || process.version.startsWith('v23')) {
        if (concurrency > 1) {
          spinner.info(chalk.blue(`Experimental Node detected: Overriding requested concurrency (${concurrency}) to 1 for stability.`)).start();
          concurrency = 1;
        }
      }

      const stats = {
        startTime: performance.now(),
        filesProcessed: 0,
        totalChunks: 0,
        totalEstimatedChunks: 0,
        totalBytes: 0,
        totalTokens: 0
      };
      
      const workers: Worker[] = [];
      const idleWorkers: Worker[] = [];
      const pendingPromises = new Map<number, { resolve: (val: { vector: number[], tokens: number }) => void; reject: (err: any) => void }>();
      const taskQueue: { id: number; text: string, task?: 'embed' | 'tokenize' }[] = [];
      const workerTasks = new Map<Worker, number>();
      let taskIdCounter = 0;
      let etaLoggerInterval: NodeJS.Timeout | null = null;
      let isShuttingDown = false;

      const processQueue = () => {
        while (taskQueue.length > 0 && idleWorkers.length > 0) {
          const task = taskQueue.shift()!;
          const worker = idleWorkers.shift()!;
          workerTasks.set(worker, task.id);
          worker.postMessage(task);
        }
      };

      try {
        // Validation: chunk_overlap must be less than chunk_size to ensure forward progress in chunking
        if (ingestionCfg.chunk_overlap >= ingestionCfg.chunk_size) {
          throw new Error(`Configuration Error: chunk_overlap (${ingestionCfg.chunk_overlap}) must be less than chunk_size (${ingestionCfg.chunk_size})`);
        }

        // Global file size limit (default 50MB) to prevent OOM crashes on massive files
        const MAX_FILE_SIZE = (ingestionCfg.max_file_size_mb || 50) * 1024 * 1024;
        
        const rawPath = options.path || ingestionCfg.source_path;
        if (!rawPath) {
          throw new Error('No ingestion path provided. Set "source_path" in config.json or use --path.');
        }

        const ingestPath = path.resolve(process.cwd(), rawPath);
        if (!(await fs.pathExists(ingestPath))) {
          throw new Error(`Ingestion path does not exist: ${ingestPath}`);
        }

        const pathStat = await fs.stat(ingestPath);
        if (!pathStat.isDirectory()) {
          throw new Error(`Ingestion path is not a directory: ${ingestPath}`);
        }

        // Normalize extensions to lowercase for robust matching
        const extensions = (options.filetype ? [options.filetype] : (ingestionCfg.supported_extensions || ['.md']))
          .map((ext: string) => ext.toLowerCase());

        const files = await walkDirectory(ingestPath, extensions);

        if (files.length === 0) {
          throw new Error(`No files matching extensions [${extensions.join(', ')}] found in ${ingestPath}`);
        }

        // Step 1: Estimate total chunks for accurate ETA
        spinner.text = `Estimating total chunks across ${files.length} files...`;
        for (const filePath of files) {
          const fileStats = await fs.stat(filePath);
          if (fileStats.size > MAX_FILE_SIZE) {
            // Skip large files from chunk estimation as they will be skipped during ingestion
            continue;
          }
          const buffer = await fs.readFile(filePath); // Read file once
          const content = await extractText(filePath, buffer, spinner); // Pass spinner for OCR progress
          if (content && content.trim().length > 0) {
            const estimatedChunks = chunkText(
              content, ingestionCfg.chunk_size, ingestionCfg.chunk_overlap, ingestionCfg.min_chunk_size || 50
            );
            stats.totalEstimatedChunks += estimatedChunks.length; // Correctly update the outer stats object
          }
        }
        spinner.succeed(chalk.green(`Estimated ${stats.totalEstimatedChunks} total chunks.`)).start();


        spinner.text = `Found ${files.length} files. Starting processing...`;

        const vectorRoot = config.storage.find((s: any) => s.classification === 'vector_store_root')?.path || './vector-store';
        const vectorStoreType = config.storage.find((s: any) => s.classification === 'vector_store_type')?.value || 'lancedb';
        if (options.force) {
          const targetDir = path.resolve(process.cwd(), vectorRoot);
          spinner.text = 'Force flag detected. Clearing existing vector store...';
          await fs.emptyDir(targetDir);
        }

        const activeModel = config.models.find((m: any) => m.active);
        if (!activeModel) {
          throw new Error('No active model found in configuration. Please check your config.json and ensure a model is marked as active.');
        }

        // Resolve the model path to an absolute path to ensure workers can find the files
        const modelWithResolvedPath = {
          ...activeModel,
          path: activeModel.local_path ? path.resolve(process.cwd(), activeModel.local_path) : undefined
        };

        // Verification step: Check if tokenizer.json exists at the resolved path
        if (modelWithResolvedPath.path) {
          const tokenizerJsonPath = path.join(modelWithResolvedPath.path, 'tokenizer.json');
          if (!(await fs.pathExists(tokenizerJsonPath))) {
            throw new Error(`Model assets missing: tokenizer.json not found at ${modelWithResolvedPath.path}. Please run 'npm run download-models' to fetch required files.`);
          }
        }
        
        let preferredProvider = 'cpu';
        let availableProviders: string[] = ['cpu'];

        if (!isDryRun) {
          // Detect best available hardware provider
          availableProviders = (ort as any).getAvailableProviders 
            ? (ort as any).getAvailableProviders() 
            : ['cpu'];
          preferredProvider = 
            availableProviders.includes('cuda') ? 'cuda' : 
            availableProviders.includes('coreml') ? 'coreml' : 
            availableProviders.includes('dml') ? 'dml' : 'cpu';

          spinner.info(
            chalk.blue(`Hardware Acceleration: Using ${chalk.bold(preferredProvider)} (Available: ${availableProviders.join(', ')})`)
          ).start();
        }

        const workerUrl = new URL('./embedding.worker.js', import.meta.url);
        const workerPath = fileURLToPath(workerUrl);
        if (!(await fs.pathExists(workerPath))) {
          throw new Error(`Worker script not found at ${workerPath}. Ensure the project is compiled and the file exists.`);
        }

        const spawnWorker = async (stagger = false) => {
          if (stagger) await new Promise(res => setTimeout(res, 1200));

          const worker = new Worker(workerUrl, {
            workerData: { modelConfig: modelWithResolvedPath, preferredProvider }
          });

          worker.on('message', (msg) => {
            workerTasks.delete(worker);
            const promise = pendingPromises.get(msg.id);
            if (promise) {
              pendingPromises.delete(msg.id);
              if (msg.status === 'success') {
                promise.resolve({ vector: msg.vector, tokens: msg.tokens });
              } else {
                promise.reject(new EmbeddingError(msg.error, msg.isRetryable ?? true));
              }
            }
            idleWorkers.push(worker);
            processQueue();
          });

        worker.stderr.on('data', (data) => {
          const msg = data.toString();
          logger.error({ workerId: worker.threadId }, `Worker Stderr: ${msg}`);
        });

          worker.on('error', (err) => {
          logger.error(err, 'Worker thread encountered a fatal error');
          });

          worker.on('exit', (code) => {
            const currentTaskId = workerTasks.get(worker);
            const wIdx = workers.indexOf(worker);
            if (wIdx > -1) workers.splice(wIdx, 1);
            const iIdx = idleWorkers.indexOf(worker);
            if (iIdx > -1) idleWorkers.splice(iIdx, 1);
            workerTasks.delete(worker);

            if (code !== 0) {
              const errorMsg = `Worker thread exited unexpectedly with code ${code}`;
              spinner.warn(chalk.yellow(errorMsg));

              // Fail the specific task the worker was processing
              if (currentTaskId !== undefined) {
                const promise = pendingPromises.get(currentTaskId);
                if (promise) {
                  promise.reject(new EmbeddingError(`Task failed due to worker crash: ${errorMsg}`, false));
                  pendingPromises.delete(currentTaskId);
                }
              }
              
              // Automatic restart: maintain pool size for future tasks
              if (!isDryRun && !isShuttingDown) {
                spinner.info(chalk.blue('Restarting crashed worker...')).start();
                spawnWorker(true);
              }
            }
          });

          workers.push(worker);
          idleWorkers.push(worker);
          processQueue();
        };

        for (let i = 0; i < concurrency; i++) {
          await spawnWorker(i > 0);
        }

        const offloadedTask = (text: string, task: 'embed' | 'tokenize' = 'embed') => {
          return new Promise<{ vector: number[], tokens: number }>((resolve, reject) => {
            const id = taskIdCounter++;
            pendingPromises.set(id, { resolve, reject });
            taskQueue.push({ id, text, task });
            processQueue();
          });
        };

        const lanceDbService: LanceDbService = new LanceDbService(vectorRoot);
        const bm25Service = new BM25Service();

        const processFile = async (filePath: string, content: string, fileHash: string, spinner: any, isDryRun: boolean) => {
          const fileName = path.basename(filePath);
          let fileTokens = 0;
          const chunks = chunkText(
            content, 
            ingestionCfg.chunk_size, 
            ingestionCfg.chunk_overlap, 
            ingestionCfg.min_chunk_size || 50
          );
          const bundle: any[] = [];

          for (let i = 0; i < chunks.length; i++) {
            // Token-Bucket Throttling to protect CPU
            chunksInCurrentWindow++;
            
            // Update telemetry every 5 chunks to avoid overhead
            if (i % 5 === 0) await updateTelemetry();

            // Dynamic Throttling Logic
            if (dynamicEnabled) {
              if (systemTelemetry.load > targetLoad || (systemTelemetry.temp > maxTemp && systemTelemetry.temp > 0)) {
                // System is hot or overloaded: Increase delay
                dynamicDelay = Math.min(2000, dynamicDelay + 200);
              } else {
                // System is cool: Gradually reduce delay to increase speed
                dynamicDelay = Math.max(0, dynamicDelay - 50);
              }
            }

            if (dynamicDelay > 0) {
              await new Promise(r => setTimeout(r, dynamicDelay));
            }

            if (maxChunksPerMin > 0 && chunksInCurrentWindow >= maxChunksPerMin) {
              const elapsed = Date.now() - windowStartTime;
              if (elapsed < 60000) {
                const wait = 60000 - elapsed;
                const originalText = spinner.text;
                spinner.text = chalk.yellow(
                  `❄️  Cooldown: ${maxChunksPerMin} chunks limit reached. ` +
                  `[Load: ${systemTelemetry.load}% | Temp: ${systemTelemetry.temp}°C] ` +
                  `Resuming in ${Math.ceil(wait/1000)}s...`
                );
                await new Promise(r => setTimeout(r, wait));
                spinner.text = originalText;
              }
              chunksInCurrentWindow = 0;
              windowStartTime = Date.now();
            }

            const progress = Math.round(((i + 1) / chunks.length) * 100);
            const bar = '█'.repeat(Math.floor(progress / 10)) + '░'.repeat(10 - Math.floor(progress / 10));
            
            const telemetryLabel = ` | Load: ${chalk.yellow(systemTelemetry.load + '%')} Temp: ${chalk.red(systemTelemetry.temp + '°C')}`;

            // Only update detailed progress if we aren't processing many files at once to avoid flickering
            if (concurrency === 1 || isDryRun) { // Also show detailed progress in dry run
              spinner.text = `Embedding ${chalk.cyan(fileName)}: ${bar} ${progress}% (Chunk ${i + 1}/${chunks.length}) | Global Chunks: ${stats.totalChunks + 1}${telemetryLabel}`;
            }

            const chunk = chunks[i];
            const chunkHash = EmbeddingCache.getHash(chunk);
            let vector: number[] = [];

            // Caching Layer Check
            const cachedVector = embeddingCache?.get(chunk);
            if (cachedVector && !isDryRun) {
              vector = cachedVector;
              fileTokens += 0; // Cached tokens aren't re-processed
            } else {
            const result = await withRetry<{ vector: number[], tokens: number }>(
              () => offloadedTask(chunk, isDryRun ? 'tokenize' : 'embed'),
              3,
              1000,
              (attempt, err) => {
                if (concurrency === 1) {
                  spinner.text = `Retrying ${chalk.cyan(fileName)} (Attempt ${attempt}): ${err.message}`;
                }
              }
            );

            vector = result.vector; // Vector will be empty in dry run
            fileTokens += result.tokens;
              if (embeddingCache && !isDryRun) embeddingCache.set(chunk, vector);
            }

            if (!isDryRun) {
              bm25Service.addDocument(chunk, filePath);
            }
            stats.totalChunks++;

            bundle.push({ // Each chunk will have its own metadata
              id: `chunk-${i}`,
              text: chunk,
              vector,
              metadata: { 
                source: filePath, 
                chunkIndex: i,
                fileChecksum: fileHash,
                chunkHash
              }
            });
          }
          return { bundle, fileTokens };
        };

        const ingestSingleFile = async (filePath: string, isForce: boolean, currentSpinner: any, isDryRun: boolean) => {
          // Create a unique ID based on relative path to prevent filename collisions
          const docId = path.relative(ingestPath, filePath).replace(/[\\/]/g, '_');
          
          const fileStats = await fs.stat(filePath);
          const fileSize = fileStats.size;

          if (fileSize > MAX_FILE_SIZE) {
            spinner.warn(chalk.yellow(`Skipping ${path.basename(filePath)}: File size (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds limit.`)).start();
            return { skipped: true, numChunks: 0, hash: 'TOO_LARGE', size: fileSize, tokens: 0 };
          }

          const fileHash = await getFileHash(filePath);

          if (!isForce) {
            if (vectorStoreType === 'lancedb') {
              if (await lanceDbService.isFileUnchanged(filePath, fileHash)) {
                return { skipped: true, numChunks: 0, hash: fileHash, size: fileSize, tokens: 0 };
              }
            } else {
              const indexPath = path.join(vectorRoot, docId, 'index.json');
              if (await fs.pathExists(indexPath)) {
                const existingData = await fs.readJson(indexPath);
                if (existingData.metadata?.hash === fileHash) {
                  return { skipped: true, numChunks: 0, hash: fileHash, size: fileSize, tokens: 0 };
                }
              }
            }
          }

          const buffer = await fs.readFile(filePath);
          const content = await extractText(filePath, buffer, currentSpinner);
          
          if (!content || content.trim().length === 0) {
            return { skipped: false, numChunks: 0, hash: fileHash, size: fileSize, tokens: 0 };
          }

          const { bundle: generatedChunks, fileTokens } = await processFile(filePath, content, fileHash, currentSpinner, isDryRun);
          if (!isDryRun) {
            if (vectorStoreType === 'lancedb') {
              const chunksToStore = generatedChunks.map((chunk, i) => ({
                vector: chunk.vector,
                text: chunk.text,
                file_path: filePath,
                chunk_index: i,
                metadata: JSON.stringify({ ...chunk.metadata, hash: fileHash, processedAt: new Date().toISOString() })
              }));
              await lanceDbService.saveChunks(chunksToStore);
            } else {
              const outDir = path.join(vectorRoot, docId);
              await fs.ensureDir(outDir);
              await fs.writeJson(path.join(outDir, 'index.json'), {
                documentId: docId,
                metadata: {
                  source: filePath,
                  hash: fileHash,
                  processedAt: new Date().toISOString()
                },
                chunks: generatedChunks
              });
            }
          }
          return { skipped: false, numChunks: generatedChunks.length, hash: fileHash, size: fileSize, tokens: fileTokens };
        };

        // Parallel Processing Logic
        const queue = [...files];
        const totalFiles = files.length;
        let completed = 0;
        const fileSummary: any[] = [];

        const getRamUsage = () => (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
        const formatSize = (bytes: number) => {
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        const worker = async () => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (!file) break;

            const fileName = path.basename(file);
            const mem = getRamUsage();
            const currentProgress = ++completed;

            const elapsedTime = performance.now() - stats.startTime;
            const averageTimePerChunk = stats.totalChunks > 0 ? elapsedTime / stats.totalChunks : 0;
            const remainingChunks = stats.totalEstimatedChunks - stats.totalChunks;
            const estimatedTimeRemainingMs = averageTimePerChunk * remainingChunks;

            let etaString = '';
            if (estimatedTimeRemainingMs > 0 && stats.totalChunks > 0) {
                const totalSeconds = Math.floor(estimatedTimeRemainingMs / 1000);
                const hours = Math.floor(totalSeconds / 3600);
                const minutes = Math.floor((totalSeconds % 3600) / 60);
                const seconds = totalSeconds % 60;

                if (hours > 0) etaString = ` ETA: ${hours}h ${minutes}m ${seconds}s`;
                else if (minutes > 0) etaString = ` ETA: ${minutes}m ${seconds}s`;
                else etaString = ` ETA: ${seconds}s`;
            }

            spinner.text = `[${currentProgress}/${totalFiles}] Processing ${chalk.cyan(fileName)} (Global Chunks: ${stats.totalChunks}) (${mem} MB RAM)${etaString}...`;
            
            const fileStartTime = performance.now();
            const { skipped, numChunks, hash, size, tokens } = await ingestSingleFile(file, options.force, spinner, isDryRun);
            const duration = (performance.now() - fileStartTime).toFixed(0);

            if (!skipped) {
              stats.filesProcessed++;
              stats.totalBytes += size;
              stats.totalTokens += tokens;
            }

            fileSummary.push({
              name: fileName,
              status: skipped ? chalk.blue('Skipped') : chalk.green(isDryRun ? 'Estimated' : 'Success'),
              size: formatSize(size),
              chunks: numChunks,
              tokens: tokens,
              time: `${duration}ms`
            });
          }
        };

        // Launch workers
        await Promise.all(Array.from({ length: concurrency }, worker));

        // Step 5: Implement ETA logging
        etaLoggerInterval = setInterval(async () => {
          const elapsedTime = performance.now() - stats.startTime;
          const averageTimePerChunk = stats.totalChunks > 0 ? elapsedTime / stats.totalChunks : 0;
          const remainingChunks = stats.totalEstimatedChunks - stats.totalChunks;
          const estimatedTimeRemainingMs = averageTimePerChunk * remainingChunks;
          const progress = stats.totalEstimatedChunks > 0 ? (stats.totalChunks / stats.totalEstimatedChunks) * 100 : 0;

          await fs.appendFile(telemetryPath, JSON.stringify({
            t: Date.now(),
            eta: estimatedTimeRemainingMs / 1000, // Log in seconds
            progress: progress,
            chunksProcessed: stats.totalChunks,
            chunksTotal: stats.totalEstimatedChunks
          }) + '\n');
        }, 60000); // Log every minute

        if (embeddingCache) await embeddingCache.save();

        if (!options.watch || isDryRun) {
          isShuttingDown = true;
          await Promise.all(workers.map(w => w.terminate()));
        }

        const endTime = performance.now();
        const durationSeconds = ((endTime - stats.startTime) / 1000).toFixed(2);
        if (etaLoggerInterval) clearInterval(etaLoggerInterval); // Clear interval on completion

        spinner.succeed(chalk.green(`Ingestion complete!`));
        
        // Premium Summary Table
        const table = new Table({
          head: [chalk.cyan('File'), chalk.cyan('Status'), chalk.cyan('Size'), chalk.cyan('Chunks'), chalk.cyan('Tokens'), chalk.cyan('Time')],
          colWidths: [25, 12, 12, 10, 10, 12],
          wordWrap: true
        });

        fileSummary.forEach(f => table.push([f.name, f.status, f.size, f.chunks, f.tokens, f.time]));
        console.log(table.toString());

        const finalMem = getRamUsage();
        
        // High-end Dashboard Style Metrics
        console.log(chalk.bold.cyan(`\n 📊 ${isDryRun ? 'DRY RUN ESTIMATION' : 'INGESTION DASHBOARD'}`));
        console.log(chalk.gray(' ─────────────────────────────────────────'));
        const metrics = [
          ['Files Processed', stats.filesProcessed],
          ['Total Chunks', stats.totalChunks],
          ['Total Tokens', stats.totalTokens],
          ['Data Indexed', formatSize(stats.totalBytes)],
          ['Peak RAM', `${finalMem} MB`],
          ['Total Duration', `${durationSeconds}s`]
        ];

        metrics.forEach(([label, value]) => {
          console.log(` ${chalk.white(label.toString().padEnd(18))} ${chalk.yellow.bold(value)}`);
        });

        if (stats.totalChunks > 0) {
          const avgTime = ((endTime - stats.startTime) / stats.totalChunks).toFixed(1);
          const avgTokens = Math.round(stats.totalTokens / stats.totalChunks);
          console.log(` ${chalk.white('Avg. per Chunk'.padEnd(18))} ${chalk.green.bold(avgTime + 'ms')}`);
          console.log(` ${chalk.white('Avg. Tokens/Chunk'.padEnd(18))} ${chalk.green.bold(avgTokens)}`);
        }
        console.log(chalk.gray(' ─────────────────────────────────────────\n'));

        if (options.watch && !isDryRun) {
          console.log(chalk.blue(`Watching for changes in: ${ingestPath}...`));

          const watcher = chokidar.watch(ingestPath, {
            persistent: true,
            ignoreInitial: true, // Already processed in the loop above
            awaitWriteFinish: {
              stabilityThreshold: 500,
              pollInterval: 100
            }
          });

          watcher
            .on('add', async (filePath) => {
              const ext = path.extname(filePath);
              if (extensions.includes(ext.toLowerCase())) {
                const watchSpinner = ora(`New file detected: ${path.basename(filePath)}. Processing...`).start();
                const { skipped } = await ingestSingleFile(filePath, false, watchSpinner, isDryRun);
                if (!skipped) {
                  watchSpinner.succeed(chalk.green(`Ingested: ${path.basename(filePath)}`));
                } else {
                  watchSpinner.info(chalk.blue(`Unchanged: ${path.basename(filePath)}`));
                }
              }
            })
            .on('change', async (filePath) => {
              const watchSpinner = ora(`Change detected: ${path.basename(filePath)}. Updating...`).start();
              const { skipped } = await ingestSingleFile(filePath, false, watchSpinner, isDryRun);
              if (!skipped) {
                watchSpinner.succeed(chalk.green(`Updated: ${path.basename(filePath)}`));
              } else {
                watchSpinner.info(chalk.blue(`Unchanged: ${path.basename(filePath)}`));
              }
            })
            .on('unlink', async (filePath) => {
              const fileName = path.basename(filePath);
              const docId = path.relative(ingestPath, filePath).replace(/[\\/]/g, '_');
              const watchSpinner = ora(`File deleted: ${fileName}. Cleaning up vectors...`).start();
                    if (vectorStoreType === 'lancedb') {
                      await lanceDbService.deleteByFilePath(filePath);
                    } else {
                      await fs.remove(path.join(vectorRoot, docId));
                    }
              watchSpinner.succeed(chalk.yellow(`Removed vectors for: ${fileName}`));
            });
          
          // Keep the process alive and handle graceful shutdown
          return new Promise<void>(() => {
            const cleanup = async () => {
              isShuttingDown = true;
              if (spinner.isSpinning) spinner.stop();
              if (etaLoggerInterval) clearInterval(etaLoggerInterval);
              await watcher.close();
              await Promise.all(workers.map(w => w.terminate()));
              console.log(chalk.yellow('\nWatcher stopped. Exiting gracefully...'));
              process.exit(0);
            };

            // Use once to ensure subsequent signals force immediate exit if cleanup hangs
            process.once('SIGINT', cleanup);
            process.once('SIGTERM', cleanup);
          });
        }

      } catch (error: any) {
        spinner.fail(chalk.red(`Ingestion failed: ${error.message}`));
        if (etaLoggerInterval) clearInterval(etaLoggerInterval); // Clear interval on failure
        isShuttingDown = true;
        await Promise.all(workers.map(w => w.terminate()));
      }
    });
}

function chunkText(text: string, size: number, overlap: number, minSize: number = 50): string[] {
  // If text is already within size limits, return as a single chunk immediately
  if (text.length <= size) {
    const trimmed = text.trim();
    // Respect minimum size even for small files
    return trimmed.length >= minSize ? [trimmed] : [];
  }

  const separators = ["\n\n", "\n", " ", ""];
  let chunks: string[] = [text];

  for (const separator of separators) {
    const nextLevelChunks: string[] = [];
    let splitPerformed = false;

    for (const chunk of chunks) {
      if (chunk.length > size) {
        const parts = chunk.split(separator);
        let buffer = "";

        for (const part of parts) {
          const joiner = buffer ? separator : "";
          
          // Pack fragments together until they reach the target size
          if (buffer.length + joiner.length + part.length <= size) {
            buffer += joiner + part;
          } else {
            if (buffer) nextLevelChunks.push(buffer);
            
            // Implement overlap: start next chunk with trailing text from previous buffer
            const overlapText = overlap > 0 ? buffer.slice(-overlap) : "";
            // The new buffer starts with the overlapping context plus the current part
            buffer = overlapText + joiner + part;
          }
        }
        if (buffer) nextLevelChunks.push(buffer);
        splitPerformed = true;
      } else {
        nextLevelChunks.push(chunk);
      }
    }
    chunks = nextLevelChunks;
    // Break if we've successfully chunked everything below the size limit
    // Note: with overlap, chunks might slightly exceed 'size' at intermediate steps
    if (!splitPerformed || chunks.every(c => c.length <= size * 1.2)) break;
  }

  // Final pass: merge chunks that are below minimum size into their predecessors
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    if (trimmed.length < minSize && finalChunks.length > 0) {
      const lastIdx = finalChunks.length - 1;
      // Merge small leftover with the previous chunk to maintain semantic density
      finalChunks[lastIdx] = (finalChunks[lastIdx] + " " + trimmed).slice(0, size + overlap);
    } else {
      finalChunks.push(trimmed);
    }
  }

  return finalChunks;
}