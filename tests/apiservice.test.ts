import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APIServiceError,
  AuthenticationError,
  ClientClosedError,
  EmailRequiredError,
  ForbiddenError,
  GeoEngine,
  InvalidCoordinatesError,
  InvalidLatitudeError,
  InvitationPendingError,
  LastAdminError,
  LastSubjectError,
  polygonFromLatLng,
  RoleRequiredError,
  Roles,
  RuleActions,
  RuleIDRequiredError,
  RuleNameRequiredError,
  RuleNotFoundError,
  SubjectTypes,
  UserAlreadyExistsError,
  UserIDRequiredError,
  UserNotFoundError,
} from '../src/index.js';

interface Captured {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Reply = { status: number; body?: string };

let closeServer: (() => Promise<void>) | null = null;

/** Starts a mock api-service; returns a client pointed at it and the captured requests. */
async function mock(
  reply: Reply | ((req: Captured, n: number) => Reply),
  options: Record<string, unknown> = {}
): Promise<{ client: GeoEngine; requests: Captured[] }> {
  const requests: Captured[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const captured = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(captured);
      const r = typeof reply === 'function' ? reply(captured, requests.length) : reply;
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(r.body ?? '');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  closeServer = () => new Promise<void>(done => server.close(() => done()));
  const { port } = server.address() as { port: number };
  const client = new GeoEngine('test-users-key', {
    apiServiceUrl: `http://127.0.0.1:${port}`,
    ...options,
  });
  return { client, requests };
}

const ok = (data: unknown, status = 200): Reply => ({
  status,
  body: JSON.stringify({ success: true, data }),
});

const apiError = (status: number, reason: string, message: string): Reply => ({
  status,
  body: JSON.stringify({
    success: false,
    error: {
      code: status,
      message,
      status: 'ERROR',
      details: [{ '@type': 'type.geoengineapis.com/geoengine.rpc.ErrorInfo', reason, domain: 'api-service' }],
    },
  }),
});

const RULE = {
  id: 'r1',
  org_id: 'o1',
  name: 'Solo CDMX',
  priority: 10,
  action: 'BLOCK',
  is_active: true,
  white_ip_list: [],
  black_ip_list: ['10.0.0.0/8'],
  assigned_subjects: [{ subject_type: 'USER', subject_id: 'u1' }],
  subjects_count: 1,
};

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
});

describe('Users module', () => {
  it('lists users with auth headers and maps fields to camelCase', async () => {
    const { client, requests } = await mock(
      ok([
        {
          id: 'u1',
          email: 'ana@acme.com',
          name: 'Ana',
          role: 'roles/geoengine.admin',
          status: 'active',
          created_at: '2026-01-02T03:04:05Z',
          last_login_at: '2026-02-03T04:05:06Z',
        },
      ])
    );

    const users = await client.users.list();

    expect(users).toEqual([
      {
        id: 'u1',
        email: 'ana@acme.com',
        name: 'Ana',
        role: Roles.Admin,
        status: 'active',
        permissions: [],
        createdAt: '2026-01-02T03:04:05Z',
        lastLoginAt: '2026-02-03T04:05:06Z',
      },
    ]);
    const req = requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/api/users');
    expect(req.headers['x-api-key']).toBe('test-users-key');
    expect(req.headers['x-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(req.headers['accept']).toBe('application/json');
    expect(req.headers['content-type']).toBeUndefined();
    expect(req.headers['user-agent']).toBe('GeoEngineNodeSDK/2.1.0');
    expect(client.Users).toBe(client.users);
  });

  it('escapes the user ID in the path', async () => {
    const { client, requests } = await mock(ok({ id: 'a/b' }));
    const user = await client.users.get('a/b');
    expect(user.id).toBe('a/b');
    expect(requests[0]!.url).toBe('/api/users/a%2Fb');
  });

  it('lists roles', async () => {
    const { client, requests } = await mock(ok([{ id: Roles.Viewer, permissions: ['geofences.read'] }]));
    expect(await client.users.listRoles()).toEqual([{ id: Roles.Viewer, permissions: ['geofences.read'] }]);
    expect(requests[0]!.url).toBe('/api/users/roles');
  });

  it('invites a user', async () => {
    const { client, requests } = await mock(
      ok(
        {
          email: 'new@acme.com',
          role: Roles.Viewer,
          status: 'pending',
          invite_url: 'https://dashboard.geoengine.dev/accept-invite?token=t',
          expires_at: '2026-12-01T00:00:00Z',
        },
        201
      )
    );

    const inv = await client.users.invite({ email: 'new@acme.com', role: Roles.Viewer, inviterName: 'Ana', lang: 'en' });

    expect(inv.inviteUrl).toBe('https://dashboard.geoengine.dev/accept-invite?token=t');
    expect(inv.expiresAt).toBe('2026-12-01T00:00:00Z');
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/api/users/invite');
    expect(requests[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(requests[0]!.body)).toEqual({
      email: 'new@acme.com',
      role: Roles.Viewer,
      inviter_name: 'Ana',
      lang: 'en',
    });
  });

  it.each([
    ['INVITATION_PENDING', InvitationPendingError],
    ['USER_ALREADY_EXISTS', UserAlreadyExistsError],
  ])('maps invite conflict %s to a typed error', async (reason, ErrorClass) => {
    const { client } = await mock(apiError(409, reason, 'conflicto'));
    const err = await client.users.invite({ email: 'dup@acme.com', role: Roles.Viewer }).catch(e => e);
    expect(err).toBeInstanceOf(ErrorClass);
    expect(err).toBeInstanceOf(APIServiceError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(reason);
    expect(err.apiMessage).toBe('conflicto');
  });

  it('rejects invalid input locally without calling the API', async () => {
    const { client, requests } = await mock(ok({}));
    await expect(client.users.invite({ email: ' ', role: Roles.Viewer })).rejects.toBeInstanceOf(EmailRequiredError);
    await expect(client.users.invite({ email: 'x@acme.com', role: '' })).rejects.toBeInstanceOf(RoleRequiredError);
    await expect(client.users.get('  ')).rejects.toBeInstanceOf(UserIDRequiredError);
    await expect(client.users.updateRole('u1', ' ')).rejects.toBeInstanceOf(RoleRequiredError);
    await expect(client.users.remove('')).rejects.toBeInstanceOf(UserIDRequiredError);
    expect(requests).toHaveLength(0);
  });

  it('updates a role', async () => {
    const { client, requests } = await mock(ok({ id: 'u1', role: Roles.Dispatcher }));
    const user = await client.users.updateRole('u1', Roles.Dispatcher);
    expect(user.role).toBe(Roles.Dispatcher);
    expect(requests[0]!.method).toBe('PATCH');
    expect(requests[0]!.url).toBe('/api/users/u1/role');
    expect(JSON.parse(requests[0]!.body)).toEqual({ role: Roles.Dispatcher });
  });

  it('removes a user', async () => {
    const { client, requests } = await mock(ok({ id: 'u1', status: 'revoked' }));
    await expect(client.users.remove('u1')).resolves.toBeUndefined();
    expect(requests[0]!.method).toBe('DELETE');
    expect(requests[0]!.url).toBe('/api/users/u1');
  });

  it('tolerates an empty 204 response on remove', async () => {
    const { client } = await mock({ status: 204 });
    await expect(client.users.remove('u1')).resolves.toBeUndefined();
  });

  it.each([
    [409, 'LAST_ADMIN', LastAdminError],
    [404, 'USER_NOT_FOUND', UserNotFoundError],
    [404, 'USER_REVOKED', UserNotFoundError],
    [401, 'MISSING_API_KEY', AuthenticationError],
  ])('maps %i %s to a typed error', async (status, reason, ErrorClass) => {
    const { client } = await mock(apiError(status, reason, 'nope'));
    await expect(client.users.remove('u1')).rejects.toBeInstanceOf(ErrorClass);
  });

  it('falls back to the HTTP status when the body has no reason', async () => {
    const forbidden = await mock({ status: 403, body: 'denied' });
    await expect(forbidden.client.users.list()).rejects.toBeInstanceOf(ForbiddenError);
    await closeServer!();

    const teapot = await mock({ status: 418, body: 'short and stout' });
    const err = await teapot.client.users.list().catch(e => e);
    expect(err).toBeInstanceOf(APIServiceError);
    expect(err.code).toBe('');
    expect(err.message).toBe('geoengine: api-service error (status 418): short and stout');
  });

  it('treats success:false in a 200 response as an error', async () => {
    const { client } = await mock({ ...apiError(200, 'USER_NOT_FOUND', 'x'), status: 200 });
    await expect(client.users.get('u1')).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('retries reads on 5xx but never retries writes', async () => {
    const reads = await mock((_req, n) => (n === 1 ? { status: 503, body: 'down' } : ok([])));
    await expect(reads.client.users.list()).resolves.toEqual([]);
    expect(reads.requests).toHaveLength(2);
    await closeServer!();

    const writes = await mock({ status: 503, body: 'down' });
    await expect(writes.client.users.invite({ email: 'a@acme.com', role: Roles.Viewer })).rejects.toBeInstanceOf(
      APIServiceError
    );
    expect(writes.requests).toHaveLength(1);
  });

  it('rejects calls after the client is closed', async () => {
    const { client, requests } = await mock(ok([]));
    client.close();
    await expect(client.users.list()).rejects.toBeInstanceOf(ClientClosedError);
    await expect(client.geoIdentity.listRules()).rejects.toBeInstanceOf(ClientClosedError);
    expect(requests).toHaveLength(0);
  });
});

describe('GeoIdentity module', () => {
  it('creates a rule, sending snake_case and omitting unset fields', async () => {
    const { client, requests } = await mock(ok(RULE, 201));
    const geoLimit = polygonFromLatLng([
      [19.4, -99.2],
      [19.4, -99.1],
      [19.5, -99.1],
    ]);

    const rule = await client.geoIdentity.createRule({
      name: 'Solo CDMX',
      priority: 10,
      action: RuleActions.Block,
      blackIpList: ['10.0.0.0/8'],
      blockTor: true,
      geoLimit,
      assignedSubjects: [{ subjectType: SubjectTypes.User, subjectId: 'u1' }],
    });

    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('/api/users/geoidentity/rules');
    expect(JSON.parse(requests[0]!.body)).toEqual({
      name: 'Solo CDMX',
      priority: 10,
      action: 'BLOCK',
      black_ip_list: ['10.0.0.0/8'],
      block_tor: true,
      geo_limit: {
        type: 'Polygon',
        coordinates: [
          [
            [-99.2, 19.4],
            [-99.1, 19.4],
            [-99.1, 19.5],
            [-99.2, 19.4],
          ],
        ],
      },
      assigned_subjects: [{ subject_type: 'USER', subject_id: 'u1' }],
    });
    expect(rule).toMatchObject({
      id: 'r1',
      orgId: 'o1',
      action: 'BLOCK',
      isActive: true,
      whiteIpList: [],
      blackIpList: ['10.0.0.0/8'],
      blockDatacenter: false,
      riskAccepted: 0,
      assignedSubjects: [{ subjectType: 'USER', subjectId: 'u1' }],
      subjectsCount: 1,
    });
    expect(client.GeoIdentity).toBe(client.geoIdentity);
  });

  it('requires a rule name and rule ID', async () => {
    const { client, requests } = await mock(ok(RULE));
    await expect(client.geoIdentity.createRule({ name: ' ' })).rejects.toBeInstanceOf(RuleNameRequiredError);
    await expect(client.geoIdentity.getRule('')).rejects.toBeInstanceOf(RuleIDRequiredError);
    await expect(client.geoIdentity.deleteRule(' ')).rejects.toBeInstanceOf(RuleIDRequiredError);
    await expect(client.geoIdentity.assignToUser('r1', ' ')).rejects.toBeInstanceOf(UserIDRequiredError);
    await expect(client.geoIdentity.unassignFromUser('r1', '')).rejects.toBeInstanceOf(UserIDRequiredError);
    await expect(client.geoIdentity.listUserRules('')).rejects.toBeInstanceOf(UserIDRequiredError);
    expect(requests).toHaveLength(0);
  });

  it('filters listRules by isActive', async () => {
    const { client, requests } = await mock(ok([RULE]));
    expect(await client.geoIdentity.listRules({ isActive: false })).toHaveLength(1);
    expect(await client.geoIdentity.listRules()).toHaveLength(1);
    expect(requests[0]!.url).toBe('/api/users/geoidentity/rules?is_active=false');
    expect(requests[1]!.url).toBe('/api/users/geoidentity/rules');
  });

  it('gets a rule and maps RULE_NOT_FOUND', async () => {
    const found = await mock(ok(RULE));
    expect((await found.client.geoIdentity.getRule('r/1')).id).toBe('r1');
    expect(found.requests[0]!.url).toBe('/api/users/geoidentity/rules/r%2F1');
    await closeServer!();

    const missing = await mock(apiError(404, 'RULE_NOT_FOUND', 'Regla no encontrada'));
    await expect(missing.client.geoIdentity.getRule('nope')).rejects.toBeInstanceOf(RuleNotFoundError);
  });

  it('sends only the changed fields on update and an explicit null to remove geoLimit', async () => {
    const { client, requests } = await mock(ok(RULE));
    await client.geoIdentity.updateRule('r1', { geoLimit: null, isActive: false });
    expect(requests[0]!.method).toBe('PATCH');
    expect(requests[0]!.url).toBe('/api/users/geoidentity/rules/r1');
    expect(JSON.parse(requests[0]!.body)).toEqual({ geo_limit: null, is_active: false });
  });

  it('deletes a rule', async () => {
    const { client, requests } = await mock(ok(null));
    await expect(client.geoIdentity.deleteRule('r1')).resolves.toBeUndefined();
    expect(requests[0]!.method).toBe('DELETE');
    expect(requests[0]!.url).toBe('/api/users/geoidentity/rules/r1');
  });

  it.each([
    ['assignToUser', 'POST', { scope: 'user', user_id: 'u2' }],
    ['assignToOrganization', 'POST', { scope: 'organization' }],
    ['unassignFromUser', 'DELETE', { scope: 'user', user_id: 'u2' }],
    ['unassignFromOrganization', 'DELETE', { scope: 'organization' }],
  ] as const)('%s sends %s with the right payload', async (fn, method, payload) => {
    const { client, requests } = await mock(ok(RULE));
    const rule = fn.endsWith('User')
      ? await client.geoIdentity[fn as 'assignToUser']('r1', ' u2 ')
      : await client.geoIdentity[fn as 'assignToOrganization']('r1');
    expect(rule.id).toBe('r1');
    expect(requests[0]!.method).toBe(method);
    expect(requests[0]!.url).toBe('/api/users/geoidentity/rules/r1/assignments');
    expect(JSON.parse(requests[0]!.body)).toEqual(payload);
  });

  it('maps LAST_SUBJECT when removing the only subject', async () => {
    const { client } = await mock(apiError(409, 'LAST_SUBJECT', 'La regla debe conservar un sujeto'));
    await expect(client.geoIdentity.unassignFromOrganization('r1')).rejects.toBeInstanceOf(LastSubjectError);
  });

  it('lists the rules that apply to a user', async () => {
    const { client, requests } = await mock(ok([RULE]));
    const rules = await client.geoIdentity.listUserRules('u1');
    expect(rules[0]!.name).toBe('Solo CDMX');
    expect(requests[0]!.url).toBe('/api/users/u1/geoidentity/rules');
  });

  it('returns an empty list when data is null', async () => {
    const { client } = await mock(ok(null));
    expect(await client.geoIdentity.listRules()).toEqual([]);
  });
});

describe('polygonFromLatLng', () => {
  it('does not duplicate the closing point of an already closed ring', () => {
    const poly = polygonFromLatLng([
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ]);
    expect(poly.coordinates[0]).toHaveLength(4);
  });

  it('validates the input', () => {
    expect(() => polygonFromLatLng([[0, 0], [1, 1]])).toThrow(InvalidCoordinatesError);
    expect(() => polygonFromLatLng([[91, 0], [0, 1], [1, 1]])).toThrow(InvalidLatitudeError);
  });
});
