import { describe, expect, it } from 'vitest';
import { buildBackendEnv, isLocalUrl, parseMarkedPath, withFallbackPath } from '../src/env.ts';

describe('parseMarkedPath', () => {
  it('extracts the PATH between markers, ignoring shell noise', () => {
    expect(parseMarkedPath('Welcome!\n__ORCH_PATH__/opt/homebrew/bin:/usr/bin__ORCH_PATH__\nbye')).toBe('/opt/homebrew/bin:/usr/bin');
  });
  it('returns null without both markers or with an empty value', () => {
    expect(parseMarkedPath('')).toBeNull();
    expect(parseMarkedPath('__ORCH_PATH__/usr/bin')).toBeNull();
    expect(parseMarkedPath('__ORCH_PATH____ORCH_PATH__')).toBeNull();
  });
});

describe('withFallbackPath', () => {
  it('keeps the existing order and appends missing common dirs once', () => {
    const p = withFallbackPath('/custom/bin:/usr/bin', '/Users/me').split(':');
    expect(p[0]).toBe('/custom/bin');
    expect(p).toContain('/Users/me/.local/bin');
    expect(p).toContain('/opt/homebrew/bin');
    expect(p.filter((d) => d === '/usr/bin')).toHaveLength(1);
  });
  it('works with an empty PATH', () => {
    expect(withFallbackPath(undefined, '/h').split(':')).toContain('/bin');
  });
});

describe('buildBackendEnv', () => {
  it('drops Electron internals and NODE_ENV, sets PATH, dashboard and port', () => {
    const env = buildBackendEnv(
      { HOME: '/h', ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NODE_OPTIONS: '--inspect', ORCH_DATA_DIR: '/d' },
      { path: '/a:/b', webDist: '/res/web', port: 4317 },
    );
    expect(env.HOME).toBe('/h');
    expect(env.ORCH_DATA_DIR).toBe('/d');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.NODE_OPTIONS).toBe('--disable-warning=ExperimentalWarning');
    expect(env.PATH).toBe('/a:/b');
    expect(env.ORCH_WEB_DIST).toBe('/res/web');
    expect(env.ORCH_PORT).toBe('4317');
    expect(env.ORCH_HOST).toBe('127.0.0.1');
  });
});

describe('isLocalUrl', () => {
  it('accepts the dashboard origin only', () => {
    expect(isLocalUrl('http://localhost:4317/#/p/1', 4317)).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:4317/', 4317)).toBe(true);
    expect(isLocalUrl('http://localhost:5173/', 4317)).toBe(false);
    expect(isLocalUrl('https://github.com/o/r/pull/1', 4317)).toBe(false);
    expect(isLocalUrl('file:///etc/passwd', 4317)).toBe(false);
    expect(isLocalUrl('not a url', 4317)).toBe(false);
  });
});
