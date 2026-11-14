import { ClientClosedError, EmailRequiredError, RoleRequiredError, UserIDRequiredError } from './errors.js';
import type { HttpClient } from './http.js';

/**
 * Organization roles accepted by the Users service.
 * The short form ("admin", "viewer", ...) is also accepted by the API.
 */
export const Roles = {
  Admin: 'roles/geoengine.admin',
  Dispatcher: 'roles/geoengine.dispatcher',
  Billing: 'roles/geoengine.billing',
  Viewer: 'roles/geoengine.viewer',
  Device: 'roles/geoengine.device',
} as const;

/** User status values returned by the API. */
export const UserStatus = {
  Active: 'active',
  Pending: 'pending',
  Revoked: 'revoked',
} as const;

/** A member of the organization that owns the API key. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  permissions: string[];
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** ISO 8601 timestamp. Absent if the user never signed in. */
  lastLoginAt?: string;
}

/** An organization role and the permissions it grants. */
export interface Role {
  id: string;
  permissions: string[];
}

/** Payload for UsersService.invite. */
export interface InviteUserRequest {
  email: string;
  role: string;
  /** Shown in the invitation email. Optional. */
  inviterName?: string;
  /** Email language: "es" (default), "en" or "pt". Optional. */
  lang?: 'es' | 'en' | 'pt' | (string & {});
}

/**
 * Result of UsersService.invite. The invitation email is sent by GeoEngine;
 * inviteUrl is returned as well so it can be delivered through other channels.
 */
export interface Invitation {
  email: string;
  role: string;
  status: string;
  inviteUrl: string;
  /** ISO 8601 timestamp. */
  expiresAt?: string;
}

interface RawUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  permissions?: string[] | null;
  created_at?: string;
  last_login_at?: string;
}

interface RawInvitation {
  email: string;
  role: string;
  status: string;
  invite_url: string;
  expires_at?: string;
}

function toUser(raw: RawUser): User {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name,
    role: raw.role,
    status: raw.status,
    permissions: raw.permissions ?? [],
    createdAt: raw.created_at,
    lastLoginAt: raw.last_login_at,
  };
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** Builds "/api/users/{id}{suffix}", rejecting empty IDs. Equivalent to Go's userPath. */
export function userPath(userId: string, suffix = ''): string {
  if (isBlank(userId)) {
    throw new UserIDRequiredError();
  }
  return `/api/users/${encodeURIComponent(userId.trim())}${suffix}`;
}

/**
 * Sends a Users / GeoIdentity request to the api-service.
 * Equivalent to Go's Client.doAPIServiceRequest.
 */
export async function apiServiceRequest<T>(
  http: HttpClient,
  isClosed: () => boolean,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  if (isClosed()) {
    throw new ClientClosedError();
  }
  return http.request<T>({
    endpoint: `${http.options.apiServiceUrl.replace(/\/+$/, '')}${path}`,
    method,
    body,
    isApiService: true,
  });
}

/**
 * Manages organization members, roles and invitations through the api-service.
 * Equivalent to Go's UsersService.
 */
export class UsersService {
  constructor(
    private readonly http: HttpClient,
    private readonly isClosed: () => boolean = () => false
  ) {}

  /** Returns the members of the organization. */
  async list(): Promise<User[]> {
    const raw = await this.send<RawUser[] | null>('GET', '/api/users');
    return (raw ?? []).map(toUser);
  }

  /** Returns a single member of the organization. */
  async get(userId: string): Promise<User> {
    return toUser(await this.send<RawUser>('GET', userPath(userId)));
  }

  /** Returns the roles available to the organization and their permissions. */
  async listRoles(): Promise<Role[]> {
    const raw = await this.send<Array<{ id: string; permissions?: string[] | null }> | null>(
      'GET',
      '/api/users/roles'
    );
    return (raw ?? []).map(r => ({ id: r.id, permissions: r.permissions ?? [] }));
  }

  /**
   * Creates an invitation and emails it to the recipient.
   * Throws InvitationPendingError if a pending invitation already exists for the email,
   * and UserAlreadyExistsError if the email already belongs to the organization.
   */
  async invite(req: InviteUserRequest): Promise<Invitation> {
    if (isBlank(req?.email)) {
      throw new EmailRequiredError();
    }
    if (isBlank(req.role)) {
      throw new RoleRequiredError();
    }
    const raw = await this.send<RawInvitation>('POST', '/api/users/invite', {
      email: req.email,
      role: req.role,
      inviter_name: req.inviterName || undefined,
      lang: req.lang || undefined,
    });
    return {
      email: raw.email,
      role: raw.role,
      status: raw.status,
      inviteUrl: raw.invite_url,
      expiresAt: raw.expires_at,
    };
  }

  /**
   * Changes the role of a member. The new permissions apply on the user's next sign-in.
   * Throws LastAdminError if the change would leave the organization without an admin.
   */
  async updateRole(userId: string, role: string): Promise<User> {
    if (isBlank(role)) {
      throw new RoleRequiredError();
    }
    return toUser(await this.send<RawUser>('PATCH', userPath(userId, '/role'), { role }));
  }

  /**
   * Revokes a member's access to the organization.
   * Throws LastAdminError if the member is the last admin.
   */
  async remove(userId: string): Promise<void> {
    await this.send<unknown>('DELETE', userPath(userId));
  }

  private send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return apiServiceRequest<T>(this.http, this.isClosed, method, path, body);
  }
}
