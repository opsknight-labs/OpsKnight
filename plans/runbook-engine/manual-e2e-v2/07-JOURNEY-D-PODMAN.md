# Phase 7 — Journey D: Podman Rootless Socket & Container Isolation

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Scope:** Rootless Podman deployment generation, named volume token pre-staging, and socket resolution

---

## 1. Rootless Podman Socket Contracts

In `src/lib/runbooks/agent-setup-commands.ts`, setup command generation for Podman provides zero-privilege, rootless runtime capability:

1. **Rootless Socket Resolution:**
   ```bash
   podman_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/podman/podman.sock"
   ```
2. **Container Host Contract:**
   The container mounts the user's rootless socket to `/run/podman/podman.sock` and exports:
   ```bash
   -e CONTAINER_HOST=unix:///run/podman/podman.sock
   ```
3. **Volume-Staged Enrollment Token:**
   To prevent host bind-mount cleanup races and ensure clean restarts, the token is written into the named volume `${deployment.name}_data:/var/lib/opsknight-agent/enrollment-token` prior to daemon initialization.
4. **Local Policy Bind Mount:**
   The resolved local policy path is mounted read-only to `/etc/opsknight-agent/policy.json:ro`, allowing administrators to restrict container mutations to approved workloads.

---

## 2. Evidence & Automated Unit Tests

- Setup commands tested in `tests/lib/runbooks/agent-deployment.test.ts`:
  - `generates runnable Podman commands with canonical runtime contracts and volume-staged tokens`: Verified passing.
  - `generates valid standalone Podman install and upgrade commands`: Verified passing.
