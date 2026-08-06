<script setup>
import { useAppUpdateStore } from '@/stores/appUpdate'
import { ArrowUpCircle } from 'lucide-vue-next'

const appUpdate = useAppUpdateStore()

function update() {
  appUpdate.goToStore()
}
function later() {
  appUpdate.dismiss()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="update-nag-fade">
      <div v-if="appUpdate.showNag" class="update-nag-overlay" @click.self="later">
        <div class="update-nag" role="dialog" aria-modal="true" aria-label="Update available">
          <div class="update-nag-icon">
            <ArrowUpCircle :size="34" />
          </div>
          <h2 class="update-nag-title">Update available</h2>
          <p class="update-nag-body">
            A newer version of BBALL SIM is out — update for the latest features and fixes.
          </p>
          <div class="update-nag-actions">
            <button type="button" class="update-nag-btn primary" @click="update">Update</button>
            <button type="button" class="update-nag-btn ghost" @click="later">Later</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.update-nag-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}
.update-nag {
  width: 100%;
  max-width: 360px;
  padding: 24px 22px;
  border-radius: 18px;
  text-align: center;
  background: #1a1f2e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.6);
}
:root[data-theme='light'] .update-nag {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.1);
  color: #111827;
}
.update-nag-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin: 0 auto 12px;
  border-radius: 50%;
  color: #000;
  background: var(--gradient-cosmic);
}
.update-nag-title {
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 800;
}
.update-nag-body {
  margin: 0 0 20px;
  font-size: 13.5px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.7);
}
:root[data-theme='light'] .update-nag-body {
  color: rgba(0, 0, 0, 0.6);
}
.update-nag-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.update-nag-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
}
.update-nag-btn.primary {
  background: var(--gradient-cosmic);
  color: #000;
}
.update-nag-btn.primary:hover {
  background: var(--gradient-cosmic);
  filter: brightness(1.08);
}
.update-nag-btn.ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.75);
}
:root[data-theme='light'] .update-nag-btn.ghost {
  border-color: rgba(0, 0, 0, 0.18);
  color: rgba(0, 0, 0, 0.7);
}

.update-nag-fade-enter-active,
.update-nag-fade-leave-active {
  transition: opacity 0.2s ease;
}
.update-nag-fade-enter-from,
.update-nag-fade-leave-to {
  opacity: 0;
}
</style>
