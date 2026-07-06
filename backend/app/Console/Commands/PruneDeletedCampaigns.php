<?php

namespace App\Console\Commands;

use App\Models\Campaign;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Hard-delete campaigns that were soft-deleted more than 30 days ago,
 * including their S3 part files. SyncController::deleteCampaign only
 * tombstones the row (keeping storage) so accidental deletions stay
 * recoverable; this command is the eventual cleanup.
 */
class PruneDeletedCampaigns extends Command
{
    protected $signature = 'campaigns:prune-deleted {--days=30 : Grace period in days before hard deletion}';

    protected $description = 'Permanently remove campaigns soft-deleted longer than the grace period (row + S3 files)';

    public function handle(): int
    {
        $days = (int) $this->option('days');
        $cutoff = now()->subDays($days);

        $stale = Campaign::onlyTrashed()
            ->where('deleted_at', '<', $cutoff)
            ->get();

        if ($stale->isEmpty()) {
            $this->info('No soft-deleted campaigns past the grace period.');
            return self::SUCCESS;
        }

        foreach ($stale as $campaign) {
            try {
                if ($campaign->client_id) {
                    Storage::deleteDirectory("campaigns/{$campaign->client_id}");
                }
                $campaign->forceDelete();
                Log::info("Pruned soft-deleted campaign: user={$campaign->user_id} campaign={$campaign->client_id} deleted_at={$campaign->deleted_at}");
                $this->line("Pruned campaign {$campaign->client_id} (user {$campaign->user_id})");
            } catch (\Exception $e) {
                Log::error("Failed to prune campaign {$campaign->client_id}: " . $e->getMessage());
                $this->error("Failed to prune {$campaign->client_id}: {$e->getMessage()}");
            }
        }

        $this->info("Pruned {$stale->count()} campaign(s).");
        return self::SUCCESS;
    }
}
