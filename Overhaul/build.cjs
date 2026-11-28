'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installInventoryEngine } = require('./src/inventory.cjs');
const { installInventoryUi } = require('./src/inventory-ui.cjs');
const { createThumbnailLoader } = require('./src/thumbnails.cjs');
const { installCameraBridge } = require('./src/camera-bridge.cjs');
const { createLiquipediaCameraLookup } = require('./src/liquipedia-cameras.cjs');

const { installBroadcastResult, showBroadcastResult } = require('./src/broadcast.cjs');
const { installModBadge } = require('./src/version-badge.cjs');
const { installComposure } = require('./src/composure.cjs');
const { installComposureUi } = require('./src/composure-ui.cjs');
const { installCoaches } = require('./src/coaches.cjs');
const { installCoachesUi } = require('./src/coaches-ui.cjs');
const { installWorldStaff } = require('./src/world-staff.cjs');
const { installWorldStaffUi } = require('./src/world-staff-ui.cjs');
const { coachAudience, coachArchiveKey, installCoachSocial } = require('./src/coach-social.cjs');
const { installPostmatchFrame } = require('./src/postmatch-frame.cjs');

const { installCareerExtras, installCareerSetup } = require('./src/career-extras.cjs');

const { steamInputRequestFile, requestSteamProxy, runSteamInputProxy } = require('./src/steam-input.cjs');

const { installCareerUpdate, compareVersions, latestCareerRelease, modifierFileVersion, showVersionNotice } = require('./src/version-check.cjs');

const { quickChatCatalog, installQuickChat, installQuickChatUi } = require('./src/quick-chat.cjs');

const { matchOfficialsRules, installMatchOfficials } = require('./src/match-officials.cjs');
const { installMatchOfficialsUi } = require('./src/match-officials-ui.cjs');
const { recruitmentRules, installRecruitment } = require('./src/recruitment.cjs');
const { installRecruitmentUi } = require('./src/recruitment-ui.cjs');
const { setupGearCatalog, installSetupGear } = require('./src/setup-gear.cjs');
const { installSetupGearUi } = require('./src/setup-gear-ui.cjs');
const { installRatingDials } = require('./src/rating-dials.cjs');
const { installWorldAttributes, installWorldAttributeUi } = require('./src/world-attributes.cjs');

process.chdir(__dirname);
fs.mkdirSync('bin', { recursive: true });
fs.mkdirSync('.build', { recursive: true });
const main = path.resolve('.build/launcher.cjs');
const source = fs.readFileSync('src/launcher.cjs', 'utf8');
const hooks = [installModBadge, installInventoryEngine, installInventoryUi, createThumbnailLoader, installCameraBridge, createLiquipediaCameraLookup, installPostmatchFrame, installBroadcastResult, showBroadcastResult, installCareerExtras, installCareerSetup, installCoaches, installCoachesUi, installWorldStaff, installWorldStaffUi, coachAudience, coachArchiveKey, installCoachSocial, installComposure, installComposureUi, steamInputRequestFile, requestSteamProxy, runSteamInputProxy, compareVersions, latestCareerRelease, modifierFileVersion, showVersionNotice, installCareerUpdate, installQuickChat, installQuickChatUi, matchOfficialsRules, installMatchOfficials, installMatchOfficialsUi, recruitmentRules, installRecruitment, installRecruitmentUi]
  .concat(setupGearCatalog,installSetupGear,installSetupGearUi,installRatingDials,installWorldAttributes,installWorldAttributeUi)
  .map(fn => fn.toString()).join('\n');
fs.writeFileSync(main, source.replace('/* INVENTORY_HOOKS */', () => 'const quickChatCatalog = ' + JSON.stringify(quickChatCatalog) + ';\n' + hooks));
const output = path.resolve('bin/RLCareer-Overhaul.exe');
const config = path.resolve('.build/RLCareer-Overhaul.json');
const coachCatalog = require('./src/coach-catalog.json');
const portraits = require('./assets/coach-portraits/sources.json');
for (const profile of coachCatalog.profiles) {
  const portrait = portraits[profile.id];
  if (portrait && fs.existsSync(path.join('assets/coach-portraits', portrait.file))) {
    const data = fs.readFileSync(path.join('assets/coach-portraits',portrait.file));
    profile.portrait = 'data:image/jpeg;base64,' + data.toString('base64');
  }
}
const coachAsset = path.resolve('.build/coach-catalog.json');
fs.writeFileSync(coachAsset,JSON.stringify(coachCatalog));
const assets = {
  inventoryTitles: path.resolve('src/title-catalog.json'),
  cameraProfiles: path.resolve('src/camera-profiles.json'),
  playerAttributes: path.resolve('src/player-attributes.json'),
  gearBrandLogos: path.resolve('src/gear-brand-logos.json'),
  coachCatalog: coachAsset,
  hudArt: path.resolve('src/hud-art.json'),
  hudGlyphs: path.resolve('src/hud-glyphs.json'),
  botStyleInstaller: path.resolve('install-bot-style.py'),
  quickChatInstaller: path.resolve('install-quick-chat.py'),
  botStyle: path.resolve('src/rlc_bot_style.py'),
  advancedMoves: path.resolve('src/rlc_advanced_moves.py'),
  quickChat: path.resolve('src/rlc_quick_chat.py'),
  cameraPlugin: path.resolve('bin/rlcareercameras.dll'),
  ...(fs.existsSync('assets/rl-music-background.wav') ? { intermissionMusic: path.resolve('assets/rl-music-background.wav') } : {}),
  ...(fs.existsSync('assets/timeout-background.wav') ? { timeoutMusic: path.resolve('assets/timeout-background.wav') } : {})
};
fs.writeFileSync(config, JSON.stringify({ main, output, assets, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--build-sea=' + config], { stdio: 'inherit' });
if (process.platform === 'win32') {
  execFileSync('python', ['set-launcher-icon.py', output, 'assets/mod-icon.ico'], { stdio: 'inherit' });
}
execFileSync(output, ['--version'], { stdio: 'inherit' });
