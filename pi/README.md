# pi

Personal [pi](https://pi.dev) coding agent configuration, stowed into `~/.pi`.

## Install on a new machine

Run the repo setup script:

```bash
cd ~/repos/dotfiles && ./setup.sh
```

Or stow this package alone:

```bash
stow -d ~/repos/dotfiles -t ~ pi
```

Pi installs the npm packages listed in `settings.json` automatically at
startup, so extensions and skills appear on first run.

## Not tracked (set up per machine)

- `~/.pi/agent/auth.json` — login tokens. Run `/login` inside pi.
- `~/.pi/agent/models.json` — custom providers with API keys. Copy it by
  hand or write your own.
- `~/.pi/agent/trust.json` — per-machine project trust decisions.
- Everything else in `~/.pi/agent` (sessions, caches, npm packages) is
  machine state and rebuilds itself.
