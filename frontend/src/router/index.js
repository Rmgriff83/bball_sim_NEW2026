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
  // Web-only — Apple's App Store reviewer hits these URLs on the web,
  // they have no purpose inside the iOS app. VITE_NATIVE_BUILD is set by
  // `npm run build:ios`, so these routes (including their dynamic imports)
  // are dead-code-eliminated from the iOS bundle.
  ...(import.meta.env.VITE_NATIVE_BUILD ? [] : [
    {
      path: '/support',
      name: 'support',
      component: lazyLoad(() => import('@/views/SupportView.vue'))
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: lazyLoad(() => import('@/views/PrivacyView.vue'))
    }
  ]),
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
    path: '/store',
    name: 'store',
    component: lazyLoad(() => import('@/views/store/StoreView.vue')),
    meta: { requiresAuth: true }
  },
  {
    path: '/admin/headshots',
    name: 'admin-headshots',
    component: lazyLoad(() => import('@/views/admin/HeadshotAdminEditorView.vue')),
    meta: { requiresAuth: true, requiresAdmin: true }
  },
  {
    path: '/campaigns',
    name: 'campaigns',
    component: lazyLoad(() => import('@/views/dashboard/CampaignsView.vue')),
    meta: { requiresAuth: true }
  },
  {
    path: '/campaign/:id/draft',
    name: 'fantasy-draft',
    component: lazyLoad(() => import('@/views/draft/DraftRoomView.vue')),
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
        path: 'playoffs',
        name: 'playoffs',
        component: lazyLoad(() => import('@/views/game/PlayoffBracketView.vue'))
      },
      {
        path: 'play',
        name: 'play',
        component: lazyLoad(() => import('@/views/game/GameView.vue'))
      },
      {
        path: 'scouting',
        name: 'scouting',
        component: lazyLoad(() => import('@/views/draft/ScoutingView.vue'))
      },
      {
        path: 'headshot-editor/:playerId',
        name: 'headshot-editor',
        component: lazyLoad(() => import('@/views/game/HeadshotEditorView.vue')),
        meta: { hideBottomNav: true, requiresHeadshotEditor: true }
      },
      {
        // Phase 3: coach customize. Reuses HeadshotEditorView with audience
        // mode derived from the route name (see HeadshotEditorView).
        path: 'coach-headshot-editor/:coachId',
        name: 'coach-headshot-editor',
        component: lazyLoad(() => import('@/views/game/HeadshotEditorView.vue')),
        meta: { hideBottomNav: true, requiresHeadshotEditor: true }
      },
      {
        // Phase 4: generalized personnel route. Covers coach/scout/physician/
        // staff_trainer via the kind path param. HeadshotEditorView's load
        // path branches on kind to pull from the right pool / IDB row.
        path: 'personnel-headshot-editor/:kind/:personnelId',
        name: 'personnel-headshot-editor',
        component: lazyLoad(() => import('@/views/game/HeadshotEditorView.vue')),
        meta: { hideBottomNav: true, requiresHeadshotEditor: true }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
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

  // Entitlement gate for IAP-unlocked features. Backstop for users who paste
  // the URL directly — the entry-point button is already hidden in
  // PlayerDetailModal when hasFeature is false, but routing must enforce it.
  if (to.meta.requiresHeadshotEditor && !authStore.hasFeature?.('headshot_editor')) {
    next({ name: 'store' })
    return
  }

  // Admin-only gate. Backend endpoints also enforce global_admin; this is the
  // UI-side safety net so non-admins can't even load the page chrome.
  if (to.meta.requiresAdmin && !authStore.isGlobalAdmin) {
    next({ name: 'dashboard' })
    return
  }

  next()
})

// When the user navigates OFF the campaign tree (anything under /campaign/...),
// push pending local changes to the cloud. afterEach runs after navigation
// commits so a failed push never blocks routing. Lazy import avoids the
// circular module dependency that would arise from importing the sync store
// at the top of the router module.
router.afterEach((to, from) => {
  const wasInCampaign = from.path?.startsWith('/campaign/')
  const stillInCampaign = to.path?.startsWith('/campaign/')
  if (wasInCampaign && !stillInCampaign) {
    import('@/stores/sync').then(({ useSyncStore }) => {
      try {
        useSyncStore().syncOnRouteLeave()
      } catch (err) {
        console.warn('[Sync] route-leave push failed:', err)
      }
    })
  }
})

export default router
