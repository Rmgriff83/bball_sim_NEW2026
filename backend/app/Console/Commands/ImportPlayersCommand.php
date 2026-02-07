<?php

namespace App\Console\Commands;

use App\Services\PlayerImportService;
use Illuminate\Console\Command;

class ImportPlayersCommand extends Command
{
    protected $signature = 'players:import
                            {--all-players= : Path to CSV with all NBA player ratings/badges/attributes}
                            {--current-players= : Path to CSV with current NBA players and their teams}
                            {--campaign=1 : Campaign ID to import players into}
                            {--dry-run : Preview import without saving to database}';

    protected $description = 'Import NBA players from CSV files with humorous name transformations';

    public function handle(PlayerImportService $importService): int
    {
        $allPlayersPath = $this->option('all-players');
        $currentPlayersPath = $this->option('current-players');
        $campaignId = (int) $this->option('campaign');
        $dryRun = $this->option('dry-run');

        // Validate required options
        if (!$allPlayersPath || !$currentPlayersPath) {
            $this->error('Both --all-players and --current-players options are required.');
            $this->line('');
            $this->line('Usage:');
            $this->line('  php artisan players:import \\');
            $this->line('    --all-players=/path/to/all_nba_players.csv \\');
            $this->line('    --current-players=/path/to/current_nba_players.csv \\');
            $this->line('    --campaign=1 \\');
            $this->line('    --dry-run');
            return Command::FAILURE;
        }

        // Validate file paths
        if (!file_exists($allPlayersPath)) {
            $this->error("All players CSV not found: {$allPlayersPath}");
            return Command::FAILURE;
        }

        if (!file_exists($currentPlayersPath)) {
            $this->error("Current players CSV not found: {$currentPlayersPath}");
            return Command::FAILURE;
        }

        $this->info($dryRun ? '=== PLAYER IMPORT DRY-RUN ===' : '=== PLAYER IMPORT ===');
        $this->line('');

        try {
            $result = $importService->import(
                allPlayersPath: $allPlayersPath,
                currentPlayersPath: $currentPlayersPath,
                campaignId: $campaignId,
                dryRun: $dryRun,
                output: $this
            );

            $this->line('');

            if ($dryRun) {
                $this->info("Dry-run complete. {$result['matched_count']} players would be imported.");
                $this->line('Run without --dry-run to execute import.');
            } else {
                $this->info("Import complete! {$result['imported_count']} players imported.");
            }

            return Command::SUCCESS;

        } catch (\Exception $e) {
            $this->error('Import failed: ' . $e->getMessage());
            if ($this->getOutput()->isVerbose()) {
                $this->error($e->getTraceAsString());
            }
            return Command::FAILURE;
        }
    }
}
