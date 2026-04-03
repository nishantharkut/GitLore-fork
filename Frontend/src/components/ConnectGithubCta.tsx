import type { ReactNode, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { startGithubOAuth } from "@/lib/githubOAuth";

type Props = {
  className?: string;
  children: ReactNode;
  /** If true, signed-in users go to GitHub OAuth again (rare); default sends them to /app */
  alwaysOAuth?: boolean;
};

/**
 * Primary “Connect GitHub” control: OAuth when signed out, app when signed in.
 */
export function ConnectGithubCta({ className, children, alwaysOAuth }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <span className={`inline-flex items-center opacity-70 ${className ?? ""}`} aria-busy>
        {children}
      </span>
    );
  }

  if (user && !alwaysOAuth) {
    return (
      <Link to="/app" className={className}>
        {children}
      </Link>
    );
  }

  const onGitHubClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    e.preventDefault();
    startGithubOAuth();
  };

  return (
    <a
      href="/auth/github"
      className={className}
      title="If this fails, try Incognito with extensions disabled. Console errors mentioning content.js are from a browser add-on, not GitLore."
      onClick={onGitHubClick}
    >
      {children}
    </a>
  );
}
