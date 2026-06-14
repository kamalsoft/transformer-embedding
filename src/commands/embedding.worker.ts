import { parentPort, workerData } from 'worker_threads';
import { env, AutoTokenizer } from '@huggingface/transformers';
import { EmbeddingService } from '../services/embedding.js';

// Stabilize native ONNX runtime in a multi-threaded environment.
// Disabling internal multi-threading prevents thread pool contention 
// and the 'HandleScope' errors/segmentation faults seen in Node.js workers.
env.backends.onnx.interOpNumThreads = 1;
env.backends.onnx.intraOpNumThreads = 1;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

// Disable telemetry and verbose logging which can sometimes interfere with N-API scopes
env.backends.onnx.logSeverityLevel = 4;

// Apply the hardware acceleration provider detected by the main thread
const { modelConfig, preferredProvider } = workerData;
if (preferredProvider) {
  env.backends.onnx.executionProviders = [preferredProvider];
}

let embeddingService: EmbeddingService | null = null;
let tokenizer: any = null;

parentPort?.on('message', async ({ id, text, task = 'embed' }) => {
  try {
    // Load tokenizer if not already loaded
    if (!tokenizer) {
      tokenizer = await AutoTokenizer.from_pretrained(modelConfig.path || modelConfig.id, {
        local_files_only: true
      });
    }

    // Calculate token count using the model's tokenizer
    const encoded = await tokenizer(text);
    const tokens = encoded.input_ids.data.length;

    let vector: number[] = [];

    // Lazy initialize to ensure initialization occurs within a task context
    if (task === 'embed') {
      if (!embeddingService) {
        embeddingService = new EmbeddingService(modelConfig);
      }
      vector = await embeddingService.generate(text);
    }

    // On experimental Node versions, a micro-delay allows the N-API 
    // handle scopes to settle before the worker signals completion back to the main thread.
    if (process.version.startsWith('v25') || process.version.startsWith('v23')) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    parentPort?.postMessage({ id, vector, tokens, status: 'success' });
  } catch (error: any) {
    // Determine if the error is retryable
    // Non-retryable: Model missing, invalid input types, or explicit environment errors
    const isRetryable = !(
      error.message.includes('not found') || 
      error.message.includes('invalid') ||
      error.message.includes('unsupported')
    );

    parentPort?.postMessage({ 
      id, 
      status: 'error', 
      error: error.message,
      isRetryable
    });
  }
});