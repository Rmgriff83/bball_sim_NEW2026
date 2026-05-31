  ┌───────────┬─────────────────────────────────┐
  │ Component │               URL               │                                                                                 
  ├───────────┼─────────────────────────────────┤                                                                               
  │ Frontend  │ https://bball-sim-31989.web.app │
  ├───────────┼─────────────────────────────────┤
  │ API       │ https://api.bball-sim.com       │
  ├───────────┼─────────────────────────────────┤
  │ Database  │ DigitalOcean Managed MySQL      │
  ├───────────┼─────────────────────────────────┤
  │ Storage   │ DigitalOcean Spaces             │
  └───────────┴─────────────────────────────────┘

  Quick reference for future PRODUCTION deploys

  Backend:
  ssh deploy@143.198.57.204
  cd /var/www/bball-sim/bball_sim_NEW2026/backend
  git pull
  composer install --no-dev --optimize-autoloader
  php artisan migrate (if migrations)
  php artisan config:cache
  php artisan route:cache

  Frontend:
  cd frontend
  npm run build
  firebase deploy --only hosting


  iOS app builds (Mac, requires Xcode + iOS Sim or device)

  Prereqs (one time):
  brew install node cocoapods            # cocoapods only if a plugin requires it; Cap 8 uses SPM
  cd frontend && npm install
  cd frontend && npx cap add ios         # only if frontend/ios is missing
  xcode-select -p                        # must point at /Applications/Xcode.app/Contents/Developer
  # if it points at CommandLineTools:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

  Pick a simulator UDID (run before either build):
  cd frontend && npx cap run ios --list  # copy the UDID for the iPhone you want
  xcrun simctl list devices booted       # which sim is already booted

  LOCAL dev build — hot reload, talks to LOCAL backend (:8000)
  Prereq services running:
    brew services start mysql            # if not already running
    cd backend && php artisan serve      # :8000
    cd frontend && npm run dev           # :3000, proxies /api to :8000
  Then deploy with live reload:
    cd frontend
    npx cap run ios -l --host localhost --port 3000 --target <UDID>
  # WebView loads from localhost:3000 (vite proxy → 127.0.0.1:8000).
  # Process stays alive to keep live-reload connected. Ctrl+C or:
  #   pkill -f "cap run ios"
  # Does NOT modify the committed capacitor.config.json — server.url is injected only for this run.

  PRODUCTION build — bundled app talks to https://api.bball-sim.com
  Required env (frontend/.env.production):
    VITE_API_URL=https://api.bball-sim.com
    VITE_REVENUECAT_API_KEY=appl_...
    VITE_STRIPE_PUBLISHABLE_KEY=pk_...
  Build + deploy to simulator:
    cd frontend
    npm run build:ios                    # vite build && cap sync ios
    npx cap run ios --target <UDID> --no-sync
  Or open in Xcode and hit Run (for archiving / device with signing):
    cd frontend && npm run open:ios

  Helpers:
  xcrun simctl get_app_container booted com.bballsim.app   # confirm app installed
  xcrun simctl launch booted com.bballsim.app              # launch from CLI
  xcrun simctl uninstall booted com.bballsim.app           # clean uninstall (state-resets login etc.)
  pkill -f "cap run ios"                                   # kill leftover live-reload session