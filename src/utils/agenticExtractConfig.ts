import fs from 'fs-extra';
import path from 'path';

/**
 * Isolated configuration for the agentic extraction pipeline.
 * Reads from VECTOR_SOURCE_PATH env variable, defaults to './vector-source'.
 */
export const getTargetSourcePath = (): string => {
  return process.env.VECTOR_SOURCE_PATH || path.resolve(process.cwd(), 'vector-source');
};

/**
 * Startup utility that safely checks for and recursively creates
 * the vector-source directory if it does not exist.
 */
export const initializeTargetSource = async (): Promise<void> => {
  const targetPath = getTargetSourcePath();
  try {
    await fs.ensureDir(targetPath);
  } catch (error) {
    console.error(`[AgenticExtract] Failed to initialize target source directory:`, error);
  }
};
