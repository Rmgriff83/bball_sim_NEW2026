import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import { set, get, del } from 'idb-keyval'
import { selectAIPick } from '@/services/AIDraftService'
import { PlayerRepository } from '@/engine/db/PlayerRepository'
import { TeamRepository } from '@/engine/db/TeamRepository'
import { CampaignRepository } from '@/engine/db/CampaignRepository'
import { initializeAllTeamLineups } from '@/engine/ai/AILineupService'

export const useDraftStore = defineStore('draft', () => {
  // State
  const allPlayers = ref([])
  const draftOrder = ref([])      // 450 slots
  const draftResults = ref([])    // completed picks
  const currentPickIndex = ref(0)
  const userTeamId = ref(null)
  const userTeamAbbr = ref(null)
  const timerSeconds = ref(60)
  const isDraftActive = ref(false)
  const isDraftComplete = ref(false)
  const isSimming = ref(false)       // fast-forward mode (skip to pick / skip all)
  const isAutoPlaying = ref(false)   // live mode -- AI picks play out with delays
  const isFinalizing = ref(false)
  const teams = ref([])
  const filterPosition = ref('ALL')
  const searchQuery = ref('')
  const sortField = ref('overallRating')
  const sortDir = ref('desc')
  const lastPickResult = ref(null)   // last completed pick for toast
  const skipRequested = ref(false)   // signal to break out of live play loop

  let timerInterval = null

  // Getters
  const currentPick = computed(() => draftOrder.value[currentPickIndex.value] || null)
  const isUserPick = computed(() => currentPick.value?.teamId === userTeamId.value)
  const currentRound = computed(() => currentPick.value?.round || 1)

  const availablePlayers = computed(() => {
    const draftedIds = new Set(draftResults.value.map(r => r.playerId))
    return allPlayers.value.filter(p => !draftedIds.has(p.id))
  })

  const filteredPlayers = computed(() => {
    let players = availablePlayers.value

    if (filterPosition.value !== 'ALL') {
      players = players.filter(p =>
        p.position === filterPosition.value ||
        p.secondaryPosition === filterPosition.value
      )
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim()
      players = players.filter(p =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
      )
    }

    const field = sortField.value
    const dir = sortDir.value === 'desc' ? -1 : 1
    players = [...players].sort((a, b) => {
      const aVal = a[field] ?? 0
      const bVal = b[field] ?? 0
      if (typeof aVal === 'string') return dir * aVal.localeCompare(bVal)
      return dir * (aVal - bVal)
    })

    return players
  })

  const userRoster = computed(() => {
    return draftResults.value.filter(r => r.teamId === userTeamId.value)
  })

  const teamRosters = computed(() => {
    const map = {}
    for (const pick of draftResults.value) {
      if (!map[pick.teamId]) map[pick.teamId] = []
      map[pick.teamId].push(pick)
    }
    return map
  })

  const recentPicks = computed(() => {
    return [...draftResults.value].reverse().slice(0, 10)
  })

  // Picks in the current round for the round ticker
  const currentRoundPicks = computed(() => {
    const round = currentRound.value
    return draftResults.value.filter(r => r.round === round)
  })

  // Generate a realistic AI thinking delay (in ms)
  // Early rounds: 5-12s, mid rounds: 3-8s, late rounds: 2-5s
  function getRealisticDelay(round) {
    if (round <= 3) return 5000 + Math.random() * 7000       // 5-12s
    if (round <= 8) return 3000 + Math.random() * 5000        // 3-8s
    return 2000 + Math.random() * 3000                        // 2-5s
  }

  // Actions
  function initializeDraft(campaign, players, teamsList) {
    allPlayers.value = players
    teams.value = teamsList
    userTeamId.value = campaign.teamId || campaign.team?.id || campaign.team_id
    userTeamAbbr.value = campaign.team?.abbreviation

    draftResults.value = []
    currentPickIndex.value = 0
    isDraftActive.value = true
    isDraftComplete.value = false
    isSimming.value = false
    isAutoPlaying.value = false
    lastPickResult.value = null
    skipRequested.value = false

    generateDraftOrder(teamsList)
  }

  function generateDraftOrder(teamsList) {
    if (!teamsList?.length) {
      console.error('generateDraftOrder: teamsList is empty or invalid', teamsList)
      return
    }
    const shuffled = [...teamsList].sort(() => Math.random() - 0.5)
    const order = []
    const totalRounds = 15
    let pickNumber = 1

    for (let round = 1; round <= totalRounds; round++) {
      const roundTeams = round % 2 === 1 ? [...shuffled] : [...shuffled].reverse()

      for (let i = 0; i < roundTeams.length; i++) {
        const team = roundTeams[i]
        order.push({
          round,
          pick: pickNumber,
          pickInRound: i + 1,
          teamId: team.id,
          teamAbbr: team.abbreviation,
          teamName: team.name,
          teamColor: team.primary_color || '#666',
        })
        pickNumber++
      }
    }

    draftOrder.value = order
  }

  function makeUserPick(playerId) {
    if (!isUserPick.value || isDraftComplete.value) return

    const player = allPlayers.value.find(p => p.id === playerId)
    if (!player) return

    stopTimer()
    recordPick(player)
    advancePick()

    // After user picks, start live AI play
    if (!isDraftComplete.value && !isUserPick.value) {
      autoPlayAIPicks()
    }
  }

  function recordPick(player) {
    const pick = currentPick.value
    if (!pick) return

    const result = {
      round: pick.round,
      pick: pick.pick,
      teamId: pick.teamId,
      teamAbbr: pick.teamAbbr,
      teamName: pick.teamName,
      teamColor: pick.teamColor,
      playerId: player.id,
      playerName: `${player.firstName} ${player.lastName}`,
      position: player.position,
      secondaryPosition: player.secondaryPosition,
      overallRating: player.overallRating,
      potentialRating: player.potentialRating,
      badges: player.badges || [],
    }

    draftResults.value.push(result)
    lastPickResult.value = result
  }

  function advancePick() {
    currentPickIndex.value++

    if (currentPickIndex.value >= draftOrder.value.length) {
      isDraftComplete.value = true
      isDraftActive.value = false
      isAutoPlaying.value = false
      stopTimer()
      return
    }

    if (isUserPick.value && !isSimming.value) {
      startTimer()
    }
  }

  function makeAIPick() {
    if (isUserPick.value || isDraftComplete.value) return

    const pick = currentPick.value
    if (!pick) return

    const teamPicks = (teamRosters.value[pick.teamId] || [])
    const selected = selectAIPick(
      availablePlayers.value,
      teamPicks,
      pick.round,
      15
    )

    if (selected) {
      recordPick(selected)
    }

    advancePick()
  }

  // Live AI play -- shows each pick with realistic delay
  async function autoPlayAIPicks(campaignId) {
    if (isDraftComplete.value || isAutoPlaying.value || isSimming.value) return

    isAutoPlaying.value = true
    skipRequested.value = false

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    while (!isDraftComplete.value && !isUserPick.value && !skipRequested.value) {
      // Wait realistic time before the pick
      const waitTime = getRealisticDelay(currentRound.value)
      // Break the wait into small chunks so skipRequested can interrupt
      const chunkSize = 100
      let waited = 0
      while (waited < waitTime && !skipRequested.value) {
        await delay(Math.min(chunkSize, waitTime - waited))
        waited += chunkSize
      }
      if (skipRequested.value || isDraftComplete.value || isUserPick.value) break

      makeAIPick()
      await delay(200) // small gap after pick for toast visibility
    }

    isAutoPlaying.value = false
    skipRequested.value = false

    if (isUserPick.value && !isDraftComplete.value) {
      startTimer()
    }

    if (campaignId) saveDraftToCache(campaignId)
  }

  function simCurrentPick() {
    if (isDraftComplete.value) return

    if (isUserPick.value) {
      const best = availablePlayers.value[0]
      if (best) {
        stopTimer()
        recordPick(best)
        advancePick()
        if (!isDraftComplete.value && !isUserPick.value) {
          autoPlayAIPicks()
        }
      }
    } else {
      // Skip current AI pick immediately
      skipRequested.value = true
      // Small delay to let autoPlay loop break, then make the pick
      setTimeout(() => {
        if (!isDraftComplete.value && !isUserPick.value) {
          makeAIPick()
        }
        skipRequested.value = false
        if (!isDraftComplete.value && !isUserPick.value && !isAutoPlaying.value) {
          autoPlayAIPicks()
        }
      }, 150)
    }
  }

  async function simToNextUserPick(campaignId) {
    if (isDraftComplete.value || isSimming.value) return

    isSimming.value = true
    isAutoPlaying.value = false
    skipRequested.value = true
    stopTimer()

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    // Wait for any autoPlay loop to stop
    await delay(200)
    skipRequested.value = false

    while (!isDraftComplete.value && !isUserPick.value) {
      makeAIPick()
      await delay(60) // brief delay for visual updates
    }

    isSimming.value = false

    if (isUserPick.value && !isDraftComplete.value) {
      startTimer()
    }

    if (campaignId) saveDraftToCache(campaignId)
  }

  async function simEntireDraft(campaignId) {
    if (isDraftComplete.value || isSimming.value) return

    isSimming.value = true
    isAutoPlaying.value = false
    skipRequested.value = true
    stopTimer()

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))
    await delay(200)
    skipRequested.value = false

    while (!isDraftComplete.value) {
      if (isUserPick.value) {
        const best = availablePlayers.value[0]
        if (best) {
          recordPick(best)
          advancePick()
        }
      } else {
        makeAIPick()
      }
      await delay(20)
    }

    isSimming.value = false

    if (campaignId) saveDraftToCache(campaignId)
  }

  function startTimer() {
    stopTimer()
    timerSeconds.value = 60

    timerInterval = setInterval(() => {
      timerSeconds.value--
      if (timerSeconds.value <= 0) {
        stopTimer()
        if (isUserPick.value) {
          const best = availablePlayers.value[0]
          if (best) {
            recordPick(best)
            advancePick()
            if (!isDraftComplete.value && !isUserPick.value) {
              autoPlayAIPicks()
            }
          }
        }
      }
    }, 1000)
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  async function saveDraftToCache(campaignId) {
    try {
      await set(`draft_${campaignId}`, JSON.parse(JSON.stringify({
        draftResults: toRaw(draftResults.value),
        currentPickIndex: currentPickIndex.value,
        draftOrder: toRaw(draftOrder.value),
        isDraftComplete: isDraftComplete.value,
        userTeamId: userTeamId.value,
        userTeamAbbr: userTeamAbbr.value,
        _savedAt: new Date().toISOString(),
      })))
    } catch (e) {
      console.warn('Failed to save draft to cache:', e)
    }
  }

  async function loadDraftFromCache(campaignId) {
    try {
      const cached = await get(`draft_${campaignId}`)
      if (!cached) return false

      draftResults.value = cached.draftResults || []
      currentPickIndex.value = cached.currentPickIndex || 0
      draftOrder.value = cached.draftOrder || []
      isDraftComplete.value = cached.isDraftComplete || false
      userTeamId.value = cached.userTeamId
      userTeamAbbr.value = cached.userTeamAbbr
      isDraftActive.value = !isDraftComplete.value

      return true
    } catch (e) {
      console.warn('Failed to load draft from cache:', e)
      return false
    }
  }

  async function clearDraftCache(campaignId) {
    try {
      await del(`draft_${campaignId}`)
    } catch (e) {
      console.warn('Failed to clear draft cache:', e)
    }
  }

  async function finalizeDraft(campaignId) {
    isFinalizing.value = true
    try {
      // Build a map of teamAbbr -> teamId for lookups
      const teamsByAbbr = {}
      for (const team of teams.value) {
        teamsByAbbr[team.abbreviation] = team
      }

      // Assign each drafted player to their team in PlayerRepository
      const playerUpdates = []
      for (const result of draftResults.value) {
        const player = allPlayers.value.find(p => p.id === result.playerId)
        if (!player) continue

        const team = teamsByAbbr[result.teamAbbr]
        if (!team) continue

        // Convert reactive proxy to plain object for IndexedDB storage
        const plain = { ...toRaw(player) }
        plain.teamId = team.id
        plain.teamAbbreviation = result.teamAbbr
        plain.isFreeAgent = 0
        plain.campaignId = campaignId
        playerUpdates.push(plain)
      }

      if (playerUpdates.length > 0) {
        await PlayerRepository.saveBulk(playerUpdates)
      }

      // Initialize lineups for all teams
      const allTeams = await TeamRepository.getAllForCampaign(campaignId)
      const allPlayersUpdated = await PlayerRepository.getAllForCampaign(campaignId)

      const getTeamRosterFn = (teamAbbr) => {
        return allPlayersUpdated.filter(p => {
          const abbr = p.teamAbbreviation ?? p.team_abbreviation ?? ''
          return abbr === teamAbbr
        })
      }

      const lineupResults = initializeAllTeamLineups({
        aiTeams: allTeams,
        getTeamRosterFn,
      })

      // Save lineup settings to each team
      for (const team of allTeams) {
        const teamKey = team.id ?? team.abbreviation
        const lineupData = lineupResults[teamKey]
        if (lineupData) {
          await TeamRepository.updateLineup(campaignId, team.id, {
            starters: lineupData.starters,
            subStrategy: lineupData.subStrategy,
          })
        }
      }

      // Save user's lineup to campaign.settings (canonical source for user lineup)
      const campaign = await CampaignRepository.get(campaignId)
      if (campaign) {
        const userTeam = allTeams.find(t => t.id === campaign.teamId)
        if (userTeam) {
          const userLineupData = lineupResults[userTeam.id ?? userTeam.abbreviation]
          if (userLineupData) {
            campaign.settings = campaign.settings ?? {}
            campaign.settings.lineup = {
              starters: userLineupData.starters,
              target_minutes: {},
              rotation: [],
            }
          }
        }

        // Mark draft as completed (top-level flag)
        campaign.draftCompleted = true
        campaign.draft_completed = true
        await CampaignRepository.save(campaign)
      }

      // Clear draft cache
      await clearDraftCache(campaignId)

      return true
    } catch (e) {
      console.error('Failed to finalize draft:', e)
      throw e
    } finally {
      isFinalizing.value = false
    }
  }

  function toggleSort(field) {
    if (sortField.value === field) {
      sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
    } else {
      sortField.value = field
      sortDir.value = 'desc'
    }
  }

  function $reset() {
    allPlayers.value = []
    draftOrder.value = []
    draftResults.value = []
    currentPickIndex.value = 0
    userTeamId.value = null
    userTeamAbbr.value = null
    timerSeconds.value = 60
    isDraftActive.value = false
    isDraftComplete.value = false
    isSimming.value = false
    isAutoPlaying.value = false
    isFinalizing.value = false
    teams.value = []
    filterPosition.value = 'ALL'
    searchQuery.value = ''
    sortField.value = 'overallRating'
    sortDir.value = 'desc'
    lastPickResult.value = null
    skipRequested.value = false
    stopTimer()
  }

  return {
    // State
    allPlayers,
    draftOrder,
    draftResults,
    currentPickIndex,
    userTeamId,
    userTeamAbbr,
    timerSeconds,
    isDraftActive,
    isDraftComplete,
    isSimming,
    isAutoPlaying,
    isFinalizing,
    teams,
    filterPosition,
    searchQuery,
    sortField,
    sortDir,
    lastPickResult,
    // Getters
    currentPick,
    isUserPick,
    currentRound,
    availablePlayers,
    filteredPlayers,
    userRoster,
    teamRosters,
    recentPicks,
    currentRoundPicks,
    // Actions
    initializeDraft,
    makeUserPick,
    makeAIPick,
    simCurrentPick,
    simToNextUserPick,
    simEntireDraft,
    autoPlayAIPicks,
    startTimer,
    stopTimer,
    saveDraftToCache,
    loadDraftFromCache,
    clearDraftCache,
    finalizeDraft,
    toggleSort,
    $reset,
  }
})
