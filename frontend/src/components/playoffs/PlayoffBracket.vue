<script setup>
import { computed } from 'vue'
import { Trophy } from 'lucide-vue-next'

const props = defineProps({
  bracket: {
    type: Object,
    default: () => null
  },
  userTeamId: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['select-series'])

const eastRound1 = computed(() => props.bracket?.east?.round1 ?? [])
const eastRound2 = computed(() => props.bracket?.east?.round2 ?? [])
const eastConfFinals = computed(() => props.bracket?.east?.confFinals ?? null)

const westRound1 = computed(() => props.bracket?.west?.round1 ?? [])
const westRound2 = computed(() => props.bracket?.west?.round2 ?? [])
const westConfFinals = computed(() => props.bracket?.west?.confFinals ?? null)

const finals = computed(() => props.bracket?.finals ?? null)
const champion = computed(() => props.bracket?.champion ?? null)

// Preview data for next-round slots (shows winners before full matchup is created)
// East R2 Slot 1: fed by R1[0] (1v8) and R1[1] (4v5)
const eastR2Slot1Preview = computed(() => {
  if (eastRound2.value[0]) return null
  return {
    team1: eastRound1.value[0]?.winner ?? null,
    team2: eastRound1.value[1]?.winner ?? null
  }
})
// East R2 Slot 2: fed by R1[3] (2v7) and R1[2] (3v6)
const eastR2Slot2Preview = computed(() => {
  if (eastRound2.value[1]) return null
  return {
    team1: eastRound1.value[3]?.winner ?? null,
    team2: eastRound1.value[2]?.winner ?? null
  }
})
// West R2 Slot 1: fed by R1[0] (1v8) and R1[1] (4v5)
const westR2Slot1Preview = computed(() => {
  if (westRound2.value[0]) return null
  return {
    team1: westRound1.value[0]?.winner ?? null,
    team2: westRound1.value[1]?.winner ?? null
  }
})
// West R2 Slot 2: fed by R1[3] (2v7) and R1[2] (3v6)
const westR2Slot2Preview = computed(() => {
  if (westRound2.value[1]) return null
  return {
    team1: westRound1.value[3]?.winner ?? null,
    team2: westRound1.value[2]?.winner ?? null
  }
})
// East Conf Finals: fed by R2[0] and R2[1]
const eastCFPreview = computed(() => {
  if (eastConfFinals.value) return null
  return {
    team1: eastRound2.value[0]?.winner ?? null,
    team2: eastRound2.value[1]?.winner ?? null
  }
})
// West Conf Finals: fed by R2[0] and R2[1]
const westCFPreview = computed(() => {
  if (westConfFinals.value) return null
  return {
    team1: westRound2.value[0]?.winner ?? null,
    team2: westRound2.value[1]?.winner ?? null
  }
})
// Finals: fed by East CF and West CF
const finalsPreview = computed(() => {
  if (finals.value) return null
  return {
    team1: eastConfFinals.value?.winner ?? null,
    team2: westConfFinals.value?.winner ?? null
  }
})

function isUserTeam(teamId) {
  return teamId == props.userTeamId
}

function isUserSeries(series) {
  if (!series || !props.userTeamId) return false
  return series.team1?.teamId == props.userTeamId || series.team2?.teamId == props.userTeamId
}

function getSeriesStatusClass(series) {
  if (!series) return 'pending'
  const classes = []
  if (series.status === 'complete') classes.push('complete')
  else if (series.status === 'in_progress') classes.push('in-progress')
  else classes.push('pending')
  if (isUserSeries(series)) classes.push('user-series')
  return classes.join(' ')
}

function getSeriesScoreDisplay(series) {
  if (!series) return ''
  return `${series.team1Wins}-${series.team2Wins}`
}

function handleSeriesClick(series) {
  if (series) {
    emit('select-series', series)
  }
}
</script>

<template>
  <div v-if="bracket" class="playoff-bracket">
    <!-- Eastern Conference -->
    <div class="conference east">
      <h3 class="conference-title">Eastern Conference</h3>

      <div class="bracket-grid">
        <!-- Round 1 -->
        <div class="round round-1">
          <div class="round-label">First Round</div>
          <div class="matchups">
            <div
              v-for="(series, idx) in eastRound1"
              :key="series?.seriesId || `e1-${idx}`"
              class="matchup-wrapper"
            >
              <div
                class="matchup"
                :class="getSeriesStatusClass(series)"
                @click="handleSeriesClick(series)"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: series?.winner?.teamId === series?.team1?.teamId,
                    'user-team': isUserTeam(series?.team1?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: series?.team1?.primaryColor }" />
                  <span class="seed">[{{ series?.team1?.seed }}]</span>
                  <span class="abbr">{{ series?.team1?.abbreviation }}</span>
                  <span class="wins">{{ series?.team1Wins }}</span>
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: series?.winner?.teamId === series?.team2?.teamId,
                    'user-team': isUserTeam(series?.team2?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: series?.team2?.primaryColor }" />
                  <span class="seed">[{{ series?.team2?.seed }}]</span>
                  <span class="abbr">{{ series?.team2?.abbreviation }}</span>
                  <span class="wins">{{ series?.team2Wins }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Round 2 -->
        <div class="round round-2">
          <div class="round-label">Semifinals</div>
          <div class="matchups">
            <!-- Slot 1: first semifinal (fed by R1 matchups 1 & 2) -->
            <div
              v-if="eastRound2[0]"
              class="matchup-wrapper"
            >
              <div
                class="matchup"
                :class="getSeriesStatusClass(eastRound2[0])"
                @click="handleSeriesClick(eastRound2[0])"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: eastRound2[0]?.winner?.teamId === eastRound2[0]?.team1?.teamId,
                    'user-team': isUserTeam(eastRound2[0]?.team1?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastRound2[0]?.team1?.primaryColor }" />
                  <span class="seed">[{{ eastRound2[0]?.team1?.seed }}]</span>
                  <span class="abbr">{{ eastRound2[0]?.team1?.abbreviation }}</span>
                  <span class="wins">{{ eastRound2[0]?.team1Wins }}</span>
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: eastRound2[0]?.winner?.teamId === eastRound2[0]?.team2?.teamId,
                    'user-team': isUserTeam(eastRound2[0]?.team2?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastRound2[0]?.team2?.primaryColor }" />
                  <span class="seed">[{{ eastRound2[0]?.team2?.seed }}]</span>
                  <span class="abbr">{{ eastRound2[0]?.team2?.abbreviation }}</span>
                  <span class="wins">{{ eastRound2[0]?.team2Wins }}</span>
                </div>
              </div>
            </div>
            <div v-else class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team" :class="{ 'preview-team': eastR2Slot1Preview?.team1, 'user-team': eastR2Slot1Preview?.team1 && isUserTeam(eastR2Slot1Preview.team1.teamId) }">
                  <template v-if="eastR2Slot1Preview?.team1">
                    <span class="team-color-dot" :style="{ background: eastR2Slot1Preview.team1.primaryColor }" />
                    <span class="seed">[{{ eastR2Slot1Preview.team1.seed }}]</span>
                    <span class="abbr">{{ eastR2Slot1Preview.team1.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': eastR2Slot1Preview?.team2, 'user-team': eastR2Slot1Preview?.team2 && isUserTeam(eastR2Slot1Preview.team2.teamId) }">
                  <template v-if="eastR2Slot1Preview?.team2">
                    <span class="team-color-dot" :style="{ background: eastR2Slot1Preview.team2.primaryColor }" />
                    <span class="seed">[{{ eastR2Slot1Preview.team2.seed }}]</span>
                    <span class="abbr">{{ eastR2Slot1Preview.team2.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>
            </div>

            <!-- Slot 2: second semifinal (fed by R1 matchups 3 & 4) -->
            <div
              v-if="eastRound2[1]"
              class="matchup-wrapper"
            >

              <div
                class="matchup"
                :class="getSeriesStatusClass(eastRound2[1])"
                @click="handleSeriesClick(eastRound2[1])"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: eastRound2[1]?.winner?.teamId === eastRound2[1]?.team1?.teamId,
                    'user-team': isUserTeam(eastRound2[1]?.team1?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastRound2[1]?.team1?.primaryColor }" />
                  <span class="seed">[{{ eastRound2[1]?.team1?.seed }}]</span>
                  <span class="abbr">{{ eastRound2[1]?.team1?.abbreviation }}</span>
                  <span class="wins">{{ eastRound2[1]?.team1Wins }}</span>
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: eastRound2[1]?.winner?.teamId === eastRound2[1]?.team2?.teamId,
                    'user-team': isUserTeam(eastRound2[1]?.team2?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastRound2[1]?.team2?.primaryColor }" />
                  <span class="seed">[{{ eastRound2[1]?.team2?.seed }}]</span>
                  <span class="abbr">{{ eastRound2[1]?.team2?.abbreviation }}</span>
                  <span class="wins">{{ eastRound2[1]?.team2Wins }}</span>
                </div>
              </div>
            </div>
            <div v-else class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team" :class="{ 'preview-team': eastR2Slot2Preview?.team1, 'user-team': eastR2Slot2Preview?.team1 && isUserTeam(eastR2Slot2Preview.team1.teamId) }">
                  <template v-if="eastR2Slot2Preview?.team1">
                    <span class="team-color-dot" :style="{ background: eastR2Slot2Preview.team1.primaryColor }" />
                    <span class="seed">[{{ eastR2Slot2Preview.team1.seed }}]</span>
                    <span class="abbr">{{ eastR2Slot2Preview.team1.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': eastR2Slot2Preview?.team2, 'user-team': eastR2Slot2Preview?.team2 && isUserTeam(eastR2Slot2Preview.team2.teamId) }">
                  <template v-if="eastR2Slot2Preview?.team2">
                    <span class="team-color-dot" :style="{ background: eastR2Slot2Preview.team2.primaryColor }" />
                    <span class="seed">[{{ eastR2Slot2Preview.team2.seed }}]</span>
                    <span class="abbr">{{ eastR2Slot2Preview.team2.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Conference Finals -->
        <div class="round round-cf">
          <div class="round-label">Conf. Finals</div>
          <div class="matchups">
            <div class="matchup-wrapper">

              <div
                v-if="eastConfFinals"
                class="matchup"
                :class="getSeriesStatusClass(eastConfFinals)"
                @click="handleSeriesClick(eastConfFinals)"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: eastConfFinals?.winner?.teamId === eastConfFinals?.team1?.teamId,
                    'user-team': isUserTeam(eastConfFinals?.team1?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastConfFinals?.team1?.primaryColor }" />
                  <span class="abbr">{{ eastConfFinals?.team1?.abbreviation }}</span>
                  <span class="wins">{{ eastConfFinals?.team1Wins }}</span>
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: eastConfFinals?.winner?.teamId === eastConfFinals?.team2?.teamId,
                    'user-team': isUserTeam(eastConfFinals?.team2?.teamId)
                  }"
                >
                  <span class="team-color-dot" :style="{ background: eastConfFinals?.team2?.primaryColor }" />
                  <span class="abbr">{{ eastConfFinals?.team2?.abbreviation }}</span>
                  <span class="wins">{{ eastConfFinals?.team2Wins }}</span>
                </div>
              </div>
              <div v-else class="matchup pending">
                <div class="team" :class="{ 'preview-team': eastCFPreview?.team1, 'user-team': eastCFPreview?.team1 && isUserTeam(eastCFPreview.team1.teamId) }">
                  <template v-if="eastCFPreview?.team1">
                    <span class="team-color-dot" :style="{ background: eastCFPreview.team1.primaryColor }" />
                    <span class="abbr">{{ eastCFPreview.team1.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': eastCFPreview?.team2, 'user-team': eastCFPreview?.team2 && isUserTeam(eastCFPreview.team2.teamId) }">
                  <template v-if="eastCFPreview?.team2">
                    <span class="team-color-dot" :style="{ background: eastCFPreview.team2.primaryColor }" />
                    <span class="abbr">{{ eastCFPreview.team2.abbreviation }}</span>
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Finals -->
    <div class="finals-section">
      <div class="finals-header">
        <Trophy :size="24" />
        <span>NBA Finals</span>
      </div>
      <div class="finals-matchup-wrapper">
        <div
          v-if="finals"
          class="matchup finals-matchup"
          :class="getSeriesStatusClass(finals)"
          @click="handleSeriesClick(finals)"
        >
          <div
            class="team team-1"
            :class="{
              winner: finals?.winner?.teamId === finals?.team1?.teamId,
              'user-team': isUserTeam(finals?.team1?.teamId)
            }"
          >
            <span class="conf-label">EAST</span>
            <span class="team-color-dot finals-dot" :style="{ background: finals?.team1?.primaryColor }" />
            <span class="abbr">{{ finals?.team1?.abbreviation }}</span>
            <span class="wins">{{ finals?.team1Wins }}</span>
          </div>
          <div class="vs">VS</div>
          <div
            class="team team-2"
            :class="{
              winner: finals?.winner?.teamId === finals?.team2?.teamId,
              'user-team': isUserTeam(finals?.team2?.teamId)
            }"
          >
            <span class="conf-label">WEST</span>
            <span class="team-color-dot finals-dot" :style="{ background: finals?.team2?.primaryColor }" />
            <span class="abbr">{{ finals?.team2?.abbreviation }}</span>
            <span class="wins">{{ finals?.team2Wins }}</span>
          </div>
        </div>
        <div v-else class="matchup finals-matchup pending">
          <div class="team" :class="{ 'preview-team': finalsPreview?.team1, 'user-team': finalsPreview?.team1 && isUserTeam(finalsPreview.team1.teamId) }">
            <span class="conf-label">EAST</span>
            <template v-if="finalsPreview?.team1">
              <span class="team-color-dot finals-dot" :style="{ background: finalsPreview.team1.primaryColor }" />
              <span class="abbr">{{ finalsPreview.team1.abbreviation }}</span>
            </template>
            <template v-else>TBD</template>
          </div>
          <div class="vs">VS</div>
          <div class="team" :class="{ 'preview-team': finalsPreview?.team2, 'user-team': finalsPreview?.team2 && isUserTeam(finalsPreview.team2.teamId) }">
            <span class="conf-label">WEST</span>
            <template v-if="finalsPreview?.team2">
              <span class="team-color-dot finals-dot" :style="{ background: finalsPreview.team2.primaryColor }" />
              <span class="abbr">{{ finalsPreview.team2.abbreviation }}</span>
            </template>
            <template v-else>TBD</template>
          </div>
        </div>
      </div>

      <!-- Champion -->
      <div v-if="champion" class="champion-display">
        <Trophy :size="32" class="champion-trophy" />
        <div class="champion-info">
          <span class="champion-label">NBA Champions</span>
          <span class="champion-name">{{ champion.city }} {{ champion.name }}</span>
        </div>
      </div>
    </div>

    <!-- Western Conference -->
    <div class="conference west">
      <h3 class="conference-title">Western Conference</h3>

      <div class="bracket-grid reverse">
        <!-- Round 1 -->
        <div class="round round-1">
          <div class="round-label">First Round</div>
          <div class="matchups">
            <div
              v-for="(series, idx) in westRound1"
              :key="series?.seriesId || `w1-${idx}`"
              class="matchup-wrapper"
            >

              <div
                class="matchup"
                :class="getSeriesStatusClass(series)"
                @click="handleSeriesClick(series)"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: series?.winner?.teamId === series?.team1?.teamId,
                    'user-team': isUserTeam(series?.team1?.teamId)
                  }"
                >
                  <span class="wins">{{ series?.team1Wins }}</span>
                  <span class="abbr">{{ series?.team1?.abbreviation }}</span>
                  <span class="seed">[{{ series?.team1?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: series?.team1?.primaryColor }" />
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: series?.winner?.teamId === series?.team2?.teamId,
                    'user-team': isUserTeam(series?.team2?.teamId)
                  }"
                >
                  <span class="wins">{{ series?.team2Wins }}</span>
                  <span class="abbr">{{ series?.team2?.abbreviation }}</span>
                  <span class="seed">[{{ series?.team2?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: series?.team2?.primaryColor }" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Round 2 -->
        <div class="round round-2">
          <div class="round-label">Semifinals</div>
          <div class="matchups">
            <!-- Slot 1: first semifinal (fed by R1 matchups 1 & 2) -->
            <div
              v-if="westRound2[0]"
              class="matchup-wrapper"
            >

              <div
                class="matchup"
                :class="getSeriesStatusClass(westRound2[0])"
                @click="handleSeriesClick(westRound2[0])"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: westRound2[0]?.winner?.teamId === westRound2[0]?.team1?.teamId,
                    'user-team': isUserTeam(westRound2[0]?.team1?.teamId)
                  }"
                >
                  <span class="wins">{{ westRound2[0]?.team1Wins }}</span>
                  <span class="abbr">{{ westRound2[0]?.team1?.abbreviation }}</span>
                  <span class="seed">[{{ westRound2[0]?.team1?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: westRound2[0]?.team1?.primaryColor }" />
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: westRound2[0]?.winner?.teamId === westRound2[0]?.team2?.teamId,
                    'user-team': isUserTeam(westRound2[0]?.team2?.teamId)
                  }"
                >
                  <span class="wins">{{ westRound2[0]?.team2Wins }}</span>
                  <span class="abbr">{{ westRound2[0]?.team2?.abbreviation }}</span>
                  <span class="seed">[{{ westRound2[0]?.team2?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: westRound2[0]?.team2?.primaryColor }" />
                </div>
              </div>

            </div>
            <div v-else class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team" :class="{ 'preview-team': westR2Slot1Preview?.team1, 'user-team': westR2Slot1Preview?.team1 && isUserTeam(westR2Slot1Preview.team1.teamId) }">
                  <template v-if="westR2Slot1Preview?.team1">
                    <span class="abbr">{{ westR2Slot1Preview.team1.abbreviation }}</span>
                    <span class="seed">[{{ westR2Slot1Preview.team1.seed }}]</span>
                    <span class="team-color-dot" :style="{ background: westR2Slot1Preview.team1.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': westR2Slot1Preview?.team2, 'user-team': westR2Slot1Preview?.team2 && isUserTeam(westR2Slot1Preview.team2.teamId) }">
                  <template v-if="westR2Slot1Preview?.team2">
                    <span class="abbr">{{ westR2Slot1Preview.team2.abbreviation }}</span>
                    <span class="seed">[{{ westR2Slot1Preview.team2.seed }}]</span>
                    <span class="team-color-dot" :style="{ background: westR2Slot1Preview.team2.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>
            </div>

            <!-- Slot 2: second semifinal (fed by R1 matchups 3 & 4) -->
            <div
              v-if="westRound2[1]"
              class="matchup-wrapper"
            >

              <div
                class="matchup"
                :class="getSeriesStatusClass(westRound2[1])"
                @click="handleSeriesClick(westRound2[1])"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: westRound2[1]?.winner?.teamId === westRound2[1]?.team1?.teamId,
                    'user-team': isUserTeam(westRound2[1]?.team1?.teamId)
                  }"
                >
                  <span class="wins">{{ westRound2[1]?.team1Wins }}</span>
                  <span class="abbr">{{ westRound2[1]?.team1?.abbreviation }}</span>
                  <span class="seed">[{{ westRound2[1]?.team1?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: westRound2[1]?.team1?.primaryColor }" />
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: westRound2[1]?.winner?.teamId === westRound2[1]?.team2?.teamId,
                    'user-team': isUserTeam(westRound2[1]?.team2?.teamId)
                  }"
                >
                  <span class="wins">{{ westRound2[1]?.team2Wins }}</span>
                  <span class="abbr">{{ westRound2[1]?.team2?.abbreviation }}</span>
                  <span class="seed">[{{ westRound2[1]?.team2?.seed }}]</span>
                  <span class="team-color-dot" :style="{ background: westRound2[1]?.team2?.primaryColor }" />
                </div>
              </div>

            </div>
            <div v-else class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team" :class="{ 'preview-team': westR2Slot2Preview?.team1, 'user-team': westR2Slot2Preview?.team1 && isUserTeam(westR2Slot2Preview.team1.teamId) }">
                  <template v-if="westR2Slot2Preview?.team1">
                    <span class="abbr">{{ westR2Slot2Preview.team1.abbreviation }}</span>
                    <span class="seed">[{{ westR2Slot2Preview.team1.seed }}]</span>
                    <span class="team-color-dot" :style="{ background: westR2Slot2Preview.team1.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': westR2Slot2Preview?.team2, 'user-team': westR2Slot2Preview?.team2 && isUserTeam(westR2Slot2Preview.team2.teamId) }">
                  <template v-if="westR2Slot2Preview?.team2">
                    <span class="abbr">{{ westR2Slot2Preview.team2.abbreviation }}</span>
                    <span class="seed">[{{ westR2Slot2Preview.team2.seed }}]</span>
                    <span class="team-color-dot" :style="{ background: westR2Slot2Preview.team2.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Conference Finals -->
        <div class="round round-cf">
          <div class="round-label">Conf. Finals</div>
          <div class="matchups">
            <div class="matchup-wrapper">

              <div
                v-if="westConfFinals"
                class="matchup"
                :class="getSeriesStatusClass(westConfFinals)"
                @click="handleSeriesClick(westConfFinals)"
              >
                <div
                  class="team team-1"
                  :class="{
                    winner: westConfFinals?.winner?.teamId === westConfFinals?.team1?.teamId,
                    'user-team': isUserTeam(westConfFinals?.team1?.teamId)
                  }"
                >
                  <span class="wins">{{ westConfFinals?.team1Wins }}</span>
                  <span class="abbr">{{ westConfFinals?.team1?.abbreviation }}</span>
                  <span class="team-color-dot" :style="{ background: westConfFinals?.team1?.primaryColor }" />
                </div>
                <div
                  class="team team-2"
                  :class="{
                    winner: westConfFinals?.winner?.teamId === westConfFinals?.team2?.teamId,
                    'user-team': isUserTeam(westConfFinals?.team2?.teamId)
                  }"
                >
                  <span class="wins">{{ westConfFinals?.team2Wins }}</span>
                  <span class="abbr">{{ westConfFinals?.team2?.abbreviation }}</span>
                  <span class="team-color-dot" :style="{ background: westConfFinals?.team2?.primaryColor }" />
                </div>
              </div>
              <div v-else class="matchup pending">
                <div class="team" :class="{ 'preview-team': westCFPreview?.team1, 'user-team': westCFPreview?.team1 && isUserTeam(westCFPreview.team1.teamId) }">
                  <template v-if="westCFPreview?.team1">
                    <span class="abbr">{{ westCFPreview.team1.abbreviation }}</span>
                    <span class="team-color-dot" :style="{ background: westCFPreview.team1.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
                <div class="team" :class="{ 'preview-team': westCFPreview?.team2, 'user-team': westCFPreview?.team2 && isUserTeam(westCFPreview.team2.teamId) }">
                  <template v-if="westCFPreview?.team2">
                    <span class="abbr">{{ westCFPreview.team2.abbreviation }}</span>
                    <span class="team-color-dot" :style="{ background: westCFPreview.team2.primaryColor }" />
                  </template>
                  <template v-else>TBD</template>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Empty State -->
  <div v-else class="empty-bracket">
    <Trophy :size="48" class="empty-icon" />
    <p>Playoff bracket not yet generated</p>
  </div>
</template>

<style scoped>
.playoff-bracket {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 1rem;
  padding: 1rem;
  overflow-x: auto;
}

.conference {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.conference-title {
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-primary);
  text-align: center;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
}

[data-theme="light"] .conference-title {
  border-bottom-color: rgba(0, 0, 0, 0.1);
}

.bracket-grid {
  display: flex;
  gap: 0.5rem;
}

.bracket-grid.reverse {
  flex-direction: row-reverse;
}

.round {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 120px;
}

.round-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  text-align: center;
}

.matchups {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  flex: 1;
  gap: 0.5rem;
}

.round-1 .matchups {
  gap: 0.25rem;
}

.round-2 .matchups {
  gap: 2rem;
}

.matchup-wrapper {
  display: flex;
  align-items: center;
  position: relative;
}

.matchup {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-lg);
  padding: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
  flex: 1;
}

[data-theme="light"] .matchup {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(0, 0, 0, 0.1);
}

.matchup:hover {
  border-color: var(--color-primary);
  background: rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

[data-theme="light"] .matchup:hover {
  background: rgba(255, 255, 255, 0.85);
}

.matchup.complete {
  border-color: var(--color-success, #22c55e);
}

.matchup.in-progress {
  border-color: var(--color-primary);
}

.matchup.user-series.in-progress {
  background: rgba(34, 197, 94, 0.08);
  border-color: var(--color-success);
  box-shadow: 0 0 12px rgba(34, 197, 94, 0.15), inset 0 0 0 1px rgba(34, 197, 94, 0.1);
  animation: pulse-user-series 2s ease-in-out infinite;
}

@keyframes pulse-user-series {
  0%, 100% {
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.15), inset 0 0 0 1px rgba(34, 197, 94, 0.1);
    border-color: var(--color-success);
  }
  50% {
    box-shadow: 0 0 18px rgba(34, 197, 94, 0.3), inset 0 0 0 1px rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.8);
  }
}

.matchup.user-series.complete {
  border-color: var(--color-success);
  background: rgba(34, 197, 94, 0.05);
}

.matchup.pending {
  opacity: 1;
  cursor: default;
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 1);
}

[data-theme="light"] .matchup.pending {
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 1);
}

.matchup.pending:hover {
  transform: none;
}

.team {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  font-size: 0.8rem;
  color: var(--color-text-primary);
  border-radius: var(--radius-sm);
}

.team.winner {
  color: var(--color-text-primary);
  font-weight: 600;
}

.team.user-team {
  background: rgba(var(--color-primary-rgb), 0.15);
}

.matchup.pending .team.preview-team {
  font-weight: 600;
}

.matchup.pending .team.user-team {
  background: rgba(34, 197, 94, 0.12);
}

.user-series .team.user-team {
  background: rgba(34, 197, 94, 0.12);
}

.team-color-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.seed {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
}

.abbr {
  font-weight: 600;
  flex: 1;
}

.wins {
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--color-primary);
  min-width: 0.875rem;
  text-align: center;
}

/* Finals Section */
.finals-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
}

.finals-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #ffd700;
}

.finals-matchup-wrapper {
  width: 100%;
  max-width: 180px;
}

.finals-matchup {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 140, 0, 0.05));
  border: 2px solid rgba(255, 215, 0, 0.3);
  padding: 0.5rem;
}

.finals-matchup .team {
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
}

.finals-matchup .conf-label {
  font-size: 0.5rem;
  color: var(--color-text-secondary);
  letter-spacing: 0.1em;
}

.finals-matchup .abbr {
  font-size: 0.95rem;
  text-align: center;
}

.finals-matchup .wins {
  font-size: 1rem;
}

.finals-dot {
  width: 10px;
  height: 10px;
}

.finals-matchup .vs {
  font-size: 0.625rem;
  color: var(--color-text-secondary);
  text-align: center;
  padding: 0.25rem 0;
}

.champion-display {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 140, 0, 0.15));
  border: 2px solid rgba(255, 215, 0, 0.4);
  border-radius: var(--radius-lg);
  margin-top: 0.5rem;
}

.champion-trophy {
  color: #ffd700;
}

.champion-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.champion-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #ffd700;
}

.champion-name {
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

/* Empty State */
.empty-bracket {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 3rem;
  color: var(--color-text-tertiary);
}

.empty-icon {
  opacity: 0.3;
}

/* Responsive */
@media (max-width: 1000px) {
  .playoff-bracket {
    grid-template-columns: 1fr;
    gap: 2rem;
  }

  .finals-section {
    order: -1;
  }

  .bracket-grid,
  .bracket-grid.reverse {
    flex-direction: row;
  }
}
</style>
