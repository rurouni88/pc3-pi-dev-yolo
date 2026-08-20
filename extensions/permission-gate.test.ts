/**
 * Permission Gate Extension — Unit Tests
 *
 * Run with:
 *   npx tsx extensions/permission-gate.test.ts
 *   (requires Node 18+ with TypeScript support via tsx or esbuild-register)
 */

import {
  dangerousPatterns,
  getRelativePath,
  isWhitelisted,
  approvedPaths,
  approvePath,
  resetSession,
} from "./permission-gate";

// ── Test runner ─────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    results.push({ name: message, passed: false, error: "Assertion failed" });
    failed++;
  } else {
    results.push({ name: message, passed: true });
    passed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const pass = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    results.push({
      name: message,
      passed: false,
      error: `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    });
    failed++;
  } else {
    results.push({ name: message, passed: true });
    passed++;
  }
}

// ── Test suites ─────────────────────────────────────────────────────────

function testGetRelativePath(): void {
  const cwd = "/Users/paul/Dev/GIT/pc3-pi-dev-yolo";

  assertEqual(
    getRelativePath("/Users/paul/Dev/GIT/pc3-pi-dev-yolo/foo.ts", cwd),
    "foo.ts",
    "returns relative path when path is within cwd",
  );

  assertEqual(
    getRelativePath("/Users/paul/Dev/GIT/pc3-pi-dev-yolo/src/bar.ts", cwd),
    "src/bar.ts",
    "returns nested relative path correctly",
  );

  assertEqual(
    getRelativePath("/Users/paul/Dev/GIT/pc3-pi-dev-yolo", cwd),
    ".",
    "returns dot when path equals cwd",
  );

  assertEqual(
    getRelativePath("/other/path/file.ts", cwd),
    "/other/path/file.ts",
    "returns absolute path when outside cwd",
  );

  assertEqual(
    getRelativePath("/Users/paul/Dev/GIT/pc3-pi-dev-yolo/./foo.ts", cwd),
    "./foo.ts",
    "preserves dot component in relative path",
  );
}

function testIsWhitelisted(): void {
  const home = process.env.HOME ?? "/Users/paul";
  const cwd = process.cwd();
  const extensionsPath = `${home}/.pi/agent/extensions`;

  // Static whitelist (extensions dir) always works
  assert(isWhitelisted(extensionsPath), "returns true for extensions directory");
  assert(isWhitelisted(`${extensionsPath}/my-ext.ts`), "returns true for file in extensions");

  // Dynamic cwd whitelist
  assert(isWhitelisted(cwd, cwd), "returns true for cwd itself");
  assert(isWhitelisted(`${cwd}/extensions/permission-gate.ts`, cwd), "returns true for file in cwd project");
  assert(isWhitelisted(`${cwd}/src/nested/file.ts`, cwd), "returns true for deeply nested file in cwd project");

  // Unrelated paths should not be whitelisted
  assert(!isWhitelisted("/tmp/something.ts"), "returns false for /tmp path without cwd");
  assert(!isWhitelisted("/tmp/something.ts", cwd), "returns false for /tmp path with cwd");
  assert(!isWhitelisted("/Users/paul/other-project/file.ts", cwd), "returns false for unrelated project");
  assert(!isWhitelisted("/etc/passwd", cwd), "returns false for system path");
}

function testDangerousPatterns(): void {
  // rm -rf variants
  assert(dangerousPatterns.some((p) => p.test("rm -rf /")), "matches rm -rf with slash");
  assert(dangerousPatterns.some((p) => p.test("rm -r ./folder")), "matches rm -r on directory");
  assert(dangerousPatterns.some((p) => p.test("rm --recursive ./dir")), "matches rm --recursive flag");
  assert(dangerousPatterns.some((p) => p.test("Rm -rf ./test")), "matches case-insensitively");

  // sudo variants
  assert(dangerousPatterns.some((p) => p.test("sudo apt update")), "matches sudo with command");
  assert(dangerousPatterns.some((p) => p.test("sudo -i")), "matches sudo with flag");
  assert(dangerousPatterns.some((p) => p.test("SUDO command")), "matches sudo case-insensitively");

  // chmod/chown 777
  assert(dangerousPatterns.some((p) => p.test("chmod 777 file.txt")), "matches chmod 777 on file");
  assert(dangerousPatterns.some((p) => p.test("chown 777 file.txt")), "matches chown 777 on file");
  assert(dangerousPatterns.some((p) => p.test("chmod 777 dir/")), "matches chmod 777 on directory");

  // Safe commands should not match
  const safeCommands = [
    "ls -la",
    "cat file.txt",
    "echo hello",
    "git status",
    "npm install",
    "mkdir newdir",
    "chmod 644 file.txt",
    "chown user:group file.txt",
    "rm file.txt", // rm without -rf is safe
  ];

  for (const cmd of safeCommands) {
    const isDangerous = dangerousPatterns.some((p) => p.test(cmd));
    assert(!isDangerous, `does not match safe command: ${cmd}`);
  }
}

function testSessionApprovedPaths(): void {
  resetSession();

  assert(!approvedPaths.has("/tmp/test.ts"), "starts with empty approval set");

  approvePath("/tmp/test.ts");
  assert(approvedPaths.has("/tmp/test.ts"), "adds path to approval set");

  assert(!approvedPaths.has("/tmp/other.ts"), "does not add different path");

  approvePath("/tmp/other.ts");
  assert(approvedPaths.has("/tmp/other.ts"), "adds second path");
  assert(approvedPaths.has("/tmp/test.ts"), "retains first path");

  const sizeBefore = approvedPaths.size;
  approvePath("/tmp/test.ts");
  assertEqual(approvedPaths.size, sizeBefore, "does not duplicate when approving same path");

  resetSession();
  assert(approvedPaths.size === 0, "clears all approvals on reset");
}

// ── Print results ───────────────────────────────────────────────────────

function printResults(): void {
  console.log("\n=== Permission Gate Extension — Unit Tests ===\n");

  for (const result of results) {
    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.name}`);
    if (!result.passed && result.error) {
      console.log(`   ${result.error}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total\n`);

  if (failed > 0) {
    console.log("❌ Some tests failed\n");
  } else {
    console.log("✅ All tests passed\n");
  }
}

// ── Run ─────────────────────────────────────────────────────────────────

function runTests(): void {
  testGetRelativePath();
  testIsWhitelisted();
  testDangerousPatterns();
  testSessionApprovedPaths();
}

runTests();
printResults();
process.exit(failed > 0 ? 1 : 0);
