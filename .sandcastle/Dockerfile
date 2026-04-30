FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Rename the base image's "node" user (UID 1000) to "agent" so build-time
# installs below have a real home to write into.
RUN usermod -d /home/agent -m -l agent node
USER agent

# Install Claude Code CLI (writes to /home/agent/.local/bin as UID 1000)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# Sandcastle's Docker driver launches the container with --user $(host_uid):$(host_gid)
# (see node_modules/@ai-hero/sandcastle/dist/sandboxes/docker.js — it ignores the
# Dockerfile USER and reads process.getuid()/getgid()). On macOS that's 501:20, not
# 1000:1000, so /home/agent ends up unwritable at runtime and `git config --global`
# fails. Hand the home directory to the host UID:GID after build-time installs are
# done. Adjust if your host UID/GID differ (`id -u`, `id -g`).
USER root
RUN chown -R 501:20 /home/agent
USER agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
