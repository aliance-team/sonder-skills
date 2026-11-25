#!/usr/bin/env node
// Enforce category prefixes on first-party skill directory names.
// Policy: scripts/skill-names.json. Upstream skills installed by the `skills`
// CLI are git-ignored and therefore out of scope.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", ...options }).trim();

const root = git(["rev-parse", "--show-toplevel"]);
const policyPath = join(root, "scripts/skill-names.json");
if (!existsSync(policyPath)) {
  console.error(`skill names: missing policy file ${policyPath}`);
  process.exit(1);
}

const policy = JSON.parse(readFileSync(policyPath, "utf8"));
const prefixes = Object.keys(policy.categories);
const legacy = new Set(policy.legacy);

const ignored = (name) => {
  try {
    execFileSync("git", ["check-ignore", "-q", `skills/${name}`], {
      cwd: root,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

const skills = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(root, "skills", name, "SKILL.md")))
  .filter((name) => !ignored(name))
  .sort();

const errors = [];

for (const name of skills) {
  const prefixed = prefixes.find((prefix) => name.startsWith(prefix));
  if (!prefixed && !legacy.has(name)) {
    errors.push(
      `skills/${name}: no category prefix (${prefixes.join(", ")}) and not in the legacy list`,
    );
  }
  if (prefixed && legacy.has(name)) {
    errors.push(
      `legacy entry "${name}": already carries the "${prefixed}" prefix — delete the entry`,
    );
  }
  const head = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8")
    .split(/\r?\n/)
    .slice(0, 25)
    .find((line) => line.startsWith("name:"));
  const declared = head?.replace(/^name:\s*/, "").trim();
  if (declared && declared !== name) {
    errors.push(
      `skills/${name}/SKILL.md: frontmatter name "${declared}" differs from the directory name`,
    );
  }
}

const present = new Set(skills);
for (const name of policy.legacy) {
  if (!present.has(name)) {
    errors.push(
      `legacy entry "${name}": no such first-party skill — delete the entry`,
    );
  }
}

if (errors.length) {
  console.error(errors.map((error) => `skill names: ${error}`).join("\n"));
  console.error(
    `skill names: ${errors.length} problem(s). Fix the name or the policy in scripts/skill-names.json.`,
  );
  process.exit(1);
}

console.log(
  `skill names: ${skills.length} first-party skills, ${policy.legacy.length} grandfathered, ${prefixes.length} categories`,
);
