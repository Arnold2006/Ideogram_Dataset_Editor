"""
Ideogram4 Dataset Editor — portable updater (mirrors ComfyUI_windows_portable/update/update.py)
Tries pygit2 (python_embeded) first, falls back to plain `git` CLI.
- stashes local changes, pulls origin/<branch>, restores stash branch as backup
- then runs npm install if package.json changed; optionally rebuilds
Usage: python update.py [repo_root] [--skip_self_update] [--rebuild]
"""
import sys, os, shutil, subprocess, filecmp

def has_pygit2():
    try:
        import pygit2  # noqa
        return True
    except: return False

def try_pygit2_pull(repo_path, branch="master"):
    import pygit2
    from datetime import datetime
    pygit2.option(pygit2.GIT_OPT_SET_OWNER_VALIDATION, 0)
    repo = pygit2.Repository(repo_path)
    ident = pygit2.Signature("ideogram4", "ideogram4@local")
    # stash
    try:
        print("stashing current changes")
        repo.stash(ident)
    except KeyError:
        print("nothing to stash")
    except Exception as e:
        print(f"Could not stash, cleaning: {e}")
        try:
            repo.state_cleanup()
            repo.index.read_tree(repo.head.peel().tree)
            repo.index.write()
            repo.stash(ident)
        except: pass
    # backup branch
    backup = f"backup_branch_{datetime.today().strftime('%Y-%m-%d_%H_%M_%S')}"
    print(f"creating backup branch: {backup}")
    try: repo.branches.local.create(backup, repo.head.peel())
    except: pass
    # checkout branch
    br = repo.lookup_branch(branch)
    if br is None:
        try:
            ref = repo.lookup_reference(f"refs/remotes/origin/{branch}")
        except:
            print("fetching...")
            for r in repo.remotes:
                if r.name == "origin": r.fetch()
            ref = repo.lookup_reference(f"refs/remotes/origin/{branch}")
        repo.checkout(ref)
        br = repo.lookup_branch(branch)
        if br is None:
            repo.create_branch(branch, repo.get(ref.target))
    else:
        repo.checkout(repo.lookup_reference(br.name))
    # pull (fast-forward / merge)
    def pull(repo, remote_name='origin', branch='master'):
        for remote in repo.remotes:
            if remote.name == remote_name:
                remote.fetch()
                target = repo.lookup_reference(f'refs/remotes/origin/{branch}').target
                analysis, _ = repo.merge_analysis(target)
                if analysis & pygit2.GIT_MERGE_ANALYSIS_UP_TO_DATE:
                    return
                elif analysis & pygit2.GIT_MERGE_ANALYSIS_FASTFORWARD:
                    repo.checkout_tree(repo.get(target))
                    try:
                        mref = repo.lookup_reference(f'refs/heads/{branch}')
                        mref.set_target(target)
                    except KeyError:
                        repo.create_branch(branch, repo.get(target))
                    repo.head.set_target(target)
                elif analysis & pygit2.GIT_MERGE_ANALYSIS_NORMAL:
                    repo.merge(target)
                    if repo.index.conflicts is not None:
                        for c in repo.index.conflicts:
                            print("Conflicts in:", c[0].path)
                        raise AssertionError("Conflicts, aborting")
                    user = repo.default_signature
                    tree = repo.index.write_tree()
                    repo.create_commit('HEAD', user, user, 'Merge!', tree, [repo.head.target, target])
                    repo.state_cleanup()
                else:
                    raise AssertionError("Unknown merge result")
    print("pulling latest changes")
    pull(repo, branch=branch)
    print("Done (pygit2)!")
    return True

def try_git_cli_pull(repo_path, branch="master"):
    print("Trying git CLI...")
    # stash + pull
    def run(*args):
        return subprocess.run(args, cwd=repo_path, capture_output=True, text=True)
    # ensure repo
    r = run("git", "status")
    if r.returncode != 0:
        print("Not a git repo or git not found:", r.stderr[:400])
        return False
    print(run("git", "stash", "push", "-m", "ideogram4 auto stash").stdout[:200])
    # backup branch
    import datetime
    bname = f"backup_branch_{datetime.datetime.today().strftime('%Y-%m-%d_%H_%M_%S')}"
    run("git", "branch", bname)
    print(f"backup branch {bname}")
    # pull
    run("git", "checkout", branch)
    r2 = run("git", "pull", "origin", branch)
    print(r2.stdout[:800] or r2.stderr[:800])
    return r2.returncode == 0

def npm_install_if_needed(repo_path):
    cur = os.path.join(os.path.dirname(__file__), "current_requirements.txt")
    # for node we track package.json hash; keep old name for compat but check package.json
    pkg = os.path.join(repo_path, "package.json")
    lock = os.path.join(repo_path, "package-lock.json")
    # simple: always run npm install when update asks, but check file equality to skip if unchanged
    try:
        changed = not os.path.exists(cur) or not filecmp.cmp(pkg, cur, shallow=False)
    except: changed = True
    if changed:
        print("Running npm install (package.json changed)...")
        exe = "npm.cmd" if os.name == "nt" else "npm"
        # prefer calling via npm.cmd on windows
        try:
            subprocess.check_call([exe, "install"], cwd=repo_path)
            shutil.copy(pkg, cur)
            if os.path.exists(lock):
                shutil.copy(lock, os.path.join(os.path.dirname(__file__), "current_package_lock.txt"))
        except Exception as e:
            print(f"npm install failed: {e} — you can run `npm install` manually.")

if __name__ == "__main__":
    repo_path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    branch = "master"
    # detect default branch
    for b in ["master", "main"]:
        if os.path.exists(os.path.join(repo_path, ".git", "refs", "heads", b)):
            branch = b
            break
    ok = False
    if has_pygit2():
        try: ok = try_pygit2_pull(repo_path, branch)
        except Exception as e:
            print(f"pygit2 pull failed: {e}")
    if not ok:
        try: ok = try_git_cli_pull(repo_path, branch)
        except Exception as e: print(f"git CLI pull failed: {e}")
    if not ok:
        print("Update failed — no git/pygit2 available. Ensure repo is a git clone and `git` is on PATH,")
        print("or put python_embeded with pygit2 next to the portable (like ComfyUI_windows_portable).")
        sys.exit(1)
    # self-update: copy newer update.py from repo if shipped
    self_update = "--skip_self_update" not in sys.argv
    if self_update:
        src_new = os.path.join(repo_path, "update", "update.py")
        cur = os.path.realpath(__file__)
        try:
            if os.path.exists(src_new) and not filecmp.cmp(cur, src_new, shallow=False) and os.path.getsize(src_new) > 10:
                shutil.copy(src_new, os.path.join(os.path.dirname(cur), "update_new.py"))
                print("Updater copied to update_new.py — will run again on next update.")
        except: pass
    # npm deps
    npm_install_if_needed(repo_path)
    if "--rebuild" in sys.argv:
        print("Rebuilding portable (npm run dist)...")
        exe = "npm.cmd" if os.name == "nt" else "npm"
        try: subprocess.check_call([exe, "run", "dist"], cwd=repo_path)
        except Exception as e: print(f"rebuild failed: {e}")
    print("Update complete!")
