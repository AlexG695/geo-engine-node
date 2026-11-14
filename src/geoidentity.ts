import { RuleIDRequiredError, RuleNameRequiredError, UserIDRequiredError } from './errors.js';
import type { HttpClient } from './http.js';
import { apiServiceRequest, userPath } from './users.js';
import { validateAndNormalizePolygon } from './validation.js';

/** Verdict applied when a GeoIdentity rule matches. */
export const RuleActions = {
  Allow: 'ALLOW',
  Block: 'BLOCK',
  Challenge: 'CHALLENGE',
} as const;
export type RuleAction = (typeof RuleActions)[keyof typeof RuleActions];

/** Who a GeoIdentity rule applies to. `All` applies the rule to every member of the organization. */
export const SubjectTypes = {
  User: 'USER',
  Role: 'ROLE',
  Device: 'DEVICE',
  All: 'ALL',
} as const;
export type SubjectType = (typeof SubjectTypes)[keyof typeof SubjectTypes];

/** Binds a rule to a subject. For SubjectTypes.All the subjectId is "*". */
export interface SubjectAssignment {
  subjectType: SubjectType;
  subjectId: string;
}

/** GeoJSON Polygon or MultiPolygon used as a rule's spatial boundary. See polygonFromLatLng. */
export type GeoLimit =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** A GeoIdentity access policy. */
export interface Rule {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  priority: number;
  action: RuleAction;
  isActive: boolean;
  whiteIpList: string[];
  blackIpList: string[];
  blockDatacenter: boolean;
  blockTor: boolean;
  riskAccepted: number;
  geoLimit?: GeoLimit | null;
  /** Only populated by calls that return a single rule (getRule, createRule, assignments...). */
  assignedSubjects: SubjectAssignment[];
  subjectsCount: number;
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** ISO 8601 timestamp. */
  updatedAt?: string;
}

/**
 * Payload for GeoIdentityService.createRule.
 * When assignedSubjects is empty the rule applies to the whole organization.
 */
export interface CreateRuleRequest {
  name: string;
  description?: string;
  priority?: number;
  action?: RuleAction;
  isActive?: boolean;
  /** IPs or CIDR ranges. */
  whiteIpList?: string[];
  /** IPs or CIDR ranges. */
  blackIpList?: string[];
  blockDatacenter?: boolean;
  blockTor?: boolean;
  riskAccepted?: number;
  geoLimit?: GeoLimit;
  assignedSubjects?: SubjectAssignment[];
}

/**
 * Payload for GeoIdentityService.updateRule. Omitted fields are left unchanged.
 * Set geoLimit to null to remove the spatial boundary.
 */
export interface UpdateRuleRequest {
  name?: string;
  description?: string;
  priority?: number;
  action?: RuleAction;
  isActive?: boolean;
  whiteIpList?: string[];
  blackIpList?: string[];
  blockDatacenter?: boolean;
  blockTor?: boolean;
  riskAccepted?: number;
  geoLimit?: GeoLimit | null;
  assignedSubjects?: SubjectAssignment[];
}

/** Filters GeoIdentityService.listRules. Omit isActive to return every rule. */
export interface ListRulesOptions {
  isActive?: boolean;
}

interface RawSubject {
  subject_type: SubjectType;
  subject_id: string;
}

interface RawRule {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  priority: number;
  action: RuleAction;
  is_active: boolean;
  white_ip_list?: string[] | null;
  black_ip_list?: string[] | null;
  block_datacenter?: boolean;
  block_tor?: boolean;
  risk_accepted?: number;
  geo_limit?: GeoLimit | null;
  assigned_subjects?: RawSubject[] | null;
  subjects_count?: number;
  created_at?: string;
  updated_at?: string;
}

function toRule(raw: RawRule): Rule {
  return {
    id: raw.id,
    orgId: raw.org_id,
    name: raw.name,
    description: raw.description,
    priority: raw.priority ?? 0,
    action: raw.action,
    isActive: Boolean(raw.is_active),
    whiteIpList: raw.white_ip_list ?? [],
    blackIpList: raw.black_ip_list ?? [],
    blockDatacenter: Boolean(raw.block_datacenter),
    blockTor: Boolean(raw.block_tor),
    riskAccepted: raw.risk_accepted ?? 0,
    geoLimit: raw.geo_limit,
    assignedSubjects: (raw.assigned_subjects ?? []).map(s => ({
      subjectType: s.subject_type,
      subjectId: s.subject_id,
    })),
    subjectsCount: raw.subjects_count ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Converts a create/update request to the snake_case wire format. Undefined fields are dropped by JSON.stringify. */
function toWire(req: CreateRuleRequest | UpdateRuleRequest): Record<string, unknown> {
  return {
    name: req.name,
    description: req.description,
    priority: req.priority,
    action: req.action,
    is_active: req.isActive,
    white_ip_list: req.whiteIpList,
    black_ip_list: req.blackIpList,
    block_datacenter: req.blockDatacenter,
    block_tor: req.blockTor,
    risk_accepted: req.riskAccepted,
    geo_limit: req.geoLimit,
    assigned_subjects: req.assignedSubjects?.map(s => ({
      subject_type: s.subjectType,
      subject_id: s.subjectId,
    })),
  };
}

const RULES_PATH = '/api/users/geoidentity/rules';

function rulePath(ruleId: string, suffix = ''): string {
  if (typeof ruleId !== 'string' || ruleId.trim() === '') {
    throw new RuleIDRequiredError();
  }
  return `${RULES_PATH}/${encodeURIComponent(ruleId.trim())}${suffix}`;
}

function requireUserId(userId: string): string {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new UserIDRequiredError();
  }
  return userId.trim();
}

/**
 * Manages GeoIdentity access rules and assigns them to users or to the whole organization.
 * Equivalent to Go's GeoIdentityService.
 */
export class GeoIdentityService {
  constructor(
    private readonly http: HttpClient,
    private readonly isClosed: () => boolean = () => false
  ) {}

  /** Creates a GeoIdentity rule. */
  async createRule(req: CreateRuleRequest): Promise<Rule> {
    if (typeof req?.name !== 'string' || req.name.trim() === '') {
      throw new RuleNameRequiredError();
    }
    return toRule(await this.send<RawRule>('POST', RULES_PATH, toWire(req)));
  }

  /**
   * Returns the organization's rules ordered by priority.
   * Use getRule to load a rule's assigned subjects.
   */
  async listRules(opts: ListRulesOptions = {}): Promise<Rule[]> {
    const query = typeof opts.isActive === 'boolean' ? `?is_active=${opts.isActive}` : '';
    const raw = await this.send<RawRule[] | null>('GET', RULES_PATH + query);
    return (raw ?? []).map(toRule);
  }

  /** Returns a rule including its assigned subjects. */
  async getRule(ruleId: string): Promise<Rule> {
    return toRule(await this.send<RawRule>('GET', rulePath(ruleId)));
  }

  /** Partially updates a rule. */
  async updateRule(ruleId: string, req: UpdateRuleRequest): Promise<Rule> {
    return toRule(await this.send<RawRule>('PATCH', rulePath(ruleId), toWire(req ?? {})));
  }

  /** Deletes a rule and all of its assignments. */
  async deleteRule(ruleId: string): Promise<void> {
    await this.send<unknown>('DELETE', rulePath(ruleId));
  }

  /** Applies the rule to a member of the organization. Assigning twice is a no-op. */
  async assignToUser(ruleId: string, userId: string): Promise<Rule> {
    return this.changeAssignment('POST', ruleId, { scope: 'user', user_id: requireUserId(userId) });
  }

  /** Applies the rule to every member of the organization. */
  async assignToOrganization(ruleId: string): Promise<Rule> {
    return this.changeAssignment('POST', ruleId, { scope: 'organization' });
  }

  /**
   * Removes a user assignment from the rule.
   * Throws LastSubjectError if it is the rule's only subject; deactivate or delete the rule instead.
   */
  async unassignFromUser(ruleId: string, userId: string): Promise<Rule> {
    return this.changeAssignment('DELETE', ruleId, { scope: 'user', user_id: requireUserId(userId) });
  }

  /**
   * Removes the organization-wide assignment from the rule.
   * Throws LastSubjectError if it is the rule's only subject.
   */
  async unassignFromOrganization(ruleId: string): Promise<Rule> {
    return this.changeAssignment('DELETE', ruleId, { scope: 'organization' });
  }

  /**
   * Returns the rules that apply to a user: assigned directly, through the user's role,
   * or to the whole organization.
   */
  async listUserRules(userId: string): Promise<Rule[]> {
    const raw = await this.send<RawRule[] | null>('GET', userPath(userId, '/geoidentity/rules'));
    return (raw ?? []).map(toRule);
  }

  private async changeAssignment(
    method: string,
    ruleId: string,
    payload: { scope: 'user' | 'organization'; user_id?: string }
  ): Promise<Rule> {
    return toRule(await this.send<RawRule>(method, rulePath(ruleId, '/assignments'), payload));
  }

  private send<T>(method: string, path: string, body?: unknown): Promise<T> {
    return apiServiceRequest<T>(this.http, this.isClosed, method, path, body);
  }
}

/**
 * Builds a GeoJSON Polygon for a rule's geoLimit from [lat, lng] pairs, the same order
 * used by GeoEngine.createGeofence. The ring is closed automatically.
 * Equivalent to Go's PolygonFromLatLng.
 */
export function polygonFromLatLng(
  coordinates: Array<[number, number] | number[]>
): { type: 'Polygon'; coordinates: number[][][] } {
  return { type: 'Polygon', coordinates: [validateAndNormalizePolygon(coordinates)] };
}
