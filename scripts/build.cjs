'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
// Publish browser assets only, excluding dependencies, rules and server source.
const assets = [
  'index.html', 'logo.mp4', 'myway-neumorphic.css', 'myway-glass.css',
  'garmin-dashboard.js', 'garmin-visual.js', 'google-timeline.js',
  'google-timeline.css', 'google-week.js', 'google-week.css',
  'google-week-glass.css', 'google-connection.js', 'jarvis-memory.js'
];
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output);
for (const asset of assets) fs.copyFileSync(path.join(root, asset), path.join(output, asset));
console.log(`Built ${assets.length} public assets.`);
