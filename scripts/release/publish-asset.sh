#!/usr/bin/env bash
# Put one file on a fixed public release page, replacing the previous one
# without a gap (v1.65). Used by the Android and Windows builds.
#
#   publish-asset.sh <tag> <file> <asset-name> <title> <notes-file> <latest:true|false>
#
# The page is https://github.com/$GITHUB_REPOSITORY/releases/tag/<tag> and the
# file https://github.com/$GITHUB_REPOSITORY/releases/download/<tag>/<asset-name>
# — no GitHub login, never expires. Uploading under a temporary name and then
# renaming means anyone downloading during a publish still gets a whole file
# (deleting and re-creating the release left the link dead for that moment).
#
# Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S., USMC.
# Project signature: HFCALC-AG-EZK-USMC-v1
set -euo pipefail
TAG="$1"; FILE="$2"; NAME="$3"; TITLE="$4"; NOTES="$5"; LATEST="$6"
R="$GITHUB_REPOSITORY"
TMP="next-$NAME"
cp "$FILE" "$TMP"
if gh release view "$TAG" > /dev/null 2>&1; then
  gh release upload "$TAG" "$TMP" --clobber
  ids() { gh api "repos/$R/releases/tags/$TAG" --jq ".assets[] | select(.name==\"$1\") | .id"; }
  OLD=$(ids "$NAME"); NEW=$(ids "$TMP")
  [ -n "$OLD" ] && gh api -X DELETE "repos/$R/releases/assets/$OLD"
  gh api -X PATCH "repos/$R/releases/assets/$NEW" -f name="$NAME" > /dev/null
  gh release edit "$TAG" --title "$TITLE" --notes-file "$NOTES" --latest="$LATEST"
else
  mv "$TMP" "$NAME"
  gh release create "$TAG" "$NAME" --target "$GITHUB_SHA" --title "$TITLE" --notes-file "$NOTES" --latest="$LATEST"
fi
gh api "repos/$R/releases/tags/$TAG" --jq '.assets[] | "  " + .name + "  " + (.size|tostring) + " bytes"'
echo "Published ${TITLE}: https://github.com/${R}/releases/tag/${TAG}" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
