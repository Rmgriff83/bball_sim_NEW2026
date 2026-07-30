<script setup>
// Team identity editor (Custom Roster editor) — renames a team's city and
// display name on the PER-CAMPAIGN team record. The abbreviation (and id) is
// deliberately immutable: it keys the logo asset lookup, the owner mapping
// (findOwnerForTeam), coach master data, player teamAbbreviation snapshots,
// and the community-build export — renaming name/city touches none of those.
import { ref, computed, watch } from 'vue'
import { Pencil, Loader2 } from 'lucide-vue-next'

const props = defineProps({
  show: { type: Boolean, default: false },
  team: { type: Object, default: null },
})

const emit = defineEmits(['close', 'save'])

const city = ref('')
const nickname = ref('')
const saving = ref(false)

// Silent-discard guard (mirrors the history/coach editors): snapshot the
// editable state right after open-seeding; a close request with changed
// state asks first.
const confirmDiscard = ref(false)
let _initialSnapshot = ''

function _snapshot() {
  return JSON.stringify({ c: city.value, n: nickname.value })
}

function requestClose() {
  if (_snapshot() !== _initialSnapshot) {
    confirmDiscard.value = true
    return
  }
  emit('close')
}

watch(() => props.show, (open) => {
  if (!open || !props.team) return
  const teamCity = props.team.city ?? ''
  const fullName = props.team.name ?? ''
  city.value = teamCity
  // The stored `name` is the full display name including the city (e.g.
  // "Boston Shamrocks", city "Boston") — strip the city prefix to seed the
  // nickname field; fall back to the whole name for teams that don't follow
  // the pattern.
  nickname.value = teamCity && fullName.startsWith(`${teamCity} `)
    ? fullName.slice(teamCity.length + 1)
    : fullName
  confirmDiscard.value = false
  _initialSnapshot = _snapshot()
})

const composedName = computed(() =>
  `${city.value.trim()} ${nickname.value.trim()}`.replace(/\s+/g, ' ').trim())

const canSave = computed(() => nickname.value.trim().length > 0)

function save() {
  if (!props.team || saving.value || !canSave.value) return
  saving.value = true
  try {
    emit('save', {
      ...props.team,
      city: city.value.trim().slice(0, 40),
      name: composedName.value.slice(0, 60),
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="show && team" class="tie-overlay" @click.self="requestClose">
      <div class="tie-modal">
        <h3><Pencil :size="16" /> Rename Team</h3>

        <div class="tie-fields">
          <label class="tie-field">
            <span>City</span>
            <input v-model="city" type="text" maxlength="40" class="tie-input" placeholder="e.g. Boston" />
          </label>
          <label class="tie-field">
            <span>Team Name</span>
            <input v-model="nickname" type="text" maxlength="40" class="tie-input" placeholder="e.g. Shamrocks" />
          </label>
        </div>

        <div class="tie-preview">
          <span class="tie-preview-label">Displays as</span>
          <span class="tie-preview-name">{{ composedName || '—' }}</span>
          <span class="tie-abbr" title="The abbreviation is fixed — it keys the logo, owner, and coach data.">
            {{ team.abbreviation }}
          </span>
        </div>
        <p class="tie-hint">
          The 3-letter abbreviation stays fixed — it's what links this team to
          its logo, owner, and coach.
        </p>

        <div class="tie-actions">
          <!-- tie-cancel: token class for the global dismiss SFX. -->
          <button class="tie-secondary tie-cancel" @click="requestClose">Cancel</button>
          <button class="tie-primary" :disabled="saving || !canSave" @click="save">
            <Loader2 v-if="saving" :size="15" class="spin" /> Save Name
          </button>
        </div>
      </div>

      <!-- Unsaved-changes discard confirm -->
      <div v-if="confirmDiscard" class="tie-discard-overlay">
        <div class="tie-discard-box">
          <p>Discard unsaved changes to this team's name?</p>
          <div class="tie-discard-actions">
            <button class="tie-primary" @click="confirmDiscard = false">Keep editing</button>
            <button class="tie-secondary tie-cancel tie-discard-confirm" @click="confirmDiscard = false; emit('close')">
              Discard
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tie-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  padding: 20px;
}

.tie-modal {
  width: 100%;
  max-width: 420px;
  border-radius: var(--radius-xl, 16px);
  padding: 22px;
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
}

.tie-modal h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: 1.05rem;
}

.tie-fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

@media (max-width: 380px) {
  .tie-fields { grid-template-columns: 1fr; }
}

.tie-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-tertiary);
}

.tie-input {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  font-size: 0.9rem;
  min-width: 0;
}

.tie-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  margin-bottom: 8px;
  flex-wrap: wrap;
}

[data-theme="light"] .tie-preview {
  background: rgba(0, 0, 0, 0.04);
}

.tie-preview-label {
  font-size: 0.66rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
}

.tie-preview-name {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.tie-abbr {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 3px 8px;
  border-radius: 8px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  cursor: default;
}

.tie-hint {
  margin: 0 0 14px;
  font-size: 0.7rem;
  line-height: 1.45;
  color: var(--color-text-tertiary);
}

.tie-actions { display: flex; gap: 10px; justify-content: flex-end; }

.tie-discard-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 20px;
}

.tie-discard-box {
  background: var(--glass-bg-elevated, var(--color-bg-secondary));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl, 16px);
  padding: 20px;
  max-width: 320px;
  text-align: center;
}

.tie-discard-box p {
  margin: 0 0 14px;
  font-size: 0.92rem;
  color: var(--color-text-primary);
}

.tie-discard-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.tie-discard-confirm {
  border-color: rgba(239, 68, 68, 0.5);
  color: var(--color-error, #ef4444);
}

.tie-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
}

.tie-primary:disabled { opacity: 0.6; }

.tie-secondary {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  padding: 10px 16px;
  font-weight: 600;
  cursor: pointer;
}

.spin { animation: tie-spin 0.9s linear infinite; }
@keyframes tie-spin { to { transform: rotate(360deg); } }
</style>
