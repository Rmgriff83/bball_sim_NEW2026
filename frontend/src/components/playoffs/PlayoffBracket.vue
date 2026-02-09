<script setup>
import { computed } from 'vue'
import { Trophy, ChevronRight } from 'lucide-vue-next'

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

function isUserTeam(teamId) {
  return teamId == props.userTeamId
}

function getSeriesStatusClass(series) {
  if (!series) return 'pending'
  if (series.status === 'complete') return 'complete'
  if (series.status === 'in_progress') return 'in-progress'
  return 'pending'
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
                  <span class="seed">[{{ series?.team2?.seed }}]</span>
                  <span class="abbr">{{ series?.team2?.abbreviation }}</span>
                  <span class="wins">{{ series?.team2Wins }}</span>
                </div>
              </div>
              <div class="connector right" />
            </div>
          </div>
        </div>

        <!-- Round 2 -->
        <div class="round round-2">
          <div class="round-label">Semifinals</div>
          <div class="matchups">
            <div
              v-for="(series, idx) in eastRound2"
              :key="series?.seriesId || `e2-${idx}`"
              class="matchup-wrapper"
            >
              <div class="connector left" />
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
                  <span class="seed">[{{ series?.team2?.seed }}]</span>
                  <span class="abbr">{{ series?.team2?.abbreviation }}</span>
                  <span class="wins">{{ series?.team2Wins }}</span>
                </div>
              </div>
              <div class="connector right" />
            </div>
            <!-- Placeholder if no round 2 yet -->
            <div v-if="eastRound2.length === 0" class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team">TBD</div>
                <div class="team">TBD</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Conference Finals -->
        <div class="round round-cf">
          <div class="round-label">Conf. Finals</div>
          <div class="matchups">
            <div class="matchup-wrapper">
              <div class="connector left" />
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
                  <span class="abbr">{{ eastConfFinals?.team2?.abbreviation }}</span>
                  <span class="wins">{{ eastConfFinals?.team2Wins }}</span>
                </div>
              </div>
              <div v-else class="matchup pending">
                <div class="team">TBD</div>
                <div class="team">TBD</div>
              </div>
              <div class="connector right finals" />
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
            <span class="abbr">{{ finals?.team2?.abbreviation }}</span>
            <span class="wins">{{ finals?.team2Wins }}</span>
          </div>
        </div>
        <div v-else class="matchup finals-matchup pending">
          <div class="team"><span class="conf-label">EAST</span>TBD</div>
          <div class="vs">VS</div>
          <div class="team"><span class="conf-label">WEST</span>TBD</div>
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
              <div class="connector left" />
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
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Round 2 -->
        <div class="round round-2">
          <div class="round-label">Semifinals</div>
          <div class="matchups">
            <div
              v-for="(series, idx) in westRound2"
              :key="series?.seriesId || `w2-${idx}`"
              class="matchup-wrapper"
            >
              <div class="connector right" />
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
                </div>
              </div>
              <div class="connector left" />
            </div>
            <div v-if="westRound2.length === 0" class="matchup-wrapper placeholder">
              <div class="matchup pending">
                <div class="team">TBD</div>
                <div class="team">TBD</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Conference Finals -->
        <div class="round round-cf">
          <div class="round-label">Conf. Finals</div>
          <div class="matchups">
            <div class="matchup-wrapper">
              <div class="connector left finals" />
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
                </div>
              </div>
              <div v-else class="matchup pending">
                <div class="team">TBD</div>
                <div class="team">TBD</div>
              </div>
              <div class="connector right" />
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
  color: var(--color-text-secondary);
  text-align: center;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--glass-border);
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
  min-width: 100px;
}

.round-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
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
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: 0.25rem;
  cursor: pointer;
  transition: all 0.2s;
  flex: 1;
}

.matchup:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
}

.matchup.complete {
  border-color: var(--color-success, #22c55e);
}

.matchup.in-progress {
  border-color: var(--color-primary);
  animation: pulse-border 2s infinite;
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--color-primary); }
  50% { border-color: rgba(var(--color-primary-rgb), 0.5); }
}

.matchup.pending {
  opacity: 0.5;
  cursor: default;
}

.matchup.pending:hover {
  transform: none;
}

.team {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.375rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.team.winner {
  color: var(--color-text-primary);
  font-weight: 600;
}

.team.user-team {
  background: rgba(var(--color-primary-rgb), 0.15);
  border-radius: var(--radius-sm);
}

.seed {
  font-size: 0.625rem;
  color: var(--color-text-tertiary);
}

.abbr {
  font-weight: 600;
  flex: 1;
}

.wins {
  font-weight: 700;
  color: var(--color-primary);
  min-width: 0.75rem;
  text-align: center;
}

.connector {
  width: 8px;
  height: 1px;
  background: var(--glass-border);
  flex-shrink: 0;
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
  max-width: 160px;
}

.finals-matchup {
  background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(255, 140, 0, 0.05));
  border: 2px solid rgba(255, 215, 0, 0.3);
}

.finals-matchup .team {
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
}

.finals-matchup .conf-label {
  font-size: 0.5rem;
  color: var(--color-text-tertiary);
  letter-spacing: 0.1em;
}

.finals-matchup .vs {
  font-size: 0.625rem;
  color: var(--color-text-tertiary);
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
@media (max-width: 768px) {
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
