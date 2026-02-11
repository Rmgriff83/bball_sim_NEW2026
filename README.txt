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

 Job queue configuration in supervisor.conf
  [program:bball-sim-queue]
  process_name=%(program_name)s_%(process_num)02d
  command=php /var/www/bball-sim/bball_sim_NEW2026/backend/artisan queue:work database --sleep=3 --tries=3
  --timeout=120
  autostart=true
  autorestart=true
  numprocs=1
  user=www-data
  redirect_stderr=true
  stdout_logfile=/var/www/bball-sim/bball_sim_NEW2026/backend/storage/logs/queue-worker.log
  stopwaitsecs=3600

  Then run:
  sudo supervisorctl reread
  sudo supervisorctl update
  sudo supervisorctl status


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