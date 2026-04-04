import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useRepo } from "@/context/RepoContext";
import { useToast } from "@/context/ToastContext";

/**
 * Sends signed-in users without a stored repo to /repos (except when already there).
 */
export function PostAuthRedirect() {
  const { user, loading } = useAuth();
  const { repoReady } = useRepo();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { toast } = useToast();
  const pickRepoToastSent = useRef(false);
  const oauthToastSent = useRef(false);

  useEffect(() => {
    if (loading || !user) return;
    try {
      if (!oauthToastSent.current && sessionStorage.getItem("gitlore-oauth-pending") === "1") {
        sessionStorage.removeItem("gitlore-oauth-pending");
        oauthToastSent.current = true;
        toast({ message: "Connected to GitHub", type: "success" });
      }
    } catch {
      /* ignore */
    }
  }, [loading, user, toast]);

  useEffect(() => {
    if (repoReady) pickRepoToastSent.current = false;
  }, [repoReady]);

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (repoReady) return;
    if (pathname === "/repos") return;
    if (!pickRepoToastSent.current) {
      pickRepoToastSent.current = true;
      toast({ message: "Pick a repository to get started", type: "info" });
    }
    navigate("/repos", { replace: true });
  }, [user, loading, repoReady, pathname, navigate, toast]);

  return null;
}
