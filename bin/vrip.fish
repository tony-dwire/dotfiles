#!/usr/bin/env fish
set -e

if test -z "$argv[1]"
    echo "Error: Please provide a movie name. Example: vrip 'Finding Nemo' 2003"
    exit 1
end

# Audible notification: freedesktop event sound, terminal bell as fallback.
function ding
    set -l sound (set -q argv[1]; and echo $argv[1]; or echo complete)
    canberra-gtk-play -i "$sound" 2>/dev/null
    or printf '\a'
end

set -l movie_name $argv[1]
set -l year (set -q argv[2]; and echo $argv[2])

# Jellyfin-friendly layout: 'Movie Name (Year)/Movie Name (Year).mp4'
if test -n "$year"
    set -l movie_dir "$movie_name ($year)"
    set -l movie_file "$movie_dir/$movie_dir.mp4"
else
    set -l movie_file "$movie_name.mp4"
end

echo "Scanning disc layout..."
set -l title (lsdvd -x /dev/sr0 2>/dev/null | awk '/Longest track:/ {print $3}')

if test -z "$title"
    ding bell
    echo "Error: Could not read DVD track structure. Is a disc inserted?"
    exit 1
end

echo "Encoding main title (Track $title) directly from disc using Nvidia GPU..."
# Read straight from the disc: libdvdnav follows the real playback path,
# which sidesteps ARccOS-style protection (bogus sectors / fake angles)
# that breaks full-disc mirroring with dvdbackup.
test -n "$year"; and mkdir -p "$movie_dir"
HandBrakeCLI -i /dev/sr0 -t $title --angle 1 \
    -e nvenc_h264 -q 20 -B 160 --comb-detect --decomb \
    -o "$movie_file"

if test $status -ne 0
    ding bell
    echo "Error: HandBrake failed."
    exit 1
end

ding
echo "Done! Saved to $movie_file"
