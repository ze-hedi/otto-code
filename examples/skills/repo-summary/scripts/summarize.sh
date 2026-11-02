#!/usr/bin/env bash
dir="${1:-.}"
echo "total files: $(find "$dir" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | wc -l)"
echo "-- extensions --"
find "$dir" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' | sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' | sort | uniq -c | sort -rn | head -5
echo "-- largest files --"
find "$dir" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -exec du -h {} + | sort -rh | head -3
