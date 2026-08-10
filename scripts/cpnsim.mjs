#!/usr/bin/env node
/**
 * Switch @rwth-pads/cpnsim between the published package and a local checkout of the
 * Rust crate, for testing simulator changes before they are released.
 *
 *   npm run cpnsim:local     build the local crate to wasm and point the app at it
 *   npm run cpnsim:restore   go back to the published version
 *   npm run cpnsim:status    show which one is currently in use
 *
 * The crate location is resolved from CPNSIM_DIR, falling back to a few conventional
 * layouts, so this works on any machine without hardcoded paths:
 *
 *   CPNSIM_DIR=~/src/cpnsim npm run cpnsim:local
 *
 * Neither package.json nor any lockfile is modified in either direction. The switch is
 * a plain symlink inside node_modules, written directly rather than through `npm link`
 * or `pnpm link`, so it behaves identically under npm, pnpm and yarn and leaves no
 * global state behind. The published version stays the committed truth, and a stale
 * link can never reach anyone else.
 *
 * Switching away moves the installed package aside rather than deleting it, so
 * restoring is a rename back. That deliberately avoids running `install` to repair the
 * dependency: an install resolves the whole tree, and in a repo whose lockfile has
 * drifted from package.json it will quietly rewrite the lockfile as a side effect of
 * what should be a local, throwaway switch.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, lstatSync, realpathSync, symlinkSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@rwth-pads/cpnsim';
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installedAt = join(appDir, 'node_modules', PACKAGE);
/**
 * Where the published install is parked while the local build is in use. It must sit
 * in the same directory as the install itself: under pnpm the entry is a symlink with
 * a path relative to its own location, so parking it at a different depth would leave
 * it dangling and unrestorable.
 */
const stashedAt = join(dirname(installedAt), '.cpnsim-published');

/** exists() that counts a symlink itself, dangling target or not. */
function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Conventional places to look for the crate, relative to this app. */
const CANDIDATES = ['../cpnsim', '../../rust/cpnsim', '../../../rust/cpnsim'];

const bail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

/** True if dir is a checkout of the cpnsim crate (not just any directory). */
function isCrate(dir) {
  const cargo = join(dir, 'Cargo.toml');
  return existsSync(cargo) && /^name\s*=\s*"cpnsim"/m.test(readFileSync(cargo, 'utf8'));
}

function findCrate() {
  if (process.env.CPNSIM_DIR) {
    const dir = resolve(process.env.CPNSIM_DIR.replace(/^~(?=$|\/)/, process.env.HOME ?? '~'));
    if (!isCrate(dir)) bail(`CPNSIM_DIR is set to ${dir}, but that is not a cpnsim checkout.`);
    return dir;
  }
  for (const candidate of CANDIDATES) {
    const dir = resolve(appDir, candidate);
    if (isCrate(dir)) return dir;
  }
  bail(
    `Could not find the cpnsim crate. Looked in:\n` +
      CANDIDATES.map((c) => `    ${resolve(appDir, c)}`).join('\n') +
      `\n\n  Point at it explicitly:\n    CPNSIM_DIR=/path/to/cpnsim npm run cpnsim:local`,
  );
}

/** The package manager this repo is set up for, so restore reinstalls the right way. */
function packageManager() {
  const { packageManager: declared } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  if (declared) return declared.split('@')[0];
  if (existsSync(join(appDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(appDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Where the installed package resolves to when it is OUR link to a crate checkout.
 * Returns null otherwise — note pnpm installs are themselves symlinks into .pnpm,
 * so the target has to be checked, not merely the fact that it is a link.
 */
function localLinkTarget() {
  if (!existsSync(installedAt) || !lstatSync(installedAt).isSymbolicLink()) return null;
  const target = realpathSync(installedAt);
  return isCrate(resolve(target, '..')) ? target : null;
}

function status() {
  const linked = localLinkTarget();
  if (linked) {
    console.log(`${PACKAGE} → LOCAL build at ${linked}`);
    console.log(`  Rebuild after changing Rust sources: npm run cpnsim:local`);
  } else if (existsSync(installedAt)) {
    const { version } = JSON.parse(readFileSync(join(installedAt, 'package.json'), 'utf8'));
    console.log(`${PACKAGE} → published version ${version}`);
  } else {
    console.log(`${PACKAGE} is not installed. Run: ${packageManager()} install`);
  }
}

/** Vite pre-bundles and caches the wasm; a stale cache silently serves the old
 *  simulator after a switch, which looks exactly like the change not working. */
function clearViteCache() {
  rmSync(join(appDir, 'node_modules', '.vite'), { recursive: true, force: true });
  console.log('\n⚠  Restart the dev server — the Vite cache was cleared.');
}

function switchToLocal() {
  const crateDir = findCrate();
  console.log(`Building cpnsim from ${crateDir}\n`);

  try {
    run('wasm-pack', ['--version']);
  } catch {
    bail(
      'wasm-pack is not installed.\n' +
        '  Install it with:  cargo install wasm-pack\n' +
        '  (see https://rustwasm.github.io/wasm-pack/installer/)',
    );
  }

  // Must match the release build in cpnsim's README, or the app gets a package
  // built with different features than the published one.
  run(
    'wasm-pack',
    ['build', '--scope', 'rwth-pads', '--target', 'web', '--release', '--', '--features', 'wasm'],
    crateDir,
  );

  const pkgDir = join(crateDir, 'pkg');
  if (!existsSync(join(pkgDir, 'package.json'))) bail(`Build finished but ${pkgDir} has no package.json.`);

  mkdirSync(dirname(installedAt), { recursive: true });
  // Park the published install (unless one is already parked from an earlier switch)
  // so restore is a rename rather than a dependency resolution.
  if (pathExists(installedAt) && !localLinkTarget() && !pathExists(stashedAt)) {
    renameSync(installedAt, stashedAt);
  }
  rmSync(installedAt, { recursive: true, force: true });
  symlinkSync(pkgDir, installedAt, 'dir');

  console.log('');
  status();
  clearViteCache();
}

function restore() {
  if (!localLinkTarget() && pathExists(installedAt)) {
    console.log('Already on the published version.');
    return status();
  }
  rmSync(installedAt, { recursive: true, force: true });

  if (pathExists(stashedAt)) {
    renameSync(stashedAt, installedAt);
  } else {
    // Nothing parked — node_modules was wiped, or the link predates this script.
    // Only here is an install warranted, and it may touch the lockfile.
    const pm = packageManager();
    console.log(`No parked copy found; reinstalling with ${pm} (this may update the lockfile)\n`);
    run(pm, ['install'], appDir);
  }

  console.log('');
  status();
  clearViteCache();
}

const command = process.argv[2];
if (command === 'local') switchToLocal();
else if (command === 'restore') restore();
else if (command === 'status') status();
else bail(`Unknown command "${command ?? ''}". Expected one of: local, restore, status`);
