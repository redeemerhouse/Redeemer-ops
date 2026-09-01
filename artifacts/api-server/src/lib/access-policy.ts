export const ORGANIZATION_ID = "redeemer-house";

export const roles = ["owner_admin", "program_director", "house_manager", "resident"] as const;
export type Role = (typeof roles)[number];

export type PrincipalForPolicy = {
  role: Role;
  organizationId: string;
  houseNames: string[];
  residentId?: number;
};

export type Permission =
  | "dashboard:read"
  | "activity:read"
  | "resident:list"
  | "resident:read"
  | "resident:create"
  | "resident:update"
  | "payment:list"
  | "payment:create"
  | "expense:list"
  | "expense:create"
  | "income:list"
  | "income:create"
  | "meeting:list"
  | "meeting:create"
  | "house:list"
  | "report:read"
  | "report:export"
  | "resident:import"
  | "assessment:read"
  | "assessment:create"
  | "assessment:update"
  | "assessment:submit"
  | "assessment:manage";

export type AuthorizationContext = {
  houseName?: string;
  residentId?: number;
  targetHouseName?: string;
};

export function isAdministrator(principal: PrincipalForPolicy): boolean {
  return principal.role === "owner_admin" || principal.role === "program_director";
}

export function hasHouseScope(principal: PrincipalForPolicy, houseName: string): boolean {
  return isAdministrator(principal) || (principal.role === "house_manager" && principal.houseNames.includes(houseName));
}

export function canAccessResident(
  principal: PrincipalForPolicy,
  resident: { id: number; home: string },
  write = false,
): boolean {
  if (isAdministrator(principal)) return true;
  if (principal.role === "house_manager") return principal.houseNames.includes(resident.home);
  return !write && principal.role === "resident" && principal.residentId === resident.id;
}

export function authorize(
  principal: PrincipalForPolicy,
  permission: Permission,
  context: AuthorizationContext = {},
): boolean {
  if (principal.organizationId !== ORGANIZATION_ID) return false;
  const isResident = principal.role === "resident";
  const isManager = principal.role === "house_manager";
  const isAdmin = isAdministrator(principal);

  if (permission === "dashboard:read" || permission === "activity:read" || permission === "report:read") {
    return isAdmin || isManager;
  }
  if (permission === "report:export") return isAdmin;
  if (permission === "resident:import") return isAdmin || isManager;
  if (permission === "resident:list") return isAdmin || isManager || isResident;
  if (permission === "resident:create") {
    return (isAdmin || isManager) && (!context.targetHouseName || hasHouseScope(principal, context.targetHouseName));
  }
  if (permission === "resident:read" || permission === "resident:update") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    return permission === "resident:read" ? isAdmin || isManager || isResident : isAdmin || isManager;
  }
  if (permission === "payment:list") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    return isAdmin || isManager || isResident;
  }
  if (permission === "payment:create") {
    return (isAdmin || isManager) && (!context.houseName || hasHouseScope(principal, context.houseName));
  }
  if (permission === "expense:list" || permission === "expense:create" || permission === "income:list" || permission === "income:create") {
    return isAdmin;
  }
  if (permission === "meeting:list" || permission === "meeting:create") {
    return (isAdmin || isManager) && (!context.houseName || hasHouseScope(principal, context.houseName));
  }
  if (permission === "house:list") return isAdmin || isManager || isResident;
  if (permission === "assessment:read" || permission === "assessment:create" || permission === "assessment:update" || permission === "assessment:submit") {
    if (context.houseName && !hasHouseScope(principal, context.houseName)) return false;
    if (context.residentId !== undefined && isResident && context.residentId !== principal.residentId) return false;
    return isAdmin || isManager || isResident;
  }
  if (permission === "assessment:manage") return isAdmin;
  return false;
}