#!/usr/bin/env node

/*
 * Sets the shared version across the root and every workspace package,
 * or verifies they are all equal (--check prints the version).
 *
 * Usage:
 *   node scripts/set-version.js 1.2.3
 *   node scripts/set-version.js --check
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

function listWorkspaceDirs() {
  // Workspace dirs come from pnpm-workspace.yaml. Parse the simple "  - dir"
  // list entries with a regex so we don't need a YAML dependency.
  const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const dirs = [];
  for (const line of yaml.split(/\r?\n/)) {
    const match = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const entry = match[1].replace(/^['"]|['"]$/g, '');
    dirs.push(path.join(root, entry));
  }
  return dirs.filter((p) => fs.existsSync(p));
}

function listPackageFiles() {
  // The root package plus every workspace package share one version.
  return [
    path.join(root, 'package.json'),
    ...listWorkspaceDirs().map((dir) => path.join(dir, 'package.json')),
  ];
}

function checkVersions() {
  // Verify every package carries the same version. Print it on success;
  // list every file's version on mismatch so the offender is obvious.
  const files = listPackageFiles();
  const versions = files.map((file) => readJson(file).version);
  const unique = [...new Set(versions)];

  if (unique.length === 1) {
    // Refuse to print (and let CI consume) anything that is not a plain
    // semver string — a malformed version should fail the release run here.
    if (!VERSION_RE.test(unique[0])) {
      console.error(`Invalid version in package.json files: ${unique[0]}`);
      process.exit(1);
    }
    console.log(unique[0]);
    return;
  }

  console.error('Version mismatch across packages:');
  for (let i = 0; i < files.length; i++) {
    console.error(`  ${path.relative(root, files[i])}: ${versions[i]}`);
  }
  process.exit(1);
}

function setVersions(version) {
  // Set the version on the root package and every workspace package. Internal
  // dependency specs are intentionally NOT rewritten: they use the workspace:
  // protocol, which pnpm converts to real semver ranges at publish time.
  const files = listPackageFiles();
  for (const file of files) {
    const pkg = readJson(file);
    pkg.version = version;
    writeJson(file, pkg);
  }
  console.log(`Set version ${version} in ${files.length} package.json files.`);
}

function main() {
  const [arg] = process.argv.slice(2);

  if (arg === '--check') {
    checkVersions();
    return;
  }

  if (!arg || !VERSION_RE.test(arg)) {
    console.error('Usage: set-version.js <version>|--check');
    process.exit(2);
  }

  setVersions(arg);
}

main();
