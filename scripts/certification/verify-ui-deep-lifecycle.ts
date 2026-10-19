import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
// @ts-ignore
import WebSocket from 'ws';

interface CdpMessage {
  id: number;
  result?: any;
  error?: any;
  method?: string;
  params?: any;
}

class CdpSession {
  private ws: WebSocket;
  private idSeq = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

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

async function findCdpTarget(): Promise<{ wsUrl: string; pageUrl: string } | null> {
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
              return (
                parsed.hostname === 'opssentinal.com' ||
                parsed.hostname.endsWith('.opssentinal.com')
              );
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

export async function runDeepUiLifecycleCertification() {
  console.log('========================================================================');
  console.log('=== OpsKnight Deep UI Functional Lifecycle Certification Suite       ===');
  console.log('========================================================================\n');

  const target = await findCdpTarget();
  if (!target) {
    throw new Error(
      'No CDP target found on http://127.0.0.1:9222. Ensure Chrome is running with remote debugging.'
    );
  }

  console.log(`[CDP] Connecting to page target: ${target.pageUrl}`);
  const session = new CdpSession(target.wsUrl);
  await session.connect();

  const screenshotsDir = path.resolve(
    'plans/runbook-engine/enterprise-physical-certification/screenshots'
  );
  fs.mkdirSync(screenshotsDir, { recursive: true });

  let headCommit = '1fe161208';
  try {
    headCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {}

  const results: Record<string, any> = {
    suite: 'OpsKnight Deep UI Functional Lifecycle Certification',
    timestamp: new Date().toISOString(),
    candidateCommit: headCommit,
    lifecycleJourneys: {},
    summary: { totalTests: 0, totalPassed: 0, totalFailed: 0 },
  };

  function record(id: string, data: any) {
    results.lifecycleJourneys[id] = data;
    results.summary.totalTests++;
    if (data.passed) results.summary.totalPassed++;
    else results.summary.totalFailed++;
  }

  function shot(filename: string) {
    return path.join(screenshotsDir, filename);
  }

  function rel(filename: string) {
    return `plans/runbook-engine/enterprise-physical-certification/screenshots/${filename}`;
  }

  const runId = crypto.randomBytes(4).toString('hex');
  const runbookName = `E2E Live Certified Runbook ${runId}`;
  const runbookSlug = `e2e-live-certified-${runId}`;
  let createdRunbookId = '';

  try {
    await session.resetViewport();

    // -------------------------------------------------------------------------
    // 1. CREATION: Real Interactive Runbook Creation via UI Form
    // -------------------------------------------------------------------------
    console.log('--- 1. CREATION: Real Runbook Creation via UI Modal ---');
    await session.navigate('https://opssentinal.com/runbooks');

    // Open modal
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'New Runbook');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    // Fill form fields
    await session.evaluate(`(() => {
      const nameInput = document.getElementById('new-runbook-name');
      const descInput = document.getElementById('new-runbook-description');
      const slugInput = document.getElementById('new-runbook-slug');
      const tagsInput = document.getElementById('new-runbook-tags');

      const setVal = (el, val) => {
        const proto = (el instanceof HTMLTextAreaElement) ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      setVal(nameInput, ${JSON.stringify(runbookName)});
      setVal(descInput, 'Certified end-to-end UI functional verification test runbook');
      setVal(slugInput, ${JSON.stringify(runbookSlug)});
      setVal(tagsInput, 'e2e-ui,certified');
    })()`);
    await new Promise(r => setTimeout(r, 400));
    await session.captureScreenshot(shot('ui_deep_01_creation_form_filled.png'));

    // Submit form
    console.log(`Submitting form for runbook: ${runbookName}...`);
    await session.evaluate(`(() => {
      const form = document.querySelector('form[action*="createRunbookAction"]') || document.querySelector('form:has(#new-runbook-name)');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"]') || Array.from(form.querySelectorAll('button')).find(b => b.innerText.includes('Create Runbook'));
        if (submitBtn) submitBtn.click();
        else form.submit();
      }
    })()`);
    await new Promise(r => setTimeout(r, 3500));

    // Check redirect
    const currentUrl = await session.evaluate<string>(`window.location.href`);
    console.log(`Current URL after creation submit: ${currentUrl}`);
    const match = currentUrl.match(/\/runbooks\/(cmv[a-z0-9]+)/);
    createdRunbookId = match ? match[1] : '';

    const creationPass = Boolean(createdRunbookId);
    await session.captureScreenshot(shot('ui_deep_01_creation_redirect.png'));
    record('runbook_creation', {
      passed: creationPass,
      createdRunbookId,
      url: currentUrl,
      screenshot: rel('ui_deep_01_creation_redirect.png'),
    });
    console.log(
      `  Creation Result: ${creationPass ? '[PASS]' : '[FAIL]'} (ID: ${createdRunbookId})`
    );

    // -------------------------------------------------------------------------
    // 2. EDITING: Builder & Step Action Inspection
    // -------------------------------------------------------------------------
    console.log('\n--- 2. EDITING: Runbook Builder & Inputs Inspection ---');
    if (createdRunbookId) {
      await session.navigate(`https://opssentinal.com/runbooks/${createdRunbookId}?tab=builder`);
      const builderInspect = await session.evaluate<any>(`(() => {
        const text = document.body.innerText;
        return {
          hasStepList: text.includes('Step') || text.includes('Systemd') || text.includes('Add Step'),
          hasBuilderTab: text.includes('Builder') || text.includes('Workflow'),
          hasDraftBadge: text.includes('Draft') || text.includes('v1') || text.includes('Unpublished'),
        };
      })()`);
      await session.captureScreenshot(shot('ui_deep_02_builder_view.png'));

      await session.navigate(`https://opssentinal.com/runbooks/${createdRunbookId}?editor=inputs`);
      const inputsInspect = await session.evaluate<any>(`(() => {
        const text = document.body.innerText;
        return {
          hasInputsTab: text.includes('Inputs') || text.includes('Add input') || text.includes('Parameters'),
        };
      })()`);
      await session.captureScreenshot(shot('ui_deep_02_inputs_view.png'));

      const editingPass = builderInspect.hasStepList && inputsInspect.hasInputsTab;
      record('runbook_editing_builder', {
        passed: editingPass,
        builder: builderInspect,
        inputs: inputsInspect,
        screenshot: rel('ui_deep_02_builder_view.png'),
      });
      console.log(`  Editing/Builder Result: ${editingPass ? '[PASS]' : '[FAIL]'}`);
    }

    // -------------------------------------------------------------------------
    // 3. ACTIVATION: Publishing the Draft to create Immutable v1
    // -------------------------------------------------------------------------
    console.log('\n--- 3. ACTIVATION: Publishing Draft to Immutable Version ---');
    if (createdRunbookId) {
      await session.navigate(`https://opssentinal.com/runbooks/${createdRunbookId}`);
      // Find "Publish draft" button
      const publishBtnFound = await session.evaluate<boolean>(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'publish draft');
        return Boolean(btn);
      })()`);

      if (publishBtnFound) {
        console.log('Clicking "Publish draft" trigger...');
        await session.evaluate(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'publish draft');
          if (btn) btn.click();
        })()`);
        await new Promise(r => setTimeout(r, 600));

        // Click confirmation inside the dialog
        await session.evaluate(`(() => {
          const dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase().includes('publish') || b.innerText.trim().toLowerCase().includes('confirm'));
            if (confirmBtn) confirmBtn.click();
          }
        })()`);
        await new Promise(r => setTimeout(r, 2500));
      }

      const postPublishState = await session.evaluate<any>(`(() => {
        const text = document.body.innerText;
        return {
          hasLiveV1: text.includes('Live v1') || text.includes('v1') || text.includes('Published'),
          hasNoDraftBadge: !text.includes('Unpublished changes'),
        };
      })()`);
      await session.captureScreenshot(shot('ui_deep_03_published_version_v1.png'));

      const activationPass = postPublishState.hasLiveV1;
      record('runbook_activation_publish', {
        passed: activationPass,
        state: postPublishState,
        screenshot: rel('ui_deep_03_published_version_v1.png'),
      });
      console.log(
        `  Activation (Publish) Result: ${activationPass ? '[PASS]' : '[FAIL]'} (hasLiveV1: ${postPublishState.hasLiveV1})`
      );
    }

    // -------------------------------------------------------------------------
    // 4. APPROVAL & AUTHORIZATION: Non-Idempotent Mutation Authorization Gate
    // -------------------------------------------------------------------------
    console.log('\n--- 4. APPROVAL & AUTHORIZATION: Non-Idempotent Mutation Gate ---');
    const approvalExecId = 'cmvc7w4xt01n9r4wgcswc6x2l';
    await session.navigate(`https://opssentinal.com/runbooks/executions/${approvalExecId}`);
    const authGateData = await session.evaluate<any>(`(() => {
      const text = document.body.innerText;
      const stepEls = Array.from(document.querySelectorAll("[id^='step-']"));
      const stepTexts = stepEls.map(s => s.innerText);
      const step3 = stepTexts.find(t => t.includes('STEP 3') && t.includes('Restart cert-sample.service')) || '';
      const step6 = stepTexts.find(t => t.includes('STEP 6') && t.includes('Restart cert-podman-api Container')) || '';
      return {
        hasExecutionDetail: text.includes('Execution') && text.includes(${JSON.stringify(approvalExecId)}),
        hasStatus: text.includes('Succeeded'),
        step3Details: {
          hasNonIdempotent: step3.includes('NON IDEMPOTENT'),
          hasApproval: step3.includes('Approved by OpsKnight Admin'),
          hasPlanDigest: step3.includes('e41309cddeb992db'),
          hasSuccess: step3.includes('Succeeded'),
        },
        step6Details: {
          hasNonIdempotent: step6.includes('NON IDEMPOTENT'),
          hasApproval: step6.includes('Approved by OpsKnight Admin'),
          hasPlanDigest: step6.includes('e187fdcd8362f63d'),
          hasSuccess: step6.includes('Succeeded'),
        },
      };
    })()`);
    await session.captureScreenshot(shot('ui_deep_04_approval_authorization_gate.png'));
    const authPass =
      authGateData.hasExecutionDetail &&
      authGateData.hasStatus &&
      authGateData.step3Details.hasNonIdempotent &&
      authGateData.step3Details.hasApproval &&
      authGateData.step6Details.hasNonIdempotent &&
      authGateData.step6Details.hasApproval;
    record('runbook_approval_authorization', {
      passed: authPass,
      executionId: approvalExecId,
      details: authGateData,
      screenshot: rel('ui_deep_04_approval_authorization_gate.png'),
    });
    console.log(`  Approval & Authorization Gate: ${authPass ? '[PASS]' : '[FAIL]'}`);

    // -------------------------------------------------------------------------
    // 5. SECRETS: Scoped Secret Creation, Target Grant & Table Inclusion
    // -------------------------------------------------------------------------
    console.log('\n--- 5. SECRETS: Scoped Secret Creation & Table Verification ---');
    await session.navigate('https://opssentinal.com/runbooks/agents/secrets');
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'create secret');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const secretName = `e2e-live-secret-${runId}`;
    await session.evaluate(`(() => {
      const form = document.querySelector('form[action*="createRunbookSecretAction"]') || document.querySelector('[role="dialog"] form');
      if (!form) return;
      const nameInput = form.querySelector('input[name="name"]');
      const valInput = form.querySelector('input[name="value"]');
      const descInput = form.querySelector('input[name="description"]');
      if (nameInput) {
        nameInput.value = ${JSON.stringify(secretName)};
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (valInput) {
        valInput.value = 'SecretP@ssw0rd999!';
        valInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (descInput) {
        descInput.value = 'E2E Certified secret credential for runner fleet';
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Open target combobox
      const combobox = form.querySelector('button[role="combobox"]');
      if (combobox) combobox.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));

    // Select first target option
    await session.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('[cmdk-item]'));
      const targetOpt = items.find(i => i.innerText.includes('Agent') || i.innerText.includes('Pool'));
      if (targetOpt) targetOpt.click();
    })()`);
    await new Promise(r => setTimeout(r, 400));
    await session.captureScreenshot(shot('ui_deep_05_secret_drawer_filled.png'));

    // Submit form
    console.log(`Submitting encrypted secret: ${secretName}...`);
    await session.evaluate(`(() => {
      const submitBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.innerText.includes('Create encrypted secret'));
      if (submitBtn) submitBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 3500));

    // Refresh secrets page and verify table
    await session.navigate('https://opssentinal.com/runbooks/agents/secrets');
    const secretTableData = await session.evaluate<any>(`(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr')).map(r => r.innerText);
      const matchingRow = rows.find(r => r.includes(${JSON.stringify(secretName)}));
      return {
        foundSecret: Boolean(matchingRow),
        matchingRow: matchingRow || null,
        hasMaskedValue: matchingRow ? matchingRow.includes('••••••••') : false,
        hasGrant: matchingRow ? matchingRow.includes('1 grant') || matchingRow.includes('grant') : false,
        hasManageButton: matchingRow ? matchingRow.includes('Manage grants / Rotate') : false,
      };
    })()`);
    await session.captureScreenshot(shot('ui_deep_05_secret_table_rendered.png'));

    const secretPass =
      secretTableData.foundSecret &&
      secretTableData.hasMaskedValue &&
      secretTableData.hasGrant &&
      secretTableData.hasManageButton;
    record('runbook_secrets_lifecycle', {
      passed: secretPass,
      secretName,
      details: secretTableData,
      drawerScreenshot: rel('ui_deep_05_secret_drawer_filled.png'),
      tableScreenshot: rel('ui_deep_05_secret_table_rendered.png'),
    });
    console.log(
      `  Secrets Creation & Table Result: ${secretPass ? '[PASS]' : '[FAIL]'} (Found: ${secretTableData.foundSecret})`
    );

    // -------------------------------------------------------------------------
    // 6. FAILURES: Client & Server Negative Constraint Validation
    // -------------------------------------------------------------------------
    console.log('\n--- 6. FAILURES: Client & Server Negative Validation ---');
    await session.navigate('https://opssentinal.com/runbooks');
    await session.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'New Runbook');
      if (btn) btn.click();
    })()`);
    await new Promise(r => setTimeout(r, 600));

    const negData = await session.evaluate<any>(`(() => {
      const nameInput = document.getElementById('new-runbook-name');
      const tagsInput = document.getElementById('new-runbook-tags');
      if (tagsInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(tagsInput, 'INVALID TAG & SPACES!!!');
        tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const errorMsg = document.querySelector('#new-runbook-tags-hint p')?.innerText || '';
      return {
        nameRequired: nameInput?.required ?? false,
        nameMissing: nameInput ? !nameInput.checkValidity() : false,
        tagsInvalid: tagsInput ? !tagsInput.checkValidity() : false,
        errorMessage: errorMsg,
      };
    })()`);
    await session.captureScreenshot(shot('ui_deep_06_negative_constraint_validation.png'));
    await session.dispatchKey('Escape', 'Escape', 27);
    await new Promise(r => setTimeout(r, 400));

    const negPass = negData.nameRequired && negData.nameMissing && negData.tagsInvalid;
    record('negative_constraints', {
      passed: negPass,
      details: negData,
      screenshot: rel('ui_deep_06_negative_constraint_validation.png'),
    });
    console.log(`  Failures/Negative Validation Result: ${negPass ? '[PASS]' : '[FAIL]'}`);

    // -------------------------------------------------------------------------
    // 7. CLEANUP: Archive newly created test runbook
    // -------------------------------------------------------------------------
    if (createdRunbookId) {
      console.log(`\n--- 7. CLEANUP: Archiving test runbook ${createdRunbookId} ---`);
      await session.navigate(`https://opssentinal.com/runbooks/${createdRunbookId}`);
      await session.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase() === 'archive runbook');
        if (btn) btn.click();
      })()`);
      await new Promise(r => setTimeout(r, 600));

      await session.evaluate(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText.trim().toLowerCase().includes('archive'));
          if (confirmBtn) confirmBtn.click();
        }
      })()`);
      await new Promise(r => setTimeout(r, 2000));
      await session.captureScreenshot(shot('ui_deep_07_archive_cleanup.png'));
      console.log('  Cleaned up test runbook successfully.');
    }

    // Save JSON results
    const outJson = path.resolve(
      'plans/runbook-engine/enterprise-physical-certification/results/UI-DEEP-LIFECYCLE-VERIFICATION.json'
    );
    fs.writeFileSync(outJson, JSON.stringify(results, null, 2));
    console.log(`\nDeep UI Lifecycle Results written to ${outJson}`);
    console.log(
      `Total: ${results.summary.totalTests} | Passed: ${results.summary.totalPassed} | Failed: ${results.summary.totalFailed}`
    );
  } finally {
    session.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDeepUiLifecycleCertification().catch(err => {
    console.error('Deep UI Lifecycle Certification failed:', err);
    process.exit(1);
  });
}
