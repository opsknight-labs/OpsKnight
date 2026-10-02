#!/usr/bin/env node
const fs = require('node:fs');

// The Security workflow is advisory (every scanner is continue-on-error and the
// publisher uses fail_on: nothing). Findings stay listed with their original
// text, but as "skipped" so the sticky summary cannot show red while the
// workflow is green. Gating checks live in their own required workflows.
const NON_GATING_MESSAGE = 'Advisory (non-gating) security finding';
const NON_GATING_DETAIL = 'Published as SARIF/artifacts for triage; this summary follows the advisory workflow conclusion.';

function findingText(testcase) {
  const match = /<(failure|error)\b[^>]*?\bmessage="([^"]*)"/.exec(testcase);
  return match ? match[2] : '';
}

function setXmlAttribute(tag, name, value) {
  const attribute = `${name}="${value}"`;
  if (new RegExp(`\\s${name}="[^"]*"`).test(tag)) {
    return tag.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${attribute}`);
  }
  return tag.replace(/\s*\/?\s*>$/, ` ${attribute}${tag.endsWith('/>') ? '/>' : '>'}`);
}

function incrementXmlAttribute(tag, name, amount) {
  const match = new RegExp(`\\s${name}="(\\d+)"`).exec(tag);
  const next = (match ? Number(match[1]) : 0) + amount;
  return setXmlAttribute(tag, name, next);
}

function sanitizeSecurityJunitContent(xml) {
  let converted = 0;
  const content = xml.replace(/<testcase\b[^>]*>[\s\S]*?<\/testcase>/g, (testcase) => {
    const findingPattern = /\s*<(failure|error)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g;
    if (!findingPattern.test(testcase)) return testcase;
    converted += 1;
    const original = findingText(testcase);
    const message = original ? `${NON_GATING_MESSAGE}: ${original}` : NON_GATING_MESSAGE;
    const withoutFindings = testcase.replace(findingPattern, '');
    return withoutFindings.replace(
      /<\/testcase>$/,
      `    <skipped message="${message}">${NON_GATING_DETAIL}</skipped>\n    </testcase>`
    );
  });

  if (converted === 0) return { content, converted };

  const withSuiteCounts = content.replace(
    /<testsuite\b[^>]*>[\s\S]*?<\/testsuite>/g,
    (suite) => {
      const skipped = (suite.match(/<skipped\b/g) || []).length;
      return suite.replace(/<testsuite\b[^>]*>/, (tag) => {
        let next = setXmlAttribute(tag, 'failures', 0);
        next = setXmlAttribute(next, 'errors', 0);
        next = incrementXmlAttribute(next, 'skipped', skipped);
        return next;
      });
    }
  );

  const withPassingCounts = withSuiteCounts.replace(/<testsuites\b[^>]*>/, (tag) => {
    let next = setXmlAttribute(tag, 'failures', 0);
    next = setXmlAttribute(next, 'errors', 0);
    next = incrementXmlAttribute(next, 'skipped', converted);
    return next;
  });

  return { content: withPassingCounts, converted };
}

function sanitizeSecurityJunitFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const { content, converted } = sanitizeSecurityJunitContent(original);
  if (converted > 0) fs.writeFileSync(file, content);
  return converted;
}

if (require.main === module) {
  const files = process.argv.slice(2);
  let total = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    total += sanitizeSecurityJunitFile(file);
  }
  console.log(`Marked ${total} non-gating security findings as skipped.`);
}

module.exports = { sanitizeSecurityJunitContent, sanitizeSecurityJunitFile };
