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
  ssh root@164.92.97.179
  cd /var/www/bball-sim/bball_sim_NEW2026/backend
  git pull
  composer install --no-dev --optimize-autoloader
  php artisan migrate --force
  php artisan config:cache
  php artisan route:cache

  Frontend:
  cd frontend
  npm run build
  firebase deploy --only hosting