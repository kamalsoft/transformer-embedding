import pino from 'pino';
import fs from 'fs-extra';
import path from 'path';
import { readConfig } from './config.js';

const config = await readConfig();
const logDir = path.dirname(config.logging.file_path);
fs.ensureDirSync(logDir);

const transport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: { destination: config.logging.file_path, mkdir: true },
      level: config.logging.level
    },
    {
      target: 'pino-pretty',
      options: { colorize: true },
      level: 'info'
    }
  ]
});

export const logger = pino(transport);