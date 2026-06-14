import ort from 'onnxruntime-node';
import chalk from 'chalk';

async function checkHardware() {
  console.log(chalk.cyan('\n--- Hardware Acceleration Diagnostic ---\n'));

  try {
    // Get available providers from the ONNX Runtime
    const providers = (ort as any).getAvailableProviders 
      ? (ort as any).getAvailableProviders() 
      : ['cpu'];

    console.log(chalk.white('Available ONNX Providers:'));
    providers.forEach((p: string) => {
      let color = chalk.yellow;
      if (p === 'cuda' || p === 'coreml' || p === 'dml') color = chalk.green;
      console.log(` - ${color(p)}`);
    });

    console.log(chalk.white('\nWhat to look for:'));
    console.log(`${chalk.green('coreml')}  : Supported on Mac (Apple Silicon)`);
    console.log(`${chalk.green('cuda')}    : Supported on Linux/Windows with NVIDIA GPUs`);
    console.log(`${chalk.green('dml')}     : Supported on Windows (DirectML) for AMD/Intel/NVIDIA`);
    console.log(`${chalk.yellow('cpu')}     : Fallback (Standard)`);

    console.log(chalk.cyan('\n----------------------------------------\n'));
  } catch (error: any) {
    console.error(chalk.red(`Diagnostic failed: ${error.message}`));
  }
}

checkHardware();