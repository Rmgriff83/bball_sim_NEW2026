import axios from "axios";
import { getToken, removeToken } from "./useTokenStorage";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  // Hard ceiling so a stalled connection can never hang a request forever (which
  // would wedge any awaited UI path, e.g. campaign navigation). Callers that need a
  // tighter bound pass their own `timeout` per-request.
  timeout: 25000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Toast store reference - set by main.js after pinia is initialized
let toastStore = null;

export function setToastStore(store) {
  toastStore = store;
}

// Request interceptor to add auth token (async — backed by Capacitor
// Preferences / Keychain on native, localStorage on web).
api.interceptors.request.use(
  async (config) => {
    const token = await getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Handle 401 Unauthorized
      if (error.response.status === 401) {
        removeToken().catch(() => {});
        // Redirect to login if not already there
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }

      // Extract error message
      const message =
        error.response.data?.message ||
        error.response.data?.error ||
        "An error occurred";

      error.message = message;

      // Show error toast (skip 401s since we handle those with redirect,
      // and skip when the caller opted out via `config.skipErrorToast`).
      const skipToast = error.config?.skipErrorToast === true;
      if (toastStore && error.response.status !== 401 && !skipToast) {
        toastStore.showError(message);
      }
    } else if (error.request) {
      // Network error
      error.message = "Network error. Please check your connection.";
      const skipToast = error.config?.skipErrorToast === true;
      if (toastStore && !skipToast) {
        toastStore.showError(error.message);
      }
    }
    return Promise.reject(error);
  },
);

export default api;
