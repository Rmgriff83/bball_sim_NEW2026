import axios from 'axios'

const api = axios.create({
  baseURL: '',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
})

// Toast store reference - set by main.js after pinia is initialized
let toastStore = null

export function setToastStore(store) {
  toastStore = store
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Handle 401 Unauthorized
      if (error.response.status === 401) {
        localStorage.removeItem('auth_token')
        // Redirect to login if not already there
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
      }

      // Extract error message
      const message = error.response.data?.message ||
                     error.response.data?.error ||
                     'An error occurred'

      error.message = message

      // Show error toast (skip 401s since we handle those with redirect)
      if (toastStore && error.response.status !== 401) {
        toastStore.showError(message)
      }
    } else if (error.request) {
      // Network error
      error.message = 'Network error. Please check your connection.'
      if (toastStore) {
        toastStore.showError(error.message)
      }
    }
    return Promise.reject(error)
  }
)

export default api
