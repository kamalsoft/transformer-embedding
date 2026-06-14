/**
 * Suppress noisy punycode deprecation warnings from sub-dependencies (Common in Node 21+)
 * to maintain a clean UI. This must be imported before any modules that might trigger the warning.
 */
const originalEmitWarning = process.emitWarning;

(process as any).emitWarning = (warning: any, ...args: any[]) => {
  if (typeof warning === 'string' && warning.includes('punycode')) return;
  if (warning instanceof Error && warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) return;
  return originalEmitWarning.call(process, warning, ...args);
};