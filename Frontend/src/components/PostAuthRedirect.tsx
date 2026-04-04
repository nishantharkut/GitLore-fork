import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";

/**
 * Sends signed-in users without a stored repo to /repos (except when already there).
 */
export function PostAuthRedirect() {
  const { user, loading } = useAuth();
  const { repoReady } = useRepo();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (repoReady) return;
    if (pathname === "/repos") return;
    navigate("/repos", { replace: true });
  }, [user, loading, repoReady, pathname, navigate]);

  return null;
}
