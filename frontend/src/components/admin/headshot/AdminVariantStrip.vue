<script setup>
import { computed, ref, reactive, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import {
  composeSvg, listAllVariants, listAllVariantsForAudience,
  getLayerTier, LAYERS,
  layerContentVersion,
} from '@/services/headshotComposer'
import { useAudioStore } from '@/stores/audio'
import api from '@/composables/useApi'

const audioStore = useAudioStore()

const props = defineProps({
  // The currently active layer's id (e.g. 'hair', 'face').
  activeLayerId: { type: String, required: true },
  // The admin's preview config — variants render as full headshot thumbnails
  // with the variant swapped in, so the admin can see the change in context.
  config: { type: Object, required: true },
  // Variant key currently being toggled — disables the switch + shows pending state.
  pendingVariant: { type: String, default: null },
  // Layer list for the in-header pill picker. Empty array = no pills.
  layers: { type: Array, default: () => [] },
  // Active audience tab. Filters the strip's variant list to only those
  // tagged for this audience. 'player' (default) preserves legacy behavior.
  audience: { type: String, default: 'player' },
})

// Per-variant SVG content fetched from the backend. This bypasses the
// composer's bundled LAYER_CONTENT entirely — the bundled glob can lag
// behind disk within the same dev session (Vite caches asset transforms),
// so the strip would otherwise keep showing pre-save content even after
// updateLayerVariantContent patched the map.
//
// We re-fetch every time the active layer changes or the content version
// bumps (save/delete/rename). Each thumb passes its fetched content as
// the `face` / `hair` / etc. override to composeSvg, so the rendered
// thumbnail reflects exactly what's on disk right now.
//
// fetchedContent is a reactive plain object (not Map) so per-variant
// updates trigger granular re-renders — each tile resolves the moment
// its S3 fetch returns instead of waiting for the whole batch.
const fetchedContent = reactive({})
// Variants whose backend fetch is in flight. The thumb template overlays
// a spinner while a variant is in this set. Cleared per-variant as each
// fetch resolves (success OR failure), so the overlay can't get stuck.
const pendingFetches = reactive(new Set())

// Generation counter — bumped on every loadVariantsForLayer call. Stale
// fetches (from a layer/audience switch that happened mid-batch) check
// this before mutating state so they can't clobber the active run.
let loadGeneration = 0

async function loadVariantsForLayer(layerId, audience) {
  if (!layerId) return
  const gen = ++loadGeneration

  // Clear prior state so the picker doesn't briefly render with stale
  // content from a previous layer / audience.
  for (const k of Object.keys(fetchedContent)) delete fetchedContent[k]
  pendingFetches.clear()

  const variantList = listAllVariantsForAudience(layerId, audience)
  for (const v of variantList) pendingFetches.add(v)

  await Promise.all(variantList.map(async (v) => {
    try {
      const { data } = await api.get('/api/admin/headshot-layers/variant', {
        params: { layer: layerId, variant: v, audience },
      })
      if (gen !== loadGeneration) return
      if (data?.content) fetchedContent[v] = data.content
    } catch (err) {
      // 503 in prod (no bucket configured) is expected — leave the entry
      // unset so thumbnailFor falls back to the composer's bundled lookup.
    } finally {
      if (gen === loadGeneration) pendingFetches.delete(v)
    }
  }))
}

// Fire on mount + every layer switch + audience switch + every successful
// save/delete/rename. `layerContentVersion` lives in the composer module so
// any of the three admin write paths bumps it, which is exactly when we
// want to refetch.
watch(
  [() => props.activeLayerId, () => props.audience, layerContentVersion],
  ([layerId, audience]) => loadVariantsForLayer(layerId, audience),
  { immediate: true },
)

const emit = defineEmits(['toggle-tier', 'enter-edit', 'create-variant', 'select-layer'])

function selectLayer(layerId) {
  if (layerId !== props.activeLayerId) emit('select-layer', layerId)
}

function enterEdit(variant) {
  emit('enter-edit', { variant, tier: getLayerTier(props.activeLayerId, variant, props.audience) })
}

function requestCreate() {
  emit('create-variant')
}

const layer = computed(() => LAYERS.find(l => l.id === props.activeLayerId) ?? null)

// Filter by active audience tab so the Coaches tab only shows variants
// tagged for coaches. Touch layerContentVersion so chip toggles re-evaluate.
const variants = computed(() => {
  void layerContentVersion.value
  return listAllVariantsForAudience(props.activeLayerId, props.audience)
})

function labelFor(variant) {
  return variant.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Variant filenames use hyphens (e.g. "side-part") but the composer's config
// keys use the original style (e.g. "side_part"). Translate when we need to
// preview a swap.
function configKeyFor(variant) {
  return variant.replace(/-/g, '_')
}

function thumbnailFor(variant) {
  if (!layer.value || !props.config) return ''
  // Use the fresh-from-disk content as the active-layer override. Every
  // thumb gets composed with ITS variant's actual file as the layer source,
  // regardless of whether the layer is string- or integer-keyed in config.
  // Falls back to the bundled lookup (no override) if the fetch hasn't
  // returned yet or failed.
  const fresh = fetchedContent[variant]
  const overrides = fresh ? { [props.activeLayerId]: fresh } : null
  const composed = composeSvg(props.config, overrides, props.audience)
  return _isolateActiveLayer(composed, variant)
}

function isLoading(variant) {
  return pendingFetches.has(variant)
}

function _isolateActiveLayer(svg, variant) {
  const safeLayer = String(props.activeLayerId).replace(/"/g, '')
  // Give each SVG a unique id and PREFIX the selector with it. <style>
  // blocks inside SVGs contribute to the document's global cascade, so an
  // unscoped `[data-layer]:not(...)` rule would also hide layers in the
  // main headshot preview elsewhere on the page. Scoping by SVG id keeps
  // the isolation per-thumb.
  const scopeId = `avs-thumb-${variant}`.replace(/[^a-z0-9-]/gi, '-')
  const styleTag = `<style>#${scopeId} [data-layer]:not([data-layer="${safeLayer}"]){display:none;}</style>`
  return svg.replace(/(<svg)([^>]*?)(>)/, `$1 id="${scopeId}"$2$3${styleTag}`)
}

function isPaid(variant) {
  return getLayerTier(props.activeLayerId, variant, props.audience) === 'paid'
}

function toggleTier(variant) {
  if (props.pendingVariant === variant) return
  const next = isPaid(variant) ? 'generic' : 'paid'
  // Free→Paid is a meaningful promotion (affirmation on success in the parent
  // handler). Suppress the generic click tap synchronously so the global
  // listener doesn't double up. Paid→Free is a normal demotion and keeps
  // the default generic tap.
  if (next === 'paid') audioStore.suppressClickSound()
  emit('toggle-tier', { variant, tier: next })
}

</script>

<template>
  <section class="admin-variant-strip">
    <header class="avs-header">
      <div class="avs-title-block">
        <h2 class="avs-title">Variant Editor</h2>
        <p class="avs-description">
          Pick a layer to filter. Click any variant to open it for editing,
          or use the tier switch to toggle Free / Paid.
        </p>
      </div>
      <div class="avs-controls-row">
        <!-- Pill picker for the active layer. Replaces the old separate
             AdminLayerPanel sidebar — clicking a pill switches which layer's
             variants the grid below shows. -->
        <nav v-if="layers.length > 0" class="avs-layer-pills">
          <button
            v-for="l in layers"
            :key="l.id"
            type="button"
            class="avs-layer-pill"
            :class="{ active: l.id === activeLayerId }"
            @click="selectLayer(l.id)"
          >
            {{ l.label }}
          </button>
        </nav>
        <span class="avs-count">{{ variants.length }}</span>
      </div>
    </header>
    <div class="avs-grid">
      <div
        v-for="variant in variants"
        :key="variant"
        class="avs-cell editable"
        :title="`Click to edit ${labelFor(variant)}`"
        @click="enterEdit(variant)"
      >
        <!-- Bake the content version into the v-html slot's key so a save/
             delete/rename forces Vue to unmount + remount the thumb element
             rather than diffing innerHTML against its previous string. This
             beats relying purely on dep-tracking inside `thumbnailFor` —
             v-html with a stable parent key can keep stale DOM around even
             when the bound expression returns a fresh string.

             Per-tile loading overlay: while this variant's S3 fetch is in
             flight, thumbnailFor falls back to the bundled composer and
             every tile renders the active config's variant — making them
             all look identical until the batch resolves. The overlay
             masks that during the load. -->
        <div class="avs-thumb-wrap">
          <div
            :key="`thumb-${variant}-${layerContentVersion}`"
            class="avs-thumb"
            v-html="thumbnailFor(variant)"
          />
          <div v-if="isLoading(variant)" class="avs-thumb-loader" aria-label="Loading variant">
            <div class="avs-spinner"></div>
          </div>
        </div>
        <div class="avs-meta">
          <span class="avs-name">{{ labelFor(variant) }}</span>
          <div class="avs-toggle-row" :class="{ paid: isPaid(variant), pending: pendingVariant === variant }">
            <button
              type="button"
              class="avs-switch"
              :class="{ on: isPaid(variant) }"
              :disabled="pendingVariant === variant"
              :aria-pressed="isPaid(variant)"
              :title="isPaid(variant) ? 'Paid — click to make Free' : 'Free — click to make Paid'"
              @click.stop="toggleTier(variant)"
            >
              <span class="avs-switch-track">
                <span class="avs-switch-thumb"></span>
              </span>
            </button>
            <span class="avs-tier-label">{{ isPaid(variant) ? 'Paid' : 'Free' }}</span>
          </div>
        </div>
      </div>

      <!-- "New Variant" tile sits at the end of the grid. Click opens the
           name+tier modal in the parent view. -->
      <button
        type="button"
        class="avs-cell avs-new"
        title="Create a new variant for this layer"
        @click="requestCreate"
      >
        <div class="avs-new-icon"><Plus :size="32" /></div>
        <span class="avs-new-label">New Variant</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.admin-variant-strip {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.avs-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--glass-border);
}

.avs-title-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.avs-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
}

.avs-description {
  margin: 0;
  font-size: 0.72rem;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.avs-controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.avs-layer-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  margin-right: 8px;
}

.avs-layer-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--glass-border);
  color: var(--color-text-secondary);
  border-radius: var(--radius-full);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.avs-layer-pill:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.avs-layer-pill.active {
  background: rgba(168, 85, 247, 0.22);
  border-color: rgba(168, 85, 247, 0.55);
  color: var(--color-text-primary);
}

.avs-count {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  padding: 2px 8px;
}

.avs-empty {
  padding: 18px 14px;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  text-align: center;
}

.avs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 10px;
  padding: 10px;
  overflow-y: auto;
}

.avs-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
}

.avs-cell.editable {
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.avs-cell.editable:hover {
  background: rgba(168, 85, 247, 0.1);
  border-color: rgba(168, 85, 247, 0.4);
}

.avs-new {
  background: rgba(255, 255, 255, 0.02);
  border: 1px dashed var(--glass-border);
  color: var(--color-text-secondary);
  cursor: pointer;
  font-family: inherit;
  padding: 18px 8px;
  justify-content: center;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.avs-new:hover {
  color: var(--color-text-primary);
  border-color: rgba(168, 85, 247, 0.5);
  background: rgba(168, 85, 247, 0.08);
}

.avs-new-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1px dashed currentColor;
}

.avs-new-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.avs-thumb {
  width: 80px;
  height: 80px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Photoshop-style transparency checkerboard — same pattern used by the
     pixel canvas. Replaces the previous solid dark circle so the admin can
     see the variant against an unambiguous "transparent" backdrop. */
  background-color: var(--glass-bg);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.14) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.14) 75%);
  background-size: 12px 12px;
  background-position: 0 0, 6px 6px;
}

[data-theme="light"] .avs-thumb {
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
}

.avs-thumb :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.avs-thumb-wrap {
  position: relative;
  width: 80px;
  height: 80px;
}

.avs-thumb-loader {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: var(--radius-lg);
  pointer-events: none;
}

[data-theme="light"] .avs-thumb-loader {
  background: rgba(255, 255, 255, 0.7);
}

.avs-spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: rgba(168, 85, 247, 0.95);
  animation: avs-spin 0.7s linear infinite;
}

[data-theme="light"] .avs-spinner {
  border: 2px solid rgba(0, 0, 0, 0.15);
  border-top-color: rgba(168, 85, 247, 0.95);
}

@keyframes avs-spin {
  to { transform: rotate(360deg); }
}

.avs-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.avs-name {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  text-align: center;
  word-break: break-word;
}

.avs-toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.avs-toggle-row.pending {
  opacity: 0.6;
  cursor: wait;
}

.avs-switch {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.avs-switch:disabled {
  cursor: wait;
}

.avs-switch-track {
  display: block;
  width: 32px;
  height: 18px;
  background: rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  position: relative;
  transition: background 0.2s ease;
}

.avs-switch.on .avs-switch-track {
  background: rgba(251, 191, 36, 0.75);
}

.avs-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s ease;
}

.avs-switch.on .avs-switch-thumb {
  transform: translateX(14px);
}

.avs-tier-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  min-width: 32px;
}

.avs-toggle-row.paid .avs-tier-label {
  color: #fbbf24;
}

/* Light mode — dark theme defaults rely on white-on-translucent contrast
   and a bright amber that disappears against a light page. Override with
   darker tones so the toggle is legible on a light background. */
[data-theme="light"] .avs-switch-track {
  background: rgba(0, 0, 0, 0.22);
}

[data-theme="light"] .avs-switch.on .avs-switch-track {
  background: #b45309;  /* amber-700 — readable on light, still clearly amber */
}

[data-theme="light"] .avs-toggle-row.paid .avs-tier-label {
  color: #b45309;
}

</style>
