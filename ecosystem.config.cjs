module.exports = {
  apps: [
    {
      name: 'versable-scripts-backend',
      script: 'server.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'development',
        PORT: 5033,
      },
      // [claude@2026-04-10] Prevents restart storm: 18k+ restarts accumulated from port-conflict loop.
      // Root cause is unclear (no stderr output); these limits stop the churn while preserving autorestart.
      min_uptime: 5000,
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: 'versable-scripts-frontend',
      script: 'npm',
      args: 'run dev',
      cwd: __dirname + '/ui',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
