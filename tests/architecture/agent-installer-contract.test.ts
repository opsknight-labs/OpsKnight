import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Installer logic and OS-release contract', () => {
  const installScript = readFileSync('deploy/agent/install.sh', 'utf8');

  it('rejects execution when not running as root', () => {
    expect(installScript).toContain('if [[ $EUID -ne 0 ]]');
    expect(installScript).toContain('ERROR: OpsKnight Agent installer must be run as root');
  });

  it('correctly maps supported architectures to normalized artifact targets', () => {
    expect(installScript).toContain('x86_64)');
    expect(installScript).toContain('ARCH="x64"');
    expect(installScript).toContain('aarch64|arm64)');
    expect(installScript).toContain('ARCH="arm64"');
    expect(installScript).toContain('ERROR: Unsupported CPU architecture');
  });

  it('maps correct package dependencies per distro family', () => {
    // RedHat / Amazon Linux / Alma / Rocky
    expect(installScript).toContain('amzn|rhel|centos|rocky|almalinux|fedora)');
    expect(installScript).toContain('install_packages procps-ng iproute ca-certificates tar gzip curl');

    // Debian / Ubuntu
    expect(installScript).toContain('ubuntu|debian)');
    expect(installScript).toContain('install_packages procps iproute2 ca-certificates tar gzip curl');

    // SLES
    expect(installScript).toContain('sles|opensuse*)');
  });

  it('enforces mandatory non-root systemd service contract with strict environment file', () => {
    const serviceUnit = readFileSync('agent/opsknight-agent.service', 'utf8');
    expect(serviceUnit).toContain('User=opsknight-agent');
    expect(serviceUnit).toContain('Group=opsknight-agent');
    expect(serviceUnit).toContain('UMask=0077');
    expect(serviceUnit).toContain('StateDirectory=opsknight-agent');
    expect(serviceUnit).toContain('StateDirectoryMode=0700');
    expect(serviceUnit).toContain('ProtectSystem=strict');
    expect(serviceUnit).toContain('ProtectHome=true');
    expect(serviceUnit).toContain('PrivateTmp=true');
    expect(serviceUnit).toContain('NoNewPrivileges=true');
    expect(serviceUnit).toContain('EnvironmentFile=/etc/opsknight-agent/agent.env');
    expect(serviceUnit).not.toContain('EnvironmentFile=-');
    expect(serviceUnit).toContain('ExecStart=/opt/opsknight-agent/runtime/bin/node /opt/opsknight-agent/opsknight-agent.mjs');
    expect(serviceUnit).toContain('After=network-online.target time-sync.target');
    expect(serviceUnit).toContain('Wants=network-online.target time-sync.target');
  });

  it('enforces live permission write probes in state directory', () => {
    expect(installScript).toContain('Performing State Directory Permission Probe');
    expect(installScript).toContain('su -s /bin/bash "${SERVICE_USER}" -c "test -w \'${STATE_DIR}\'"');
    expect(installScript).toContain('touch \'${TEST_FILE}\' && rm -f \'${TEST_FILE}\'');
  });

  it('validates artifact sha256 checksums before installation', () => {
    expect(installScript).toContain('sha256sum -c');
    expect(installScript).toContain('Artifact checksum verified');
  });

  it('fails closed when local tarball is missing instead of falling back to remote download', () => {
    expect(installScript).toContain('if [[ -n "${TARBALL_OVERRIDE}" ]]');
    expect(installScript).toContain('ERROR: Specified local tarball \'${TARBALL_OVERRIDE}\' does not exist.');
  });

  it('writes correct agent enrollment and execution signing environment variables and supports rotation', () => {
    expect(installScript).toContain('OPSKNIGHT_AGENT_ENROLLMENT_TOKEN=');
    expect(installScript).toContain('OPSKNIGHT_EXECUTION_PUBLIC_KEY=');
    expect(installScript).toContain('OPSKNIGHT_EXECUTION_PUBLIC_KEYS=');
    expect(installScript).toContain('--keys-json');
    expect(installScript).toContain('--keys-file');
    expect(installScript).not.toContain('OPSKNIGHT_ENROLLMENT_TOKEN=');
  });

  it('enforces root-owned agent.env with 0600 permissions', () => {
    expect(installScript).toContain('chown root:root "${ENV_FILE}"');
    expect(installScript).toContain('chmod 0600 "${ENV_FILE}"');
  });

  it('verifies bundled node runtime execution compatibility before service enablement', () => {
    expect(installScript).toContain('The bundled Node 24 runtime cannot execute on this host');
    expect(installScript).toContain('requires glibc >= 2.28');
  });

  it('performs transactional staging and safe service restart on upgrade', () => {
    expect(installScript).toContain('STAGE_DIR=');
    expect(installScript).toContain('BACKUP_DIR=');
    expect(installScript).toContain('SERVICE_WAS_ACTIVE=');
    expect(installScript).toContain('systemctl restart opsknight-agent');
    expect(installScript).toContain('--no-restart');
  });

  it('normalizes release tag version preventing vv2.0.0 URLs', () => {
    expect(installScript).toContain('CLEAN_VERSION="${RELEASE_TAG#v}"');
    expect(installScript).toContain('CLEAN_TAG="v${CLEAN_VERSION}"');
  });

  it('drains active executions before restarting active agent process', () => {
    expect(installScript).toContain('pgrep -P "${AGENT_PID}"');
    expect(installScript).toContain('Waiting up to 30s to drain');
  });

  it('initiates transactional rollback on activation or restart failure', () => {
    expect(installScript).toContain('rollback_and_fail');
    expect(installScript).toContain('Initiating transactional rollback to previous installation');
  });

  it('enforces local tarball integrity verification unless explicitly bypassed', () => {
    expect(installScript).toContain('--allow-unverified-tarball');
    expect(installScript).toContain('Integrity verification required for local tarball');
  });

  it('canonicalizes multiline JSON when reading from keys file', () => {
    expect(installScript).toContain('JSON.stringify(JSON.parse');
    expect(installScript).toContain('--keys-file');
  });

  it('fails preflight when bundled node execution fails, keys are invalid, or configuration is incomplete', () => {
    const preflightScript = readFileSync('deploy/agent/preflight.sh', 'utf8');
    expect(preflightScript).toContain('Bundled node binary at ${NODE_BIN} failed to execute');
    expect(preflightScript).toContain('OPSKNIGHT_EXECUTION_PUBLIC_KEY or OPSKNIGHT_EXECUTION_PUBLIC_KEYS missing in ${ENV_FILE}');
    expect(preflightScript).toContain('Neither existing ${IDENTITY_FILE} nor OPSKNIGHT_AGENT_ENROLLMENT_TOKEN is present');
    expect(preflightScript).toContain('sudo ${INSTALL_PREFIX}/preflight.sh');
  });
});
