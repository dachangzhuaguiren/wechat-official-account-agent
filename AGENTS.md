# Interface design rules

- Preserve the three-surface workflow: project navigation, writing canvas, and Agent inspector.
- Use Codex-inspired neutral surfaces, thin separators, compact controls, and restrained elevation.
- Keep primary actions charcoal; reserve green and red for semantic states only.
- Use the vendored Phosphor icon font for interface icons. Do not use emoji or text glyphs as UI icons.
- Keep all existing writing, editing, audit, preview, backup, and responsive interactions functional.

# Deployment rules

- Treat `https://k8w98rr595-blip.github.io/wechat-official-account-agent/` as the only production user entry point.
- Use localhost only for development and verification; every completed product change must be deployed to the production URL.
- Keep model API keys in the separately hosted backend environment. Never place secrets in GitHub Pages assets or Git history.
- Do not report a change as complete until the production deployment and its core workflow have been verified.
