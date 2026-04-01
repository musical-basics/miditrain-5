#!/usr/bin/env bash

# Exit if any command fails
set -e

echo "🎵 Starting Miditrain-3 Engine..."

# Ensure we're in the right directory relative to the script
cd "$(dirname "$0")"

# We run from the root, but the web app is inside visualizer
cd visualizer

# Install missing dependencies if needed
pnpm install

# Start the Next.js visualizer
echo "🚀 Booting visualizer UI on http://localhost:3000..."
pnpm dev
