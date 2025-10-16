export type SessionType = 'member' | 'branch';
export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Mode = 'all' | 'any';
export type ComputeInput = {
    role?: Role;
    sessionType: SessionType;
    viewAs?: SessionType;
};
export type Capability = string;
/**
 * Compute capabilities given role + sessionType.
 * - branch sessions: locked to minimal branch caps (no create/update/delete on structure)
 * - member sessions: role-based
 * - member view-as branch: intersect role caps with branch-safe set (defensive)
 */
export declare function computeCapabilities(input: ComputeInput): Capability[];
/** Check if a capability list includes a required cap (supports resource:* wildcard and global *) */
export declare function hasCapability(caps: Capability[] | undefined, required: Capability): boolean;
/** Check if caps satisfy a list in 'all' or 'any' mode */
export declare function satisfies(caps: Capability[] | undefined, required: string | string[], mode?: Mode): boolean;
