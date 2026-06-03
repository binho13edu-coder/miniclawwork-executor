module.exports = {
  apps: [{
    name: "miniclawwork-executor",
    script: "./index.js",
    max_memory_restart: "800M",
    env_file: ".env"
  }, {
    name: "memory-summarizer",
    script: "./jobs/memory-summarizer.js",
    instances: 1,
    exec_mode: "fork",
    cron_restart: "0 3 * * 0",
    autorestart: false,
    max_memory_restart: "200M",
    env_file: ".env"
  }, {
    name: "leads-pipeline",
    script: "./jobs/leads-pipeline.js",
    instances: 1,
    exec_mode: "fork",
    cron_restart: "0 7 * * 1",
    autorestart: false,
    max_memory_restart: "200M",
    env_file: ".env"
  }]
};
