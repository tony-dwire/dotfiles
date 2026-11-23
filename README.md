# dotfiles

Personal configuration files. GNU Stow and symlinks link them into place.

## Set up a new machine

```bash
git clone git@github.com:tony-dwire/dotfiles.git ~/repos/dotfiles
cd ~/repos/dotfiles && ./setup.sh
```

Run `./setup.sh` again any time. It is safe to re-run:

- Existing correct links are skipped.
- Conflicts (a link that points elsewhere, or a real file in the way) are reported, never overwritten.
- Use `./setup.sh --dry-run` to see what would change.

## How linking works

Most packages are one directory. `setup.sh` symlinks each top-level entry into `~/.config`. To add a new app, make a top-level directory with its config inside. The link appears on the next `./setup.sh` run.

Two packages work differently:

- **pi** — GNU Stow package targeting `$HOME`, not `~/.config`. Pi keeps config in `~/.pi/agent`, which also holds machine state (sessions, caches, logins). Stow links only the tracked files. See [pi/README.md](pi/README.md).
- **systemd** — unit files are copied by hand, not linked.

## Not tracked

- Machine state that rebuilds itself: caches, sessions, installed packages.
- Secrets. Pi logins (`auth.json`) and provider keys (`models.json`) stay on each machine. See `pi/README.md`.
- Repo-local pi runtime state (`/.pi/`), ignored via `.gitignore`.

## Other notes

- `packages.txt` lists the pacman packages to install.
- Git submodules (tmux plugins, awesome widgets) are pulled in by `setup.sh`.
- `bin/` holds small helper scripts; add it to your PATH if you want them.
