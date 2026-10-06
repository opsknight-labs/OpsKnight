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

  it('enforces mandatory non-root systemd service contract', () => {
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
});
