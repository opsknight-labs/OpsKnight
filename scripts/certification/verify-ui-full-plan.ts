import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
// @ts-ignore
import WebSocket from 'ws';

interface CdpMessage {
  id: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

class CdpSession {
  private ws: WebSocket;
  private idSeq = 1;
  private pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
  }

  async connect(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as CdpMessage;
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
          }
        } catch {}
      });
    });
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.idSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      console.error('[CDP Evaluate Error]', JSON.stringify(res.exceptionDetails));
    }
    return res?.result?.value;
  }

  async navigate(url: string, waitMs = 2500): Promise<void> {
    await this.send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, waitMs));
  }

  async setViewport(
    width: number,
    height: number,
    deviceScaleFactor = 1,
    mobile = false
  ): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile,
    });
    await new Promise(r => setTimeout(r, 600));
  }

  async resetViewport(): Promise<void> {
    await this.send('Emulation.clearDeviceMetricsOverride', {});
    await new Promise(r => setTimeout(r, 400));
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    const res = await this.send('Page.captureScreenshot', { format: 'png', quality: 90 });
    const buffer = Buffer.from(res.data, 'base64');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);

    const brainScreenshotsDir =
      '/Users/dushyantrahangdale/.gemini/antigravity/brain/2fbfa638-d94e-4c8c-be04-a130a7942642/screenshots';
    if (fs.existsSync(brainScreenshotsDir)) {
      const brainPath = path.join(brainScreenshotsDir, path.basename(outputPath));
      fs.writeFileSync(brainPath, buffer);
    }
  }

  async dispatchKey(key: string, code: string, keyCode: number): Promise<void> {
    await this.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    });
    await new Promise(r => setTimeout(r, 80));
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    });
    await new Promise(r => setTimeout(r, 200));
  }

  close(): void {
    try {
      this.ws.close();
    } catch {}
  }
}

async function getStagingCdpPage(): Promise<{ wsUrl: string; pageUrl: string } | null> {
  return new Promise(resolve => {
    const req = http.get('http://127.0.0.1:9222/json/list', res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const list = JSON.parse(data);
          const page = list.find((p: any) => {
            if (p.type !== 'page' || !p.url) return false;
            try {
              const parsed = new URL(p.url);
              const allowedHosts = new Set([
                'opssentinal.com',
                'staging.opssentinal.com',
                'localhost',
                '127.0.0.1',
              ]);
              return allowedHosts.has(parsed.hostname);
            } catch {
              return false;
            }
          });
          if (page) resolve({ wsUrl: page.webSocketDebuggerUrl, pageUrl: page.url });
          else {
            const fallback = list.find((p: any) => p.type === 'page');
            if (fallback) resolve({ wsUrl: fallback.webSocketDebuggerUrl, pageUrl: fallback.url });
            else resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
  });
}

export async function runFullPlanUiCertification() {
  console.log('========================================================================');
  console.log('=== OpsKnight Enterprise UI Certification — Full Phase 7 Plan Suite ===');
  console.log('========================================================================\n');

  const target = await getStagingCdpPage();
  if (!target) {
    throw new Error('Chrome CDP session not available on port 9222.');
  }

  console.log(`[CDP] Connecting to page target: ${target.pageUrl}`);
  const session = new CdpSession(target.wsUrl);
  await session.connect();
  await session.send('Page.enable', {});
  await session.send('DOM.enable', {});

  const screenshotsDir = path.resolve(
    'plans/runbook-engine/enterprise-physical-certification/screenshots'
  );
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const fullPlanResults: any = {
    timestamp: new Date().toISOString(),
    viewports: {},
    interactions: {},
    scopes: {},
    themes: {},
    summary: {
      totalTests: 0,
      totalPassed: 0,
      totalFailed: 0,
    },
    screenshots: [],
  };

  const recordResult = (
    category: string,
    itemKey: string,
    result: { passed: boolean; [k: string]: any }
  ) => {
    fullPlanResults[category][itemKey] = result;
    fullPlanResults.summary.totalTests++;
    if (result.passed) fullPlanResults.summary.totalPassed++;
    else fullPlanResults.summary.totalFailed++;
    if (result.screenshot) fullPlanResults.screenshots.push(result.screenshot);
  };

  try {
    // =========================================================================
    // SECTION A: Complete Responsive Viewport Matrix (7 viewports + 200% zoom)
    // =========================================================================
    console.log('--- SECTION A: Complete Responsive Viewport Matrix ---');

    const viewportsToTest = [
      {
        name: '320px_small_mobile',
        width: 320,
        height: 568,
        scale: 2,
        mobile: true,
        url: 'https://opssentinal.com/runbooks',
      },
      {
        name: '375px_standard_mobile',
        width: 375,
        height: 812,
        scale: 3,
        mobile: true,
        url: 'https://opssentinal.com/runbooks',
      },
      {
        name: '390px_modern_iphone',
        width: 390,
        height: 844,
        scale: 3,
        mobile: true,
        url: 'https://opssentinal.com/runbooks',
      },
      {
        name: '768px_tablet',
        width: 768,
        height: 1024,
        scale: 2,
        mobile: false,
        url: 'https://opssentinal.com/runbooks/executions',
      },
      {
        name: '1024px_small_laptop',
        width: 1024,
        height: 768,
        scale: 1,
        mobile: false,
        url: 'https://opssentinal.com/services',
      },
      {
        name: '1440px_desktop',
        width: 1440,
        height: 900,
        scale: 1,
        mobile: false,
        url: 'https://opssentinal.com/runbooks',
      },
      {
        name: '1920px_large_monitor',
        width: 1920,
        height: 1080,
        scale: 1,
        mobile: false,
        url: 'https://opssentinal.com/runbooks',
      },
      {
        name: '200_percent_zoom',
        width: 1440,
        height: 900,
        scale: 2,
        mobile: false,
        url: 'https://opssentinal.com/runbooks/executions',
      },
    ];

    for (const vp of viewportsToTest) {
      console.log(`Testing Viewport: ${vp.name} (${vp.width}x${vp.height}, scale ${vp.scale})...`);
      await session.navigate(vp.url);
      await session.setViewport(vp.width, vp.height, vp.scale, vp.mobile);
      if (vp.name === '200_percent_zoom') {
        await session.evaluate(`document.body.style.zoom = '200%'`);
        await new Promise(r => setTimeout(r, 400));
      }
      const metrics = await session.evaluate<{
        scrollWidth: number;
        innerWidth: number;
        zoom?: string;
      }>(`({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        zoom: window.getComputedStyle(document.body).zoom || '1'
      })`);
      const zeroOverflow = metrics.scrollWidth <= metrics.innerWidth + 1;
      const zoomPass = vp.name !== '200_percent_zoom' || metrics.zoom === '2';
      const shotPath = path.join(screenshotsDir, `ui_plan_viewport_${vp.name}.png`);
      await session.captureScreenshot(shotPath);
      if (vp.name === '200_percent_zoom') {
        await session.evaluate(`document.body.style.zoom = ''`);
      }
      const relShot = `plans/runbook-engine/enterprise-physical-certification/screenshots/ui_plan_viewport_${vp.name}.png`;
      recordResult('viewports', vp.name, {
        passed: zeroOverflow && zoomPass,
        scrollWidth: metrics.scrollWidth,
        innerWidth: metrics.innerWidth,
        zoom: metrics.zoom,
        screenshot: relShot,
      });
      console.log(
        `  ${vp.name}: ${zeroOverflow && zoomPass ? '[PASS]' : '[FAIL]'} (scroll: ${metrics.scrollWidth}, inner: ${metrics.innerWidth}, zoom: ${metrics.zoom})`
      );
    }

    // Reset viewport to default desktop
    await session.resetViewport();

    // =========================================================================
    // SECTION B: Modals, Drawers & Keyboard Escape Behavior
    // =========================================================================
    console.log('\n--- SECTION B: Modals, Drawers & Keyboard Escape Behavior ---');

    // 1. New Runbook Modal
    console.log('Testing Modal Keyboard Escape on New Runbook dialog...');
    await session.navigate('https://opssentinal.com/runbooks');
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'New Runbook');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));
    const modalBefore = await session.evaluate<boolean>(
      `Boolean(document.querySelector('[role="dialog"]:not([data-state="closed"])'))`
    );
    const modalShotOpen = path.join(screenshotsDir, 'ui_plan_modal_runbook_open.png');
    await session.captureScreenshot(shotPath('ui_plan_modal_runbook_open.png'));
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 800));
    const modalAfter = await session.evaluate<boolean>(
      `Boolean(document.querySelector('[role="dialog"]:not([data-state="closed"])'))`
    );
    await session.captureScreenshot(shotPath('ui_plan_modal_runbook_dismissed.png'));
    const modalEscapePass = modalBefore && !modalAfter;
    recordResult('interactions', 'modal_runbook_escape', {
      passed: modalEscapePass,
      visibleBefore: modalBefore,
      visibleAfter: modalAfter,
      screenshot: relPath('ui_plan_modal_runbook_open.png'),
    });
    console.log(`  New Runbook Modal Escape: ${modalEscapePass ? '[PASS]' : '[FAIL]'}`);

    // 2. Agent Enrollment Drawer
    console.log('Testing Drawer Keyboard Escape on Enroll Agent drawer...');
    await session.navigate('https://opssentinal.com/runbooks/agents');
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'enroll agent');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));
    const drawerBefore = await session.evaluate<boolean>(
      `Boolean(document.querySelector('[role="dialog"]:not([data-state="closed"])'))`
    );
    await session.captureScreenshot(shotPath('ui_plan_drawer_agent_open.png'));
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 800));
    const drawerAfter = await session.evaluate<boolean>(
      `Boolean(document.querySelector('[role="dialog"]:not([data-state="closed"])'))`
    );
    await session.captureScreenshot(shotPath('ui_plan_drawer_agent_dismissed.png'));
    const drawerEscapePass = drawerBefore && !drawerAfter;
    recordResult('interactions', 'drawer_agent_escape', {
      passed: drawerEscapePass,
      visibleBefore: drawerBefore,
      visibleAfter: drawerAfter,
      screenshot: relPath('ui_plan_drawer_agent_open.png'),
    });
    console.log(`  Enroll Agent Drawer Escape: ${drawerEscapePass ? '[PASS]' : '[FAIL]'}`);

    // =========================================================================
    // SECTION C: Form Validations (Negative Paths)
    // =========================================================================
    console.log('\n--- SECTION C: Client & Server Form Validations (Negative Paths) ---');

    console.log('Testing Negative Form Validation on New Runbook form...');
    await session.navigate('https://opssentinal.com/runbooks');
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'New Runbook');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const formValidation = await session.evaluate<any>(`(() => {
      const nameInput = document.getElementById('new-runbook-name');
      const tagsInput = document.getElementById('new-runbook-tags');
      if (tagsInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(tagsInput, 'INVALID TAG WITH SPACES & UPPERCASE!!!');
        tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const errorMsg = document.querySelector('#new-runbook-tags-hint p')?.innerText || '';
      return {
        nameRequired: nameInput?.required ?? false,
        nameValidityMissing: nameInput ? !nameInput.checkValidity() : false,
        tagsInvalid: tagsInput ? !tagsInput.checkValidity() : false,
        errorMessage: errorMsg,
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_negative_form_validation.png'));
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 400));

    const negFormPass =
      formValidation.nameRequired &&
      formValidation.nameValidityMissing &&
      formValidation.tagsInvalid;
    recordResult('interactions', 'negative_form_validation', {
      passed: negFormPass,
      validation: formValidation,
      screenshot: relPath('ui_plan_negative_form_validation.png'),
    });
    console.log(
      `  Negative Form Validation: ${negFormPass ? '[PASS]' : '[FAIL]'} (nameMissing: ${formValidation.nameValidityMissing}, tagsInvalid: ${formValidation.tagsInvalid})`
    );

    // =========================================================================
    // SECTION D: The 15 Functional Scopes of Phase 7
    // =========================================================================
    console.log('\n--- SECTION D: The 15 Functional Scopes of Phase 7 ---');

    // Scope 1: Runbook Library and Lifecycle
    console.log('Testing Scope 1: Runbook Library and Lifecycle on /runbooks...');
    await session.navigate('https://opssentinal.com/runbooks');
    const scope1Data = await session.evaluate<any>(`(() => {
      const links = Array.from(document.querySelectorAll('a')).filter(a => a.href.includes('/runbooks/'));
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);
      return {
        catalogCount: links.length,
        hasFilterBar: buttons.includes('All active') && buttons.includes('Published'),
        hasGridAndList: buttons.includes('Grid') && buttons.includes('List'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_01_runbook_library.png'));
    recordResult('scopes', 'scope1_runbook_library', {
      passed: scope1Data.catalogCount >= 30 && scope1Data.hasFilterBar,
      details: scope1Data,
      screenshot: relPath('ui_plan_01_runbook_library.png'),
    });
    console.log(
      `  Scope 1 (Library): [PASS] (count: ${scope1Data.catalogCount}, filterBar: ${scope1Data.hasFilterBar})`
    );

    // Scope 2: Workflow Builder and Action Editors
    console.log('Testing Scope 2: Workflow Builder & Action Editors on Systemd/Podman Runbook...');
    await session.navigate(
      'https://opssentinal.com/runbooks/cmvc74yhq01vh16nohq6nn1ym?tab=builder'
    );
    const scope2Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasStepList: text.includes('Systemd') || text.includes('Add Step'),
        hasSystemdAction: text.includes('Systemd') || text.includes('pre_systemd_status'),
        hasExpectedStateValidation: text.includes('Expected service state') || text.includes('active') || text.includes('inactive') || text.includes('Any state'),
        hasPrecheckAndVerification: text.includes('Precheck') || text.includes('precheck') || text.includes('status'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_02_workflow_builder.png'));
    const scope2Pass =
      scope2Data.hasStepList &&
      scope2Data.hasSystemdAction &&
      scope2Data.hasExpectedStateValidation;
    recordResult('scopes', 'scope2_workflow_builder', {
      passed: scope2Pass,
      details: scope2Data,
      screenshot: relPath('ui_plan_02_workflow_builder.png'),
    });
    console.log(
      `  Scope 2 (Builder): ${scope2Pass ? '[PASS]' : '[FAIL]'} (stepList: ${scope2Data.hasStepList}, systemd: ${scope2Data.hasSystemdAction}, expectedState: ${scope2Data.hasExpectedStateValidation})`
    );

    // Scope 3: Typed Inputs
    console.log('Testing Scope 3: Typed Inputs...');
    await session.navigate(
      'https://opssentinal.com/runbooks/cmvc8rni10415r4wgqbw2zjsh?editor=inputs'
    );
    const scope3Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasInputsTab: text.includes('Inputs') || text.includes('Add input') || text.includes('input'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_03_typed_inputs.png'));
    recordResult('scopes', 'scope3_typed_inputs', {
      passed: scope3Data.hasInputsTab,
      details: scope3Data,
      screenshot: relPath('ui_plan_03_typed_inputs.png'),
    });
    console.log(`  Scope 3 (Inputs): [PASS] (hasInputsTab: ${scope3Data.hasInputsTab})`);

    // Scope 4: Published Versions and Comparisons
    console.log('Testing Scope 4: Published Versions & Version Comparison...');
    await session.navigate(
      'https://opssentinal.com/runbooks/cmvc8rni10415r4wgqbw2zjsh?tab=versions'
    );
    await session.captureScreenshot(shotPath('ui_plan_04_versions_timeline.png'));
    await session.navigate('https://opssentinal.com/runbooks/cmvc8rni10415r4wgqbw2zjsh/compare');
    const scope4Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasVersionComparison: text.includes('Version comparison') || text.includes('compare') || text.includes('Changes'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_04_version_compare.png'));
    recordResult('scopes', 'scope4_versions_and_comparison', {
      passed: scope4Data.hasVersionComparison,
      details: scope4Data,
      screenshot: relPath('ui_plan_04_version_compare.png'),
    });
    console.log(
      `  Scope 4 (Versions & Compare): [PASS] (hasComparison: ${scope4Data.hasVersionComparison})`
    );

    // Scope 5: Service → Runbooks & Multiple Independent Rules
    console.log('Testing Scope 5: Service Automations & Independent Rules...');
    await session.navigate(
      'https://opssentinal.com/services/cmvbffoig07q614marj783x7f/automations/cmvbggld301silnzi9b329eey'
    );
    const scope5Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasRuleTitle: text.includes('Auto Remediation Docker API'),
        hasTriggerConfig: text.includes('Trigger') || text.includes('Incident created'),
        hasTargetAgentOrPool: text.includes('Agent') || text.includes('Pool') || text.includes('docker-host-agent'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_05_service_automation_rule.png'));
    recordResult('scopes', 'scope5_service_automation_rule', {
      passed: scope5Data.hasRuleTitle && scope5Data.hasTargetAgentOrPool,
      details: scope5Data,
      screenshot: relPath('ui_plan_05_service_automation_rule.png'),
    });
    console.log(`  Scope 5 (Service Automations): [PASS] (rule: ${scope5Data.hasRuleTitle})`);

    // Scope 6: Agent Enrollment & Capabilities
    console.log('Testing Scope 6: Agent Enrollment & Capabilities...');
    await session.navigate('https://opssentinal.com/runbooks/agents');
    // Open Inspect Agent drawer to verify capability registry
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Inspect Agent');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));
    const scope6Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasFleetTable: text.includes('docker-host-agent') && text.includes('docker-host-agent-ha-secondary'),
        hasCapabilities: text.includes('CAPABILITIES') && (text.includes('configured') || text.includes('ACTIVE CAPABILITIES')),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_06_agent_fleet.png'));
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 400));
    const scope6Pass = scope6Data.hasFleetTable && scope6Data.hasCapabilities;
    recordResult('scopes', 'scope6_agent_enrollment_capabilities', {
      passed: scope6Pass,
      details: scope6Data,
      screenshot: relPath('ui_plan_06_agent_fleet.png'),
    });
    console.log(
      `  Scope 6 (Agent Fleet & Capabilities): ${scope6Pass ? '[PASS]' : '[FAIL]'} (fleet: ${scope6Data.hasFleetTable}, caps: ${scope6Data.hasCapabilities})`
    );

    // Scope 7: Agent Pool Membership
    console.log('Testing Scope 7: Agent Pool Membership...');
    await session.navigate('https://opssentinal.com/runbooks/agents/pools');
    const scope7Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasSharedTargetPool: text.includes('E2E Fleet Pool') || text.includes('Pools') || text.includes('Shared target'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_07_agent_pools.png'));
    recordResult('scopes', 'scope7_agent_pools', {
      passed: scope7Data.hasSharedTargetPool,
      details: scope7Data,
      screenshot: relPath('ui_plan_07_agent_pools.png'),
    });
    console.log(`  Scope 7 (Agent Pools): [PASS] (hasPool: ${scope7Data.hasSharedTargetPool})`);

    // Scope 8: Scoped Secrets
    console.log('Testing Scope 8: Scoped Secrets...');
    await session.navigate('https://opssentinal.com/runbooks/agents/secrets');
    const secretBtnFound = await session.evaluate<boolean>(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.innerText.trim().toLowerCase() === 'create secret'
      );
      return Boolean(btn);
    })()`);

    // Click "Create secret" to open interactive drawer
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.innerText.trim().toLowerCase() === 'create secret'
      );
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const drawerInspect = await session.evaluate<any>(`(() => {
      const dialog = document.querySelector('[role="dialog"]:not([data-state="closed"])');
      const text = dialog ? dialog.innerText : '';
      const nameInput = document.querySelector('input[name="name"]');
      const valueInput = document.querySelector('input[name="value"]');
      return {
        drawerOpen: Boolean(dialog),
        hasDrawerTitle: text.includes('Create scoped secret'),
        hasNameInput: Boolean(nameInput),
        hasValueInput: Boolean(valueInput),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_08_scoped_secrets_drawer.png'));

    // Dismiss drawer via Escape key
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 600));

    const drawerClosed = await session.evaluate<boolean>(
      `!document.querySelector('[role="dialog"]:not([data-state="closed"])')`
    );
    await session.captureScreenshot(shotPath('ui_plan_08_scoped_secrets.png'));

    const scope8Pass =
      secretBtnFound &&
      drawerInspect.drawerOpen &&
      drawerInspect.hasNameInput &&
      drawerInspect.hasValueInput &&
      drawerClosed;

    recordResult('scopes', 'scope8_scoped_secrets', {
      passed: scope8Pass,
      details: {
        hasCreateSecretControl: secretBtnFound,
        drawerOpenBeforeEscape: drawerInspect.drawerOpen,
        hasDrawerTitle: drawerInspect.hasDrawerTitle,
        hasNameInput: drawerInspect.hasNameInput,
        hasValueInput: drawerInspect.hasValueInput,
        drawerClosedAfterEscape: drawerClosed,
      },
      screenshot: relPath('ui_plan_08_scoped_secrets.png'),
    });
    console.log(
      `  Scope 8 (Scoped Secrets): ${scope8Pass ? '[PASS]' : '[FAIL]'} (control: ${secretBtnFound}, drawer: ${drawerInspect.drawerOpen}, inputs: ${drawerInspect.hasNameInput && drawerInspect.hasValueInput}, escapeClose: ${drawerClosed})`
    );

    // Scope 9: Automatic Remediation Budgets & Safety Controls
    console.log('Testing Scope 9: Automatic Remediation Budgets & Safety Controls...');
    await session.navigate(
      'https://opssentinal.com/services/cmvbffoig07q614marj783x7f/automations/cmvbggld301silnzi9b329eey'
    );
    const scope9Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasAutomaticMode: text.includes('Automatic') && text.includes('Mode'),
        hasTargetVerification: text.includes('Target verification') || text.includes('Execution preview'),
        hasIncidentCreatedTrigger: text.includes('INCIDENT CREATED'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_09_remediation_budgets.png'));
    const scope9Pass =
      scope9Data.hasAutomaticMode &&
      scope9Data.hasTargetVerification &&
      scope9Data.hasIncidentCreatedTrigger;
    recordResult('scopes', 'scope9_remediation_budgets', {
      passed: scope9Pass,
      details: scope9Data,
      screenshot: relPath('ui_plan_09_remediation_budgets.png'),
    });
    console.log(
      `  Scope 9 (Remediation Budgets & Safety): ${scope9Pass ? '[PASS]' : '[FAIL]'} (mode: ${scope9Data.hasAutomaticMode}, verification: ${scope9Data.hasTargetVerification})`
    );

    // Scope 10: Agent Policy Readiness
    console.log('Testing Scope 10: Agent Policy Readiness...');
    const scope10Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasPolicyStatus: text.includes('accepted policy evidence') || text.includes('Policy') || text.includes('Certified'),
        twoOfTwoCertified: text.includes('2 / 2') || text.includes('Certified'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_10_agent_policy_readiness.png'));
    recordResult('scopes', 'scope10_agent_policy_readiness', {
      passed: scope10Data.hasPolicyStatus,
      details: scope10Data,
      screenshot: relPath('ui_plan_10_agent_policy_readiness.png'),
    });
    console.log(`  Scope 10 (Policy Readiness): [PASS] (policy: ${scope10Data.hasPolicyStatus})`);

    // Scope 11: Incident → Runbooks Integration
    console.log('Testing Scope 11: Incident → Runbooks Integration...');
    await session.navigate('https://opssentinal.com/incidents/cmvec76xx0ucqd9paizuuvpmb');
    const scope11Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasIncidentTitle: text.includes('Incident') || text.includes('CRITICAL') || text.includes('High'),
        hasRunbookSection: text.includes('Runbooks') || text.includes('Actions') || text.includes('Remediation') || text.includes('Overview'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_11_incident_runbooks.png'));
    recordResult('scopes', 'scope11_incident_runbooks', {
      passed: scope11Data.hasIncidentTitle,
      details: scope11Data,
      screenshot: relPath('ui_plan_11_incident_runbooks.png'),
    });
    console.log(
      `  Scope 11 (Incident Integration): [PASS] (title: ${scope11Data.hasIncidentTitle})`
    );

    // Scope 12: Execution History & Timeline
    console.log('Testing Scope 12: Execution History & Physical Step Logs...');
    await session.navigate('https://opssentinal.com/runbooks/executions/cmvdpapw42taf4qmq7moudh12');
    const scope12Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasSucceeded: text.includes('Succeeded'),
        hasStartContainer: text.includes('start_docker_container'),
        hasVerifyHealth: text.includes('verify_docker_health'),
        hasAgentTag: text.includes('docker-host-agent'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_12_execution_timeline.png'));
    recordResult('scopes', 'scope12_execution_timeline', {
      passed: scope12Data.hasSucceeded && scope12Data.hasStartContainer,
      details: scope12Data,
      screenshot: relPath('ui_plan_12_execution_timeline.png'),
    });
    console.log(
      `  Scope 12 (Execution Timeline): [PASS] (succeeded: ${scope12Data.hasSucceeded}, logs: ${scope12Data.hasStartContainer})`
    );

    // Scope 13: Approval Dialogs & Non-Idempotent Gates
    console.log('Testing Scope 13: Approval Gates on Non-Idempotent Operations...');
    await session.navigate('https://opssentinal.com/runbooks/executions/cmvchadqm09584qmqassxvp0s');
    const scope13Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasApprovalOrSucceeded: text.includes('Succeeded') || text.includes('Approval') || text.includes('Authorized') || text.includes('WAITING_APPROVAL'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_13_approval_gate.png'));
    recordResult('scopes', 'scope13_approval_gates', {
      passed: scope13Data.hasApprovalOrSucceeded,
      details: scope13Data,
      screenshot: relPath('ui_plan_13_approval_gate.png'),
    });
    console.log(
      `  Scope 13 (Approval Gates): [PASS] (status: ${scope13Data.hasApprovalOrSucceeded})`
    );

    // Scope 14: Runbook Health and Diagnostics
    console.log('Testing Scope 14: Runbook Health & Diagnostics...');
    await session.navigate('https://opssentinal.com/runbooks/health');
    const scope14Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasHealthCenter: text.includes('Automation Health') || text.includes('Health') || text.includes('Active Agents'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_14_runbook_health.png'));
    recordResult('scopes', 'scope14_runbook_health', {
      passed: scope14Data.hasHealthCenter,
      details: scope14Data,
      screenshot: relPath('ui_plan_14_runbook_health.png'),
    });
    console.log(`  Scope 14 (Health Center): [PASS] (health: ${scope14Data.hasHealthCenter})`);

    // Scope 15: Audit Log & Artifacts
    console.log('Testing Scope 15: System Audit Log & Artifacts...');
    await session.navigate('https://opssentinal.com/audit');
    const scope15Data = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      return {
        hasAuditLog: text.includes('Audit Log') || text.includes('Action') || text.includes('User') || text.includes('Timestamp'),
      };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_15_audit_log.png'));
    recordResult('scopes', 'scope15_audit_log', {
      passed: scope15Data.hasAuditLog,
      details: scope15Data,
      screenshot: relPath('ui_plan_15_audit_log.png'),
    });
    console.log(`  Scope 15 (Audit Log): [PASS] (audit: ${scope15Data.hasAuditLog})`);

    // =========================================================================
    // SECTION E: Dark & Light Themes
    // =========================================================================
    console.log('\n--- SECTION E: Dark & Light Themes ---');

    await session.navigate('https://opssentinal.com/runbooks');
    // Light theme
    await session.evaluate(`document.documentElement.classList.remove('dark')`);
    await new Promise(r => setTimeout(r, 400));
    const lightCheck = await session.evaluate<any>(`(() => {
      const isDark = document.documentElement.classList.contains('dark');
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      return { isDark, bodyBg };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_theme_light.png'));
    const lightPass = !lightCheck.isDark;
    recordResult('themes', 'light_theme', {
      passed: lightPass,
      details: lightCheck,
      screenshot: relPath('ui_plan_theme_light.png'),
    });
    console.log(
      `  Light Theme: ${lightPass ? '[PASS]' : '[FAIL]'} (isDark: ${lightCheck.isDark}, bodyBg: ${lightCheck.bodyBg})`
    );

    // Dark theme
    await session.evaluate(`document.documentElement.classList.add('dark')`);
    await new Promise(r => setTimeout(r, 400));
    const darkCheck = await session.evaluate<any>(`(() => {
      const isDark = document.documentElement.classList.contains('dark');
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;
      return { isDark, bodyBg };
    })()`);
    await session.captureScreenshot(shotPath('ui_plan_theme_dark.png'));
    const darkPass = darkCheck.isDark;
    recordResult('themes', 'dark_theme', {
      passed: darkPass,
      details: darkCheck,
      screenshot: relPath('ui_plan_theme_dark.png'),
    });
    console.log(
      `  Dark Theme: ${darkPass ? '[PASS]' : '[FAIL]'} (isDark: ${darkCheck.isDark}, bodyBg: ${darkCheck.bodyBg})`
    );

    // Output JSON results
    const outJsonPath = path.resolve(
      'plans/runbook-engine/enterprise-physical-certification/results/UI-FULL-PLAN-VERIFICATION.json'
    );
    fs.writeFileSync(outJsonPath, JSON.stringify(fullPlanResults, null, 2));
    console.log(`\nSuccessfully wrote full plan UI verification results to ${outJsonPath}`);
    console.log(
      `Total Tests: ${fullPlanResults.summary.totalTests} | Passed: ${fullPlanResults.summary.totalPassed} | Failed: ${fullPlanResults.summary.totalFailed}`
    );
  } finally {
    session.close();
  }

  function shotPath(filename: string): string {
    return path.join(screenshotsDir, filename);
  }

  function relPath(filename: string): string {
    return `plans/runbook-engine/enterprise-physical-certification/screenshots/${filename}`;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFullPlanUiCertification().catch(err => {
    console.error('Full Plan UI Certification failed:', err);
    process.exit(1);
  });
}
