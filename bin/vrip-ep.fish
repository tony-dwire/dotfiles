#!/usr/bin/env fish
# Rips TV episodes from the DVD in /dev/sr0 into a Jellyfin layout:
#   Show Name/Season 01/Show Name S01E01.mp4
#
# Episode discs carry junk titles (warnings), one giant "play all" title, and
# one title per episode. Episodes all run about the same length, so we keep
# the densest cluster of similar-length titles and drop everything else.

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

echo "Scanning disc layout..."
set -l detected (lsdvd -x $dev 2>/dev/null | awk -v min=$min_secs -v tol=$tol_secs '
    /^Title: / {
        tn = $2; gsub(/,/, "", tn)
        split($4, t, ":")
        secs = t[1]*3600 + t[2]*60 + t[3]
        if (secs >= min) { n++; dur[n] = secs; ttl[n] = tn + 0 }
    }
    END {
        for (i = 2; i <= n; i++) {
            d = dur[i]; k = ttl[i]; j = i - 1
            while (j >= 1 && dur[j] > d) { dur[j+1] = dur[j]; ttl[j+1] = ttl[j]; j-- }
            dur[j+1] = d; ttl[j+1] = k
        }
        best = 0
        for (i = 1; i <= n; i++) {
            cnt = 0
            for (j = i; j <= n && dur[j] - dur[i] <= tol; j++) cnt++
            if (cnt > best) { best = cnt; med = dur[int((i + j - 1) / 2)] }
        }
        if (best == 0) exit 1
        for (i = 1; i <= n; i++)
            if (dur[i] >= 0.6 * med && dur[i] <= 1.4 * med)
                print ttl[i], dur[i]
    }' | sort -n)

if test (count $detected) -eq 0
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
    printf '  Title %2d (%4d min) -> %s/%s\n' $parts[1] (math "floor($parts[2] / 60)") "$season_dir" "$outfile"
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
    set -l title (string split ' ' $line)[1]
    set -l outfile (printf '%s S%02dE%02d.mp4' "$show_name" $season $ep)
    set -l outpath "$season_dir/$outfile"

    if test -s "$outpath"
        echo "[$outfile] exists, skipping."
        set ep (math $ep + 1)
        continue
    end

    echo "[$outfile] Encoding Title $title..."
    if not HandBrakeCLI -i $dev -t $title --angle 1 \
            -e nvenc_h264 -q 20 -B 160 --comb-detect --decomb \
            -o "$outpath"
        echo "Error: HandBrake failed on Title $title ($outfile)."
        set fails (math $fails + 1)
    end
    set ep (math $ep + 1)
end

if test $fails -ne 0
    echo "Done, but $fails episode(s) failed. Re-run the same command to retry."
    exit 1
end
echo "Done! $total episodes saved to $season_dir/"
