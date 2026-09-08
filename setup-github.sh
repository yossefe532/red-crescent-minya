#!/bin/bash
# GitHub Repository Setup Script for Red Crescent Minya
# Run this script after creating the repo on GitHub

echo "🚀 Red Crescent Minya - GitHub Push Setup"
echo "=========================================="
echo ""

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found. Install from: https://cli.github.com"
    exit 1
fi

# Check if authenticated
echo "🔐 Checking GitHub authentication..."
if ! gh auth status &> /dev/null; then
    echo "⚠️  Not authenticated. Running gh auth login..."
    gh auth login --web
fi

# Get repo name from user
read -p "Enter GitHub username: " GH_USER
read -p "Enter repository name (default: red-crescent-minya): " GH_REPO
GH_REPO=${GH_REPO:-red-crescent-minya}

# Create remote
echo ""
echo "📡 Adding remote..."
git remote add origin "https://github.com/${GH_USER}/${GH_REPO}.git" 2>/dev/null || \
    git remote set-url origin "https://github.com/${GH_USER}/${GH_REPO}.git"

# Push to GitHub
echo ""
echo "⬆️  Pushing to GitHub..."
git branch -M main
git push -u origin main

echo ""
echo "✅ Done! Repository: https://github.com/${GH_USER}/${GH_REPO}"
