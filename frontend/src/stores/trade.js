import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { SALARY_CAP } from '@/engine/data/teams'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { SeasonRepository } from '@/engine/db/SeasonRepository'
import { useSyncStore } from '@/stores/sync'
import {
  evaluateTrade,
  generateWeeklyProposals,
  buildAiOffer,
  findTargetPlayers,
  identifyNeed,
  analyzeTeamDirection,
  buildContext,
} from '@/engine/ai/AITradeService'
import {
  validateSalaryCap,
  buildTradeDetails,
  executeTrade as executeTradeEngine,
  formatTradeForDisplay,
} from '@/engine/finance/TradeExecutor'

export const useTradeStore = defineStore('trade', () => {
  // State
  const tradeableTeams = ref([])
  const selectedTeam = ref(null)
  const selectedTeamRoster = ref([])
  const selectedTeamPicks = ref([])
  const userAssets = ref({ roster: [], picks: [], team: null })
  const tradeHistory = ref([])

  // Trade proposal state
  const userOffering = ref([]) // Assets user is giving
  const userRequesting = ref([]) // Assets user wants

  // AI-initiated trade proposals
  const pendingProposals = ref([])

  const loading = ref(false)
  const proposing = ref(false)
  const error = ref(null)
  const lastProposalResult = ref(null)

  // Getters
  const selectedTeamId = computed(() => selectedTeam.value?.id)

  const userOfferingSalary = computed(() => {
    return userOffering.value
      .filter(a => a.type === 'player')
      .reduce((sum, a) => sum + (a.contractSalary || 0), 0)
  })

  const userRequestingSalary = computed(() => {
    return userRequesting.value
      .filter(a => a.type === 'player')
      .reduce((sum, a) => sum + (a.contractSalary || 0), 0)
  })

  const salaryDifference = computed(() => {
    return userRequestingSalary.value - userOfferingSalary.value
  })

  const canProposeTrade = computed(() => {
    return userOffering.value.length > 0 && userRequesting.value.length > 0 && !proposing.value
  })

  // Helper: build a player lookup function from an array
  function _buildPlayerLookup(players) {
    const map = {}
    for (const p of players) {
      map[p.id] = p
    }
    return (playerId) => map[playerId] || null
  }

  // Helper: get campaign year
  async function _getCampaignYear(campaignId) {
    const campaign = await CampaignRepository.get(campaignId)
    return campaign?.settings?.currentYear ?? campaign?.year ?? new Date().getFullYear()
  }

  // Actions
  async function fetchTradeableTeams(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)

      // Load standings to attach win/loss records
      const year = campaign?.currentSeasonYear ?? campaign?.gameYear ?? 2025
      const seasonData = await SeasonRepository.get(campaignId, year)
      const standings = seasonData?.standings ?? { east: [], west: [] }
      const allStandings = [...(standings.east ?? []), ...(standings.west ?? [])]

      // Build a lookup from teamId to standings record
      const standingsMap = {}
      for (const s of allStandings) {
        standingsMap[s.teamId] = s
      }

      // Filter out the user's team and enrich with record + direction
      tradeableTeams.value = allTeams
        .filter(t => t.id !== userTeamId)
        .map(t => {
          const s = standingsMap[t.id]
          const wins = s?.wins ?? 0
          const losses = s?.losses ?? 0
          const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0.5
          // Simple direction heuristic based on record
          let direction = 'ascending'
          if (winPct >= 0.6) direction = 'win_now'
          else if (winPct >= 0.5) direction = 'ascending'
          else if (winPct < 0.35) direction = 'rebuilding'
          const totalPayroll = t.total_payroll ?? t.totalPayroll ?? 0
          return {
            ...t,
            record: { wins, losses },
            direction,
            cap_space: SALARY_CAP - totalPayroll,
          }
        })

      return tradeableTeams.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch teams'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchTeamDetails(campaignId, teamId) {
    loading.value = true
    error.value = null
    try {
      const team = await TeamRepository.get(campaignId, teamId)
      const roster = await PlayerRepository.getByTeam(campaignId, teamId)

      // Merge with existing selectedTeam to preserve enriched props (record, direction, cap_space)
      const existing = selectedTeam.value
      if (existing && existing.id === teamId) {
        selectedTeam.value = { ...existing, ...team, record: existing.record, direction: existing.direction, cap_space: existing.cap_space }
      } else {
        selectedTeam.value = team
      }
      selectedTeamRoster.value = roster
      selectedTeamPicks.value = team?.draftPicks ?? []

      return { team: selectedTeam.value, roster, picks: selectedTeamPicks.value }
    } catch (err) {
      error.value = err.message || 'Failed to fetch team details'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function fetchUserAssets(campaignId) {
    loading.value = true
    error.value = null
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const team = await TeamRepository.get(campaignId, userTeamId)
      const roster = await PlayerRepository.getByTeam(campaignId, userTeamId)

      userAssets.value = {
        roster,
        picks: team?.draftPicks ?? [],
        team,
      }
      return userAssets.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch your assets'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function proposeTrade(campaignId) {
    if (!canProposeTrade.value || !selectedTeam.value) return null

    proposing.value = true
    error.value = null
    lastProposalResult.value = null

    try {
      const campaign = await CampaignRepository.get(campaignId)
      const year = campaign?.settings?.currentYear ?? campaign?.year ?? new Date().getFullYear()
      const difficulty = campaign?.settings?.difficulty ?? 'pro'
      const seasonData = await SeasonRepository.get(campaignId, year)
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)

      const aiTeamId = selectedTeam.value.id
      const aiTeamRoster = await PlayerRepository.getByTeam(campaignId, aiTeamId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)

      const standings = seasonData?.standings ?? { east: [], west: [] }
      const context = buildContext({ standings, teams: allTeams, seasonPhase: 'regular_season' })

      // Build the proposal in AI format: aiReceives = what user is offering, aiGives = what user is requesting
      const proposal = {
        aiReceives: userOffering.value.map(formatAssetForApi),
        aiGives: userRequesting.value.map(formatAssetForApi),
      }

      const result = evaluateTrade({
        proposal,
        team: selectedTeam.value,
        teamRoster: aiTeamRoster,
        difficulty,
        context,
        getPlayerFn,
      })

      lastProposalResult.value = result
      return result
    } catch (err) {
      error.value = err.message || 'Failed to propose trade'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function executeTrade(campaignId) {
    if (!selectedTeam.value) return null

    proposing.value = true
    error.value = null

    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const userTeam = await TeamRepository.get(campaignId, userTeamId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)

      // Build trade details
      const details = buildTradeDetails({
        userTeam,
        aiTeam: selectedTeam.value,
        userGives: userOffering.value.map(formatAssetForApi),
        userReceives: userRequesting.value.map(formatAssetForApi),
        getPlayerFn,
      })

      // Separate players into user roster vs league players
      const userRoster = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid == userTeamId
      })
      const leaguePlayers = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid != userTeamId
      })

      const currentDate = campaign?.settings?.currentDate ?? new Date().toISOString().split('T')[0]

      // Collect all draft picks from both teams for the executor
      const aiTeamObj = await TeamRepository.get(campaignId, selectedTeam.value.id)
      const allDraftPicks = [
        ...(userTeam.draftPicks || []),
        ...(aiTeamObj?.draftPicks || []),
      ]

      const result = executeTradeEngine({
        tradeDetails: details,
        leaguePlayers,
        userRoster,
        draftPicks: allDraftPicks,
        userTeam: { id: userTeamId, abbreviation: userTeam.abbreviation },
        currentDate,
      })

      // Persist player changes: update teamId for all moved players
      const playersToSave = []
      for (const asset of details.assets) {
        if (asset.type === 'player') {
          // Find the player in the combined result arrays
          const player = [...result.updatedLeaguePlayers, ...result.updatedUserRoster]
            .find(p => (p.id ?? '') == asset.playerId)
          if (player) {
            player.teamId = asset.to
            player.campaignId = campaignId
            playersToSave.push(player)
          }
        }
      }

      if (playersToSave.length > 0) {
        await PlayerRepository.saveBulk(playersToSave)
      }

      // Persist draft pick ownership changes: move picks between teams
      const pickAssets = details.assets.filter(a => a.type === 'pick')
      if (pickAssets.length > 0) {
        const userPicks = [...(userTeam.draftPicks || [])]
        const aiPicks = [...(aiTeamObj?.draftPicks || [])]

        for (const asset of pickAssets) {
          const pickId = asset.pickId
          const fromId = asset.from
          const toId = asset.to

          // Find and remove pick from source team
          let pick = null
          const fromUserTeam = fromId == userTeamId
          const sourceArr = fromUserTeam ? userPicks : aiPicks
          const destArr = fromUserTeam ? aiPicks : userPicks
          const destTeamId = toId

          const idx = sourceArr.findIndex(p => (p.id ?? '') == pickId)
          if (idx >= 0) {
            pick = { ...sourceArr[idx] }
            sourceArr.splice(idx, 1)

            // Update ownership fields
            pick.currentOwnerId = destTeamId
            pick.current_owner_id = destTeamId
            pick.isTraded = true
            pick.is_traded = true

            // Add to destination team
            destArr.push(pick)
          }
        }

        // Save both teams with updated draftPicks
        userTeam.draftPicks = userPicks
        await TeamRepository.save(userTeam)

        if (aiTeamObj) {
          aiTeamObj.draftPicks = aiPicks
          await TeamRepository.save(aiTeamObj)
        }
      }

      // Save trade to history in season data
      const year = campaign?.settings?.currentYear ?? campaign?.year ?? new Date().getFullYear()
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (seasonData) {
        if (!seasonData.tradeHistory) seasonData.tradeHistory = []
        seasonData.tradeHistory.push({
          id: `trade_${Date.now()}`,
          ...result.trade,
        })
        await SeasonRepository.save(seasonData)
      }

      // Mark for cloud sync
      useSyncStore().markDirty()

      // Build trade context for breaking news before clearing state
      const assetsSent = [
        ...details.assets
          .filter(a => a.type === 'player' && a.from == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.from == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const assetsReceived = [
        ...details.assets
          .filter(a => a.type === 'player' && a.to == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.to == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const tradeContext = {
        playersSent: assetsSent,
        playersReceived: assetsReceived,
        otherTeamName: selectedTeam.value?.name || 'Unknown',
        userTeamName: userTeam?.name || 'Unknown',
        date: currentDate,
      }

      // Clear the trade after successful execution
      clearTrade()

      return { ...result, tradeContext }
    } catch (err) {
      error.value = err.message || 'Failed to execute trade'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function fetchTradeHistory(campaignId) {
    loading.value = true
    error.value = null
    try {
      const year = await _getCampaignYear(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)

      const rawTrades = seasonData?.tradeHistory ?? []
      tradeHistory.value = rawTrades.map(formatTradeForDisplay)
      return tradeHistory.value
    } catch (err) {
      error.value = err.message || 'Failed to fetch trade history'
      throw err
    } finally {
      loading.value = false
    }
  }

  // AI-initiated trade proposal actions
  async function fetchPendingProposals(campaignId) {
    try {
      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const year = campaign?.settings?.currentYear ?? campaign?.year ?? new Date().getFullYear()
      const difficulty = campaign?.settings?.difficulty ?? 'pro'
      const currentDate = campaign?.settings?.currentDate ?? new Date().toISOString().split('T')[0]

      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const seasonData = await SeasonRepository.get(campaignId, year)

      const userTeam = allTeams.find(t => t.id === userTeamId)
      const aiTeams = allTeams.filter(t => t.id !== userTeamId)
      const userRoster = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid == userTeamId
      })

      const standings = seasonData?.standings ?? { east: [], west: [] }
      const getPlayerFn = _buildPlayerLookup(allPlayers)

      const getTeamRosterFn = (teamAbbr) => {
        return allPlayers.filter(p => {
          const abbr = p.teamAbbreviation ?? p.team_abbreviation ?? ''
          return abbr === teamAbbr
        })
      }

      const newProposals = generateWeeklyProposals({
        aiTeams,
        userRoster,
        standings,
        allTeams,
        currentDate,
        seasonYear: year,
        difficulty,
        seasonPhase: 'regular_season',
        pendingProposals: pendingProposals.value,
        getTeamRosterFn,
        getPlayerFn,
      })

      // Assign IDs to new proposals and add to pending
      for (const proposal of newProposals) {
        proposal.id = `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        pendingProposals.value.push(proposal)
      }

      return pendingProposals.value
    } catch (err) {
      console.error('Failed to fetch trade proposals:', err)
      pendingProposals.value = []
      return []
    }
  }

  async function acceptProposal(campaignId, proposalId) {
    proposing.value = true
    error.value = null
    try {
      const proposal = pendingProposals.value.find(p => p.id === proposalId)
      if (!proposal) throw new Error('Proposal not found')

      const campaign = await CampaignRepository.get(campaignId)
      const userTeamId = campaign?.team_id ?? campaign?.teamId
      const userTeam = await TeamRepository.get(campaignId, userTeamId)
      const allPlayers = await PlayerRepository.getAllForCampaign(campaignId)
      const getPlayerFn = _buildPlayerLookup(allPlayers)

      // Build trade details from the proposal
      const aiTeam = {
        id: proposal.proposing_team_id,
        name: proposal.proposing_team_name,
        abbreviation: proposal.proposing_team_abbreviation,
      }

      const details = buildTradeDetails({
        userTeam,
        aiTeam,
        userGives: proposal.proposal.aiReceives,   // AI receives = user gives
        userReceives: proposal.proposal.aiGives,    // AI gives = user receives
        getPlayerFn,
      })

      const userRoster = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid == userTeamId
      })
      const leaguePlayers = allPlayers.filter(p => {
        const tid = p.teamId ?? p.team_id
        return tid != userTeamId
      })

      const currentDate = campaign?.settings?.currentDate ?? new Date().toISOString().split('T')[0]

      // Collect all draft picks from both teams for the executor
      const aiTeamObj = await TeamRepository.get(campaignId, aiTeam.id)
      const allDraftPicks = [
        ...(userTeam.draftPicks || []),
        ...(aiTeamObj?.draftPicks || []),
      ]

      const result = executeTradeEngine({
        tradeDetails: details,
        leaguePlayers,
        userRoster,
        draftPicks: allDraftPicks,
        userTeam: { id: userTeamId, abbreviation: userTeam.abbreviation },
        currentDate,
      })

      // Persist player moves
      const playersToSave = []
      for (const asset of details.assets) {
        if (asset.type === 'player') {
          const player = [...result.updatedLeaguePlayers, ...result.updatedUserRoster]
            .find(p => (p.id ?? '') == asset.playerId)
          if (player) {
            player.teamId = asset.to
            player.campaignId = campaignId
            playersToSave.push(player)
          }
        }
      }

      if (playersToSave.length > 0) {
        await PlayerRepository.saveBulk(playersToSave)
      }

      // Persist draft pick ownership changes: move picks between teams
      const pickAssets = details.assets.filter(a => a.type === 'pick')
      if (pickAssets.length > 0) {
        const userPicks = [...(userTeam.draftPicks || [])]
        const aiPicks = [...(aiTeamObj?.draftPicks || [])]

        for (const asset of pickAssets) {
          const pickId = asset.pickId
          const fromId = asset.from
          const toId = asset.to

          let pick = null
          const fromUserTeam = fromId == userTeamId
          const sourceArr = fromUserTeam ? userPicks : aiPicks
          const destArr = fromUserTeam ? aiPicks : userPicks
          const destTeamId = toId

          const idx = sourceArr.findIndex(p => (p.id ?? '') == pickId)
          if (idx >= 0) {
            pick = { ...sourceArr[idx] }
            sourceArr.splice(idx, 1)

            pick.currentOwnerId = destTeamId
            pick.current_owner_id = destTeamId
            pick.isTraded = true
            pick.is_traded = true

            destArr.push(pick)
          }
        }

        userTeam.draftPicks = userPicks
        await TeamRepository.save(userTeam)

        if (aiTeamObj) {
          aiTeamObj.draftPicks = aiPicks
          await TeamRepository.save(aiTeamObj)
        }
      }

      // Save trade to history
      const year = campaign?.settings?.currentYear ?? campaign?.year ?? new Date().getFullYear()
      const seasonData = await SeasonRepository.get(campaignId, year)
      if (seasonData) {
        if (!seasonData.tradeHistory) seasonData.tradeHistory = []
        seasonData.tradeHistory.push({
          id: `trade_${Date.now()}`,
          ...result.trade,
        })
        await SeasonRepository.save(seasonData)
      }

      // Mark for cloud sync
      useSyncStore().markDirty()

      // Build trade context for breaking news
      const assetsSent = [
        ...details.assets
          .filter(a => a.type === 'player' && a.from == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.from == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const assetsReceived = [
        ...details.assets
          .filter(a => a.type === 'player' && a.to == userTeamId)
          .map(a => { const p = getPlayerFn(a.playerId); return p ? `${p.first_name || p.firstName || ''} ${p.last_name || p.lastName || ''}`.trim() : 'Unknown' }),
        ...details.assets
          .filter(a => a.type === 'pick' && a.to == userTeamId)
          .map(a => a.pickDisplay || `Draft Pick`),
      ]
      const tradeContext = {
        playersSent: assetsSent,
        playersReceived: assetsReceived,
        otherTeamName: aiTeam.name || 'Unknown',
        userTeamName: userTeam?.name || 'Unknown',
        date: currentDate,
      }

      // Remove from pending list
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)

      return { ...result, tradeContext }
    } catch (err) {
      error.value = err.message || 'Failed to accept trade proposal'
      throw err
    } finally {
      proposing.value = false
    }
  }

  async function rejectProposal(campaignId, proposalId) {
    try {
      // Simply remove from pending list -- no API call needed
      pendingProposals.value = pendingProposals.value.filter(p => p.id !== proposalId)
    } catch (err) {
      error.value = err.message || 'Failed to reject trade proposal'
      throw err
    }
  }

  // Trade management
  function addToUserOffering(asset) {
    // Prevent duplicates
    const exists = userOffering.value.some(a =>
      (a.type === 'player' && asset.type === 'player' && a.id === asset.id) ||
      (a.type === 'pick' && asset.type === 'pick' && a.id === asset.id)
    )
    if (!exists) {
      userOffering.value.push({ ...asset })
    }
  }

  function removeFromUserOffering(asset) {
    userOffering.value = userOffering.value.filter(a =>
      !(a.type === asset.type && a.id === asset.id)
    )
  }

  function addToUserRequesting(asset) {
    // Prevent duplicates
    const exists = userRequesting.value.some(a =>
      (a.type === 'player' && asset.type === 'player' && a.id === asset.id) ||
      (a.type === 'pick' && asset.type === 'pick' && a.id === asset.id)
    )
    if (!exists) {
      userRequesting.value.push({ ...asset })
    }
  }

  function removeFromUserRequesting(asset) {
    userRequesting.value = userRequesting.value.filter(a =>
      !(a.type === asset.type && a.id === asset.id)
    )
  }

  function clearTrade() {
    userOffering.value = []
    userRequesting.value = []
    lastProposalResult.value = null
  }

  function selectTeam(team) {
    // Only clear requesting assets when switching teams (keep user's offering)
    userRequesting.value = []
    lastProposalResult.value = null
    selectedTeam.value = team
    selectedTeamRoster.value = []
    selectedTeamPicks.value = []
  }

  function clearSelectedTeam() {
    selectedTeam.value = null
    selectedTeamRoster.value = []
    selectedTeamPicks.value = []
    clearTrade()
  }

  // Format asset for API calls
  function formatAssetForApi(asset) {
    if (asset.type === 'player') {
      return { type: 'player', playerId: asset.id }
    }
    return { type: 'pick', pickId: asset.id }
  }

  // Check if asset is in offering
  function isInOffering(assetType, assetId) {
    return userOffering.value.some(a => a.type === assetType && a.id === assetId)
  }

  // Check if asset is in requesting
  function isInRequesting(assetType, assetId) {
    return userRequesting.value.some(a => a.type === assetType && a.id === assetId)
  }

  // Utility functions
  function formatSalary(salary) {
    if (!salary) return '$0'
    if (salary >= 1000000) {
      return `$${(salary / 1000000).toFixed(1)}M`
    }
    return `$${(salary / 1000).toFixed(0)}K`
  }

  function getDirectionLabel(direction) {
    const labels = {
      title_contender: 'Title Contender',
      win_now: 'Win Now',
      ascending: 'Ascending',
      rebuilding: 'Rebuilding',
      // Legacy fallbacks
      contending: 'Contending',
      middling: 'Neutral',
    }
    return labels[direction] || direction
  }

  function getDirectionColor(direction) {
    const colors = {
      title_contender: '#10B981', // Green
      win_now: '#3B82F6',         // Blue
      ascending: '#8B5CF6',       // Purple
      rebuilding: '#F59E0B',      // Amber
      // Legacy fallbacks
      contending: '#10B981',
      middling: '#6B7280',
    }
    return colors[direction] || '#6B7280'
  }

  return {
    // State
    tradeableTeams,
    selectedTeam,
    selectedTeamRoster,
    selectedTeamPicks,
    userAssets,
    tradeHistory,
    userOffering,
    userRequesting,
    pendingProposals,
    loading,
    proposing,
    error,
    lastProposalResult,

    // Getters
    selectedTeamId,
    userOfferingSalary,
    userRequestingSalary,
    salaryDifference,
    canProposeTrade,

    // Actions
    fetchTradeableTeams,
    fetchTeamDetails,
    fetchUserAssets,
    proposeTrade,
    executeTrade,
    fetchTradeHistory,
    fetchPendingProposals,
    acceptProposal,
    rejectProposal,
    addToUserOffering,
    removeFromUserOffering,
    addToUserRequesting,
    removeFromUserRequesting,
    clearTrade,
    selectTeam,
    clearSelectedTeam,
    isInOffering,
    isInRequesting,

    // Utilities
    formatSalary,
    getDirectionLabel,
    getDirectionColor,
  }
})
