import type { Role } from "@/hooks/useAuth";

export const ROUTES = {
  LOGIN: "/learner/login",
  ORG_ADMIN_LOGIN: "/orgadmin/login",
  MANAGER_LOGIN: "/manager/login",
  // Shared portal for both admin and super_admin — see ADMIN_LOGIN_ALLOWED_ROLES.
  ADMIN_LOGIN: "/admin/login",
  SIGNUP: "/signup",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  VERIFY_EMAIL: "/verify-email",
  ONBOARDING: "/onboarding",
  PLACEMENT: "/placement",
  FACE_ENROLLMENT: "/face-enrollment",
  PLACEMENT_TEST: "/placement/test",
  ROADMAP: "/roadmap",
  DASHBOARD: "/dashboard",
  PROGRESS: "/progress",
  MODULES: "/modules",
  PRACTICE_TESTS: "/practice-tests",
  TUTOR: "/tutor",
  PROFILE: "/profile",
  PLANS: "/plans",
  CHECKOUT_RETURN: "/checkout/return",
  INVOICE: "/invoice/:id",
  ADMIN_REVIEW: "/admin/review",
  // Super Admin's own console — exclusively theirs, never reachable by an
  // Admin (see SUPER_ADMIN_ONLY_ROLES below). Sees every organization,
  // manages other Admin accounts.
  ADMIN_DASHBOARD: "/superadmin/dashboard",
  ADMIN_ADMINS: "/superadmin/admins",
  ADMIN_ORG_ADMINS: "/superadmin/org-admins",
  ADMIN_MANAGERS: "/superadmin/managers",
  ADMIN_LEARNERS: "/superadmin/learners",
  ADMIN_PROFILE: "/superadmin/profile",
  ADMIN_ANALYTICS: "/superadmin/analytics",
  // An Admin's own, separate console — no "manage other Admins" screen,
  // no bulk-onboard-admin, no unscoped individual-learners list. Just the
  // organizations assigned to them and their own profile.
  ADMIN_CONSOLE_DASHBOARD: "/admin/dashboard",
  ADMIN_CONSOLE_ORGANIZATIONS: "/admin/organizations",
  ADMIN_CONSOLE_USERS: "/admin/users",
  ADMIN_CONSOLE_MANAGERS: "/admin/managers",
  ADMIN_CONSOLE_PROFILE: "/admin/profile",
  ADMIN_CONSOLE_ANALYTICS: "/admin/analytics",
  // Org Admin's own console — their one organization only: every batch,
  // every Manager, every learner in it.
  ORG_ADMIN_DASHBOARD: "/orgadmin/dashboard",
  ORG_ADMIN_BATCHES: "/orgadmin/batches",
  ORG_ADMIN_MANAGERS: "/orgadmin/managers",
  ORG_ADMIN_LEARNERS: "/orgadmin/learners",
  ORG_ADMIN_LICENSES: "/orgadmin/licenses",
  ORG_ADMIN_ANALYTICS: "/orgadmin/analytics",
  ORG_ADMIN_PLAN: "/orgadmin/plan",
  ORG_ADMIN_AUDIT: "/orgadmin/audit",
  ORG_ADMIN_PROFILE: "/orgadmin/profile",
  // Manager's own console — only the batch(es) they were assigned, never
  // the whole organization.
  MANAGER_DASHBOARD: "/manager/dashboard",
  MANAGER_LEARNERS: "/manager/learners",
  MANAGER_PROFILE: "/manager/profile",
  MANAGER_ANALYTICS: "/manager/analytics",
} as const;

// These route groups are never shared — a role hitting another role's URL
// gets redirected to their own console, not shown the other role's data.
export const SUPER_ADMIN_ONLY_ROLES: Role[] = ["super_admin"];
export const ADMIN_CONSOLE_ONLY_ROLES: Role[] = ["admin"];
export const ORG_ADMIN_ONLY_ROLES: Role[] = ["org_admin"];
export const MANAGER_ONLY_ROLES: Role[] = ["manager"];

// Which role(s) each login portal accepts.
export const LEARNER_LOGIN_ALLOWED_ROLES: Role[] = ["learner"];
export const ORG_ADMIN_LOGIN_ALLOWED_ROLES: Role[] = ["org_admin"];
export const MANAGER_LOGIN_ALLOWED_ROLES: Role[] = ["manager"];
export const ADMIN_LOGIN_ALLOWED_ROLES: Role[] = ["admin", "super_admin"];

// Lets verify-email/reset-password send the learner to *their* role's login page.
export const LOGIN_ROUTE_BY_ROLE: Record<Role, string> = {
  learner: ROUTES.LOGIN,
  org_admin: ROUTES.ORG_ADMIN_LOGIN,
  manager: ROUTES.MANAGER_LOGIN,
  admin: ROUTES.ADMIN_LOGIN,
  super_admin: ROUTES.ADMIN_LOGIN,
};

// Every role now lands on its own real console — none of these share a URL
// or a nav set with any other role.
export const LANDING_ROUTE_BY_ROLE: Record<Role, string> = {
  learner: ROUTES.ONBOARDING,
  org_admin: ROUTES.ORG_ADMIN_DASHBOARD,
  manager: ROUTES.MANAGER_DASHBOARD,
  admin: ROUTES.ADMIN_CONSOLE_DASHBOARD,
  super_admin: ROUTES.ADMIN_DASHBOARD,
};

// Lets the header's user-menu send "Profile" to the right console's own page.
export const PROFILE_ROUTE_BY_ROLE: Record<Role, string> = {
  learner: ROUTES.PROFILE,
  org_admin: ROUTES.ORG_ADMIN_PROFILE,
  manager: ROUTES.MANAGER_PROFILE,
  admin: ROUTES.ADMIN_CONSOLE_PROFILE,
  super_admin: ROUTES.ADMIN_PROFILE,
};
