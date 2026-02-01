#!/usr/bin/env bash
#
# claude-mem-secure setup script
# One-command installation and configuration
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() { echo -e "${BLUE}==>${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_warning() { echo -e "${YELLOW}!${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}     claude-mem-secure installer        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}     Persistent memory for Claude Code  ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for required tools
print_step "Checking requirements..."

if command -v bun &> /dev/null; then
    RUNTIME="bun"
    print_success "Found Bun runtime"
elif command -v node &> /dev/null; then
    RUNTIME="node"
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js 18+ required (found v$NODE_VERSION)"
        exit 1
    fi
    print_success "Found Node.js $(node -v)"
else
    print_error "Neither Bun nor Node.js found. Please install one of them."
    echo "  Install Bun: curl -fsSL https://bun.sh/install | bash"
    echo "  Install Node: https://nodejs.org/"
    exit 1
fi

# Check for package manager
if command -v bun &> /dev/null; then
    PKG_MGR="bun"
elif command -v npm &> /dev/null; then
    PKG_MGR="npm"
else
    print_error "No package manager found (bun or npm)"
    exit 1
fi

print_success "Using $PKG_MGR as package manager"

# Install dependencies
print_step "Installing dependencies..."
$PKG_MGR install --silent 2>/dev/null || $PKG_MGR install
print_success "Dependencies installed"

# Build the project
print_step "Building project..."
if [ -f "package.json" ] && grep -q '"build"' package.json; then
    $PKG_MGR run build 2>/dev/null || true
fi
print_success "Build complete"

# Create data directory with secure permissions
print_step "Setting up data directory..."
DATA_DIR="$HOME/.claude-mem"
mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"
print_success "Created $DATA_DIR with secure permissions"

# Configure Claude Code hooks
print_step "Configuring Claude Code hooks..."

CLAUDE_CONFIG_DIR="$HOME/.claude"
CLAUDE_SETTINGS="$CLAUDE_CONFIG_DIR/settings.json"

mkdir -p "$CLAUDE_CONFIG_DIR"

# Create or update Claude settings with hooks
if [ -f "$CLAUDE_SETTINGS" ]; then
    # Backup existing settings
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.backup.$(date +%Y%m%d%H%M%S)"
    print_warning "Backed up existing settings"
fi

# Find bun path
BUN_PATH=$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")

# Generate hooks configuration (new format with nested hooks array)
HOOKS_CONFIG=$(cat <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$BUN_PATH $SCRIPT_DIR/plugin/scripts/worker-service.cjs hook claude-code context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$BUN_PATH $SCRIPT_DIR/plugin/scripts/worker-service.cjs hook claude-code session-init"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$BUN_PATH $SCRIPT_DIR/plugin/scripts/worker-service.cjs hook claude-code observation"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$BUN_PATH $SCRIPT_DIR/plugin/scripts/worker-service.cjs hook claude-code summarize"
          }
        ]
      }
    ]
  }
}
EOF
)

# Merge with existing settings or create new
if [ -f "$CLAUDE_SETTINGS" ]; then
    # Use jq if available, otherwise Python
    if command -v jq &> /dev/null; then
        jq -s '.[0] * .[1]' "$CLAUDE_SETTINGS" <(echo "$HOOKS_CONFIG") > "$CLAUDE_SETTINGS.tmp"
        mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"
    elif command -v python3 &> /dev/null; then
        python3 -c "
import json, sys
with open('$CLAUDE_SETTINGS') as f: existing = json.load(f)
new_hooks = json.loads('''$HOOKS_CONFIG''')
existing.update(new_hooks)
with open('$CLAUDE_SETTINGS', 'w') as f: json.dump(existing, f, indent=2)
"
    else
        print_warning "Could not merge settings (no jq or python3). Creating new file."
        echo "$HOOKS_CONFIG" > "$CLAUDE_SETTINGS"
    fi
else
    echo "$HOOKS_CONFIG" > "$CLAUDE_SETTINGS"
fi
print_success "Claude Code hooks configured"

# Verify worker-service.cjs exists
print_step "Verifying built files..."
if [ ! -f "$SCRIPT_DIR/plugin/scripts/worker-service.cjs" ]; then
    print_error "worker-service.cjs not found. Build may have failed."
    print_warning "Try running: $PKG_MGR run build"
    exit 1
fi
print_success "Built files verified"

# Create logs directory
mkdir -p "$DATA_DIR/logs"

# Final summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}     Installation Complete!              ${GREEN}║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo "claude-mem-secure has been installed and configured."
echo ""
echo -e "${BLUE}What's next:${NC}"
echo "  1. Restart Claude Code to activate the hooks"
echo "  2. Your sessions will now be remembered!"
echo ""
echo -e "${BLUE}Data location:${NC} $DATA_DIR"
echo -e "${BLUE}Logs:${NC} $DATA_DIR/logs/"
echo ""
echo -e "${BLUE}Commands:${NC}"
echo "  View memory:    open http://127.0.0.1:37777"
echo "  Get auth token: curl http://127.0.0.1:37777/api/auth/token"
echo ""
echo -e "${YELLOW}Security features enabled:${NC}"
echo "  ✓ API keys stored in OS keyring"
echo "  ✓ API authentication required"
echo "  ✓ Automatic secret redaction"
echo "  ✓ Data retention policies"
echo ""
