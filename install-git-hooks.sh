#!/bin/bash
# install-git-hooks.sh: Symlink all hooks from ./hooks/ to .git/hooks/
set -euo pipefail

echo "Installing git hooks..."

# Get the absolute path to the hooks directory
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)/hooks"
GIT_HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

# Check if we're in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: Not in a git repository"
  exit 1
fi

# Check if hooks directory exists
if [ ! -d "$HOOKS_DIR" ]; then
  echo "Error: Hooks directory not found at $HOOKS_DIR"
  exit 1
fi

# Create git hooks directory if it doesn't exist
mkdir -p "$GIT_HOOKS_DIR"

# Install each hook
installed_count=0
for hook in "$HOOKS_DIR"/*; do
  if [ -f "$hook" ]; then
    name="$(basename "$hook")"
    target="$GIT_HOOKS_DIR/$name"
    
    # Remove existing hook if present
    if [ -e "$target" ] || [ -L "$target" ]; then
      echo "Removing existing $name hook"
      rm -f "$target"
    fi
    
    # Create symlink and make executable
    ln -s "$hook" "$target"
    chmod +x "$hook"
    echo "✓ Installed $name hook"
    ((installed_count++))
  fi
done

if [ $installed_count -eq 0 ]; then
  echo "No hooks found in $HOOKS_DIR"
  exit 1
fi

echo "Successfully installed $installed_count git hook(s)"
echo ""
echo "Available hooks:"
for hook in "$HOOKS_DIR"/*; do
  if [ -f "$hook" ]; then
    name="$(basename "$hook")"
    echo "  - $name: $(head -2 "$hook" | tail -1 | sed 's/^# *//')"
  fi
done
echo ""
echo "To uninstall hooks, run: rm -f .git/hooks/*"
echo "To reinstall hooks, run: ./install-git-hooks.sh"
