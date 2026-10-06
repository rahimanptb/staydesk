import { describe, expect, it } from 'vitest';
import { internalPath, portalForHost } from './portals';

describe('portalForHost', () => {
  it('maps portal subdomains', () => {
    expect(portalForHost('app.staydesk.app')).toBe('hotel');
    expect(portalForHost('agent.staydesk.app')).toBe('agent');
    expect(portalForHost('admin.staydesk.app')).toBe('admin');
    expect(portalForHost('agent.localhost:3000')).toBe('agent');
    expect(portalForHost('ADMIN.localhost')).toBe('admin');
  });

  it('serves the hotel portal on bare localhost', () => {
    expect(portalForHost('localhost:3000')).toBe('hotel');
    expect(portalForHost('127.0.0.1:3000')).toBe('hotel');
  });

  it('rejects unknown and missing hosts', () => {
    expect(portalForHost('www.staydesk.app')).toBeNull();
    expect(portalForHost('evil.example.com')).toBeNull();
    expect(portalForHost(null)).toBeNull();
  });
});

describe('internalPath', () => {
  it('prefixes the portal so other portals stay unreachable', () => {
    expect(internalPath('hotel', '/')).toBe('/hotel');
    expect(internalPath('agent', '/search')).toBe('/agent/search');
    expect(internalPath('hotel', '/admin/tenants')).toBe('/hotel/admin/tenants');
  });
});
