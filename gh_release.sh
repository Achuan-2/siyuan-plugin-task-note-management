#!/bin/bash
# gh repo set-default
# Change directory to the script's directory
cd "$(dirname "$0")" 

# Get current branch
current_branch=$(git rev-parse --abbrev-ref HEAD)

# Get version from plugin.json
version=v$(grep -oP '(?<="version": ")[^"]+' plugin.json) 
# Check if version already exists
if git rev-parse "$version" >/dev/null 2>&1 || gh release view "$version" >/dev/null 2>&1; then
    read -p "Version $version already exists. Overwrite? (y/n) " confirm
    if [ "$confirm" != "y" ]; then
        echo "Release aborted."
        exit 0
    fi
fi
echo "Preparing release for version: $version"

# Commit changes in private-branch
echo "Committing changes in private-branch..."
git add .
git commit -m "🔖 $version" || echo "No changes to commit in private-branch"
git push origin main

echo "Creating release for version: $version"

# Extract release notes from CHANGELOG.md
# Find the section starting with "## $version" and ending before the next "## " line
release_notes=$(awk "/^## $version/ {flag=1; next} /^## / {flag=0} flag" CHANGELOG.md | sed '/^$/d')

if [ -z "$release_notes" ]; then
    if ! grep -q "^## $version" CHANGELOG.md; then
        echo "Warning: No section starting with '## $version' found in CHANGELOG.md"
    else
        echo "Warning: Changelog entry for version $version is empty."
    fi
    read -p "Proceed with release anyway? (y/n) " confirm
    if [ "$confirm" != "y" ]; then
        echo "Release aborted."
        exit 1
    fi
fi

echo "Release notes:"
echo "$release_notes"
echo ""

# Check if release already exists
if gh release view "$version" &>/dev/null; then
    echo "Release $version already exists. Deleting..."
    gh release delete "$version" -y
    echo "Release deleted."
fi

# Check if tag already exists and delete it
# First check remote tag
if git ls-remote --tags origin | grep -q "refs/tags/$version"; then
    echo "Remote tag $version exists. Deleting..."
    git push origin :refs/tags/"$version" 2>/dev/null || echo "Failed to delete remote tag."
    echo "Remote tag deleted."
fi

# Then delete local tag if exists
if git rev-parse "$version" &>/dev/null 2>&1; then
    echo "Local tag $version exists. Deleting..."
    git tag -d "$version"
    echo "Local tag deleted."
fi

# Build the package
pnpm run build

# Create GitHub release with extracted notes
gh release create "$version" package.zip \
    --title "$version / $(date +%Y%m%d)" \
    --notes "$release_notes" \
    --latest

echo "Release $version created successfully!"
