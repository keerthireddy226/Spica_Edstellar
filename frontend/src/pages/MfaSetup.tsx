import { useNavigate } from "react-router-dom";
import { MfaCard } from "@/components/MfaCard";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { LANDING_ROUTE_BY_ROLE } from "@/constants/routes";

// Where an Org Admin or Manager lands when their organization requires
// two-step sign-in and they haven't set it up yet. Nothing else opens until
// they do.
export function MfaSetup() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app-surface min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl flex flex-col gap-4">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Set up two-step sign-in</h1>
          <p className="text-sm text-muted mt-1">
            {user?.mfaSetupRequired
              ? "Your organization requires a code from an authenticator app each time you sign in. Set it up to continue."
              : "Add a code from an authenticator app to your sign-in."}
          </p>
        </div>
        <MfaCard
          onEnabled={async () => {
            await refresh();
            if (user) navigate(LANDING_ROUTE_BY_ROLE[user.role], { replace: true });
          }}
        />
        <Button variant="secondary" onClick={() => logout()} className="self-start">
          Sign out
        </Button>
      </div>
    </div>
  );
}
