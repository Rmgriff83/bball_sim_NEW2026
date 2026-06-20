<script setup>
// Part 2: the owner's end-of-contract verdict. Shown in the offseason modal chain
// (after awards/retirements, before the offseason hub). Mandatory — the user must
// resolve it before continuing.
//   • extend       → owner re-signs the GM (+1 GM Level). One button: re-sign.
//   • not_extended → owner moves on. The user must pick a new team to run
//                    (gated by GM Level), then takes over there.
import { ref, computed, watch } from 'vue'
import { Crown, CheckCircle2, Circle, TrendingUp, ArrowRight, ArrowLeft } from 'lucide-vue-next'
import TeamPicker from '@/components/team/TeamPicker.vue'
import OwnerQuickInfo from '@/components/team/OwnerQuickInfo.vue'
import { gmLevelLabel, nextGmLevel } from '@/engine/data/gmLevels'
import { useAudioStore } from '@/stores/audio'

const audio = useAudioStore()

const props = defineProps({
  show: { type: Boolean, default: false },
  decision: { type: Object, default: null },
  teams: { type: Array, default: () => [] },
  gmLevel: { type: Number, default: 0 },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['extend', 'switch'])

// not_extended is a two-step flow: read the verdict, then pick a new team.
const phase = ref('verdict')
const selectedTeam = ref(null)

watch(() => props.show, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) {
    phase.value = 'verdict'
    selectedTeam.value = null
  }
})

const isExtend = computed(() => props.decision?.decision === 'extend')
const ownerName = computed(() => props.decision?.ownerName ?? 'Your owner')
const nextLevelLabel = computed(() => gmLevelLabel(nextGmLevel(props.gmLevel)))
const willPromote = computed(() => nextGmLevel(props.gmLevel) !== props.gmLevel)
const subtasks = computed(() => props.decision?.subtasks ?? [])

// Picker copy depends on how the user got here: walking away from a standing
// extension offer vs. having been let go by the owner.
const pickIntro = computed(() =>
  isExtend.value
    ? `You're turning down ${ownerName.value}'s extension. Choose the franchise you want to take over instead.`
    : 'Choose the franchise you want to take over as GM.'
)

function confirmExtend() {
  if (props.busy) return
  emit('extend')
}
function goToPicker() {
  phase.value = 'pick'
}
// Turning down a standing extension offer — play the decline (cancel) chime
// instead of the generic tap.
function declineExtension() {
  audio.cancel()
  goToPicker()
}
// Only relevant when the user declined an extension — lets them undo an
// accidental "pursue other jobs" and re-sign after all.
function goBackToVerdict() {
  if (props.busy) return
  selectedTeam.value = null
  phase.value = 'verdict'
}
function confirmSwitch() {
  if (props.busy || !selectedTeam.value) return
  emit('switch', selectedTeam.value.abbreviation)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show && decision" class="modal-overlay">
        <div class="modal-container">
          <header class="modal-header" :class="isExtend ? 'good' : 'bad'">
            <div class="hdr-icon"><Crown :size="24" /></div>
            <div>
              <h2 class="modal-title">
                {{ isExtend ? 'Contract Extended' : 'Contract Not Renewed' }}
              </h2>
              <p class="modal-sub">{{ ownerName }} · {{ decision.expectationLabel }} mandate</p>
            </div>
          </header>

          <main class="modal-content">
            <!-- VERDICT -->
            <template v-if="phase === 'verdict'">
              <div class="verdict-score">
                <div class="score-ring" :style="{ '--c': decision.satisfactionColor }">
                  <span class="score-val">{{ decision.combined }}<small>%</small></span>
                  <span class="score-label">{{ decision.satisfactionLabel }}</span>
                </div>
                <div class="score-breakdown">
                  <div class="sb-row">
                    <span>Wins record</span><b>{{ decision.winsSatisfaction }}% <em>×60%</em></b>
                  </div>
                  <div class="sb-row">
                    <span>Sub-tasks</span><b>{{ decision.subtaskScore }}% <em>×40%</em></b>
                  </div>
                  <div class="sb-row total">
                    <span>Needed to extend</span><b>{{ decision.threshold }}%</b>
                  </div>
                </div>
              </div>

              <p class="verdict-blurb">
                <template v-if="isExtend">
                  {{ ownerName }} is satisfied with your work and wants to keep building with you.
                  Re-sign a fresh 2-year deal to continue.
                </template>
                <template v-else>
                  {{ ownerName }} has decided to move in another direction. Your time with this
                  franchise is over — but your reputation travels. Choose a new team to lead.
                </template>
              </p>

              <div v-if="isExtend && willPromote" class="promo-banner">
                <TrendingUp :size="16" />
                <span>Re-signing promotes you to <b>GM Level {{ nextLevelLabel }}</b>.</span>
              </div>

              <div class="subtask-recap">
                <h4 class="recap-title">Owner Sub-Tasks ({{ decision.metCount }}/{{ decision.total }})</h4>
                <ul class="recap-list">
                  <li v-for="t in subtasks" :key="t.id" :class="{ met: t.met }">
                    <CheckCircle2 v-if="t.met" :size="15" />
                    <Circle v-else :size="15" />
                    <span>{{ t.label }}</span>
                    <span v-if="t.progress" class="recap-progress" :class="{ met: t.met }">{{ t.progress.current }}/{{ t.progress.target }}</span>
                    <span v-if="t.global" class="recap-tag">Global</span>
                  </li>
                </ul>
              </div>
            </template>

            <!-- TEAM PICKER (not extended) -->
            <template v-else>
              <p class="pick-intro">{{ pickIntro }}</p>

              <div v-if="selectedTeam" class="switch-preview">
                <div class="sp-badge" :style="{ backgroundColor: selectedTeam.primary_color }">
                  {{ selectedTeam.abbreviation }}
                </div>
                <div class="sp-info">
                  <span class="sp-name">{{ selectedTeam.name }}</span>
                  <span class="sp-meta">{{ selectedTeam.division }} Division</span>
                  <OwnerQuickInfo :team-abbreviation="selectedTeam.abbreviation" />
                </div>
              </div>

              <TeamPicker
                v-model="selectedTeam"
                :teams="teams"
                :gm-level="gmLevel"
                :exclude-abbreviation="decision.teamAbbreviation"
              />
            </template>
          </main>

          <footer class="modal-footer">
            <template v-if="phase === 'verdict'">
              <template v-if="isExtend">
                <button class="btn-secondary decline" :disabled="busy" @click="declineExtension">
                  Decline &amp; pursue other jobs
                </button>
                <button class="btn-confirm good" :disabled="busy" @click="confirmExtend">
                  {{ busy ? 'Re-signing…' : 'Re-sign 2-Year Contract' }}
                </button>
              </template>
              <button v-else class="btn-confirm" @click="goToPicker">
                Find a New Team <ArrowRight :size="16" />
              </button>
            </template>
            <template v-else>
              <button
                v-if="isExtend"
                class="btn-secondary back-left"
                :disabled="busy"
                @click="goBackToVerdict"
              >
                <ArrowLeft :size="16" /> Back
              </button>
              <button
                class="btn-confirm good"
                :disabled="busy || !selectedTeam"
                @click="confirmSwitch"
              >
                {{ busy
                  ? 'Taking over…'
                  : selectedTeam
                    ? `Become GM of the ${selectedTeam.name}`
                    : 'Select a team' }}
              </button>
            </template>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(4px);
}
.modal-container {
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-secondary, #15171c);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--glass-border);
}
.modal-header.good {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.18), rgba(34, 197, 94, 0.04));
}
.modal-header.bad {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.18), rgba(239, 68, 68, 0.04));
}
.hdr-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(245, 199, 44, 0.18);
  color: #ffc72c;
  flex-shrink: 0;
}
.modal-title {
  font-size: 1.2rem;
  font-weight: 700;
  margin: 0;
  color: var(--color-text-primary);
}
.modal-sub {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}
.modal-content {
  padding: 20px 22px;
  overflow-y: auto;
}
.verdict-score {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.score-ring {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 4px solid var(--c, #f59e0b);
  flex-shrink: 0;
}
.score-val {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1;
}
.score-val small {
  font-size: 0.8rem;
  font-weight: 600;
}
.score-label {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  margin-top: 3px;
  text-align: center;
}
.score-breakdown {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sb-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--color-text-secondary);
}
.sb-row b {
  color: var(--color-text-primary);
}
.sb-row b em {
  font-style: normal;
  font-weight: 500;
  color: var(--color-text-tertiary);
}
.sb-row.total {
  border-top: 1px dashed var(--glass-border);
  padding-top: 5px;
  margin-top: 2px;
}
.verdict-blurb {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text-secondary);
  margin: 0 0 1rem;
}
.promo-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  background: rgba(245, 199, 44, 0.12);
  border: 1px solid rgba(245, 199, 44, 0.3);
  color: var(--color-text-primary);
  font-size: 0.82rem;
  margin-bottom: 1rem;
}
.promo-banner b { color: #f5c72c; }
.subtask-recap {
  border-top: 1px solid var(--glass-border);
  padding-top: 0.85rem;
}
.recap-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 0.6rem;
}
.recap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.4rem 1rem;
}
.recap-list li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.82rem;
  color: var(--color-text-tertiary);
}
.recap-list li.met {
  color: var(--color-text-primary);
}
.recap-list li.met svg {
  color: #22c55e;
}
.recap-progress {
  font-size: 0.62rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 0 6px;
}
.recap-progress.met {
  color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
}
.recap-tag {
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #f5c72c;
  background: rgba(245, 199, 44, 0.14);
  border-radius: 4px;
  padding: 0 4px;
}
.pick-intro {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin: 0 0 1rem;
}
.switch-preview {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 1rem;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}
.sp-badge {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 0.78rem;
  font-weight: 700;
  color: white;
}
.sp-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.sp-name {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
}
.sp-meta {
  font-size: 0.76rem;
  color: var(--color-text-secondary);
}
.modal-footer {
  padding: 14px 22px;
  border-top: 1px solid var(--glass-border);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.btn-confirm {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 11px 22px;
  border-radius: var(--radius-xl);
  font-size: 0.88rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  background: var(--color-primary);
  color: white;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.btn-confirm.good {
  background: #22c55e;
}
.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 18px;
  border-radius: var(--radius-xl);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px solid var(--glass-border);
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}
.btn-secondary:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.04);
}
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary.back-left {
  margin-right: auto;
}
/* Decline an extension offer — our red, filled, to read as the negative choice. */
.btn-secondary.decline {
  background: var(--color-primary);
  border-color: transparent;
  color: white;
}
.btn-secondary.decline:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: transparent;
  color: white;
  filter: brightness(1.08);
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
