/**
 * Utility functions to extract package names from PR diffs
 */

export interface PackageChange {
  name: string;
  version?: string;
  type: 'added' | 'removed' | 'updated';
}

/**
 * Extract package names from package.json diff
 */
export function extractPackagesFromPackageJson(diff: string): PackageChange[] {
  const packages: PackageChange[] = [];
  const lines = diff.split('\n');

  let inDependencies = false;
  let inDevDependencies = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip diff header lines (starting with @@)
    if (line.startsWith('@@')) {
      continue;
    }

    // Check if we're entering dependencies section (works for both + and - lines)
    if (line.includes('"dependencies"') || line.includes("'dependencies'")) {
      inDependencies = true;
      inDevDependencies = false;
      continue;
    }

    // Check if we're entering devDependencies section
    if (line.includes('"devDependencies"') || line.includes("'devDependencies'")) {
      inDependencies = false;
      inDevDependencies = true;
      continue;
    }

    // Check if we're leaving a section (closing brace)
    if (line.match(/^[\+\-\s]*\}[\s,]*$/)) {
      inDependencies = false;
      inDevDependencies = false;
      continue;
    }

    // Extract package additions (lines starting with +)
    // We check if we're in a dependencies section OR if the line looks like a package entry
    // (this handles cases where the section header isn't in the diff)
    if (line.startsWith('+')) {
      const packageLine = line.substring(1).trim();
      
      // Match package name and version: "package-name": "version" or 'package-name': 'version'
      // Also handle trailing commas
      const match = packageLine.match(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/);
      if (match) {
        const [, name, version] = match;
        // Skip if it's a section header or closing brace
        if (name && 
            name !== 'dependencies' && 
            name !== 'devDependencies' &&
            !name.startsWith('}')) {
          // Only add if we're in a dependencies section OR if it looks like a package entry
          // (package names typically don't contain special characters like {, }, :, etc.)
          if (inDependencies || inDevDependencies || /^[a-zA-Z0-9@_\-\.\/]+$/.test(name)) {
            packages.push({
              name,
              version: cleanVersion(version),
              type: 'added',
            });
          }
        }
      }
    }

    // Extract package removals (lines starting with -)
    if (line.startsWith('-')) {
      const packageLine = line.substring(1).trim();
      const match = packageLine.match(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/);
      if (match) {
        const [, name, version] = match;
        if (name && 
            name !== 'dependencies' && 
            name !== 'devDependencies' &&
            !name.startsWith('}')) {
          if (inDependencies || inDevDependencies || /^[a-zA-Z0-9@_\-\.\/]+$/.test(name)) {
            packages.push({
              name,
              version: cleanVersion(version),
              type: 'removed',
            });
          }
        }
      }
    }
  }

  return packages;
}

/**
 * Extract package names from requirements.txt diff
 */
export function extractPackagesFromRequirementsTxt(diff: string): PackageChange[] {
  const packages: PackageChange[] = [];
  const lines = diff.split('\n');

  for (const line of lines) {
    if (line.startsWith('+')) {
      const packageLine = line.substring(1).trim();
      // Match format: package-name==version or package-name>=version, etc.
      const match = packageLine.match(/^([a-zA-Z0-9_-]+(?:\[[^\]]+\])?)([=<>!]+)?([0-9.]+)?/);
      if (match && !packageLine.startsWith('#')) {
        const [, name] = match;
        const versionMatch = packageLine.match(/==([0-9.]+)/);
        packages.push({
          name: name.split('[')[0], // Remove extras like package[extra]
          version: versionMatch ? versionMatch[1] : undefined,
          type: 'added',
        });
      }
    }
  }

  return packages;
}

/**
 * Extract package names from PR files
 */
export function extractPackagesFromPRFiles(files: any[]): PackageChange[] {
  const packages: PackageChange[] = [];

  for (const file of files) {
    if (file.filename === 'package.json' && file.patch) {
      const packageChanges = extractPackagesFromPackageJson(file.patch);
      packages.push(...packageChanges);
    } else if (file.filename === 'requirements.txt' && file.patch) {
      const requirementsChanges = extractPackagesFromRequirementsTxt(file.patch);
      packages.push(...requirementsChanges);
    }
  }

  return packages;
}

/**
 * Clean version string (remove ^, ~, etc.)
 */
function cleanVersion(version: string): string {
  if (!version) return '';
  // Remove range prefixes
  return version.replace(/^[\^~]/, '').trim();
}

