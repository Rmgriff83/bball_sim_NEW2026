<script setup>
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { composeSvg, LAYERS } from '@/services/headshotComposer'

const props = defineProps({
  layerId: { type: String, default: null },
  config: { type: Object, required: true },
  inSheet: { type: Boolean, default: false },
})

const emit = defineEmits(['update:config', 'close'])

const layer = computed(() => LAYERS.find(l => l.id === props.layerId) ?? null)

// Style variants for the current layer (e.g. hair styles, jaw widths)
const styleVariants = computed(() => layer.value?.styleVariants ?? null)

// Color palette swatches — only shown for layers that declare their own
// colorPalette. Derived-color layers (stubble, nose, neck) intentionally
// have no palette here — their color follows the Face skin tone by design,
// so the user changes it from the Face layer.
const colorEntries = computed(() => {
  if (!layer.value || !layer.value.colorPalette) return null
  const palette = layer.value.colorPalette
  const configKey = layer.value.colorKey
  return Object.entries(palette).map(([key, value]) => {
    const hex = typeof value === 'string' ? value : (value.base || value.iris || '#000')
    return { key, hex, configKey }
  })
})

// What field in config does this layer's style toggle control?
const styleConfigKey = computed(() => layer.value?.styleKey ?? null)
const currentStyleValue = computed(() => {
  if (!styleConfigKey.value) return null
  return props.config[styleConfigKey.value]
})

function setStyle(variant) {
  if (!styleConfigKey.value) return
  emit('update:config', { ...props.config, [styleConfigKey.value]: variant })
}

function setColor(key, configKey) {
  emit('update:config', { ...props.config, [configKey]: key })
}

function toggleStubble() {
  emit('update:config', { ...props.config, hasStubble: !props.config.hasStubble })
}

// Thumbnail for a style variant — compose the full headshot with just this
// layer's style overridden. Memoized via computed map.
function thumbnailFor(variant) {
  if (!styleConfigKey.value) return ''
  return composeSvg({ ...props.config, [styleConfigKey.value]: variant })
}

function labelForVariant(variant) {
  if (typeof variant === 'number') return String(variant)
  return String(variant).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
</script>

<template>
  <div
    v-if="layer"
    class="context-menu"
    :class="{ sheet: inSheet }"
    data-tour="editor-context-menu"
  >
    <header class="ctx-header">
      <h3>{{ layer.label }}</h3>
      <button type="button" class="ctx-close" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>

    <!-- Toggle layer (stubble) -->
    <div v-if="layer.toggleKey === 'hasStubble'" class="toggle-row">
      <span>{{ config.hasStubble ? 'On' : 'Off' }}</span>
      <button
        class="ctx-toggle"
        :class="{ on: config.hasStubble }"
        @click="toggleStubble"
      >
        <span class="ctx-toggle-track">
          <span class="ctx-toggle-thumb"></span>
        </span>
      </button>
    </div>

    <!-- Style variants grid -->
    <section v-if="styleVariants" class="ctx-section">
      <h4>Style</h4>
      <div class="style-grid">
        <button
          v-for="variant in styleVariants"
          :key="variant"
          type="button"
          class="style-cell"
          :class="{ active: currentStyleValue === variant }"
          :title="labelForVariant(variant)"
          @click="setStyle(variant)"
        >
          <div class="style-thumb" v-html="thumbnailFor(variant)" />
          <span class="style-label">{{ labelForVariant(variant) }}</span>
        </button>
      </div>
    </section>

    <!-- Color swatches -->
    <section v-if="colorEntries" class="ctx-section">
      <h4>Color</h4>
      <div class="swatch-row">
        <button
          v-for="entry in colorEntries"
          :key="entry.configKey + ':' + entry.key"
          type="button"
          class="swatch"
          :class="{ active: config[entry.configKey] === entry.key }"
          :style="{ background: entry.hex }"
          :title="entry.key"
          @click="setColor(entry.key, entry.configKey)"
        />
      </div>
    </section>

    <!-- No edits for derived-only layers (neck) -->
    <p
      v-if="!styleVariants && !colorEntries && layer.toggleKey !== 'hasStubble'"
      class="derived-note"
    >
      This layer follows the Face skin tone. Change it from the Face layer.
    </p>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  top: 50%;
  right: 140px;
  transform: translateY(-50%);
  width: 320px;
  max-height: 70vh;
  overflow-y: auto;
  padding: 14px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-2xl);
  backdrop-filter: saturate(180%) blur(20px);
  z-index: 41;
}

.context-menu.sheet {
  position: fixed;
  top: auto;
  right: 0;
  left: 0;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 96px);
  transform: none;
  width: auto;
  margin: 0 12px;
  max-height: 50vh;
}

.ctx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.ctx-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.ctx-close {
  background: transparent;
  border: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 4px;
  display: flex;
}

.ctx-close:hover {
  color: var(--color-text-primary);
}

.ctx-section {
  margin-top: 12px;
}

.ctx-section h4 {
  margin: 0 0 8px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.style-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.style-cell:hover {
  background: rgba(255, 255, 255, 0.07);
}

.style-cell.active {
  border-color: rgba(168, 85, 247, 0.6);
  background: rgba(168, 85, 247, 0.14);
}

.style-thumb {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.15);
}

.style-thumb :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.style-label {
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.swatch:hover {
  transform: scale(1.08);
}

.swatch.active {
  border-color: rgba(168, 85, 247, 0.9);
  transform: scale(1.08);
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.ctx-toggle {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}

.ctx-toggle-track {
  display: block;
  width: 44px;
  height: 24px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  position: relative;
  transition: background 0.2s ease;
}

.ctx-toggle.on .ctx-toggle-track {
  background: rgba(168, 85, 247, 0.7);
}

.ctx-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.ctx-toggle.on .ctx-toggle-thumb {
  transform: translateX(20px);
}

.derived-note {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin: 8px 0 0;
}
</style>
