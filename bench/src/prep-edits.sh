#!/bin/sh
# Copy original outputs into bench/edits/ so edit agents patch copies in place.
set -e
cd "$(dirname "$0")/.."
for m in haiku opus; do for a in A B C; do
  mkdir -p edits/$m/$a && cp gen/$m/$a/* edits/$m/$a/
done; done
find edits -type f | wc -l
