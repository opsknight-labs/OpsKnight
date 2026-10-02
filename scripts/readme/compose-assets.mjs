import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const captures = resolve(root, 'generated/readme-captures');
const output = resolve(root, 'public/readme');
const SCALE = 1.5;

const files = {
  logo: resolve(root, 'public/logo.png'),
  commandCenter: resolve(captures, 'desktop/command-center.png'),
  incident: resolve(captures, 'desktop/incident-detail.png'),
  analytics: resolve(captures, 'desktop/analytics-overview.png'),
  schedule: resolve(captures, 'desktop/on-call-schedule.png'),
  policy: resolve(captures, 'desktop/escalation-policy.png'),
  lightHome: resolve(captures, 'mobile/light/home.png'),
  lightIncidents: resolve(captures, 'mobile/light/incidents.png'),
  lightIncident: resolve(captures, 'mobile/light/incident-detail.png'),
  darkIncident: resolve(captures, 'mobile/dark/incident-detail.png'),
  darkOnCall: resolve(captures, 'mobile/dark/on-call.png'),
  darkHome: resolve(captures, 'mobile/dark/home.png'),
};

const img = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, file]) => [
      key,
      `data:image/png;base64,${(await readFile(file)).toString('base64')}`,
    ])
  )
);

const escapeHtml = value =>
  String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);

// ---------------------------------------------------------------------------
// Shared design system
// ---------------------------------------------------------------------------

const baseCss = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    position: relative;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", Inter, "Segoe UI", sans-serif;
    color: #f8fafc;
    background: #06080f;
    -webkit-font-smoothing: antialiased;
  }
  .backdrop { position: absolute; inset: 0; overflow: hidden; }
  .backdrop::before { content: ""; position: absolute; inset: 0; background:
    radial-gradient(ellipse 55% 45% at 50% 18%, rgba(225, 29, 72, .20), transparent 70%),
    radial-gradient(ellipse 40% 40% at 12% 85%, rgba(99, 102, 241, .16), transparent 70%),
    radial-gradient(ellipse 40% 40% at 88% 80%, rgba(14, 165, 233, .12), transparent 70%); }
  .backdrop::after { content: ""; position: absolute; inset: 0; background:
    linear-gradient(rgba(148, 163, 184, .055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, .055) 1px, transparent 1px);
    background-size: 48px 48px;
    -webkit-mask-image: radial-gradient(ellipse 75% 70% at 50% 40%, #000 30%, transparent 100%); }

  .brand { position: absolute; display: flex; align-items: center; gap: 14px; z-index: 30; }
  .brand img { width: 46px; height: 46px; object-fit: contain; filter: drop-shadow(0 6px 18px rgba(225, 29, 72, .45)); }
  .brand b { display: block; font-size: 26px; font-weight: 750; letter-spacing: -.6px; }
  .brand small { display: block; margin-top: 2px; font-size: 13px; font-weight: 500; color: #94a3b8; letter-spacing: .1px; }

  .eyebrow { position: absolute; z-index: 30; display: flex; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 13px; border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, .22); background: rgba(15, 23, 42, .62); color: #cbd5e1;
    font-size: 12.5px; font-weight: 600; letter-spacing: .2px; backdrop-filter: blur(8px); }
  .chip i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e; }
  .chip.red i { background: #f43f5e; box-shadow: 0 0 10px #f43f5e; }

  .browser { position: absolute; z-index: 10; border-radius: 14px; overflow: hidden; background: #0b1120;
    border: 1px solid rgba(255, 255, 255, .13);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .4), 0 40px 90px -20px rgba(0, 0, 0, .75), 0 0 80px -30px rgba(225, 29, 72, .35); }
  .browser .bar { height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 14px;
    background: linear-gradient(#1a2030, #131826); border-bottom: 1px solid rgba(255, 255, 255, .07); }
  .browser .bar span { width: 11px; height: 11px; border-radius: 50%; }
  .browser .bar span:nth-child(1) { background: #ff5f57; } .browser .bar span:nth-child(2) { background: #febc2e; }
  .browser .bar span:nth-child(3) { background: #28c840; }
  .browser .bar em { margin: 0 auto; transform: translateX(-24px); min-width: 300px; height: 22px; border-radius: 7px;
    display: flex; align-items: center; justify-content: center; gap: 6px; font-style: normal; font-size: 11.5px;
    color: #94a3b8; background: rgba(2, 6, 23, .55); border: 1px solid rgba(255, 255, 255, .06); }
  .browser .bar em::before { content: "🔒"; font-size: 9px; filter: grayscale(1) brightness(1.6); }
  .browser .shot { position: relative; overflow: hidden; }
  .browser .shot img { display: block; width: 100%; }

  .phone { position: absolute; z-index: 20; padding: 9px; border-radius: 50px;
    background: linear-gradient(145deg, #4b4f57 0%, #1d1f24 18%, #0a0b0d 50%, #24262b 82%, #50545c 100%);
    box-shadow: 0 0 0 1.5px #0a0a0c, inset 0 0 0 1px rgba(255, 255, 255, .16), 0 40px 70px -18px rgba(0, 0, 0, .8); }
  .phone::before, .phone::after { content: ""; position: absolute; width: 3px; border-radius: 2px; background: #2a2c31; }
  .phone::before { left: -3px; top: 120px; height: 46px; box-shadow: 0 60px 0 #2a2c31; }
  .phone::after { right: -3px; top: 150px; height: 74px; }
  .screen { position: relative; overflow: hidden; border-radius: 42px; background: #000; display: flex; flex-direction: column; }
  .screen .status { position: relative; z-index: 3; flex: none; display: flex; align-items: center; justify-content: space-between;
    padding: 0 26px 0 30px; font-size: 13.5px; font-weight: 650; letter-spacing: -.2px; }
  .screen .status svg { display: block; }
  .screen .status .icons { display: flex; align-items: center; gap: 5px; }
  .screen .island { position: absolute; z-index: 3; left: 50%; transform: translateX(-50%); border-radius: 20px; background: #000; }
  .screen > img { display: block; width: 100%; flex: none; }
  .screen .home-indicator { position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%); width: 34%; height: 4px;
    border-radius: 3px; z-index: 4; }

  .callout { position: absolute; z-index: 40; width: 236px; padding: 12px 14px 13px; border-radius: 12px;
    background: rgba(13, 18, 32, .86); border: 1px solid rgba(148, 163, 184, .2);
    box-shadow: 0 18px 40px -16px rgba(0, 0, 0, .8); backdrop-filter: blur(10px); }
  .callout b { display: flex; align-items: center; gap: 9px; font-size: 14.5px; font-weight: 700; letter-spacing: -.15px; color: #f8fafc; }
  .callout p { margin-top: 5px; font-size: 12.3px; line-height: 1.45; color: #a5b4c8; }
  .num { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%;
    background: linear-gradient(135deg, #fb7185, #e11d48); color: #fff; font-size: 12px; font-weight: 800;
    box-shadow: 0 0 0 3px rgba(225, 29, 72, .25); }
  .marker { position: absolute; z-index: 35; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; color: #fff; font-size: 12.5px; font-weight: 800;
    background: linear-gradient(135deg, #fb7185, #e11d48); border: 2px solid #fff;
    box-shadow: 0 0 0 5px rgba(225, 29, 72, .28), 0 6px 16px rgba(0, 0, 0, .5); }
  svg.links { position: absolute; inset: 0; z-index: 34; pointer-events: none; overflow: visible; }

  .caption { position: absolute; z-index: 30; text-align: center; }
  .caption b { display: block; font-size: 15px; font-weight: 700; letter-spacing: -.1px; color: #f1f5f9; }
  .caption span { display: block; margin-top: 4px; font-size: 12px; font-weight: 600; letter-spacing: 1.6px; text-transform: uppercase; color: #64748b; }
`;

const statusIcons = color => `
  <svg width="18" height="12" viewBox="0 0 18 12" fill="${color}"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="${color}"><path d="M8 2.6c2.2 0 4.2.9 5.7 2.3l1.2-1.3C13.1 1.9 10.7.9 8 .9S2.9 1.9 1.1 3.6l1.2 1.3C3.8 3.5 5.8 2.6 8 2.6Zm0 3.4c1.3 0 2.5.5 3.4 1.3l1.2-1.3C11.4 4.9 9.8 4.3 8 4.3s-3.4.6-4.6 1.7l1.2 1.3C5.5 6.5 6.7 6 8 6Zm0 3.3c.5 0 1 .2 1.3.5L8 11.2 6.7 9.8c.3-.3.8-.5 1.3-.5Z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="22" height="12" rx="3.5" fill="none" stroke="${color}" stroke-opacity=".4"/><rect x="2" y="2" width="19" height="9" rx="2" fill="${color}"/><path d="M24 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" fill="${color}" fill-opacity=".45"/></svg>`;

/**
 * iPhone 15 Pro frame. The capture is 393x798 pt; the frame adds the 54 pt
 * status bar so the composed screen keeps the device's exact 393x852 aspect.
 */
function phone({ src, scheme = 'light', width, left, top, z = 20, extraStyle = '', inner }) {
  const k = width / 393;
  const statusH = 54 * k;
  const ink = scheme === 'dark' ? '#fff' : '#0b0b0f';
  const body = inner ?? `<img src="${src}" alt="">`;
  return `<div class="phone" data-scheme="${scheme}" style="left:${left}px;top:${top}px;z-index:${z};${extraStyle}">
    <div class="screen" style="width:${width}px;height:${852 * k}px;border-radius:${46 * k}px">
      <div class="status" style="height:${statusH}px;color:${ink};font-size:${15 * k}px;padding:0 ${30 * k}px 0 ${44 * k}px">
        <span>9:41</span><span class="icons" style="transform:scale(${Math.max(k, 0.55)});transform-origin:right center">${statusIcons(ink)}</span>
      </div>
      <div class="island" style="top:${11 * k}px;width:${124 * k}px;height:${36 * k}px"></div>
      ${body}
      <div class="home-indicator" style="background:${ink};opacity:.85"></div>
    </div>
  </div>`;
}

function browser({ src, left, top, width, url, id = '' }) {
  return `<div class="browser" ${id ? `id="${id}"` : ''} style="left:${left}px;top:${top}px;width:${width}px">
    <div class="bar"><span></span><span></span><span></span><em>${escapeHtml(url)}</em></div>
    <div class="shot"><img src="${src}" alt=""></div>
  </div>`;
}

/** Browser frame showing only a region (in 1600x1000 capture CSS pixels). */
function croppedBrowser({ src, crop, left, top, width, url }) {
  const k = width / crop.w;
  return `<div class="browser" style="left:${left}px;top:${top}px;width:${width}px">
    <div class="bar"><span></span><span></span><span></span><em>${escapeHtml(url)}</em></div>
    <div class="shot" style="height:${crop.h * k}px"><img src="${src}" alt=""
      style="position:absolute;width:${1600 * k}px;max-width:none;left:${-crop.x * k}px;top:${-crop.y * k}px"></div>
  </div>`;
}

function brand(left, top, subtitle = 'Open-source incident management &amp; on-call') {
  return `<div class="brand" style="left:${left}px;top:${top}px"><img src="${img.logo}" alt="">
    <div><b>OpsKnight</b><small>${subtitle}</small></div></div>`;
}

/**
 * Annotation layer. Points use the 1600x1000 CSS-pixel coordinate space of
 * the desktop captures; the page script maps them onto the rendered frame and
 * draws elbow connectors to each label card.
 */
function annotations(frameId, items) {
  const markers = items
    .map((item, index) => `<div class="marker" data-frame="${frameId}" data-x="${item.x}" data-y="${item.y}" data-i="${index}">${index + 1}</div>`)
    .join('');
  const cards = items
    .map(
      (item, index) => `<div class="callout" data-i="${index}" data-side="${item.side}" style="${item.side}:${item.edge}px;top:0">
        <b><span class="num">${index + 1}</span>${escapeHtml(item.title)}</b><p>${escapeHtml(item.text)}</p></div>`
    )
    .join('');
  return `${markers}${cards}<svg class="links"></svg>`;
}

const layoutScript = `
  for (const screen of document.querySelectorAll('.screen')) {
    const shot = screen.querySelector(':scope > img');
    const status = screen.querySelector('.status');
    if (!shot) continue;
    // Match the iOS status bar to the captured app header colour.
    const canvas = document.createElement('canvas');
    canvas.width = shot.naturalWidth; canvas.height = 12;
    const context = canvas.getContext('2d');
    context.drawImage(shot, 0, 0);
    const [r, g, b] = context.getImageData(Math.floor(shot.naturalWidth / 2), 4, 1, 1).data;
    status.style.background = 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  for (const marker of document.querySelectorAll('.marker')) {
    const frame = document.getElementById(marker.dataset.frame);
    const shot = frame.querySelector('.shot img').getBoundingClientRect();
    const k = shot.width / 1600;
    marker.style.left = (shot.left + Number(marker.dataset.x) * k) + 'px';
    marker.style.top = (shot.top + Number(marker.dataset.y) * k) + 'px';
  }
  // Stack label cards beside their markers so connectors stay short and
  // mostly horizontal, then resolve overlaps per side.
  for (const side of ['left', 'right']) {
    const cards = [...document.querySelectorAll('.callout[data-side="' + side + '"]')].map(card => {
      const marker = document.querySelector('.marker[data-i="' + card.dataset.i + '"]');
      const m = marker.getBoundingClientRect();
      return { card, want: m.top + m.height / 2 - 24, height: card.getBoundingClientRect().height };
    }).sort((a, b) => a.want - b.want);
    let cursor = 24;
    for (const entry of cards) {
      const top = Math.max(entry.want, cursor);
      entry.top = top;
      cursor = top + entry.height + 16;
    }
    const overflow = cursor - 16 - (window.innerHeight - 24);
    if (overflow > 0) for (const entry of cards) entry.top -= overflow;
    for (const entry of cards) entry.card.style.top = entry.top + 'px';
  }
  const svg = document.querySelector('svg.links');
  if (svg) {
    const ns = 'http://www.w3.org/2000/svg';
    for (const card of document.querySelectorAll('.callout')) {
      const marker = document.querySelector('.marker[data-i="' + card.dataset.i + '"]');
      const c = card.getBoundingClientRect();
      const m = marker.getBoundingClientRect();
      const mx = m.left + m.width / 2, my = m.top + m.height / 2;
      const leftSide = c.right < mx;
      const sx = leftSide ? c.right : c.left;
      const sy = c.top + 22;
      const bend = sx + (mx - sx) * 0.42;
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M' + sx + ' ' + sy + ' H' + bend + ' L' + mx + ' ' + my);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(251,113,133,.85)');
      path.setAttribute('stroke-width', '1.6');
      path.setAttribute('stroke-dasharray', '0');
      svg.appendChild(path);
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', sx); dot.setAttribute('cy', sy); dot.setAttribute('r', '3.2');
      dot.setAttribute('fill', '#fb7185');
      svg.appendChild(dot);
    }
  }
`;

async function render(browserInstance, { name, width, height, html }) {
  const page = await browserInstance.newPage({ viewport: { width, height }, deviceScaleFactor: SCALE });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}</style></head>
    <body><div class="backdrop"></div>${html}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(image => image.decode()));
    await document.fonts.ready;
  });
  await page.evaluate(layoutScript);
  const png = await page.screenshot({ type: 'png' });
  const webp = await page.evaluate(
    async ({ data, w, h }) => {
      const source = new Image();
      source.src = 'data:image/png;base64,' + data;
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(source, 0, 0);
      return canvas.toDataURL('image/webp', 0.88).split(',')[1];
    },
    { data: png.toString('base64'), w: width * SCALE, h: height * SCALE }
  );
  const destination = resolve(output, `${name}.webp`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.from(webp, 'base64'));
  await page.close();
  console.log(`Wrote ${destination}`);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

const hero = {
  name: 'hero',
  width: 1600,
  height: 900,
  html: `
    ${brand(64, 46)}
    <div class="eyebrow" style="right:64px;top:54px">
      <span class="chip red"><i></i>2.0 release</span><span class="chip"><i></i>Self-hosted</span><span class="chip">Web + mobile PWA</span>
    </div>
    ${browser({ src: img.commandCenter, left: 310, top: 140, width: 980, url: 'opsknight.example.com/' })}
    ${phone({ src: img.lightHome, scheme: 'light', width: 236, left: 76, top: 318, z: 25 })}
    ${phone({ src: img.darkIncident, scheme: 'dark', width: 236, left: 1270, top: 318, z: 25 })}
  `,
};

const commandCenter = {
  name: 'command-center',
  width: 1600,
  height: 860,
  html: `
    ${brand(56, 40, 'Command Center')}
    ${browser({ src: img.commandCenter, id: 'cc', left: 330, top: 118, width: 940, url: 'opsknight.example.com/' })}
    ${annotations('cc', [
      { x: 244, y: 85, side: 'left', edge: 56, title: 'Global incident banner', text: 'The highest-priority active incident follows responders across every page.' },
      { x: 288, y: 222, side: 'left', edge: 56, title: 'Live command center', text: 'Total, active, muted, resolved and unassigned incidents refresh automatically.' },
      { x: 288, y: 812, side: 'left', edge: 56, title: 'Ops Pulse triage', text: 'Your queue, critical focus and services at risk in one glance.' },
      { x: 1578, y: 62, side: 'right', edge: 56, title: 'Real-time alerts', text: 'New incidents pop up live with one-click acknowledge.' },
      { x: 1552, y: 455, side: 'right', edge: 56, title: 'Workload signals', text: 'Unassigned work and overload are flagged before SLAs slip.' },
      { x: 1552, y: 812, side: 'right', edge: 56, title: 'SLA alerts', text: 'Acknowledge and resolve timers show what is overdue or about to breach.' },
    ])}
  `,
};

const incidentResponse = {
  name: 'incident-response',
  width: 1600,
  height: 860,
  html: `
    ${brand(56, 40, 'Incident response')}
    ${browser({ src: img.incident, id: 'ir', left: 330, top: 118, width: 940, url: 'opsknight.example.com/incidents/INC-1042' })}
    ${annotations('ir', [
      { x: 274, y: 480, side: 'left', edge: 56, title: 'Ownership at a glance', text: 'Priority, urgency, visibility, service, assignee and escalation policy.' },
      { x: 274, y: 660, side: 'left', edge: 56, title: 'Context that travels', text: 'Description, tags and links stay with the incident record.' },
      { x: 292, y: 780, side: 'left', edge: 56, title: 'Notes, timeline, postmortem', text: 'Every update, event and learning stays on one auditable record.' },
      { x: 905, y: 291, side: 'right', edge: 56, title: 'Response-health timers', text: 'Live time left to acknowledge and resolve, derived from the service SLA.' },
      { x: 1566, y: 379, side: 'right', edge: 56, title: 'One-click lifecycle', text: 'Acknowledge, resolve, snooze, suppress or reassign in a click.' },
      { x: 1566, y: 782, side: 'right', edge: 56, title: 'Stakeholder updates', text: 'Subscribe teammates and leaders to every incident change.' },
    ])}
  `,
};

const platform = {
  name: 'platform',
  width: 1600,
  height: 900,
  html: `
    ${brand(64, 40, 'Plan, route and measure')}
    ${croppedBrowser({ src: img.analytics, crop: { x: 262, y: 128, w: 1320, h: 862 }, left: 64, top: 122, width: 860, url: 'opsknight.example.com/analytics' })}
    <div class="caption" style="left:64px;top:742px;width:860px;text-align:left">
      <b style="font-size:20px">Analytics &amp; SLA insights</b>
      <span style="margin-top:6px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:500;color:#94a3b8">MTTA, MTTR, SLA compliance, ownership load and service health — filtered by team, service, urgency and time window.</span>
    </div>
    ${croppedBrowser({ src: img.schedule, crop: { x: 262, y: 188, w: 1320, h: 540 }, left: 972, top: 122, width: 564, url: 'opsknight.example.com/schedules' })}
    <div class="caption" style="left:972px;top:418px;width:564px;text-align:left">
      <b style="font-size:17px">On-call schedules</b>
      <span style="margin-top:4px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;color:#94a3b8">Rotation layers, overrides, live coverage and time-zone context.</span>
    </div>
    ${croppedBrowser({ src: img.policy, crop: { x: 262, y: 188, w: 1320, h: 590 }, left: 972, top: 490, width: 564, url: 'opsknight.example.com/policies' })}
    <div class="caption" style="left:972px;top:812px;width:564px;text-align:left">
      <b style="font-size:17px">Escalation policies</b>
      <span style="margin-top:4px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:500;color:#94a3b8">Ordered, timed steps that page users, teams and schedules.</span>
    </div>
  `,
};

const lockScreen = width => {
  const k = width / 393;
  const note = (title, lines, time) => `
    <div style="margin:0 ${10 * k}px ${8 * k}px;padding:${11 * k}px ${12 * k}px;border-radius:${20 * k}px;
      background:rgba(245,245,250,.16);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);display:flex;gap:${10 * k}px">
      <img src="${img.logo}" style="width:${36 * k}px;height:${36 * k}px;border-radius:${9 * k}px;background:#fff;padding:${3 * k}px;flex:none" alt="">
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;font-size:${13 * k}px;font-weight:700;color:#fff">
          <span>${escapeHtml(title)}</span><span style="font-weight:500;color:rgba(255,255,255,.6)">${time}</span></div>
        ${lines.map(line => `<div style="font-size:${12.5 * k}px;line-height:1.32;color:rgba(255,255,255,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(line)}</div>`).join('')}
      </div>
    </div>`;
  return `<div style="position:absolute;inset:0;background:
      radial-gradient(ellipse 90% 55% at 30% 20%, rgba(225,29,72,.55), transparent 65%),
      radial-gradient(ellipse 90% 60% at 80% 75%, rgba(79,70,229,.55), transparent 65%),
      linear-gradient(160deg,#1a0b16,#0b0d1f 60%,#05060c)"></div>
    <div style="position:relative;z-index:2;text-align:center;color:#fff;margin-top:${14 * k}px">
      <div style="font-size:${16 * k}px;font-weight:600;opacity:.9">Friday, October 2</div>
      <div style="font-size:${86 * k}px;font-weight:700;letter-spacing:-${2 * k}px;line-height:1;margin-top:${2 * k}px">9:41</div>
    </div>
    <div style="position:relative;z-index:2;margin-top:${150 * k}px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:0 ${16 * k}px ${8 * k}px;color:#fff">
        <span style="font-size:${17 * k}px;font-weight:700">Notification Centre</span>
      </div>
      ${note('🔴 CRITICAL • Checkout API', ['Checkout API p95 latency above SLO', 'Triggered • Commerce Reliability • 8:04 PM', '🚨 Urgent Action Required'], 'now')}
      ${note('✅ Acknowledged • Edge Gateway', ['Elevated error rate at the edge gateway', 'Acknowledged • Daniel Kim • 7:40 PM'], '24m ago')}
      ${note('🟡 Incident • Event Streaming', ['Event processing backlog in EU region', 'Triggered • Unassigned • 7:21 PM'], '43m ago')}
    </div>
    <div style="position:absolute;z-index:2;left:${44 * k}px;right:${44 * k}px;bottom:${40 * k}px;display:flex;justify-content:space-between">
      <span style="width:${50 * k}px;height:${50 * k}px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:${20 * k}px">🔦</span>
      <span style="width:${50 * k}px;height:${50 * k}px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:${20 * k}px">📷</span>
    </div>`;
};

const mobileRow = [
  { src: img.lightHome, scheme: 'light', title: 'Responder home', tag: 'Light' },
  { src: img.lightIncidents, scheme: 'light', title: 'Fast triage', tag: 'Light' },
  { scheme: 'dark', title: 'Push paging', tag: 'Web Push', lock: true },
  { src: img.darkIncident, scheme: 'dark', title: 'Respond anywhere', tag: 'Dark' },
  { src: img.darkOnCall, scheme: 'dark', title: 'On-call at a glance', tag: 'Dark' },
];

const mobile = {
  name: 'mobile',
  width: 1600,
  height: 900,
  html: `
    ${brand(64, 46, 'Mobile responder PWA')}
    <div class="eyebrow" style="right:64px;top:54px">
      <span class="chip"><i></i>Installable on iOS &amp; Android</span><span class="chip">Light &amp; dark</span><span class="chip">Push notifications</span>
    </div>
    ${mobileRow
      .map((item, index) => {
        const center = index === 2;
        const width = center ? 262 : 244;
        const left = 66 + index * 298 + (center ? -9 : 0);
        const top = center ? 150 : 172;
        return `${phone({
          src: item.src,
          scheme: item.scheme,
          width,
          left,
          top,
          z: center ? 26 : 20,
          extraStyle: '-webkit-box-reflect: below 14px linear-gradient(transparent 82%, rgba(255,255,255,.10));',
          inner: item.lock ? lockScreen(width) : undefined,
        })}
          <div class="caption" style="left:${left - 10}px;top:${center ? 742 : 728}px;width:${width + 38}px">
            <b>${item.title}</b><span>${item.tag}</span></div>`;
      })
      .join('')}
  `,
};

const browserInstance = await chromium.launch();
try {
  for (const scene of [hero, commandCenter, incidentResponse, platform, mobile]) {
    await render(browserInstance, scene);
  }
} finally {
  await browserInstance.close();
}
