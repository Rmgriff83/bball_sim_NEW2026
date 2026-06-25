import { ref, onMounted, onUnmounted } from 'vue'

// Reactive light/dark theme flag. The app sets `data-theme="light"` on <html>
// for light mode (dark is the default / no attribute). Returns a ref that stays
// in sync if the user toggles the theme while the component is mounted.
export function useIsLightTheme() {
  const isLight = ref(
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'light'
  )

  let observer = null
  const read = () => {
    isLight.value = document.documentElement.getAttribute('data-theme') === 'light'
  }

  onMounted(() => {
    read()
    observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  })
  onUnmounted(() => observer?.disconnect())

  return isLight
}
