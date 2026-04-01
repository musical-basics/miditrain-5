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

# Always wipe Turbopack dev cache to prevent SST corruption on restart
echo "🧹 Clearing Next.js cache..."
rm -rf .next/dev/cache

# Start the Next.js visualizer
echo "🚀 Booting visualizer UI on http://localhost:3000..."
pnpm dev
