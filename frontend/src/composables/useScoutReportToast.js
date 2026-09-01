// =============================================================================
// useScoutReportToast — the scout-milestone toast block shared by the Scouting
// page. When a prospect hits 100% scouted AND a scout is hired, shows the rich
// "scouting report" toast (scout headshot + generated synopsis via
// buildScoutSynopsis, factoring team direction + owner expectation + the
// optional Insider Intel perk). Every other milestone — badge-only reveals,
// no scout hired, or ANY failure building the rich context — falls back to
// the exact plain success toast this block replaced, so old saves and edge
// cases keep today's behavior byte-for-byte.
// =============================================================================

import { useToastStore } from '@/stores/toast'
import { useAudioStore } from '@/stores/audio'
import { useTeamStore } from '@/stores/team'
import { t } from '@wl-i18n/i18n.js'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { buildScoutSynopsis } from '@/engine/scouting/scoutSynopsis'
import { isScoutPerkActive } from '@/engine/scouting/scoutReveal'
import { analyzeTeamDirection, buildContext } from '@/engine/ai/AITradeService'
import { getEffectiveExpectation } from '@/engine/season/OwnerExpectationService'
import { findOwnerForTeam } from '@/engine/data/owners'

export function useScoutReportToast() {
  const toastStore = useToastStore()
  const audio = useAudioStore()
  const teamStore = useTeamStore()

  // Resolve the user's team + roster: fast path from the team store (already
  // loaded on the Scouting page), IDB fallback otherwise. Roster excludes
  // prospects — direction analysis wants the actual NBA roster.
  async function _teamAndRoster(campaign) {
    const stTeam = teamStore.team
    if (stTeam && String(stTeam.id) === String(campaign.teamId)) {
      const roster = Array.isArray(teamStore.roster) ? teamStore.roster : []
      if (roster.length > 0) return { team: stTeam, roster, allTeams: null }
    }
    const allTeams = await TeamRepository.getAllForCampaign(campaign.id)
    const team = allTeams.find((tm) => String(tm.id) === String(campaign.teamId))
    if (!team) return null
    const allPlayers = await PlayerRepository.getAllForCampaign(campaign.id)
    const roster = allPlayers.filter(
      (p) => String(p.teamId ?? p.team_id) === String(team.id) && !p.isDraftProspect
    )
    return { team, roster, allTeams }
  }

  async function _showRichReport(campaign, player, scout) {
    const resolved = await _teamAndRoster(campaign)
    if (!resolved) return false
    const { team, roster } = resolved
    const allTeams = resolved.allTeams ?? (await TeamRepository.getAllForCampaign(campaign.id))

    // Live owner mandate steers the direction read, mirroring DraftRoomView.
    const owner = findOwnerForTeam(team.abbreviation)
    const ownerTier = getEffectiveExpectation(campaign, owner)?.tier ?? owner?.expectation ?? null

    const seasonData = await SeasonRepository.get(campaign.id, campaign.currentSeasonYear ?? 2025)
    const context = buildContext({
      standings: seasonData?.standings || { east: [], west: [] },
      teams: allTeams,
      seasonPhase: String(campaign.phase || '').startsWith('offseason') ? 'offseason' : 'regular_season',
    })
    const direction = analyzeTeamDirection(
      ownerTier ? { ...team, effectiveExpectation: ownerTier } : team,
      roster,
      context
    )

    const facilityLevel = teamStore.team?.facilities?.scouting ?? team.facilities?.scouting ?? 1
    const synopsis = buildScoutSynopsis({
      player,
      direction,
      ownerTier,
      includeRedFlags: isScoutPerkActive(scout, facilityLevel, 'red_flag_intel'),
    })

    toastStore.showScoutReport({
      // Plain copy — the toast must not hold a reactive proxy.
      scout: JSON.parse(JSON.stringify(scout)),
      playerName: `${player.firstName} ${player.lastName}`,
      synopsis,
      campaignId: campaign.id,
    })
    return true
  }

  /**
   * Surface the scout-milestone toast for one scout action's outcome.
   * No-op unless a milestone fired (full scout or badge reveal).
   */
  async function notifyScoutMilestone({ campaign, player, hitFullScout, badgesJustRevealed }) {
    if (!hitFullScout && !badgesJustRevealed) return

    // Rich report only for the full-scout milestone with a scout on staff.
    const scout = campaign?.settings?.scout
    if (hitFullScout && scout) {
      try {
        if (await _showRichReport(campaign, player, scout)) return
      } catch (err) {
        console.error('Scout report toast failed, falling back to plain toast:', err)
      }
    }

    // Plain path — unchanged from the original milestone block.
    const playerName = player.firstName + ' ' + player.lastName
    let message
    if (hitFullScout && badgesJustRevealed) {
      message = t('{name} fully scouted — badges revealed!', { name: playerName })
    } else if (hitFullScout) {
      message = t('{name} fully scouted!', { name: playerName })
    } else {
      message = t('Badges revealed for {name}!', { name: playerName })
    }
    audio.affirm()
    toastStore.showSuccess(message)
  }

  return { notifyScoutMilestone }
}
