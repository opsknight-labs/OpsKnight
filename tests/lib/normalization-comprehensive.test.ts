import { describe, it, expect } from 'vitest';
import {
  normalizeSeverity,
  normalizeEventAction,
  firstString,
} from '@/lib/integrations/normalization';

describe('Normalization Unit & Real-World Payload Suite', () => {
  describe('normalizeEventAction - False Positive Prevention', () => {
    it('should NOT resolve on words containing "up" as a substring', () => {
      expect(normalizeEventAction('upstream_down')).toBe('trigger');
      expect(normalizeEventAction('setup_failed')).toBe('trigger');
      expect(normalizeEventAction('backup_error')).toBe('trigger');
      expect(normalizeEventAction('update_failed')).toBe('trigger');
      expect(normalizeEventAction('startup_crash')).toBe('trigger');
      expect(normalizeEventAction('lookup_timeout')).toBe('trigger');
      expect(normalizeEventAction('group_unreachable')).toBe('trigger');
      expect(normalizeEventAction('corrupted_state')).toBe('trigger');
    });

    it('should NOT resolve on words containing "ok" as a substring', () => {
      expect(normalizeEventAction('look_into_this')).toBe('trigger');
      expect(normalizeEventAction('token_expired')).toBe('trigger');
      expect(normalizeEventAction('broken_pipe')).toBe('trigger');
      expect(normalizeEventAction('spoke_failed')).toBe('trigger');
      expect(normalizeEventAction('choke_point')).toBe('trigger');
      expect(normalizeEventAction('poker_face')).toBe('trigger');
    });

    it('should NOT acknowledge on words containing "ack" as a substring', () => {
      expect(normalizeEventAction('packet_loss')).toBe('trigger');
      expect(normalizeEventAction('blackout')).toBe('trigger');
      expect(normalizeEventAction('tracking_error')).toBe('trigger');
      expect(normalizeEventAction('stack_overflow')).toBe('trigger');
      expect(normalizeEventAction('backend_down')).toBe('trigger');
      expect(normalizeEventAction('deadlock')).toBe('trigger');
      expect(normalizeEventAction('attack_detected')).toBe('trigger');
    });

    it('should correctly resolve on legitimate "up" and "ok" tokens', () => {
      expect(normalizeEventAction('up')).toBe('resolve');
      expect(normalizeEventAction('UP')).toBe('resolve');
      expect(normalizeEventAction('Host is UP')).toBe('resolve');
      expect(normalizeEventAction('service_up')).toBe('resolve');
      expect(normalizeEventAction('db:up')).toBe('resolve');
      expect(normalizeEventAction('ok')).toBe('resolve');
      expect(normalizeEventAction('OK')).toBe('resolve');
      expect(normalizeEventAction('Status: OK')).toBe('resolve');
      expect(normalizeEventAction('health_check:ok')).toBe('resolve');
      expect(normalizeEventAction('resolved')).toBe('resolve');
      expect(normalizeEventAction('RESOLVED')).toBe('resolve');
      expect(normalizeEventAction('recover')).toBe('resolve');
      expect(normalizeEventAction('RECOVERED')).toBe('resolve');
      expect(normalizeEventAction('closed')).toBe('resolve');
    });

    it('should correctly acknowledge on legitimate "ack" tokens', () => {
      expect(normalizeEventAction('ack')).toBe('acknowledge');
      expect(normalizeEventAction('ACK')).toBe('acknowledge');
      expect(normalizeEventAction('incident_ack')).toBe('acknowledge');
      expect(normalizeEventAction('acknowledge')).toBe('acknowledge');
      expect(normalizeEventAction('acknowledged')).toBe('acknowledge');
    });

    it('should default to fallback for unknown or empty actions', () => {
      expect(normalizeEventAction(undefined)).toBe('trigger');
      expect(normalizeEventAction('', 'trigger')).toBe('trigger');
      expect(normalizeEventAction('unknown_action', 'trigger')).toBe('trigger');
      expect(normalizeEventAction('firing', 'trigger')).toBe('trigger');
    });
  });

  describe('normalizeSeverity - Classification Accuracy', () => {
    it('should classify critical keywords accurately', () => {
      expect(normalizeSeverity('critical')).toBe('critical');
      expect(normalizeSeverity('CRIT')).toBe('critical');
      expect(normalizeSeverity('p1')).toBe('critical');
      expect(normalizeSeverity('SEV0')).toBe('critical');
      expect(normalizeSeverity('sev1')).toBe('critical');
      expect(normalizeSeverity('fatal')).toBe('critical');
      expect(normalizeSeverity('host_down')).toBe('critical');
      expect(normalizeSeverity('down')).toBe('critical');
    });

    it('should classify error keywords accurately', () => {
      expect(normalizeSeverity('error')).toBe('error');
      expect(normalizeSeverity('ERR')).toBe('error');
      expect(normalizeSeverity('p2')).toBe('error');
      expect(normalizeSeverity('sev2')).toBe('error');
    });

    it('should classify warning keywords accurately', () => {
      expect(normalizeSeverity('warning')).toBe('warning');
      expect(normalizeSeverity('WARN')).toBe('warning');
      expect(normalizeSeverity('p3')).toBe('warning');
      expect(normalizeSeverity('sev3')).toBe('warning');
      expect(normalizeSeverity('degraded')).toBe('warning');
      expect(normalizeSeverity('medium')).toBe('warning');
    });

    it('should classify info keywords accurately', () => {
      expect(normalizeSeverity('info')).toBe('info');
      expect(normalizeSeverity('informational')).toBe('info');
      expect(normalizeSeverity('p4')).toBe('info');
      expect(normalizeSeverity('p5')).toBe('info');
      expect(normalizeSeverity('low')).toBe('info');
      expect(normalizeSeverity('normal')).toBe('info');
    });

    it('should return fallback when given undefined or empty string', () => {
      expect(normalizeSeverity(undefined, 'warning')).toBe('warning');
      expect(normalizeSeverity('', 'error')).toBe('error');
      expect(normalizeSeverity('custom_unknown', 'warning')).toBe('warning');
    });
  });

  describe('firstString helper', () => {
    it('should extract first valid non-empty string', () => {
      expect(firstString(undefined, null, '', '  ', 'valid string', 'another')).toBe(
        'valid string'
      );
      expect(firstString(null, undefined)).toBeUndefined();
      expect(firstString(123)).toBe('123');
      expect(firstString('   hello   ')).toBe('hello');
    });
  });
});
