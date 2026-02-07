<?php

namespace App\Console\Commands;

use App\Services\PlayerMasterBuilder;
use Illuminate\Console\Command;

class BuildPlayersMasterCommand extends Command
{
    protected $signature = 'players:build-master
                            {--input= : Path to base_player_data.csv}
                            {--output= : Output path for players_master.js}
                            {--dry-run : Preview without writing file}';

    protected $description = 'Build the players_master.js file from base_player_data.csv';

    public function handle(PlayerMasterBuilder $builder): int
    {
        $inputPath = $this->option('input');
        $outputPath = $this->option('output') ?: resource_path('data/players_master.js');
        $dryRun = $this->option('dry-run');

        // Validate required option
        if (!$inputPath) {
            $this->error('Input CSV path is required.');
            $this->line('');
            $this->line('Usage:');
            $this->line('  php artisan players:build-master \\');
            $this->line('    --input=player_data/base_player_data.csv \\');
            $this->line('    --dry-run');
            return Command::FAILURE;
        }

        // Resolve path - if relative, make relative to project root (parent of backend)
        $projectRoot = dirname(base_path()); // Goes up from backend to bball_sim
        if (!str_starts_with($inputPath, '/')) {
            $inputPath = $projectRoot . '/' . $inputPath;
        }

        // Validate file exists
        if (!file_exists($inputPath)) {
            $this->error("Input CSV not found: {$inputPath}");
            return Command::FAILURE;
        }

        $this->info($dryRun ? '=== PLAYERS MASTER BUILD (DRY-RUN) ===' : '=== PLAYERS MASTER BUILD ===');
        $this->line('');

        try {
            $result = $builder->build(
                inputPath: $inputPath,
                outputPath: $outputPath,
                dryRun: $dryRun,
                output: $this
            );

            $this->line('');

            if ($dryRun) {
                $this->info("Dry-run complete. {$result['total_players']} players would be generated.");
                $this->line("  - With full ratings: {$result['with_ratings']}");
                $this->line("  - With inferred ratings: {$result['inferred_ratings']}");
                $this->line('');
                $this->line("Would write to: {$outputPath}");
                $this->line('Run without --dry-run to generate file.');
            } else {
                $this->info("Build complete! {$result['total_players']} players written to:");
                $this->line("  {$outputPath}");
            }

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $this->error('Build failed: ' . $e->getMessage());
            if ($this->getOutput()->isVerbose()) {
                $this->error($e->getTraceAsString());
            }
            return Command::FAILURE;
        }
    }
}
