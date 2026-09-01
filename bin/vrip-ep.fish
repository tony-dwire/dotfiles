#!/usr/bin/env fish
# Rips TV episodes from the DVD in /dev/sr0 into a Jellyfin layout:
#   Show Name/Season 01/Show Name S01E01.mp4
#
# Episode discs come in two layouts:
#   1. junk titles (warnings), one giant "play all" title, and one title per
#      episode (e.g. Bluey)
#   2. one or more giant "play all" titles with each episode as a chapter
#      (e.g. Sword Art Online), plus maybe a few standalone episode titles
# Either way episodes run about the same length, so: pool every title length
# and every long-enough chapter length, keep the densest cluster of similar
# durations = the episode length, and emit one rip unit per episode.

if test (count $argv) -lt 2
    echo "Usage: vrip-ep 'Show Name' <season> [first_episode] [-y]"
    echo ""
    echo "  vrip-ep 'Bluey' 1        # disk 1: episodes 1-26"
    echo "  vrip-ep 'Bluey' 1 27     # disk 2: episodes 27-52"
    exit 1
end

set -l show_name $argv[1]
set -l season $argv[2]
set -l first_ep 1
set -l auto_yes 0
for arg in $argv[3..-1]
    switch $arg
        case -y --yes
            set auto_yes 1
        case -h --help
            echo "See header comment of this script."
            exit 0
        case '*'
            set first_ep $arg
    end
end

set -l dev (set -q VRIP_DEV; and echo $VRIP_DEV; or echo /dev/sr0)
set -l min_secs (set -q VRIP_EP_MIN_SECS; and echo $VRIP_EP_MIN_SECS; or echo 120)
set -l tol_secs (set -q VRIP_EP_TOL_SECS; and echo $VRIP_EP_TOL_SECS; or echo 90)

# Audible notification: freedesktop event sound, terminal bell as fallback.
function ding
    set -l sound (set -q argv[1]; and echo $argv[1]; or echo complete)
    canberra-gtk-play -i "$sound" 2>/dev/null
    or printf '\a'
end

echo "Scanning disc layout..."
set -l detected (lsdvd -x $dev 2>/dev/null | awk -v min=$min_secs -v tol=$tol_secs '
    $1 == "Title:" {
        cur = $2 + 0
        split($4, t, ":")
        tsecs[cur] = t[1]*3600 + t[2]*60 + t[3]
        nc[cur] = 0
        if (cur > maxt) maxt = cur
    }
    $1 == "Chapter:" && cur {
        split($4, t, ":")
        secs = t[1]*3600 + t[2]*60 + t[3]
        if (secs < min) next
        nc[cur]++
        cdur[cur, nc[cur]] = secs
        cnum[cur, nc[cur]] = $2 + 0
    }
    END {
        n = 0
        for (ti = 1; ti <= maxt; ti++)
            if (ti in tsecs && tsecs[ti] >= min) pool[++n] = tsecs[ti]
        for (ti = 1; ti <= maxt; ti++)
            for (ci = 1; ci <= nc[ti]; ci++) pool[++n] = cdur[ti, ci]
        for (i = 2; i <= n; i++) {
            d = pool[i]; j = i - 1
            while (j >= 1 && pool[j] > d) { pool[j+1] = pool[j]; j-- }
            pool[j+1] = d
        }
        best = 0
        for (i = 1; i <= n; i++) {
            cnt = 0
            for (j = i; j <= n && pool[j] - pool[i] <= tol; j++) cnt++
            if (cnt > best) { best = cnt; med = pool[int((i + j - 1) / 2)] }
        }
        if (best == 0) exit 1
        for (ti = 1; ti <= maxt; ti++) {
            if (!(ti in tsecs) || tsecs[ti] < min) continue
            if (tsecs[ti] >= 0.6 * med && tsecs[ti] <= 1.4 * med) {
                print ti, 0, tsecs[ti]
            } else {
                for (ci = 1; ci <= nc[ti]; ci++)
                    if (cdur[ti, ci] >= 0.6 * med && cdur[ti, ci] <= 1.4 * med)
                        print ti, cnum[ti, ci], cdur[ti, ci]
            }
        }
    }')

if test (count $detected) -eq 0
    ding bell
    echo "Error: No episode-like titles found. Is the right disc inserted?"
    exit 1
end

set -l season_padded (printf %02d $season)
set -l season_dir "$show_name/Season $season_padded"
set -l total (count $detected)

echo "Detected $total episodes:"
set -l ep $first_ep
for line in $detected
    set -l outfile (printf '%s S%02dE%02d.mp4' "$show_name" $season $ep)
    set -l parts (string split ' ' $line)
    if test $parts[2] = 0
        set -l src (printf 'Title %d' $parts[1])
        printf '  %-16s (%4d min) -> %s/%s\n' $src (math "floor($parts[3] / 60)") "$season_dir" "$outfile"
    else
        set -l src (printf 'Title %d ch %d' $parts[1] $parts[2])
        printf '  %-16s (%4d min) -> %s/%s\n' $src (math "floor($parts[3] / 60)") "$season_dir" "$outfile"
    end
    set ep (math $ep + 1)
end

if test $auto_yes -eq 0
    read -l -P "Rip these $total episodes? [y/N] " answer
    or exit 0
    string match -qi 'y' -- $answer; or exit 0
end

mkdir -p "$season_dir"

# Read straight from the disc: libdvdnav follows the real playback path,
# which sidesteps ARccOS-style protection (bogus sectors / fake angles)
# that breaks full-disc mirroring with dvdbackup.
set -l ep $first_ep
set -l fails 0
for line in $detected
    set -l parts (string split ' ' $line)
    set -l title $parts[1]
    set -l chap $parts[2]
    set -l outfile (printf '%s S%02dE%02d.mp4' "$show_name" $season $ep)
    set -l outpath "$season_dir/$outfile"

    if test -s "$outpath"
        echo "[$outfile] exists, skipping."
        set ep (math $ep + 1)
        continue
    end

    if test $chap = 0
        echo "[$outfile] Encoding Title $title..."
        if not HandBrakeCLI -i $dev -t $title --angle 1 \
                -e nvenc_h264 -q 20 -B 160 --comb-detect --decomb \
                -o "$outpath"
            echo "Error: HandBrake failed on Title $title ($outfile)."
            set fails (math $fails + 1)
        end
    else
        echo "[$outfile] Encoding Title $title, Chapter $chap..."
        if not HandBrakeCLI -i $dev -t $title --angle 1 --chapters "$chap-$chap" \
                -e nvenc_h264 -q 20 -B 160 --comb-detect --decomb \
                -o "$outpath"
            echo "Error: HandBrake failed on Title $title ch $chap ($outfile)."
            set fails (math $fails + 1)
        end
    end
    set ep (math $ep + 1)
end

if test $fails -ne 0
    ding bell
    echo "Done, but $fails episode(s) failed. Re-run the same command to retry."
    exit 1
end
ding
echo "Done! $total episodes saved to $season_dir/"
