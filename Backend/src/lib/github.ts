import { graphql } from "@octokit/graphql";

export interface GitHubClient {
  query: (query: string, variables?: Record<string, any>) => Promise<any>;
}

export function createGithubClient(token: string): typeof graphql {
  return graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });
}

/**
 * GraphQL query to get blame information for a specific file and line
 */
const BLAME_QUERY = `
  query($owner: String!, $name: String!, $ref: String!, $path: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $ref) {
        ... on Commit {
          blame(path: $path) {
            ranges {
              startingLine
              endingLine
              age
              commit {
                oid
                message
                committedDate
                author {
                  name
                  email
                  user {
                    login
                  }
                }
                associatedPullRequests(first: 1) {
                  nodes {
                    number
                    title
                    body
                    url
                    state
                    mergedAt
                    author {
                      login
                    }
                    reviews(first: 10) {
                      nodes {
                        body
                        state
                        author {
                          login
                        }
                      }
                    }
                    comments(first: 20) {
                      nodes {
                        body
                        author {
                          login
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Get blame information for a specific line in a file
 */
export async function getBlameForLine(
  client: typeof graphql,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  lineNumber: number
): Promise<any> {
  try {
    const result: any = await client(BLAME_QUERY, {
      owner,
      name: repo,
      ref,
      path,
    });

    const ranges = result.repository?.object?.blame?.ranges || [];
    const range = ranges.find(
      (r: any) => lineNumber >= r.startingLine && lineNumber <= r.endingLine
    );

    return range || null;
  } catch (error) {
    console.error("Error fetching blame:", error);
    return null;
  }
}

/**
 * Extract issue numbers from PR body or commit message
 */
export function extractIssueNumbers(text: string): number[] {
  const pattern =
    /(?:closes|fixes|resolves|close|fix|resolve)\s+#(\d+)/gi;
  const matches = [...text.matchAll(pattern)];
  return [...new Set(matches.map((m) => parseInt(m[1])))];
}

/**
 * Get issue information
 */
export async function getIssue(
  client: typeof graphql,
  owner: string,
  repo: string,
  number: number
): Promise<any> {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) {
          title
          body
          createdAt
          comments(first: 10) {
            nodes {
              body
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  `;

  try {
    const result: any = await client(query, { owner, name: repo, number });
    return result.repository?.issue || null;
  } catch (error) {
    console.error("Error fetching issue:", error);
    return null;
  }
}

/**
 * Get PR information
 */
export async function getPullRequest(
  client: typeof graphql,
  owner: string,
  repo: string,
  number: number
): Promise<any> {
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          number
          title
          body
          state
          mergedAt
          author {
            login
          }
          changedFiles
          additions
          deletions
          reviews(first: 20) {
            nodes {
              body
              state
              author {
                login
              }
              createdAt
            }
          }
          comments(first: 30) {
            nodes {
              body
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  `;

  try {
    const result: any = await client(query, { owner, name: repo, number });
    return result.repository?.pullRequest || null;
  } catch (error) {
    console.error("Error fetching PR:", error);
    return null;
  }
}

/**
 * Get repository information
 */
export async function getRepositoryInfo(
  client: typeof graphql,
  owner: string,
  repo: string
): Promise<any> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        name
        description
        url
        isPrivate
        stargazerCount
        forkCount
        primaryLanguage {
          name
        }
        owner {
          login
          type
        }
      }
    }
  `;

  try {
    const result: any = await client(query, { owner, name: repo });
    return result.repository || null;
  } catch (error) {
    console.error("Error fetching repository info:", error);
    return null;
  }
}

/**
 * Get repository statistics
 */
export async function getRepositoryStats(
  client: typeof graphql,
  owner: string,
  repo: string
): Promise<any> {
  const query = `
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        refs(refPrefix: "refs/heads/", first: 1) {
          nodes {
            name
            target {
              ... on Commit {
                history(first: 1) {
                  totalCount
                }
              }
            }
          }
        }
        pullRequests(first: 1) {
          totalCount
        }
        issues(first: 1) {
          totalCount
        }
      }
    }
  `;

  try {
    const result: any = await client(query, { owner, name: repo });
    return result.repository || null;
  } catch (error) {
    console.error("Error fetching repository stats:", error);
    return null;
  }
}

/**
 * Get user information
 */
export async function getUserInfo(
  client: typeof graphql
): Promise<any> {
  const query = `
    query {
      viewer {
        login
        name
        email
        avatarUrl
        bio
      }
    }
  `;

  try {
    const result: any = await client(query);
    return result.viewer || null;
  } catch (error) {
    console.error("Error fetching user info:", error);
    return null;
  }
}
