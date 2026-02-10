import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// Handle chunk load failures (happens after deployment when old chunks are deleted)
// Wraps dynamic imports to catch failures and force reload
function lazyLoad(importFn) {
  return async () => {
    try {
      return await importFn()
    } catch (error) {
      // Check if it's a chunk loading error
      if (
        error.message?.includes('Failed to fetch dynamically imported module') ||
        error.message?.includes('Importing a module script failed') ||
        error.name === 'ChunkLoadError'
      ) {
        // Force reload to get the new version
        window.location.reload()
        // Return a promise that never resolves to prevent further navigation
        return new Promise(() => {})
      }
      throw error
    }
  }
}

const routes = [
  {
    path: '/',
    name: 'home',
    component: lazyLoad(() => import('@/views/HomeView.vue'))
  },
  {
    path: '/login',
    name: 'login',
    component: lazyLoad(() => import('@/views/auth/LoginView.vue')),
    meta: { guest: true }
  },
  {
    path: '/register',
    name: 'register',
    component: lazyLoad(() => import('@/views/auth/RegisterView.vue')),
    meta: { guest: true }
  },
  {
    path: '/forgot-password',
    name: 'forgot-password',
    component: lazyLoad(() => import('@/views/auth/ForgotPasswordView.vue')),
    meta: { guest: true }
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: lazyLoad(() => import('@/views/auth/ResetPasswordView.vue')),
    meta: { guest: true }
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: lazyLoad(() => import('@/views/dashboard/DashboardView.vue')),
    meta: { requiresAuth: true }
  },
  {
    path: '/profile',
    name: 'profile',
    component: lazyLoad(() => import('@/views/auth/ProfileView.vue')),
    meta: { requiresAuth: true }
  },
  {
    path: '/campaigns',
    name: 'campaigns',
    component: lazyLoad(() => import('@/views/dashboard/CampaignsView.vue')),
    meta: { requiresAuth: true }
  },
  {
    path: '/campaign/:id',
    name: 'campaign',
    component: lazyLoad(() => import('@/views/game/CampaignView.vue')),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'campaign-home',
        component: lazyLoad(() => import('@/views/game/CampaignHomeView.vue'))
      },
      {
        path: 'team',
        name: 'team-management',
        component: lazyLoad(() => import('@/views/team/TeamManagementView.vue'))
      },
      {
        path: 'league',
        name: 'league',
        component: lazyLoad(() => import('@/views/league/LeagueView.vue'))
      },
      {
        path: 'game/:gameId',
        name: 'game',
        component: lazyLoad(() => import('@/views/game/GameView.vue'))
      },
      {
        path: 'play',
        name: 'play',
        component: lazyLoad(() => import('@/views/game/GameView.vue'))
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // If user used back/forward, restore saved position
    if (savedPosition) {
      return savedPosition
    }
    // Otherwise scroll to top
    return { top: 0 }
  }
})

// Navigation guards
router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore()

  // Initialize auth state if not done
  if (!authStore.initialized) {
    await authStore.initialize()
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    next({ name: 'login', query: { redirect: to.fullPath } })
    return
  }

  // Check if route is for guests only (login, register)
  if (to.meta.guest && authStore.isAuthenticated) {
    next({ name: 'dashboard' })
    return
  }

  next()
})

export default router
