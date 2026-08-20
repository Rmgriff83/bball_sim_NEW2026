<template>
  <div class="wl-language-switcher" :style="rootStyle">
    <!-- Circular Toolbar Button -->
    <button
      @click="isOpen = !isOpen"
      class="wl-ls-toolbar-button"
      :title="headerText"
      :aria-label="headerText"
    >
      <span class="wl-ls-globe-icon" v-html="globeIcon"></span>
      <span v-if="currentFlag" class="wl-ls-current-flag" v-html="currentFlag"></span>
    </button>

    <!-- Floating Language Menu -->
    <transition name="wl-ls-slide-up">
      <div v-if="isOpen" class="wl-ls-language-menu">
        <!-- Menu Header -->
        <div class="wl-ls-menu-header">
          <span class="wl-ls-header-content">
            <span class="wl-ls-header-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 420 420"
                stroke="#374151"
                fill="none"
              >
                <path stroke-width="26" d="M209,15a195,195 0 1,0 2,0z" />
                <path
                  stroke-width="26"
                  d="m210,15v390m195-195H15M59,90a260,260 0 0,0 302,0 m0,240 a260,260 0 0,0-302,0M195,20a250,250 0 0,0 0,382 m30,0 a250,250 0 0,0 0-382"
                />
              </svg>
            </span>
            <span class="wl-ls-header-text">{{ headerText }}</span>
          </span>
          <button @click="isOpen = false" class="wl-ls-close-btn" aria-label="Close">&times;</button>
        </div>

        <!-- Language List -->
        <div class="wl-ls-language-list">
          <button
            v-for="lang in languageOptions"
            :key="lang.code"
            @click="onSelectLanguage(lang.code)"
            class="wl-ls-language-option"
            :class="{ 'wl-ls-active': isActive(lang.code) }"
          >
            <!-- Pill indicator (left side) -->
            <span class="wl-ls-pill-box">
              <ul>
                <li class="wl-ls-pill-background"></li>
                <li class="wl-ls-pill-foreground" :class="{ 'wl-ls-pill-active': isActive(lang.code) }"></li>
              </ul>
            </span>

            <span class="wl-ls-lang-name">{{ lang.name }}</span>
            <span class="wl-ls-lang-flag" v-html="lang.flag"></span>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script>
import { defineComponent, ref, computed, inject, onMounted, onUnmounted } from 'vue'

// Static reference data for supported languages (flags + display names)
const baseLanguageData = {
  "en-us": { name: "English (United States)", flag: '<svg id=flag-icons-us viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0"fill=#bd3d44 /><path d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"stroke=#fff stroke-width=37 /><path d="M0 0h364.8v258.5H0"fill=#192f5d /><marker id=us-a markerHeight=30 markerWidth=30><path d="m14 0 9 27L0 10h28L5 27z"fill=#fff /></marker><path d="m0 0 16 11h61 61 61 61 60L47 37h61 61 60 61L16 63h61 61 61 61 60L47 89h61 61 60 61L16 115h61 61 61 61 60L47 141h61 61 60 61L16 166h61 61 61 61 60L47 192h61 61 60 61L16 218h61 61 61 61 60z"fill=none marker-mid=url(#us-a) /></svg>' },
  "en-gb": { name: "English (United Kingdom)", flag: '<svg id=flag-icons-gb viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#012169 /><path d="m75 0 244 181L562 0h78v62L400 241l240 178v61h-80L320 301 81 480H0v-60l239-178L0 64V0z"fill=#FFF /><path d="m424 281 216 159v40L369 281zm-184 20 6 35L54 480H0zM640 0v3L391 191l2-44L590 0zM0 0l239 176h-60L0 42z"fill=#C8102E /><path d="M241 0v480h160V0zM0 160v160h640V160z"fill=#FFF /><path d="M0 193v96h640v-96zM273 0v480h96V0z"fill=#C8102E /></svg>' },
  "en": { name: "English", flag: '<svg id=flag-icons-us viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0"fill=#bd3d44 /><path d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"stroke=#fff stroke-width=37 /><path d="M0 0h364.8v258.5H0"fill=#192f5d /><marker id=us-a markerHeight=30 markerWidth=30><path d="m14 0 9 27L0 10h28L5 27z"fill=#fff /></marker><path d="m0 0 16 11h61 61 61 61 60L47 37h61 61 60 61L16 63h61 61 61 61 60L47 89h61 61 60 61L16 115h61 61 61 61 60L47 141h61 61 60 61L16 166h61 61 61 61 60L47 192h61 61 60 61L16 218h61 61 61 61 60z"fill=none marker-mid=url(#us-a) /></svg>' },
  "fr": { name: "Fran\u00e7ais", flag: '<svg id=flag-icons-fr viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#fff /><path d="M0 0h213.3v480H0z"fill=#000091 /><path d="M426.7 0H640v480H426.7z"fill=#e1000f /></svg>' },
  "fr-fr": { name: "Fran\u00e7ais (France)", flag: '<svg id=flag-icons-fr viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#fff /><path d="M0 0h213.3v480H0z"fill=#000091 /><path d="M426.7 0H640v480H426.7z"fill=#e1000f /></svg>' },
  "fr-ca": { name: "Fran\u00e7ais (Canada)", flag: '<svg id=flag-icons-ca viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M150.1 0h339.7v480H150z"fill=#fff /><path d="M-19.7 0h169.8v480H-19.7zm509.5 0h169.8v480H489.9zM201 232l-13.3 4.4 61.4 54c4.7 13.7-1.6 17.8-5.6 25l66.6-8.4-1.6 67 13.9-.3-3.1-66.6 66.7 8c-4.1-8.7-7.8-13.3-4-27.2l61.3-51-10.7-4c-8.8-6.8 3.8-32.6 5.6-48.9 0 0-35.7 12.3-38 5.8l-9.2-17.5-32.6 35.8c-3.5.9-5-.5-5.9-3.5l15-74.8-23.8 13.4q-3.2 1.3-5.2-2.2l-23-46-23.6 47.8q-2.8 2.5-5 .7L264 130.8l13.7 74.1c-1.1 3-3.7 3.8-6.7 2.2l-31.2-35.3c-4 6.5-6.8 17.1-12.2 19.5s-23.5-4.5-35.6-7c4.2 14.8 17 39.6 9 47.7"fill=#d52b1e /></svg>' },
  "es": { name: "Espa\u00f1ol", flag: '<svg aria-hidden=true preserveAspectRatio="xMidYMid meet"role=img viewBox="0 0 36 36"xmlns=http://www.w3.org/2000/svg><path d="M36 27a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v18z"fill=#C60A1D /><path d="M0 12h36v12H0z"fill=#FFC400 /><path d="M9 17v3a3 3 0 1 0 6 0v-3H9z"fill=#EA596E /><path d="M12 16h3v3h-3z"fill=#F4A2B2 /><path d="M9 16h3v3H9z"fill=#DD2E44 /><ellipse cx=12 cy=14.5 fill=#EA596E rx=3 ry=1.5 /><ellipse cx=12 cy=13.75 fill=#FFAC33 rx=3 ry=.75 /><path d="M7 16h1v7H7zm9 0h1v7h-1z"fill=#99AAB5 /><path d="M6 22h3v1H6zm9 0h3v1h-3zm-8-7h1v1H7zm9 0h1v1h-1z"fill=#66757F /></svg>' },
  "es-es": { name: "Espa\u00f1ol (Espa\u00f1a)", flag: '<svg aria-hidden=true preserveAspectRatio="xMidYMid meet"role=img viewBox="0 0 36 36"xmlns=http://www.w3.org/2000/svg><path d="M36 27a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v18z"fill=#C60A1D /><path d="M0 12h36v12H0z"fill=#FFC400 /><path d="M9 17v3a3 3 0 1 0 6 0v-3H9z"fill=#EA596E /><path d="M12 16h3v3h-3z"fill=#F4A2B2 /><path d="M9 16h3v3H9z"fill=#DD2E44 /><ellipse cx=12 cy=14.5 fill=#EA596E rx=3 ry=1.5 /><ellipse cx=12 cy=13.75 fill=#FFAC33 rx=3 ry=.75 /><path d="M7 16h1v7H7zm9 0h1v7h-1z"fill=#99AAB5 /><path d="M6 22h3v1H6zm9 0h3v1h-3zm-8-7h1v1H7zm9 0h1v1h-1z"fill=#66757F /></svg>' },
  "it": { name: "Italiano", flag: '<svg id=flag-icons-it viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><g fill-rule=evenodd stroke-width=1pt><path d="M0 0h640v480H0z"fill=#fff /><path d="M0 0h213.3v480H0z"fill=#009246 /><path d="M426.7 0H640v480H426.7z"fill=#ce2b37 /></g></svg>' },
  "it-it": { name: "Italiano (Italia)", flag: '<svg id=flag-icons-it viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><g fill-rule=evenodd stroke-width=1pt><path d="M0 0h640v480H0z"fill=#fff /><path d="M0 0h213.3v480H0z"fill=#009246 /><path d="M426.7 0H640v480H426.7z"fill=#ce2b37 /></g></svg>' },
  "pt": { name: "Portugu\u00eas", flag: '<svg id=flag-icons-pt viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M256 0h384v480H256z"fill=red /><path d="M0 0h256v480H0z"fill=#060 /></svg>' },
  "pt-pt": { name: "Portugu\u00eas (Portugal)", flag: '<svg id=flag-icons-pt viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M256 0h384v480H256z"fill=red /><path d="M0 0h256v480H0z"fill=#060 /></svg>' },
  "pt-br": { name: "Portugu\u00eas (Brasil)", flag: '<svg id=flag-icons-br viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><g stroke-width=1pt><path d="M0 0h640v480H0z"fill=#229e45 fill-rule=evenodd /><path d="m321.4 436 301.5-195.7L319.6 44 17.1 240.7z"fill=#f8e509 fill-rule=evenodd /><path d="M452.8 240c0 70.3-57.1 127.3-127.6 127.3A127.4 127.4 0 1 1 452.8 240"fill=#2b49a3 fill-rule=evenodd /></g></svg>' },
  "ro": { name: "Rom\u00e2n\u0103", flag: '<svg id=flag-icons-ro viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><g fill-rule=evenodd stroke-width=1pt><path d="M0 0h213.3v480H0z"fill=#00319c /><path d="M213.3 0h213.4v480H213.3z"fill=#ffde00 /><path d="M426.7 0H640v480H426.7z"fill=#de2110 /></g></svg>' },
  "ro-ro": { name: "Rom\u00e2n\u0103 (Rom\u00e2nia)", flag: '<svg id=flag-icons-ro viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><g fill-rule=evenodd stroke-width=1pt><path d="M0 0h213.3v480H0z"fill=#00319c /><path d="M213.3 0h213.4v480H213.3z"fill=#ffde00 /><path d="M426.7 0H640v480H426.7z"fill=#de2110 /></g></svg>' },
  "de": { name: "Deutsch", flag: '<svg id=flag-icons-de viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 320h640v160H0z"fill=#ffce00 /><path d="M0 0h640v160H0z"/><path d="M0 160h640v160H0z"fill=#d00 /></svg>' },
  "nl": { name: "Nederlands", flag: '<svg id=flag-icons-nl viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v160H0z"fill=#ae1c28 /><path d="M0 160h640v160H0z"fill=#fff /><path d="M0 320h640v160H0z"fill=#21468b /></svg>' },
  "nl-nl": { name: "Nederlands (Nederland)", flag: '<svg id=flag-icons-nl viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v160H0z"fill=#ae1c28 /><path d="M0 160h640v160H0z"fill=#fff /><path d="M0 320h640v160H0z"fill=#21468b /></svg>' },
  "ja": { name: "\u65e5\u672c\u8a9e", flag: '<svg id=flag-icons-jp viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><defs><clipPath id=jp-a><path d="M-88 32h640v480H-88z"fill-opacity=.7 /></clipPath></defs><g clip-path=url(#jp-a) transform="translate(88 -32)"><path d="M-128 32h720v480h-720z"fill=#fff /><circle cx=232 cy=272 fill=#bc002d r=120 /></g></svg>' },
  "ko": { name: "\ud55c\uad6d\uc5b4", flag: '<svg id=flag-icons-kr viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#fff /></svg>' },
  "zh": { name: "\u4e2d\u6587", flag: '<svg id=flag-icons-cn viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><defs><path d="M-.588.81L0-1 .588.81-.952-.31h1.902z"fill=#ff0 id=cn-a /></defs><path d="M0 0h640v480H0z"fill=#ee1c25 /><use height=480 transform="matrix(71.933 0 0 71.933 119.678 55.51)"width=640 xlink:href=#cn-a /><use height=480 transform="matrix(-12.33 -20.565 20.565 -12.33 240.29 47.53)"width=640 xlink:href=#cn-a /><use height=480 transform="matrix(-3.38 -23.753 23.753 -3.38 263.22 91.04)"width=640 xlink:href=#cn-a /><use height=480 transform="matrix(6.87 -23.001 23.001 6.87 247.13 137.64)"width=640 xlink:href=#cn-a /><use height=480 transform="matrix(14.98 -18.476 18.476 14.98 216.28 168.79)"width=640 xlink:href=#cn-a /></svg>' },
  "ar": { name: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", flag: '<svg id=flag-icons-sa viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#006c35 /></svg>' },
  "hi": { name: "\u0939\u093f\u0928\u094d\u0926\u0940", flag: '<svg id=flag-icons-in viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v160H0z"fill=#f93 /><path d="M0 160h640v160H0z"fill=#fff /><path d="M0 320h640v160H0z"fill=#128807 /><circle cx=320 cy=240 fill=#008 r=48 /></svg>' },
  "ru": { name: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", flag: '<svg id=flag-icons-ru viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v160H0z"fill=#fff /><path d="M0 160h640v160H0z"fill=#0039a6 /><path d="M0 320h640v160H0z"fill=#d52b1e /></svg>' },
  "tr": { name: "T\u00fcrk\u00e7e", flag: '<svg id=flag-icons-tr viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#e30a17 /></svg>' },
  "pl": { name: "Polski", flag: '<svg id=flag-icons-pl viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v240H0z"fill=#fff /><path d="M0 240h640v240H0z"fill=#dc143c /></svg>' },
  "sv": { name: "Svenska", flag: '<svg id=flag-icons-se viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#006aa7 /><path d="M0 192h640v96H0z"fill=#fecc00 /><path d="M176 0h96v480h-96z"fill=#fecc00 /></svg>' },
  "da": { name: "Dansk", flag: '<svg id=flag-icons-dk viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#c8102e /><path d="M0 192h640v96H0z"fill=#fff /><path d="M176 0h96v480h-96z"fill=#fff /></svg>' },
  "no": { name: "Norsk", flag: '<svg id=flag-icons-no viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#ef2b2d /><path d="M0 192h640v96H0z"fill=#fff /><path d="M176 0h96v480h-96z"fill=#fff /><path d="M0 208h640v64H0z"fill=#002868 /><path d="M192 0h64v480h-64z"fill=#002868 /></svg>' },
  "fi": { name: "Suomi", flag: '<svg id=flag-icons-fi viewBox="0 0 640 480"xmlns=http://www.w3.org/2000/svg><path d="M0 0h640v480H0z"fill=#fff /><path d="M0 174.5h640v131H0z"fill=#003580 /><path d="M175.5 0h130.9v480H175.5z"fill=#003580 /></svg>' },
}

function resolveLanguageData(code) {
  const lower = (code || 'en').toLowerCase()
  if (baseLanguageData[lower]) return { code, ...baseLanguageData[lower] }
  const family = lower.split('-')[0]
  if (baseLanguageData[family]) return { code, ...baseLanguageData[family] }
  return { code, name: code.toUpperCase(), flag: '' }
}

export default defineComponent({
  name: 'LanguageSwitcher',
  setup() {
    const i18n = inject('i18n')
    const isOpen = ref(false)

    const config = i18n.getConfig()
    const sourceLanguage = config.sourceLanguage || 'en'
    const targetLanguages = config.targetLanguages || []

    const globeIcon = '<svg fill="none" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg"><path d="M209,15a195,195 0 1,0 2,0z" stroke-width="26" /><path d="m210,15v390m195-195H15M59,90a260,260 0 0,0 302,0 m0,240 a260,260 0 0,0-302,0M195,20a250,250 0 0,0 0,382 m30,0 a250,250 0 0,0 0-382" stroke-width="26" /></svg>'

    const headerText = computed(() => {
      const current = languageOptions.value.find(
        l => l.code.toLowerCase() === i18n.currentLocale.value.toLowerCase()
      )
      return current ? current.name : 'Select Language'
    })

    const currentFlag = computed(() => {
      const current = languageOptions.value.find(
        l => l.code.toLowerCase() === i18n.currentLocale.value.toLowerCase()
      )
      return current ? current.flag : ''
    })

    const languageOptions = computed(() => {
      const codes = [sourceLanguage, ...targetLanguages.filter(l => l !== sourceLanguage)]
      return codes.map(code => resolveLanguageData(code))
    })

    const rootStyle = computed(() => ({
      '--wl-ls-accent': '#667eea'
    }))

    const isActive = (code) => {
      return i18n.currentLocale.value.toLowerCase() === code.toLowerCase()
    }

    const onSelectLanguage = async (code) => {
      i18n.setLocale(code)

      // Fetch translations from S3 for non-source locales if not already loaded
      if (code !== sourceLanguage && !i18n.messages[code]) {
        await Promise.all([
          i18n.fetchTranslationsFromS3(code, 'static'),
          i18n.fetchTranslationsFromS3(code, 'dynamic')
        ])
      }

      isOpen.value = false
    }

    // Close on click outside
    const onClickOutside = (e) => {
      if (isOpen.value && !e.target.closest('.wl-language-switcher')) {
        isOpen.value = false
      }
    }

    onMounted(() => document.addEventListener('click', onClickOutside))
    onUnmounted(() => document.removeEventListener('click', onClickOutside))

    return {
      isOpen,
      globeIcon,
      headerText,
      currentFlag,
      languageOptions,
      rootStyle,
      isActive,
      onSelectLanguage,
    }
  }
})
</script>

<style scoped>
.wl-language-switcher {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.5;
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.wl-language-switcher * {
  box-sizing: border-box;
}

/* ── Circular Toolbar Button (matches .toolbar-button) ── */
.wl-ls-toolbar-button {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  width: 41px;
  min-width: 41px;
  max-width: 41px;
  height: 41px;
  min-height: 41px;
  max-height: 41px;
  border-radius: 50%;
  border: none;
  color: white;
  cursor: pointer;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.3s ease;
  padding: 0;
}

.wl-ls-toolbar-button:hover {
  transform: scale(1.05);
}

.wl-ls-toolbar-button:active {
  transform: scale(0.95);
}

.wl-ls-globe-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-51%, -50%);
}

.wl-ls-globe-icon :deep(svg) {
  width: 31px !important;
  height: 31px !important;
  display: block;
  fill: none;
  stroke: white;
}

/* ── Current Flag Badge (matches .current-flag) ── */
.wl-ls-current-flag {
  position: absolute;
  bottom: -6px;
  left: -6px;
  font-size: 18px;
  background: white;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.wl-ls-current-flag :deep(svg) {
  width: 16px;
  height: 16px;
  border-radius: 2px;
}

/* ── Floating Language Menu (matches .language-menu) ── */
.wl-ls-language-menu {
  position: absolute;
  bottom: 70px;
  right: 0;
  background: white;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  width: 280px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Slide-up transition (matches toolbar .slide-up) */
.wl-ls-slide-up-enter-active,
.wl-ls-slide-up-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.wl-ls-slide-up-enter-from,
.wl-ls-slide-up-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* ── Menu Header (matches .menu-header) ── */
.wl-ls-menu-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #374151;
  font-size: 16px;
  position: relative;
}

.wl-ls-header-content {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wl-ls-header-icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wl-ls-header-icon svg {
  stroke: #374151;
}

.wl-ls-header-text {
  margin-left: 4px;
}

.wl-ls-close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
  position: absolute;
  top: 7.5px;
  right: 7.5px;
}

.wl-ls-close-btn:hover {
  background: #f3f4f6;
  color: #1f2937;
}

/* ── Language List (matches .language-list) ── */
.wl-ls-language-list {
  overflow-y: auto;
  padding: 8px;
  max-height: 375px;
}

/* ── Language Option (matches .language-option) ── */
.wl-ls-language-option {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid #ddd;
  background: transparent;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
  font-size: 14px;
  color: #374151;
  text-align: left;
  margin-bottom: 0.5rem;
  box-shadow: none;
  font-weight: 400;
  position: relative;
  font-family: inherit;
}

.wl-ls-language-option:last-child {
  margin-bottom: 0;
}

.wl-ls-language-option:hover {
  background: #f3f4f6;
}

.wl-ls-language-option.wl-ls-active {
  border-color: var(--wl-ls-accent, #667eea);
}

.wl-ls-lang-name {
  flex: 1;
  text-align: left;
}

.wl-ls-lang-flag {
  display: inline-flex;
  background: #ddd;
  padding: 5px;
  border-radius: 50%;
  justify-content: center;
  align-items: center;
  width: 25px;
  height: 25px;
}

.wl-ls-lang-flag :deep(svg) {
  width: 20px;
  height: 20px;
  border-radius: 2px;
}

/* ── Pill Indicator (matches .pill-box) ── */
.wl-ls-pill-box {
  width: 5px;
  height: 100%;
  position: absolute;
  left: 5px;
  padding-bottom: 7.5px;
}

.wl-ls-pill-box ul {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 4px 0;
  padding: 0;
  position: relative;
  list-style: none;
  height: 100%;
}

.wl-ls-pill-box ul li {
  width: 5px;
  border-radius: 6px;
  transition: height 0.175s ease-in-out;
  padding: 0;
}

.wl-ls-pill-background {
  height: 100%;
  background: #ddd;
  margin: 0;
}

.wl-ls-pill-foreground {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 0;
  background: var(--wl-ls-accent, #667eea);
  transition: height 0.15s ease-in-out;
  margin: 0;
}

.wl-ls-pill-foreground.wl-ls-pill-active {
  height: 100%;
}
</style>
