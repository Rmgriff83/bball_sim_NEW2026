<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Animation state from usePlayAnimation
  isPlaying: {
    type: Boolean,
    default: false
  },
  currentPossessionIndex: {
    type: Number,
    default: 0
  },
  totalPossessions: {
    type: Number,
    default: 0
  },
  progress: {
    type: Number,
    default: 0
  },
  playbackSpeed: {
    type: Number,
    default: 1
  },
  currentPlayName: {
    type: String,
    default: ''
  },
  currentTeam: {
    type: String,
    default: 'home'
  },
  currentQuarter: {
    type: Number,
    default: 1
  },
  currentDescription: {
    type: String,
    default: ''
  },
  homeTeamName: {
    type: String,
    default: 'Home'
  },
  awayTeamName: {
    type: String,
    default: 'Away'
  },
  homeTeamColor: {
    type: String,
    default: '#3B82F6'
  },
  awayTeamColor: {
    type: String,
    default: '#EF4444'
  }
})

const emit = defineEmits([
  'play',
  'pause',
  'stop',
  'toggle-play-pause',
  'next-possession',
  'previous-possession',
  'set-speed',
  'seek'
])

const speedOptions = [0.5, 1, 2, 4]

const teamDisplayName = computed(() => {
  return props.currentTeam === 'home' ? props.homeTeamName : props.awayTeamName
})

const teamColor = computed(() => {
  return props.currentTeam === 'home' ? props.homeTeamColor : props.awayTeamColor
})

const quarterDisplay = computed(() => {
  if (props.currentQuarter <= 4) {
    return `Q${props.currentQuarter}`
  }
  return `OT${props.currentQuarter - 4}`
})

const progressPercent = computed(() => {
  return Math.round(props.progress * 100)
})

function handleSeek(event) {
  const rect = event.target.getBoundingClientRect()
  const x = event.clientX - rect.left
  const percent = x / rect.width
  emit('seek', percent)
}
</script>

<template>
  <div class="play-animator">
    <!-- Play Info Header -->
    <div class="play-info">
      <div class="team-indicator" :style="{ backgroundColor: teamColor }">
        {{ teamDisplayName }}
      </div>
      <div class="play-details">
        <div class="play-name">{{ currentPlayName || 'Play' }}</div>
        <div class="play-quarter">{{ quarterDisplay }}</div>
      </div>
      <div class="possession-counter">
        {{ currentPossessionIndex + 1 }} / {{ totalPossessions }}
      </div>
    </div>

    <!-- Current Action Description -->
    <div v-if="currentDescription" class="action-description">
      {{ currentDescription }}
    </div>

    <!-- Progress Bar -->
    <div class="progress-container" @click="handleSeek">
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: progressPercent + '%', backgroundColor: teamColor }"
        />
      </div>
    </div>

    <!-- Playback Controls -->
    <div class="controls">
      <div class="control-group">
        <!-- Previous -->
        <button
          class="control-btn"
          :disabled="currentPossessionIndex === 0"
          @click="emit('previous-possession')"
          title="Previous Possession"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
          </svg>
        </button>

        <!-- Play/Pause -->
        <button
          class="control-btn control-btn-primary"
          @click="emit('toggle-play-pause')"
          :title="isPlaying ? 'Pause' : 'Play'"
        >
          <svg v-if="!isPlaying" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        </button>

        <!-- Stop -->
        <button
          class="control-btn"
          @click="emit('stop')"
          title="Stop"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h12v12H6z"/>
          </svg>
        </button>

        <!-- Next -->
        <button
          class="control-btn"
          :disabled="currentPossessionIndex >= totalPossessions - 1"
          @click="emit('next-possession')"
          title="Next Possession"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
          </svg>
        </button>
      </div>

      <!-- Speed Control -->
      <div class="speed-control">
        <span class="speed-label">Speed:</span>
        <div class="speed-buttons">
          <button
            v-for="speed in speedOptions"
            :key="speed"
            class="speed-btn"
            :class="{ active: playbackSpeed === speed }"
            @click="emit('set-speed', speed)"
          >
            {{ speed }}x
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.play-animator {
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 16px;
  color: white;
}

.play-info {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.team-indicator {
  padding: 4px 12px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 14px;
}

.play-details {
  flex: 1;
}

.play-name {
  font-weight: 600;
  font-size: 16px;
}

.play-quarter {
  font-size: 12px;
  opacity: 0.7;
}

.possession-counter {
  font-size: 14px;
  opacity: 0.8;
  font-family: monospace;
}

.action-description {
  background: rgba(255, 255, 255, 0.1);
  padding: 10px 14px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 14px;
  min-height: 20px;
}

.progress-container {
  margin-bottom: 16px;
  cursor: pointer;
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.1s ease-out;
  border-radius: 3px;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.control-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.control-btn-primary {
  width: 48px;
  height: 48px;
  background: #3B82F6;
}

.control-btn-primary:hover {
  background: #2563EB;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speed-label {
  font-size: 12px;
  opacity: 0.7;
}

.speed-buttons {
  display: flex;
  gap: 4px;
}

.speed-btn {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.speed-btn.active {
  background: #3B82F6;
}
</style>
