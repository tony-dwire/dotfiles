#!/usr/bin/env fish
set -e

if test -z "$argv[1]"
    echo "Error: Please provide a movie name. Example: vrip 'Finding Nemo'"
    exit 1
end

set -l movie_name $argv[1]

echo "Scanning disc layout..."
set -l title (lsdvd -x /dev/sr0 2>/dev/null | awk '/Longest track:/ {print $3}')

if test -z "$title"
    echo "Error: Could not read DVD track structure. Is a disc inserted?"
    exit 1
end

echo "Encoding main title (Track $title) directly from disc using Nvidia GPU..."
# Read straight from the disc: libdvdnav follows the real playback path,
# which sidesteps ARccOS-style protection (bogus sectors / fake angles)
# that breaks full-disc mirroring with dvdbackup.
HandBrakeCLI -i /dev/sr0 -t $title --angle 1 \
    -e nvenc_h264 -q 20 -B 160 --comb-detect --decomb \
    -o "$movie_name.mp4"

if test $status -ne 0
    echo "Error: HandBrake failed."
    exit 1
end

echo "Done! Saved to $movie_name.mp4"
