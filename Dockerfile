# Stage 1: Build
FROM oven/bun:1-slim AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src/ ./src/
RUN bun run build

# Stage 2: Production
FROM oven/bun:1-slim

# Install dependencies for Claude Code CLI and GitHub CLI
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create directories for bun user
RUN mkdir -p /home/bun/.config/gh && chown -R bun:bun /home/bun/.config

# Switch to bun user for Claude Code CLI installation
USER bun

# Install Claude Code CLI and Beads CLI as bun user
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash

# Add Claude and Beads to PATH
ENV PATH="/home/bun/.local/bin:${PATH}"

# Default command
CMD ["bun", "dist/index.js"]
