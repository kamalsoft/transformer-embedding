import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import asciichart from 'asciichart';

export function registerDashboardCommand(program: Command) {
  program
    .command('dashboard')
    .description('View real-time CPU performance graph during ingestion')
    .action(async () => {
      const telemetryPath = path.resolve(process.cwd(), '.telemetry.log');

      console.clear();
      console.log(chalk.bold.cyan('📊 Ingestion Performance Dashboard'));
      console.log(chalk.gray('Press Ctrl+C to exit. Open another terminal and run "ingest".\n'));

      const render = async () => {
        if (!(await fs.pathExists(telemetryPath))) {
          process.stdout.write('\rWaiting for ingestion telemetry data...');
          return;
        }

        const raw = await fs.readFile(telemetryPath, 'utf-8');
        const lines = raw.trim().split('\n').filter(Boolean);
        
        let data;
        try {
          data = lines.map(l => JSON.parse(l));
        } catch (e) {
          return; // Skip this frame if file is being written
        }

        // Get last 60 data points
        const recent = data.slice(-60);
        const loadHistory = recent.map(d => d.l);
        const tempHistory = recent.map(d => d.tp);

        if (loadHistory.length < 2) return;

        process.stdout.write('\x1B[H\x1B[2J'); // Clear screen
        console.log(chalk.bold.cyan('📊 Ingestion Performance Dashboard'));
        console.log(chalk.gray(`Tracking last ${loadHistory.length} data points\n`));

        console.log(chalk.yellow('CPU Load (%)'));
        console.log(asciichart.plot(loadHistory, { height: 10, colors: [asciichart.yellow] }));
        
        console.log('\n' + chalk.red('CPU Temperature (°C)'));
        console.log(asciichart.plot(tempHistory, { height: 5, colors: [asciichart.red] }));

        const current = data[data.length - 1];
        console.log('\n' + chalk.gray('─────────────────────────────────────────'));
        console.log(`Current: Load: ${chalk.yellow(current.l + '%')} | Temp: ${chalk.red(current.tp + '°C')}`);
      };

      // Polling loop
      const interval = setInterval(render, 1000);

      process.on('SIGINT', () => {
        clearInterval(interval);
        process.exit(0);
      });

      await render();
    });
}