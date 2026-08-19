/**
 * One-off script: diff ICON_REGISTRY slugs against the actual files installed
 * in @material-symbols-svg/react/dist/icons/ and report every mismatch.
 *
 * Run from project root:
 *   node scripts/check-icon-slugs.mjs
 */

import { readdirSync } from 'fs';
import { resolve } from 'path';

// ── 1. Read every slug the package actually ships ────────────────────────────
const iconsDir = resolve('node_modules/@material-symbols-svg/react/dist/icons');
const packageSlugs = new Set(
  readdirSync(iconsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
);

console.log(`\n✓ Package ships ${packageSlugs.size} icon files\n`);

// ── 2. Read every slug our registry declares ─────────────────────────────────
// Inline the slugs so this script has no build dependency.
const registrySlugs = [
  // UI
  'home', 'settings', 'search', 'menu', 'close', 'add', 'delete', 'edit',
  'more-vert', 'more-horiz', 'star', 'bookmark', 'filter-list', 'refresh',
  'content-copy', 'content-paste', 'visibility', 'visibility-off', 'help',
  'info', 'tune', 'sort', 'expand-more', 'expand-less', 'chevron-right',
  'chevron-left', 'swap-horiz', 'swap-vert', 'fullscreen', 'fullscreen-exit',
  'zoom-in', 'zoom-out', 'drag', 'open-in-new', 'launch', 'label', 'tag',
  // People
  'person', 'group', 'groups', 'person-add', 'person-remove',
  'account-circle', 'badge', 'face-retouching-natural', 'manage-accounts',
  // Communication
  'notifications', 'notifications-off', 'mail', 'mail-outline', 'inbox',
  'chat', 'chat-bubble', 'forum', 'phone', 'phone-in-talk', 'video-call',
  'send', 'share', 'rss', 'campaign', 'sms',
  // Tech
  'cloud', 'cloud-upload', 'cloud-download', 'cloud-sync', 'storage',
  'memory', 'wifi', 'wifi-off', 'bluetooth', 'dns', 'http', 'link',
  'link-off', 'code', 'code-blocks', 'terminal', 'api', 'data-object',
  'data-array', 'javascript', 'bug-report', 'integration-instructions',
  'web-asset', 'web',
  // Security
  'lock', 'lock-open', 'shield', 'verified-user', 'key', 'fingerprint',
  'security', 'gpp-good', 'gpp-bad', 'admin-panel-settings', 'privacy-tip',
  'password',
  // Arrows
  'arrow-forward', 'arrow-back', 'arrow-upward', 'arrow-downward',
  'arrow-circle-right', 'arrow-circle-left', 'arrow-circle-up',
  'arrow-circle-down', 'trending-up', 'trending-down', 'trending-flat',
  'redo', 'undo', 'repeat', 'loop', 'double-arrow',
  // Files
  'description', 'folder', 'folder-open', 'folder-shared', 'article',
  'note-add', 'attachment', 'file-download', 'file-upload', 'file-copy',
  'archive', 'unarchive', 'picture-as-pdf', 'csv', 'text-snippet',
  'summarize', 'drive-file-move',
  // Status
  'check-circle', 'cancel', 'error', 'warning', 'pending', 'hourglass-top',
  'block', 'done', 'done-all', 'sync', 'sync-problem',
  'circle-notifications', 'verified',
  // Devices
  'laptop', 'smartphone', 'tablet', 'watch', 'tv', 'monitor', 'router',
  'headphones', 'speaker', 'print', 'scanner',
  // Media
  'image', 'photo-camera', 'videocam', 'mic', 'mic-off', 'play-circle',
  'pause-circle', 'stop-circle', 'skip-next', 'skip-previous', 'volume-up',
  'volume-off', 'library-music', 'podcast', 'slideshow', 'ondemand-video',
  // Data
  'bar-chart', 'show-chart', 'pie-chart', 'area-chart', 'table-chart',
  'data-usage', 'analytics', 'query-stats', 'assessment', 'leaderboard',
  // Commerce
  'shopping-cart', 'shopping-bag', 'credit-card', 'payments', 'wallet',
  'local-offer', 'sell', 'receipt', 'loyalty', 'inventory', 'local-shipping',
  // Navigation
  'map', 'location-on', 'explore', 'navigation', 'directions', 'near-me',
  'commute', 'travel-explore',
  // Time
  'schedule', 'calendar-today', 'calendar-month', 'date-range', 'timer',
  'alarm', 'history', 'update',
  // Auth
  'login', 'logout', 'how-to-reg', 'account-box', 'no-accounts',
  // Design
  'palette', 'brush', 'format-paint', 'layers', 'grid-on', 'space-bar',
  'center-focus-strong', 'crop', 'straighten', 'design-services', 'widgets',
  'view-quilt',
  // Dev
  'account-tree', 'schema', 'hub', 'device-hub', 'settings-ethernet',
  'build', 'construction', 'extension', 'webhook', 'token',
];

// ── 3. Diff ──────────────────────────────────────────────────────────────────
const missing = registrySlugs.filter(s => !packageSlugs.has(s));
const ok      = registrySlugs.filter(s =>  packageSlugs.has(s));

console.log(`Registry declares  : ${registrySlugs.length} slugs`);
console.log(`Found in package   : ${ok.length}`);
console.log(`MISSING (no file)  : ${missing.length}`);

if (missing.length === 0) {
  console.log('\n✓ All registry slugs resolve to real package files — nothing to fix.');
} else {
  console.log('\n✗ Registry slugs with NO matching package file:\n');
  for (const s of missing) {
    // Try to suggest a similar name
    const candidates = [...packageSlugs]
      .filter(pkg => pkg.includes(s.split('-')[0]) || s.includes(pkg.split('-')[0]))
      .slice(0, 3);
    const hint = candidates.length ? `  (similar: ${candidates.join(', ')})` : '';
    console.log(`  - ${s}${hint}`);
  }
}

// ── 4. Bonus: look up specific ambiguous names ───────────────────────────────
const probes = ['phone', 'laptop', 'assessment', 'launch', 'loop', 'drag',
                 'rss', 'podcast', 'done', 'watch', 'history', 'schedule',
                 'alarm', 'map', 'share', 'send', 'repeat', 'monitor', 'scanner'];

console.log('\n── Probe: what does the package actually ship for these names? ──\n');
for (const probe of probes) {
  const matches = [...packageSlugs].filter(s => s === probe || s.startsWith(probe + '-') || s.endsWith('-' + probe));
  console.log(`  ${probe.padEnd(16)} → ${matches.length ? matches.join(', ') : '(none)'}`);
}
