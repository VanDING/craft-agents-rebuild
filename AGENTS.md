# Repository collaboration defaults

## Git remotes

- `rebuild` (`VanDING/craft-agents-rebuild`) is this project's working repository.
- When a request mentions the remote `main` branch without naming a remote, interpret it as `rebuild/main`.
- `origin` (`craft-ai-agents/craft-agents-oss`) is the upstream repository. Only use `origin/main` when the request explicitly says upstream or names `origin`.
- Use SSH for all GitHub Git operations. Do not default to HTTPS.
- In environments where the standard SSH port is unavailable, use GitHub SSH over port 443 (`ssh://git@ssh.github.com:443/<owner>/<repository>.git`), which is the verified connection method for this workspace.

