import { Navigate, Route, Routes } from "react-router-dom";
import { AuthContext, useAuth, useAuthState } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { MfaSetup } from "@/pages/MfaSetup";
import { CertificateView } from "@/pages/CertificateView";
import { QuoteView } from "@/pages/QuoteView";
import {
  ADMIN_CONSOLE_ONLY_ROLES,
  ADMIN_LOGIN_ALLOWED_ROLES,
  LANDING_ROUTE_BY_ROLE,
  LEARNER_LOGIN_ALLOWED_ROLES,
  MANAGER_LOGIN_ALLOWED_ROLES,
  MANAGER_ONLY_ROLES,
  ORG_ADMIN_LOGIN_ALLOWED_ROLES,
  ORG_ADMIN_ONLY_ROLES,
  ROUTES,
  SUPER_ADMIN_ONLY_ROLES,
} from "@/constants/routes";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import { VerifyEmail } from "@/pages/VerifyEmail";
import { Onboarding } from "@/pages/Onboarding";
import { Placement } from "@/pages/Placement";
import { FaceEnrollment } from "@/pages/FaceEnrollment";
import { PlacementTest } from "@/pages/PlacementTest";
import { Roadmap } from "@/pages/Roadmap";
import { Dashboard } from "@/pages/Dashboard";
import { Progress } from "@/pages/Progress";
import { Modules } from "@/pages/Modules";
import { PracticeTests } from "@/pages/PracticeTests";
import { Tutor } from "@/pages/Tutor";
import { Profile } from "@/pages/Profile";
import { AdminReview } from "@/pages/AdminReview";
import { IntegrityReviews } from "@/pages/IntegrityReviews";
import { AdminsList } from "@/pages/admin/AdminsList";
import { OrgAdminsList } from "@/pages/admin/OrgAdminsList";
import { ManagersList } from "@/pages/admin/ManagersList";
import { AdminProfile } from "@/pages/admin/AdminProfile";
import { StaffDashboard } from "@/pages/staff/StaffDashboard";
import { StaffLearners } from "@/pages/staff/StaffLearners";
import { StaffBilling } from "@/pages/staff/StaffBilling";
import { StaffAudit } from "@/pages/staff/StaffAudit";
import { SystemPage } from "@/pages/staff/SystemPage";
import { StaffInsights } from "@/pages/staff/StaffInsights";
import { PlansCatalog } from "@/pages/staff/PlansCatalog";
import { AdminOrganizations } from "@/pages/admin/AdminOrganizations";
import { OrgAdminDashboard } from "@/pages/orgAdmin/OrgAdminDashboard";
import { OrgAdminBatches } from "@/pages/orgAdmin/OrgAdminBatches";
import { OrgAdminManagers } from "@/pages/orgAdmin/OrgAdminManagers";
import { LicenseGate } from "@/components/licenses/LicenseGate";
import { Plans } from "@/pages/Plans";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { CheckoutReturn } from "@/pages/CheckoutReturn";
import { InvoiceView } from "@/pages/InvoiceView";
import { OrgAdminLicenses } from "@/pages/orgAdmin/OrgAdminLicenses";
import { OrgAdminPlan } from "@/pages/orgAdmin/OrgAdminPlan";
import { OrgAdminAudit } from "@/pages/orgAdmin/OrgAdminAudit";
import { OrgAdminSettings } from "@/pages/orgAdmin/OrgAdminSettings";
import { OrgAdminDevelopers } from "@/pages/orgAdmin/OrgAdminDevelopers";
import { ManagerActivity } from "@/pages/manager/ManagerActivity";
import { ManagerBatches } from "@/pages/manager/ManagerBatches";
import { OrgAdminLearners } from "@/pages/orgAdmin/OrgAdminLearners";
import { ManagerDashboard } from "@/pages/manager/ManagerDashboard";
import { ManagerLearners } from "@/pages/manager/ManagerLearners";
import { AppLayout } from "@/components/AppShell/AppLayout";
import { AdminLayout } from "@/components/AppShell/AdminLayout";

// Unmatched path: logged-in goes to their landing page, logged-out to learner login.
function DefaultRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  return <Navigate to={LANDING_ROUTE_BY_ROLE[user.role]} replace />;
}

function App() {
  const auth = useAuthState();

  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path={ROUTES.LOGIN} element={<Login allowedRoles={LEARNER_LOGIN_ALLOWED_ROLES} />} />
        <Route
          path={ROUTES.ORG_ADMIN_LOGIN}
          element={<Login allowedRoles={ORG_ADMIN_LOGIN_ALLOWED_ROLES} />}
        />
        <Route path={ROUTES.MANAGER_LOGIN} element={<Login allowedRoles={MANAGER_LOGIN_ALLOWED_ROLES} />} />
        <Route path={ROUTES.ADMIN_LOGIN} element={<Login allowedRoles={ADMIN_LOGIN_ALLOWED_ROLES} />} />
        <Route path="/superadmin/login" element={<Navigate to={ROUTES.ADMIN_LOGIN} replace />} />
        <Route path="/login" element={<Navigate to={ROUTES.LOGIN} replace />} />
        <Route path={ROUTES.SIGNUP} element={<Signup />} />
        <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPassword />} />
        <Route path={ROUTES.RESET_PASSWORD} element={<ResetPassword />} />
        <Route path={ROUTES.CERTIFICATE} element={<CertificateView />} />
        <Route
          path={ROUTES.MFA_SETUP}
          element={
            <ProtectedRoute>
              <MfaSetup />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.CHECKOUT_RETURN}
          element={
            <ProtectedRoute>
              <CheckoutReturn />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.QUOTE}
          element={
            <ProtectedRoute>
              <QuoteView />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.INVOICE}
          element={
            <ProtectedRoute>
              <InvoiceView />
            </ProtectedRoute>
          }
        />
        <Route path={ROUTES.VERIFY_EMAIL} element={<VerifyEmail />} />
        <Route
          path={ROUTES.ONBOARDING}
          element={
            <ProtectedRoute>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.PLACEMENT}
          element={
            <ProtectedRoute>
              <LicenseGate feature="placement">
                <Placement />
              </LicenseGate>
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.FACE_ENROLLMENT}
          element={
            <ProtectedRoute>
              <FaceEnrollment />
            </ProtectedRoute>
          }
        />
        <Route
          path={ROUTES.PLACEMENT_TEST}
          element={
            <ProtectedRoute>
              <LicenseGate feature="placement">
                <PlacementTest />
              </LicenseGate>
            </ProtectedRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path={ROUTES.ROADMAP} element={<Roadmap />} />
          <Route path={ROUTES.DASHBOARD} element={<Dashboard />} />
          <Route path={ROUTES.PROGRESS} element={<Progress />} />
          <Route path={ROUTES.MODULES} element={<LicenseGate feature="practice"><Modules /></LicenseGate>} />
          <Route path={ROUTES.PRACTICE_TESTS} element={<LicenseGate feature="mocktest"><PracticeTests /></LicenseGate>} />
          <Route path={ROUTES.TUTOR} element={<LicenseGate feature="coach"><Tutor /></LicenseGate>} />
          <Route path={ROUTES.PROFILE} element={<Profile />} />
          <Route path={ROUTES.PLANS} element={<Plans />} />
        </Route>
        {/* Super Admin's own console — every organization, manages other Admins. */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout allowedRoles={SUPER_ADMIN_ONLY_ROLES} />
            </ProtectedRoute>
          }
        >
          <Route path={ROUTES.ADMIN_DASHBOARD} element={<StaffDashboard />} />
          <Route path={ROUTES.SUPER_ORGANIZATIONS} element={<AdminOrganizations />} />
          <Route path={ROUTES.SUPER_BILLING} element={<StaffBilling />} />
          <Route path={ROUTES.SUPER_AUDIT} element={<StaffAudit />} />
          <Route path={ROUTES.SUPER_SYSTEM} element={<SystemPage />} />
          <Route path={ROUTES.SUPER_INSIGHTS} element={<StaffInsights />} />
          <Route path={ROUTES.SUPER_PLANS} element={<PlansCatalog />} />
          <Route path={ROUTES.ADMIN_ADMINS} element={<AdminsList />} />
          <Route path={ROUTES.ADMIN_ORG_ADMINS} element={<OrgAdminsList />} />
          <Route path={ROUTES.ADMIN_MANAGERS} element={<ManagersList />} />
          <Route path={ROUTES.ADMIN_LEARNERS} element={<StaffLearners />} />
          <Route path={ROUTES.ADMIN_PROFILE} element={<AdminProfile />} />
          <Route path={ROUTES.ADMIN_ANALYTICS} element={<AnalyticsPage />} />
          <Route path={ROUTES.ADMIN_REVIEW} element={<AdminReview />} />
          <Route path={ROUTES.SUPER_INTEGRITY} element={<IntegrityReviews />} />
        </Route>
        {/* An Admin's own, separate console — never the same URLs or nav as Super Admin's. */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout allowedRoles={ADMIN_CONSOLE_ONLY_ROLES} />
            </ProtectedRoute>
          }
        >
          <Route path={ROUTES.ADMIN_CONSOLE_DASHBOARD} element={<StaffDashboard />} />
          <Route path={ROUTES.ADMIN_CONSOLE_ORG_ADMINS} element={<OrgAdminsList />} />
          <Route path={ROUTES.ADMIN_CONSOLE_BILLING} element={<StaffBilling />} />
          <Route path={ROUTES.ADMIN_CONSOLE_AUDIT} element={<StaffAudit />} />
          <Route path={ROUTES.ADMIN_CONSOLE_REVIEWS} element={<AdminReview />} />
          <Route path={ROUTES.ADMIN_CONSOLE_INTEGRITY} element={<IntegrityReviews />} />
          <Route path={ROUTES.ADMIN_CONSOLE_ADMINS} element={<AdminsList />} />
          <Route path={ROUTES.ADMIN_CONSOLE_INSIGHTS} element={<StaffInsights />} />
          <Route path={ROUTES.ADMIN_CONSOLE_PLANS} element={<PlansCatalog />} />
          <Route path={ROUTES.ADMIN_CONSOLE_ORGANIZATIONS} element={<AdminOrganizations />} />
          <Route path={ROUTES.ADMIN_CONSOLE_MANAGERS} element={<ManagersList />} />
          <Route path={ROUTES.ADMIN_CONSOLE_USERS} element={<StaffLearners />} />
          <Route path={ROUTES.ADMIN_CONSOLE_PROFILE} element={<AdminProfile />} />
          <Route path={ROUTES.ADMIN_CONSOLE_ANALYTICS} element={<AnalyticsPage />} />
        </Route>
        {/* Org Admin's own console — their one organization only: every batch, every Manager. */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout allowedRoles={ORG_ADMIN_ONLY_ROLES} />
            </ProtectedRoute>
          }
        >
          <Route path={ROUTES.ORG_ADMIN_DASHBOARD} element={<OrgAdminDashboard />} />
          <Route path={ROUTES.ORG_ADMIN_BATCHES} element={<OrgAdminBatches />} />
          <Route path={ROUTES.ORG_ADMIN_MANAGERS} element={<OrgAdminManagers />} />
          <Route path={ROUTES.ORG_ADMIN_LEARNERS} element={<OrgAdminLearners />} />
          <Route path={ROUTES.ORG_ADMIN_LICENSES} element={<OrgAdminLicenses />} />
          <Route path={ROUTES.ORG_ADMIN_PLAN} element={<OrgAdminPlan />} />
          <Route path={ROUTES.ORG_ADMIN_AUDIT} element={<OrgAdminAudit />} />
          <Route path={ROUTES.ORG_ADMIN_INTEGRITY} element={<IntegrityReviews />} />
          <Route path={ROUTES.ORG_ADMIN_SETTINGS} element={<OrgAdminSettings />} />
          <Route path={ROUTES.ORG_ADMIN_DEVELOPERS} element={<OrgAdminDevelopers />} />
          <Route path={ROUTES.ORG_ADMIN_PROFILE} element={<AdminProfile />} />
          <Route path={ROUTES.ORG_ADMIN_ANALYTICS} element={<AnalyticsPage />} />
        </Route>
        {/* Manager's own console — only the batch(es) assigned to them. */}
        <Route
          element={
            <ProtectedRoute>
              <AdminLayout allowedRoles={MANAGER_ONLY_ROLES} />
            </ProtectedRoute>
          }
        >
          <Route path={ROUTES.MANAGER_DASHBOARD} element={<ManagerDashboard />} />
          <Route path={ROUTES.MANAGER_BATCHES} element={<ManagerBatches />} />
          <Route path={ROUTES.MANAGER_LEARNERS} element={<ManagerLearners />} />
          <Route path={ROUTES.MANAGER_ACTIVITY} element={<ManagerActivity />} />
          <Route path={ROUTES.MANAGER_PROFILE} element={<AdminProfile />} />
          <Route path={ROUTES.MANAGER_ANALYTICS} element={<AnalyticsPage />} />
        </Route>
        <Route path="*" element={<DefaultRedirect />} />
      </Routes>
    </AuthContext.Provider>
  );
}

export default App;
